// Versioning: every save of a versioned entity stores a snapshot. Restore copies a snapshot back
// and records it as a new version, so history is never rewritten.
import { diffSnapshots, diffWorkflows, randomId, serializeWorkflow, normalizeWorkflow, type VersionedEntity } from "@amw/shared";
import type { Db } from "../db";
import { BadRequestError, NotFoundError, toMasterScript, toPrompt, toReference, toScene, toVersion } from "../repo";

const MAX_VERSIONS = 100;

/** Fields a restore may write back (identity and bookkeeping fields are excluded). */
const RESTORABLE: Record<VersionedEntity, string[]> = {
  scene: ["title", "duration", "script", "action", "dialogue", "camera", "shotType", "cameraMovement", "location", "lighting", "expression", "characterId", "productId", "styleId", "voiceId", "imagePrompt", "videoPrompt", "voicePrompt", "continuity", "imageProvider", "videoProvider", "voiceProvider", "sceneNumber", "code"],
  masterScript: ["title", "objective", "targetPlatform", "aspectRatio", "duration", "characterId", "productId", "styleId", "voiceId", "globalInstruction", "scriptText"],
  reference: ["name", "description", "prompt", "settings", "assetIds", "type", "code"],
  prompt: ["name", "category", "description", "template", "variables"],
  workflow: ["nodes", "edges", "viewport"],
};

export async function currentSnapshot(db: Db, type: VersionedEntity, id: string): Promise<{ version: number; snapshot: Record<string, unknown> }> {
  switch (type) {
    case "scene": {
      const r = await db.scene.findUnique({ where: { id } });
      if (!r) throw new NotFoundError(`Scene ${id}`);
      return { version: r.version, snapshot: toScene(r) as unknown as Record<string, unknown> };
    }
    case "masterScript": {
      const r = await db.masterScript.findUnique({ where: { id } });
      if (!r) throw new NotFoundError(`Master script ${id}`);
      return { version: r.version, snapshot: toMasterScript(r) as unknown as Record<string, unknown> };
    }
    case "reference": {
      const r = await db.reference.findUnique({ where: { id } });
      if (!r) throw new NotFoundError(`Reference ${id}`);
      return { version: r.version, snapshot: toReference(r) as unknown as Record<string, unknown> };
    }
    case "prompt": {
      const r = await db.promptTemplate.findUnique({ where: { id } });
      if (!r) throw new NotFoundError(`Prompt ${id}`);
      return { version: r.version, snapshot: toPrompt(r) as unknown as Record<string, unknown> };
    }
    case "workflow": {
      const r = await db.workflow.findUnique({ where: { id } });
      if (!r) throw new NotFoundError(`Workflow ${id}`);
      return { version: r.version, snapshot: JSON.parse(r.json) };
    }
    default:
      throw new BadRequestError(`Unknown entity type ${type as string}`);
  }
}

export async function recordVersion(db: Db, type: VersionedEntity, id: string, note = ""): Promise<void> {
  const { version, snapshot } = await currentSnapshot(db, type, id);
  await db.entityVersion.create({ data: { id: randomId("ver"), entityType: type, entityId: id, version, note, snapshot: JSON.stringify(snapshot) } });
  const old = await db.entityVersion.findMany({ where: { entityType: type, entityId: id }, orderBy: { createdAt: "desc" }, skip: MAX_VERSIONS, select: { id: true } });
  if (old.length) await db.entityVersion.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
}

export async function listVersions(db: Db, type: VersionedEntity, id: string) {
  const rows = await db.entityVersion.findMany({ where: { entityType: type, entityId: id }, orderBy: [{ version: "desc" }, { createdAt: "desc" }] });
  return rows.map(toVersion);
}

/** Saves the current state as a new numbered version ("duplicate version"). */
export async function snapshotNow(db: Db, type: VersionedEntity, id: string, note: string) {
  await bumpVersion(db, type, id);
  await recordVersion(db, type, id, note || "Manual snapshot");
  return listVersions(db, type, id);
}

async function bumpVersion(db: Db, type: VersionedEntity, id: string) {
  const data = { version: { increment: 1 } };
  if (type === "scene") await db.scene.update({ where: { id }, data });
  else if (type === "masterScript") await db.masterScript.update({ where: { id }, data });
  else if (type === "reference") await db.reference.update({ where: { id }, data });
  else if (type === "prompt") await db.promptTemplate.update({ where: { id }, data });
  else if (type === "workflow") await db.workflow.update({ where: { id }, data });
}

export async function restoreVersion(db: Db, versionId: string) {
  const v = await db.entityVersion.findUnique({ where: { id: versionId } });
  if (!v) throw new NotFoundError(`Version ${versionId}`);
  const type = v.entityType as VersionedEntity;
  const snap = JSON.parse(v.snapshot) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  for (const k of RESTORABLE[type]) if (k in snap) data[k] = snap[k];
  const id = v.entityId;
  if (type === "scene") await db.scene.update({ where: { id }, data: { ...data, version: { increment: 1 } } as never });
  else if (type === "masterScript") await db.masterScript.update({ where: { id }, data: { ...data, version: { increment: 1 } } as never });
  else if (type === "reference")
    await db.reference.update({ where: { id }, data: { ...data, settings: JSON.stringify(data.settings ?? {}), assetIds: JSON.stringify(data.assetIds ?? []), version: { increment: 1 } } as never });
  else if (type === "prompt") await db.promptTemplate.update({ where: { id }, data: { ...data, variables: JSON.stringify(data.variables ?? []), version: { increment: 1 } } as never });
  else if (type === "workflow") {
    const wf = await db.workflow.findUniqueOrThrow({ where: { id } });
    const doc = normalizeWorkflow({ ...JSON.parse(wf.json), ...data });
    await db.workflow.update({ where: { id }, data: { json: serializeWorkflow(doc), version: { increment: 1 } } });
  }
  await recordVersion(db, type, id, `Restored from v${v.version}`);
  return { entityType: type, entityId: id };
}

export async function compareVersions(db: Db, versionId: string, withId: string) {
  const a = await db.entityVersion.findUnique({ where: { id: versionId } });
  if (!a) throw new NotFoundError(`Version ${versionId}`);
  const before = JSON.parse(a.snapshot) as Record<string, unknown>;
  let after: Record<string, unknown>;
  let label: string;
  if (withId === "current") {
    after = (await currentSnapshot(db, a.entityType as VersionedEntity, a.entityId)).snapshot;
    label = "current";
  } else {
    const b = await db.entityVersion.findUnique({ where: { id: withId } });
    if (!b) throw new NotFoundError(`Version ${withId}`);
    after = JSON.parse(b.snapshot);
    label = `v${b.version}`;
  }
  const changes = a.entityType === "workflow" ? diffWorkflows(before as never, after as never) : diffSnapshots(before, after);
  return { from: `v${a.version}`, to: label, changes };
}
