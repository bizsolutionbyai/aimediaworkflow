// Operational routes: providers, consistency check, runs/jobs, outputs, Markdown export/import, assistant.
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { checkConsistency, formatCheckReport } from "@amw/shared";
import type { AppContext } from "../app";
import { BadRequestError, NotFoundError, loadBundle, toOutput, toRun } from "../repo";
import { ffmpegAvailable } from "../services/ffmpeg";
import { exportSpace, importFiles, listExports, readMarkdownFolder } from "../services/markdown";
import { applyStoryboard } from "../services/scenes";
import { resolveData } from "../services/storage";

type P<T extends string> = { Params: Record<T, string> };

export function opsRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg, registry, engine, assistant } = ctx;

  app.get("/api/health", async () => ({ ok: true, dataDir: cfg.dataDir, exportDir: cfg.exportDir }));

  /** Provider discovery. Returns ids, labels and whether a key is present — never the key itself. */
  app.get("/api/providers", async () => ({ providers: registry.list(), ffmpeg: await ffmpegAvailable(cfg.env) }));

  // ---------- Consistency check ----------
  app.post<P<"id">>("/api/spaces/:id/check", async (req) => {
    const report = checkConsistency(await loadBundle(db, req.params.id), registry.list());
    return { ...report, text: formatCheckReport(report) };
  });

  // ---------- Runs & jobs ----------
  app.post<P<"id">>("/api/spaces/:id/run", async (req, reply) => {
    const b = (req.body ?? {}) as { targets?: string[]; mode?: "missing" | "all" };
    const r = await engine.start(req.params.id, { targets: Array.isArray(b.targets) ? b.targets.map(String) : undefined, mode: b.mode === "all" ? "all" : "missing" });
    reply.code(202);
    return r;
  });

  app.get<P<"id">>("/api/spaces/:id/runs", async (req) =>
    (await db.workflowRun.findMany({ where: { spaceId: req.params.id }, orderBy: { createdAt: "desc" }, take: 20 })).map(toRun),
  );

  app.get<P<"id">>("/api/runs/:id", async (req) => {
    const run = await db.workflowRun.findUnique({ where: { id: req.params.id } });
    if (!run) throw new NotFoundError("Run");
    return { run: toRun(run), jobs: await engine.jobsForRun(run.id) };
  });

  app.post<P<"id">>("/api/runs/:id/cancel", async (req) => engine.cancel(req.params.id));

  // ---------- Outputs ----------
  app.get<P<"id">>("/api/spaces/:id/outputs", async (req) =>
    (await db.output.findMany({ where: { spaceId: req.params.id }, orderBy: [{ createdAt: "desc" }, { index: "asc" }] })).map(toOutput),
  );

  /** Marks one output as the preferred input for downstream nodes. */
  app.post<P<"id">>("/api/outputs/:id/select", async (req) => {
    const o = await db.output.findUnique({ where: { id: req.params.id } });
    if (!o) throw new NotFoundError("Output");
    await db.output.updateMany({ where: { spaceId: o.spaceId, nodeId: o.nodeId }, data: { selected: false } });
    return toOutput(await db.output.update({ where: { id: o.id }, data: { selected: true } }));
  });

  app.delete<P<"id">>("/api/outputs/:id", async (req) => {
    const o = await db.output.findUnique({ where: { id: req.params.id } });
    if (!o) throw new NotFoundError("Output");
    await db.output.delete({ where: { id: o.id } });
    fs.rmSync(resolveData(cfg.dataDir, o.path), { force: true });
    return { ok: true };
  });

  // ---------- Markdown export / import ----------
  app.post<P<"id">>("/api/spaces/:id/export", async (req) => {
    const r = await exportSpace(db, req.params.id, cfg.exportDir, registry.list());
    return { ...r, dir: path.relative(cfg.rootDir, r.dir).split(path.sep).join("/") || r.dir, absoluteDir: r.dir };
  });

  app.get("/api/exports", async () => listExports(cfg.exportDir));

  /** Import from files uploaded by the browser (folder picker): { files: { "PROJECT.md": "...", "scenes/SCENE-01.md": "..." } }. */
  app.post("/api/import", async (req) => {
    const b = (req.body ?? {}) as { files?: Record<string, string>; removeMissingScenes?: boolean };
    if (!b.files || typeof b.files !== "object") throw new BadRequestError("files map is required");
    const md = Object.fromEntries(Object.entries(b.files).filter(([p, c]) => p.toLowerCase().endsWith(".md") && typeof c === "string"));
    return importFiles(db, md, { dataDir: cfg.dataDir, removeMissingScenes: !!b.removeMissingScenes });
  });

  /** Import an export folder by name (inside EXPORT_DIR) or by absolute path on this machine. */
  app.post("/api/import/folder", async (req) => {
    const b = (req.body ?? {}) as { folder?: string; path?: string; removeMissingScenes?: boolean };
    let dir: string;
    if (b.folder) {
      dir = path.resolve(cfg.exportDir, b.folder);
      if (!dir.startsWith(path.resolve(cfg.exportDir) + path.sep)) throw new BadRequestError("Invalid folder");
    } else if (b.path) {
      dir = path.resolve(b.path);
    } else throw new BadRequestError("folder or path is required");
    if (!fs.existsSync(path.join(dir, "PROJECT.md"))) throw new BadRequestError(`PROJECT.md not found in ${dir}`);
    return importFiles(db, readMarkdownFolder(dir), { dataDir: cfg.dataDir, removeMissingScenes: !!b.removeMissingScenes });
  });

  // ---------- AI Assistant ----------
  app.get("/api/assistant/status", async () => assistant.status());

  app.post("/api/assistant/:task", async (req) => {
    const task = (req.params as { task: string }).task;
    const b = (req.body ?? {}) as Record<string, unknown>;
    const spaceId = String(b.spaceId ?? "");
    const provider = String(b.provider ?? "") || undefined;
    switch (task) {
      case "master-script":
        return assistant.generateMasterScript(spaceId, String(b.brief ?? ""), provider);
      case "plan":
        return assistant.plan(spaceId, String(b.brief ?? ""), provider);
      case "split-scenes":
        return { scenes: await assistant.splitScenes(spaceId, provider) };
      case "scene-prompts":
        return assistant.scenePrompts(String(b.sceneId), (Array.isArray(b.targets) ? b.targets : ["image", "video", "voice"]) as never, !!b.improve, provider);
      case "continuity":
        return assistant.continuity(spaceId, provider);
      case "apply-plan": {
        // Saves an (edited) plan: master script + scenes.
        const plan = b.plan as { masterScript?: Record<string, unknown>; scenes?: unknown[] } | undefined;
        if (!plan) throw new BadRequestError("plan is required");
        if (plan.masterScript) await assistant.applyMasterScript(spaceId, plan.masterScript as never);
        const scenes = Array.isArray(plan.scenes) && plan.scenes.length ? await applyStoryboard(db, spaceId, plan.scenes as never, b.mode === "append" ? "append" : "replace") : [];
        return { ok: true, scenes };
      }
      default:
        throw new NotFoundError(`Assistant task ${task}`);
    }
  });
}
