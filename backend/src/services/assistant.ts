// AI Assistant: LLM-backed drafting (master script, scenes, prompts, continuity review).
// Results are returned as drafts; the UI lets the user edit them before anything is saved
// (except the Script Generator node, which writes a new, versioned master script).
import { checkConsistency, randomId, type ProviderInfo, type SpaceBundle } from "@amw/shared";
import { ProviderError, ProviderNotConfiguredError, type ProviderRegistry } from "@amw/providers";
import type { AppConfig } from "../config";
import type { Db } from "../db";
import { BadRequestError, loadBundle, NotFoundError } from "../repo";
import { recordVersion } from "./versions";

export interface MasterScriptDraft {
  title: string;
  objective: string;
  targetPlatform: string;
  aspectRatio: string;
  duration: number;
  globalInstruction: string;
  scriptText: string;
}

export interface SceneDraftAI {
  title: string;
  duration: number;
  script: string;
  action: string;
  dialogue: string;
  camera: string;
  shotType: string;
  cameraMovement: string;
  location: string;
  lighting: string;
  expression: string;
  imagePrompt: string;
  videoPrompt: string;
  voicePrompt: string;
}

const SYSTEM = `You are the production assistant inside an AI media workflow app that makes short product videos
(TikTok, Reels, Shorts). You write in the language the user writes in. Characters and products are referenced by
stable IDs such as MODEL_001 and PRODUCT_001; always keep those IDs and never invent new ones. Image prompts describe
one still frame; video prompts describe motion and camera for that frame; voice prompts describe delivery/tone.
Respond with a single JSON object only, no prose, no Markdown fences.`;

export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fenced ? fenced[1] : text;
  const start = src.indexOf("{");
  const end = src.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Assistant did not return JSON");
  return JSON.parse(src.slice(start, end + 1)) as T;
}

function contextOf(b: SpaceBundle): string {
  return JSON.stringify(
    {
      project: { name: b.project.name, description: b.project.description },
      space: { name: b.space.name, targetPlatform: b.space.targetPlatform, aspectRatio: b.space.aspectRatio },
      references: b.references.map((r) => ({ id: r.code, type: r.type, name: r.name, description: r.description, prompt: r.prompt, locks: r.settings })),
      masterScript: b.masterScript && {
        title: b.masterScript.title,
        objective: b.masterScript.objective,
        duration: b.masterScript.duration,
        characterId: b.masterScript.characterId,
        productId: b.masterScript.productId,
        styleId: b.masterScript.styleId,
        voiceId: b.masterScript.voiceId,
        globalInstruction: b.masterScript.globalInstruction,
        scriptText: b.masterScript.scriptText,
      },
      scenes: b.scenes.map((s) => ({
        id: s.code,
        number: s.sceneNumber,
        title: s.title,
        duration: s.duration,
        script: s.script,
        action: s.action,
        dialogue: s.dialogue,
        camera: s.camera,
        location: s.location,
        expression: s.expression,
        characterId: s.characterId,
        productId: s.productId,
        imagePrompt: s.imagePrompt,
        videoPrompt: s.videoPrompt,
        voicePrompt: s.voicePrompt,
      })),
    },
    null,
    1,
  );
}

const SCENE_SHAPE = `{"title":string,"duration":number(seconds),"script":string,"action":string,"dialogue":string,"camera":string,"shotType":string,"cameraMovement":string,"location":string,"lighting":string,"expression":string,"imagePrompt":string,"videoPrompt":string,"voicePrompt":string}`;

