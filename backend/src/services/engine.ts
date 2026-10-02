// Workflow execution engine: graph → execution plan → queued jobs, with retry, cancellation,
// logging and output tracking. Execution state lives here and in the Job/WorkflowRun tables,
// never in the canvas UI state.
import fs from "node:fs";
import path from "node:path";
import {
  buildExecutionPlan,
  buildPromptLayers,
  checkConsistency,
  findUpstreamScene,
  getNodeTypeDef,
  randomId,
  renderTemplate,
  resolveNodeProvider,
  sceneVariables,
  upstreamIds,
  type CheckItem,
  type CheckReport,
  type JobStatus,
  type Output,
  type OutputKind,
  type Scene,
  type SpaceBundle,
  type WorkflowNode,
} from "@amw/shared";
import { ProviderError, ProviderNotConfiguredError, sleep, type MediaFile, type MediaResult, type ProviderContext, type ProviderRegistry } from "@amw/providers";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { BadRequestError, loadBundle, toJob, toOutput, toRun } from "../repo";
import type { Assistant } from "./assistant";
import { concatVideos, ffmpegAvailable } from "./ffmpeg";
import { exportSpace } from "./markdown";
import { mimeFromName, resolveData, writeDataFile } from "./storage";

export class RunBlockedError extends Error {
  statusCode = 422;
  constructor(public readonly report: CheckReport, public readonly blocking: CheckItem[]) {
    super(`Workflow check failed: ${blocking.map((b) => b.message).join("; ")}`);
  }
}

export interface RunOptions {
  /** Only run these nodes (plus their ancestors). */
  targets?: string[];
  /** "missing": reuse existing outputs of generator nodes that are not targets. "all": regenerate everything. */
  mode?: "missing" | "all";
}

interface NodeResult {
  status: JobStatus;
  outputs: Output[];
  blocked?: boolean;
  count?: number;
  prompt?: string;
  text?: string;
}

const GRAPH_CODES = new Set(["broken_edge", "cycle", "unknown_type", "duplicate_node", "self_loop"]);
const GENERATOR_TYPES = new Set(["imageGenerator", "imageEditor", "videoGenerator", "voiceGenerator", "lipSync", "finalVideo"]);

function preferred(outputs: Output[]): Output[] {
  const sel = outputs.filter((o) => o.selected);
  return sel.length ? sel : outputs;
}

class JobLogger {
  private lines: string[] = [];
  constructor(private db: Db, private jobId: string, private file: string) {}
  log = (m: string) => {
    const line = `${new Date().toISOString()} ${m}`;
    this.lines.push(line);
    try {
      fs.appendFileSync(this.file, `[${this.jobId}] ${line}\n`);
    } catch {
      /* log file is best effort */
    }
  };
  async flush() {
    await this.db.job.update({ where: { id: this.jobId }, data: { logs: JSON.stringify(this.lines) } });
  }
}

export class WorkflowEngine {
  private queue: string[] = [];
  private controllers = new Map<string, AbortController>();
  private processing = false;
  private idleWaiters: (() => void)[] = [];

