// Scene creation/update helpers shared by the scenes API, storyboard generator and assistant.
import { normalizeWorkflow, randomId, sceneCode, serializeWorkflow, type SceneDraft, type SceneInput } from "@amw/shared";
import type { Db } from "../db";
import { toScene } from "../repo";
import { recordVersion } from "./versions";

export const SCENE_FIELDS = [
  "code", "sceneNumber", "title", "duration", "script", "action", "dialogue", "camera", "shotType", "cameraMovement", "location",
  "lighting", "expression", "characterId", "productId", "styleId", "voiceId", "imagePrompt", "videoPrompt", "voicePrompt",
  "continuity", "imageProvider", "videoProvider", "voiceProvider",
] as const;

export function cleanSceneInput(body: unknown): SceneInput {
  const out: Record<string, unknown> = {};
  if (body && typeof body === "object") {
    for (const k of SCENE_FIELDS) {
      const v = (body as Record<string, unknown>)[k];
      if (v === undefined) continue;
      out[k] = k === "duration" || k === "sceneNumber" ? Math.max(0, Math.round(Number(v) || 0)) : String(v ?? "");
    }
  }
  return out as SceneInput;
}

export async function nextSceneSlot(db: Db, spaceId: string) {
  const scenes = await db.scene.findMany({ where: { spaceId }, select: { sceneNumber: true, code: true } });
  const maxNum = scenes.reduce((m, s) => Math.max(m, s.sceneNumber), 0);
  const used = new Set(scenes.map((s) => s.code));
  let n = maxNum + 1;
  let code = sceneCode(n);
  while (used.has(code)) code = sceneCode(++n);
  return { sceneNumber: maxNum + 1, code };
}

export async function createScene(db: Db, spaceId: string, input: SceneInput, note = "Created") {
  const ms = await db.masterScript.findUnique({ where: { spaceId } });
  const slot = await nextSceneSlot(db, spaceId);
  const row = await db.scene.create({
    data: {
      id: randomId("scn"),
      spaceId,
      masterScriptId: ms?.id ?? null,
      ...input,
      code: input.code || slot.code,
      sceneNumber: input.sceneNumber || slot.sceneNumber,
      title: input.title || `Scene ${input.sceneNumber || slot.sceneNumber}`,
    } as never,
  });
  await recordVersion(db, "scene", row.id, note);
  return toScene(row);
}

export async function updateScene(db: Db, id: string, input: SceneInput, note = "Saved") {
  const row = await db.scene.update({ where: { id }, data: { ...input, version: { increment: 1 } } as never });
  await recordVersion(db, "scene", row.id, note);
  return toScene(row);
}

/**
 * Applies storyboard drafts. "replace" updates scenes in place by scene number (keeping ids, outputs
 * and history) and deletes scenes beyond the new count; "append" adds new scenes after the last one.
 */
export async function applyStoryboard(db: Db, spaceId: string, drafts: (SceneDraft | SceneInput)[], mode: "replace" | "append") {
  const existing = await db.scene.findMany({ where: { spaceId }, orderBy: { sceneNumber: "asc" } });
  const result = [];
  if (mode === "append") {
    for (const d of drafts) result.push(await createScene(db, spaceId, cleanSceneInput({ ...d, sceneNumber: undefined, code: undefined }), "Storyboard generator"));
    return result;
  }
  for (const [i, d] of drafts.entries()) {
    const n = i + 1;
    const input = cleanSceneInput({ ...d, sceneNumber: n, code: undefined });
    const match = existing.find((s) => s.sceneNumber === n);
    result.push(match ? await updateScene(db, match.id, input, "Storyboard generator") : await createScene(db, spaceId, input, "Storyboard generator"));
  }
  const removed = existing.filter((s) => s.sceneNumber > drafts.length);
  if (removed.length) {
    await db.scene.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
    await removeSceneNodes(db, spaceId, removed.map((s) => s.id));
  }
  return result;
}

/** Drops canvas nodes bound to deleted scenes (and their edges). */
export async function removeSceneNodes(db: Db, spaceId: string, sceneIds: string[]) {
  const wf = await db.workflow.findUnique({ where: { spaceId } });
  if (!wf) return;
  const doc = normalizeWorkflow(JSON.parse(wf.json));
  const drop = new Set(doc.nodes.filter((n) => n.type === "scene" && sceneIds.includes(String(n.data.sceneId))).map((n) => n.id));
  if (!drop.size) return;
  doc.nodes = doc.nodes.filter((n) => !drop.has(n.id));
  doc.edges = doc.edges.filter((e) => !drop.has(e.source) && !drop.has(e.target));
  await db.workflow.update({ where: { id: wf.id }, data: { json: serializeWorkflow(doc) } });
}