export class Assistant {
  constructor(
    private db: Db,
    private registry: ProviderRegistry,
    private cfg: AppConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  status(): { configured: boolean; provider: ProviderInfo | null; providers: ProviderInfo[] } {
    const providers = this.registry.list("llm");
    const p = this.registry.defaultFor("llm") ?? null;
    return { configured: !!p, provider: p, providers };
  }

  private async ask(prompt: string, providerId = "", signal?: AbortSignal, log: (m: string) => void = () => {}): Promise<string> {
    const info = providerId ? this.registry.list("llm").find((p) => p.id === providerId) : this.registry.defaultFor("llm");
    const provider = info && this.registry.llm(info.id);
    if (!provider || !info?.configured) throw new ProviderNotConfiguredError(providerId || "assistant", "ANTHROPIC_API_KEY or OPENAI_API_KEY");
    return provider.complete({ system: SYSTEM, prompt, maxTokens: 8000 }, { env: this.cfg.env, fetch: this.fetchImpl, signal, log });
  }

  private async askJson<T>(prompt: string, providerId?: string, signal?: AbortSignal, log?: (m: string) => void): Promise<T> {
    const text = await this.ask(prompt, providerId, signal, log);
    try {
      return extractJson<T>(text);
    } catch (e) {
      throw new ProviderError("assistant", `could not parse JSON from the model: ${(e as Error).message}`);
    }
  }

  async generateMasterScript(spaceId: string, brief: string, providerId?: string, signal?: AbortSignal, log?: (m: string) => void): Promise<MasterScriptDraft> {
    const b = await loadBundle(this.db, spaceId);
    const r = await this.askJson<Partial<MasterScriptDraft>>(
      `Context:\n${contextOf(b)}\n\nTask: write a MASTER SCRIPT for this brief:\n"${brief}"\n\nThe scriptText must list scenes as "Scene 1: <title>" lines, each followed by the narration/dialogue and an "Action:" line.\nReturn {"title":string,"objective":string,"targetPlatform":string,"aspectRatio":string,"duration":number,"globalInstruction":string,"scriptText":string}.`,
      providerId,
      signal,
      log,
    );
    return {
      title: String(r.title ?? ""),
      objective: String(r.objective ?? ""),
      targetPlatform: String(r.targetPlatform ?? b.space.targetPlatform),
      aspectRatio: String(r.aspectRatio ?? b.space.aspectRatio),
      duration: Number(r.duration) || 0,
      globalInstruction: String(r.globalInstruction ?? ""),
      scriptText: String(r.scriptText ?? ""),
    };
  }

  async applyMasterScript(spaceId: string, draft: MasterScriptDraft) {
    const existing = await this.db.masterScript.findUnique({ where: { spaceId } });
    if (existing) {
      await this.db.masterScript.update({ where: { id: existing.id }, data: { ...draft, version: { increment: 1 } } });
      await recordVersion(this.db, "masterScript", existing.id, "AI Assistant");
    } else {
      const created = await this.db.masterScript.create({ data: { id: randomId("ms"), spaceId, ...draft } });
      await recordVersion(this.db, "masterScript", created.id, "AI Assistant");
    }
  }

  async splitScenes(spaceId: string, providerId?: string): Promise<SceneDraftAI[]> {
    const b = await loadBundle(this.db, spaceId);
    if (!b.masterScript?.scriptText.trim()) throw new BadRequestError("The master script is empty");
    const r = await this.askJson<{ scenes?: Partial<SceneDraftAI>[] }>(
      `Context:\n${contextOf(b)}\n\nTask: split the master script into storyboard scenes. Durations must add up to about ${b.masterScript.duration || 60} seconds.\nReturn {"scenes":[${SCENE_SHAPE}]}.`,
      providerId,
    );
    return (r.scenes ?? []).map(normalizeScene);
  }

  async plan(spaceId: string, brief: string, providerId?: string): Promise<{ masterScript: MasterScriptDraft; scenes: SceneDraftAI[] }> {
    const b = await loadBundle(this.db, spaceId);
    const r = await this.askJson<{ masterScript?: Partial<MasterScriptDraft>; scenes?: Partial<SceneDraftAI>[] }>(
      `Context:\n${contextOf(b)}\n\nTask: "${brief}"\nProduce a master script and its storyboard scenes with image, video and voice prompts.\nReturn {"masterScript":{"title":string,"objective":string,"targetPlatform":string,"aspectRatio":string,"duration":number,"globalInstruction":string,"scriptText":string},"scenes":[${SCENE_SHAPE}]}.`,
      providerId,
    );
    const ms = r.masterScript ?? {};
    return {
      masterScript: {
        title: String(ms.title ?? ""),
        objective: String(ms.objective ?? ""),
        targetPlatform: String(ms.targetPlatform ?? b.space.targetPlatform),
        aspectRatio: String(ms.aspectRatio ?? b.space.aspectRatio),
        duration: Number(ms.duration) || 0,
        globalInstruction: String(ms.globalInstruction ?? ""),
        scriptText: String(ms.scriptText ?? ""),
      },
      scenes: (r.scenes ?? []).map(normalizeScene),
    };
  }

  async scenePrompts(sceneId: string, targets: ("image" | "video" | "voice")[], improve: boolean, providerId?: string) {
    const scene = await this.db.scene.findUnique({ where: { id: sceneId } });
    if (!scene) throw new NotFoundError(`Scene ${sceneId}`);
    const b = await loadBundle(this.db, scene.spaceId);
    const keys = targets.map((t) => `"${t}Prompt":string`).join(",");
    const task = improve
      ? `improve the existing ${targets.join("/")} prompt(s) of scene ${scene.code}: make them more specific and visual, keep reference IDs and continuity, keep the user's intent`
      : `write the ${targets.join("/")} prompt(s) for scene ${scene.code}`;
    const r = await this.askJson<Record<string, string>>(`Context:\n${contextOf(b)}\n\nTask: ${task}.\nReturn {${keys}}.`, providerId);
    const out: Record<string, string> = {};
    for (const t of targets) if (typeof r[`${t}Prompt`] === "string") out[`${t}Prompt`] = r[`${t}Prompt`];
    return out;
  }

  async continuity(spaceId: string, providerId?: string) {
    const b = await loadBundle(this.db, spaceId);
    const deterministic = checkConsistency(b, this.registry.list(), this.registry.defaults()).items.filter((i) => i.level !== "ok" && /reference|character|product|asset/.test(i.code));
    const r = await this.askJson<{ issues?: { severity?: string; sceneId?: string; message?: string }[] }>(
      `Context:\n${contextOf(b)}\n\nTask: review continuity across all scenes. Look for: inconsistent product descriptions (name, color, packaging, size), character appearance drift, missing or wrong reference IDs, dialogue that contradicts the objective, scene durations that do not add up.\nReturn {"issues":[{"severity":"error"|"warning"|"info","sceneId":string,"message":string}]}.`,
      providerId,
    );
    return {
      referenceChecks: deterministic,
      issues: (r.issues ?? []).map((i) => ({ severity: String(i.severity ?? "info"), sceneId: String(i.sceneId ?? ""), message: String(i.message ?? "") })),
    };
  }
}

function normalizeScene(s: Partial<SceneDraftAI>): SceneDraftAI {
  const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));
  return {
    title: str(s.title),
    duration: Number(s.duration) || 0,
    script: str(s.script),
    action: str(s.action),
    dialogue: str(s.dialogue),
    camera: str(s.camera),
    shotType: str(s.shotType),
    cameraMovement: str(s.cameraMovement),
    location: str(s.location),
    lighting: str(s.lighting),
    expression: str(s.expression),
    imagePrompt: str(s.imagePrompt),
    videoPrompt: str(s.videoPrompt),
    voicePrompt: str(s.voicePrompt),
  };
}