  constructor(
    private db: Db,
    private registry: ProviderRegistry,
    private cfg: AppConfig,
    private assistant: Assistant,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  /** Marks jobs interrupted by a server restart as FAILED. */
  async recover() {
    const now = new Date();
    await this.db.job.updateMany({ where: { status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", error: "Interrupted by server restart", finishedAt: now } });
    await this.db.workflowRun.updateMany({ where: { status: { in: ["PENDING", "RUNNING"] } }, data: { status: "FAILED", error: "Interrupted by server restart", finishedAt: now } });
  }

  async start(spaceId: string, opts: RunOptions = {}) {
    const bundle = await loadBundle(this.db, spaceId);
    const report = checkConsistency(bundle, this.registry.list());
    let plan;
    try {
      plan = buildExecutionPlan(bundle.workflow, opts.targets);
    } catch (e) {
      throw new BadRequestError((e as Error).message);
    }
    if (!plan.order.length) throw new BadRequestError("Nothing to run: the workflow has no nodes");
    const planned = new Set(plan.order);
    const plannedScenes = new Set(
      bundle.workflow.nodes.filter((n) => planned.has(n.id) && n.type === "scene").map((n) => String(n.data.sceneId)),
    );
    const blocking = report.items.filter(
      (i) => i.level === "error" && (GRAPH_CODES.has(i.code) || (i.nodeId && planned.has(i.nodeId)) || (i.sceneId && plannedScenes.has(i.sceneId))),
    );
    if (blocking.length) throw new RunBlockedError(report, blocking);

    const runId = randomId("run");
    const maxAttempts = Math.max(1, Number(this.cfg.env.JOB_MAX_ATTEMPTS) || 2);
    await this.db.workflowRun.create({ data: { id: runId, spaceId, status: "PENDING", order: JSON.stringify(plan.order) } });
    const byId = new Map(bundle.workflow.nodes.map((n) => [n.id, n]));
    for (const nodeId of plan.order) {
      await this.db.job.create({ data: { id: randomId("job"), runId, spaceId, nodeId, nodeType: byId.get(nodeId)!.type, status: "PENDING", maxAttempts } });
    }
    this.controllers.set(runId, new AbortController());
    this.runOptions.set(runId, opts);
    this.queue.push(runId);
    void this.kick();
    return { run: toRun(await this.db.workflowRun.findUniqueOrThrow({ where: { id: runId } })), report };
  }

  private runOptions = new Map<string, RunOptions>();

  async cancel(runId: string) {
    const run = await this.db.workflowRun.findUnique({ where: { id: runId } });
    if (!run) throw new BadRequestError(`Run ${runId} not found`);
    this.controllers.get(runId)?.abort();
    const now = new Date();
    await this.db.job.updateMany({ where: { runId, status: "PENDING" }, data: { status: "CANCELLED", finishedAt: now, error: "Cancelled by user" } });
    if (this.queue.includes(runId)) {
      this.queue = this.queue.filter((r) => r !== runId);
      await this.db.workflowRun.update({ where: { id: runId }, data: { status: "CANCELLED", finishedAt: now } });
    }
    return toRun(await this.db.workflowRun.findUniqueOrThrow({ where: { id: runId } }));
  }

  /** Resolves when the queue is empty (used by tests). */
  whenIdle(): Promise<void> {
    if (!this.processing && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private async kick() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length) {
        const runId = this.queue.shift()!;
        try {
          await this.execute(runId);
        } catch (e) {
          await this.db.workflowRun.update({ where: { id: runId }, data: { status: "FAILED", error: (e as Error).message, finishedAt: new Date() } });
        } finally {
          this.controllers.delete(runId);
          this.runOptions.delete(runId);
        }
      }
    } finally {
      this.processing = false;
      this.idleWaiters.splice(0).forEach((r) => r());
    }
  }

  private async execute(runId: string) {
    const run = await this.db.workflowRun.findUniqueOrThrow({ where: { id: runId } });
    const controller = this.controllers.get(runId) ?? new AbortController();
    const opts = this.runOptions.get(runId) ?? {};
    const targets = new Set(opts.targets ?? []);
    await this.db.workflowRun.update({ where: { id: runId }, data: { status: "RUNNING" } });
    const bundle = await loadBundle(this.db, run.spaceId);
    const doc = bundle.workflow;
    const order: string[] = JSON.parse(run.order);
    const planned = new Set(order);
    const results = new Map<string, NodeResult>();
    const logFile = path.join(this.cfg.dataDir, "logs", `${runId}.log`);

    for (const nodeId of order) {
      const job = await this.db.job.findFirstOrThrow({ where: { runId, nodeId } });
      if (controller.signal.aborted || job.status === "CANCELLED") {
        await this.finishJob(job.id, "CANCELLED", "Cancelled by user");
        results.set(nodeId, { status: "CANCELLED", outputs: [] });
        continue;
      }
      const node = doc.nodes.find((n) => n.id === nodeId);
      const logger = new JobLogger(this.db, job.id, logFile);
      if (!node) {
        await this.finishJob(job.id, "FAILED", `Node ${nodeId} no longer exists`);
        results.set(nodeId, { status: "FAILED", outputs: [] });
        continue;
      }
      const ups = upstreamIds(doc, nodeId).filter((u) => planned.has(u));
      const bad = ups.find((u) => results.get(u)?.status !== "SUCCESS");
      const blocked = ups.find((u) => results.get(u)?.blocked);
      if (bad || blocked) {
        const reason = bad ? `Skipped: upstream ${bad} ${results.get(bad)?.status ?? "did not run"}` : `Skipped: condition ${blocked} is false`;
        await this.finishJob(job.id, "CANCELLED", reason);
        results.set(nodeId, { status: "CANCELLED", outputs: [] });
        continue;
      }

      // Reuse outputs of generators that already produced something (unless forced).
      if (GENERATOR_TYPES.has(node.type) && opts.mode !== "all" && !targets.has(nodeId)) {
        const existing = bundle.outputs.filter((o) => o.nodeId === nodeId);
        if (existing.length) {
          logger.log(`Reused ${existing.length} existing output(s)`);
          await logger.flush();
          await this.db.job.update({ where: { id: job.id }, data: { status: "SUCCESS", startedAt: new Date(), finishedAt: new Date(), outputIds: JSON.stringify(existing.map((o) => o.id)) } });
          results.set(nodeId, { status: "SUCCESS", outputs: existing });
          continue;
        }
      }

      let attempt = 0;
      for (;;) {
        attempt++;
        await this.db.job.update({ where: { id: job.id }, data: { status: "RUNNING", attempts: attempt, startedAt: new Date(), error: null } });
        await this.setSceneStatus(doc, node, bundle.scenes, "RUNNING");
        try {
          logger.log(`Attempt ${attempt}/${job.maxAttempts}: ${getNodeTypeDef(node.type)?.label ?? node.type}`);
          const result = await this.runNode(node, { bundle, results, signal: controller.signal, log: logger.log, jobId: job.id, runId });
          await logger.flush();
          await this.db.job.update({ where: { id: job.id }, data: { status: "SUCCESS", finishedAt: new Date(), outputIds: JSON.stringify(result.outputs.map((o) => o.id)) } });
          await this.setSceneStatus(doc, node, bundle.scenes, "SUCCESS");
          results.set(nodeId, result);
          break;
        } catch (e) {
          const err = e as Error;
          const cancelled = controller.signal.aborted;
          const retryable = !cancelled && !(err instanceof ProviderNotConfiguredError) && (err instanceof ProviderError ? err.retryable : err.name === "TypeError");
          logger.log(`${cancelled ? "Cancelled" : "Error"}: ${err.message}`);
          await logger.flush();
          if (retryable && attempt < job.maxAttempts) {
            logger.log(`Retrying in ${attempt * 2}s`);
            await sleep(attempt * 2000, controller.signal).catch(() => undefined);
            if (!controller.signal.aborted) continue;
          }
          const status: JobStatus = controller.signal.aborted ? "CANCELLED" : "FAILED";
          await this.finishJob(job.id, status, err.message);
          await this.setSceneStatus(doc, node, bundle.scenes, status);
          results.set(nodeId, { status, outputs: [] });
          break;
        }
      }
    }

    const statuses = [...results.values()].map((r) => r.status);
    const final: JobStatus = controller.signal.aborted ? "CANCELLED" : statuses.includes("FAILED") ? "FAILED" : "SUCCESS";
    const failed = (await this.db.job.findMany({ where: { runId, status: "FAILED" } })).map((j) => `${j.nodeId}: ${j.error}`);
    await this.db.workflowRun.update({ where: { id: runId }, data: { status: final, finishedAt: new Date(), error: failed.length ? failed.join("; ") : null } });
  }

  private async finishJob(id: string, status: JobStatus, error: string | null) {
    await this.db.job.update({ where: { id }, data: { status, error, finishedAt: new Date() } });
  }

  private async setSceneStatus(doc: SpaceBundle["workflow"], node: WorkflowNode, scenes: Scene[], status: JobStatus) {
    const field = node.type === "imageGenerator" || node.type === "imageEditor" ? "imageStatus" : node.type === "videoGenerator" ? "videoStatus" : node.type === "voiceGenerator" ? "voiceStatus" : null;
    if (!field) return;
    const sceneNode = findUpstreamScene(doc, node.id);
    const scene = sceneNode && scenes.find((s) => s.id === sceneNode.data.sceneId);
    if (scene) await this.db.scene.update({ where: { id: scene.id }, data: { [field]: status } });
  }

  private providerCtx(signal: AbortSignal, log: (m: string) => void): ProviderContext {
    return { env: this.cfg.env, fetch: this.fetchImpl, signal, log };
  }

  private readMedia(rel: string, filename?: string): MediaFile {
    const abs = resolveData(this.cfg.dataDir, rel);
    return { data: new Uint8Array(fs.readFileSync(abs)), mimeType: mimeFromName(abs), filename: filename ?? path.basename(abs) };
  }

  private async saveOutputs(spaceId: string, node: WorkflowNode, jobId: string, sceneId: string | null, kind: OutputKind, provider: string, prompt: string, media: MediaResult[]): Promise<Output[]> {
    await this.db.output.updateMany({ where: { spaceId, nodeId: node.id }, data: { selected: false } });
    const out: Output[] = [];
    for (const [i, m] of media.entries()) {
      const id = randomId("out");
      const rel = writeDataFile(this.cfg.dataDir, `outputs/${spaceId}/${node.id}/${id}.${m.ext}`, m.data);
      const row = await this.db.output.create({ data: { id, spaceId, sceneId, nodeId: node.id, jobId, kind, path: rel, provider, model: m.model, prompt, index: i, selected: i === 0 } });
      out.push(toOutput(row));
    }
    return out;
  }

  private upstreamResults(doc: SpaceBundle["workflow"], nodeId: string, results: Map<string, NodeResult>) {
    const byId = new Map(doc.nodes.map((n) => [n.id, n]));
    return upstreamIds(doc, nodeId)
      .map((id) => ({ node: byId.get(id)!, result: results.get(id) }))
      .filter((u) => u.node && u.result)
      .sort((a, b) => a.node.position.x - b.node.position.x || a.node.position.y - b.node.position.y) as { node: WorkflowNode; result: NodeResult }[];
  }

  private async runNode(
    node: WorkflowNode,
    c: { bundle: SpaceBundle; results: Map<string, NodeResult>; signal: AbortSignal; log: (m: string) => void; jobId: string; runId: string },
  ): Promise<NodeResult> {
    const { bundle, results, signal, log } = c;
    const doc = bundle.workflow;
    const ups = this.upstreamResults(doc, node.id, results);
    const upOutputs = (kind?: OutputKind) => ups.flatMap((u) => preferred(u.result.outputs)).filter((o) => !kind || o.kind === kind);
    const upPrompts = ups.map((u) => u.result.prompt).filter((p): p is string => !!p);
    const batchCount = ups.map((u) => u.result.count).find((n) => !!n);
    const sceneNode = findUpstreamScene(doc, node.id);
    const scene = sceneNode ? bundle.scenes.find((s) => s.id === sceneNode.data.sceneId) : undefined;
    const d = node.data;
    const override = typeof d.promptOverride === "string" ? d.promptOverride.trim() : "";
    const assetById = new Map(bundle.assets.map((a) => [a.id, a]));
    const refAssetFiles = (ids: string[]) =>
      ids
        .map((id) => assetById.get(id))
        .filter((a) => a && a.kind === "image")
        .map((a) => this.readMedia(a!.path, a!.filename));
    const upstreamRefImages = () =>
      ups
        .filter((u) => u.node.type === "imageReference")
        .flatMap((u) => {
          const assetId = String(u.node.data.assetId ?? "");
          const code = String(u.node.data.referenceCode ?? "");
          const ref = bundle.references.find((r) => r.code === code);
          return refAssetFiles([...(assetId ? [assetId] : []), ...(ref?.assetIds ?? [])]);
        });

    switch (node.type) {
      case "characterReference":
      case "productReference":
      case "styleReference":
      case "voiceReference":
      case "imageReference":
      case "videoReference":
      case "audioReference": {
        const code = String(d.referenceCode ?? "");
        const ref = bundle.references.find((r) => r.code === code);
        log(ref ? `Reference ${ref.code} (${ref.name}), ${ref.assetIds.length} file(s)` : d.assetId ? `Asset ${String(d.assetId)}` : "No reference selected");
        return { status: "SUCCESS", outputs: [] };
      }
      case "scriptInput":
        return { status: "SUCCESS", outputs: [], text: String(d.text ?? "") };
      case "masterScript":
        log(bundle.masterScript ? `Master script "${bundle.masterScript.title}"` : "No master script");
        return { status: "SUCCESS", outputs: [], text: bundle.masterScript?.scriptText };
      case "storyboardGenerator":
        log(`${bundle.scenes.length} scene(s) in storyboard (use "Generate Storyboard" to (re)split the master script)`);
        return { status: "SUCCESS", outputs: [] };
      case "scene":
        log(scene ? `Scene ${scene.code}: ${scene.title}` : "Scene missing");
        if (!bundle.scenes.find((s) => s.id === d.sceneId)) throw new Error("Scene does not exist");
        return { status: "SUCCESS", outputs: [] };
      case "prompt": {
        const tpl = bundle.prompts.find((p) => p.id === d.templateId);
        let text = String(d.text ?? "") || tpl?.template || "";
        if (scene) text = renderTemplate(text, sceneVariables({ ...bundle, scene }));
        log(`Prompt: ${text.slice(0, 200)}`);
        return { status: "SUCCESS", outputs: [], prompt: text };
      }
      case "promptGenerator": {
        if (!scene) throw new Error("Prompt Generator needs an upstream Scene");
        const target = (d.target as "image" | "video" | "voice") || "image";
        const composed = buildPromptLayers({ ...bundle, scene }, target);
        composed.warnings.forEach((w) => log(`warning: ${w}`));
        log(`Composed ${target} prompt (${composed.final.length} chars)`);
        return { status: "SUCCESS", outputs: [], prompt: composed.final };
      }
      case "batch":
        return { status: "SUCCESS", outputs: upOutputs(), count: Math.max(1, Number(d.count) || 1) };
      case "loop":
        log("Loop is a pass-through node in this version");
        return { status: "SUCCESS", outputs: upOutputs() };
      case "delay": {
        const s = Math.max(0, Math.min(3600, Number(d.seconds) || 0));
        log(`Waiting ${s}s`);
        await sleep(s * 1000, signal);
        return { status: "SUCCESS", outputs: upOutputs() };
      }
      case "condition": {
        const outs = upOutputs();
        const ok = outs.length > 0;
        log(`Condition hasOutputs: ${ok}`);
        return { status: "SUCCESS", outputs: outs, blocked: !ok };
      }
      case "merge": {
        const outs = upOutputs();
        log(`Merged ${outs.length} output(s): ${outs.map((o) => o.id).join(", ")}`);
        return { status: "SUCCESS", outputs: outs };
      }
      case "imageOutput":
      case "videoOutput":
      case "audioOutput": {
        const kind = node.type.replace("Output", "") as OutputKind;
        const outs = upOutputs(kind);
        log(`${outs.length} ${kind} output(s)`);
        return { status: "SUCCESS", outputs: outs };
      }
      case "export": {
        const r = await exportSpace(this.db, bundle.space.id, this.cfg.exportDir, this.registry.list());
        log(`Exported ${r.files.length} files to ${r.folder}`);
        return { status: "SUCCESS", outputs: [] };
      }
      case "scriptGenerator": {
        const brief = [String(d.brief ?? ""), ...ups.map((u) => u.result.text ?? "")].filter(Boolean).join("\n\n");
        const result = await this.assistant.generateMasterScript(bundle.space.id, brief || "Write a product video script", String(d.provider ?? ""), signal, log);
        await this.assistant.applyMasterScript(bundle.space.id, result);
        log(`Master script updated: ${result.title}`);
        return { status: "SUCCESS", outputs: [], text: result.scriptText };
      }
      case "imageGenerator":
      case "imageEditor": {
        const providerId = resolveNodeProvider(doc, node, bundle.scenes);
        const provider = this.registry.image(providerId);
        if (!provider) throw new ProviderNotConfiguredError(providerId || "image", "an image provider on this node or scene");
        let prompt = override;
        let refs: MediaFile[] = [];
        let negative = "";
        if (scene) {
          const composed = buildPromptLayers({ ...bundle, scene }, "image", { aspectRatio: String(d.aspectRatio ?? "") });
          composed.warnings.forEach((w) => log(`warning: ${w}`));
          prompt ||= [composed.final, ...upPrompts].join("\n\n");
          negative = composed.negative;
          if (d.useReferenceImages !== false && provider.supportsReferenceImages) refs = refAssetFiles(composed.referenceAssetIds);
        } else {
          prompt ||= upPrompts.join("\n\n");
        }
        if (!prompt) throw new Error("No prompt: connect a Scene or Prompt node, or set a prompt override");
        if (provider.supportsReferenceImages) refs.push(...upstreamRefImages());
        let inputImage: MediaFile | undefined;
        if (node.type === "imageEditor") {
          const src = upOutputs("image")[0];
          if (src) inputImage = this.readMedia(src.path);
          else if (refs.length) inputImage = refs.shift();
          if (!inputImage) throw new Error("Image Editor needs an upstream image");
        }
        const count = Math.max(1, Math.min(10, batchCount || Number(d.count) || 1));
        log(`Provider ${provider.id}, count ${count}, reference images ${refs.length}`);
        const media = await provider.generateImage(
          { prompt, negativePrompt: negative, aspectRatio: String(d.aspectRatio || bundle.space.aspectRatio || "9:16"), count, model: String(d.model ?? ""), referenceImages: refs, inputImage },
          this.providerCtx(signal, log),
        );
        const outs = await this.saveOutputs(bundle.space.id, node, c.jobId, scene?.id ?? null, "image", provider.id, prompt, media);
        log(`Saved ${outs.length} image(s)`);
        return { status: "SUCCESS", outputs: outs };
      }
      case "videoGenerator": {
        const providerId = resolveNodeProvider(doc, node, bundle.scenes);
        const provider = this.registry.video(providerId);
        if (!provider) throw new ProviderNotConfiguredError(providerId || "video", "a video provider on this node or scene");
        const src = upOutputs("image")[0];
        const inputImage = src ? this.readMedia(src.path) : upstreamRefImages()[0];
        if (!inputImage) throw new Error("No input image: run the upstream Image Generator first or connect an Image Reference");
        let prompt = override;
        if (!prompt && scene) {
          const composed = buildPromptLayers({ ...bundle, scene }, "video", { aspectRatio: String(d.aspectRatio ?? ""), duration: Number(d.duration) || scene.duration });
          composed.warnings.forEach((w) => log(`warning: ${w}`));
          prompt = [composed.final, ...upPrompts].join("\n\n");
        }
        prompt ||= upPrompts.join("\n\n");
        if (!prompt) throw new Error("No prompt: connect a Scene or Prompt node, or set a prompt override");
        const media = await provider.generateVideo(
          { prompt, aspectRatio: String(d.aspectRatio || bundle.space.aspectRatio || "9:16"), duration: Number(d.duration) || scene?.duration || 8, model: String(d.model ?? ""), inputImage },
          this.providerCtx(signal, log),
        );
        const outs = await this.saveOutputs(bundle.space.id, node, c.jobId, scene?.id ?? null, "video", provider.id, prompt, media);
        log(`Saved ${outs.length} video(s)`);
        return { status: "SUCCESS", outputs: outs };
      }
      case "voiceGenerator": {
        const providerId = resolveNodeProvider(doc, node, bundle.scenes);
        const provider = this.registry.voice(providerId);
        if (!provider) throw new ProviderNotConfiguredError(providerId || "voice", "a voice provider on this node or scene");
        let text = ups.map((u) => u.result.text).find(Boolean) ?? "";
        let instructions = override;
        let voice = String(d.voice ?? "");
        if (scene) {
          const composed = buildPromptLayers({ ...bundle, scene }, "voice");
          text = composed.speechText || text;
          instructions ||= composed.final;
          const voiceRef = bundle.references.find((r) => r.code === composed.refs.voice);
          voice ||= String(voiceRef?.settings.voiceName ?? "");
        }
        if (!text.trim()) throw new Error("Nothing to speak: the scene has no dialogue");
        const media = await provider.generateVoice({ text, instructions, voice, model: String(d.model ?? "") }, this.providerCtx(signal, log));
        const outs = await this.saveOutputs(bundle.space.id, node, c.jobId, scene?.id ?? null, "audio", provider.id, `${instructions}\n\n${text}`, media);
        log(`Saved ${outs.length} audio file(s)`);
        return { status: "SUCCESS", outputs: outs };
      }
      case "lipSync":
        throw new ProviderNotConfiguredError("lip-sync", "LIPSYNC provider (no lip-sync adapter ships with this version)");
      case "finalVideo": {
        const videos = upOutputs("video");
        if (!videos.length) throw new Error("No upstream videos to combine");
        if (!(await ffmpegAvailable(this.cfg.env))) throw new Error("ffmpeg not found: install ffmpeg and add it to PATH, or set FFMPEG_PATH in .env");
        const id = randomId("out");
        const rel = `outputs/${bundle.space.id}/${node.id}/${id}.mp4`;
        await concatVideos(this.cfg.env, videos.map((v) => resolveData(this.cfg.dataDir, v.path)), resolveData(this.cfg.dataDir, rel), signal, log);
        await this.db.output.updateMany({ where: { spaceId: bundle.space.id, nodeId: node.id }, data: { selected: false } });
        const row = await this.db.output.create({ data: { id, spaceId: bundle.space.id, sceneId: null, nodeId: node.id, jobId: c.jobId, kind: "video", path: rel, provider: "ffmpeg", prompt: `concat ${videos.map((v) => v.id).join(",")}`, selected: true } });
        return { status: "SUCCESS", outputs: [toOutput(row)] };
      }
      default:
        throw new Error(`No executor for node type ${node.type}`);
    }
  }

  async jobsForRun(runId: string) {
    const run = await this.db.workflowRun.findUnique({ where: { id: runId } });
    const order: string[] = run ? JSON.parse(run.order) : [];
    const jobs = (await this.db.job.findMany({ where: { runId } })).map(toJob);
    return jobs.sort((a, b) => order.indexOf(a.nodeId) - order.indexOf(b.nodeId));
  }
}
