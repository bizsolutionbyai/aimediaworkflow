// Database row ↔ domain type mapping and common queries.
import {
  createEmptyWorkflow,
  normalizeWorkflow,
  type Asset,
  type EntityVersion,
  type Job,
  type MasterScript,
  type Output,
  type Project,
  type PromptTemplate,
  type Reference,
  type Scene,
  type Space,
  type SpaceBundle,
  type WorkflowDoc,
  type WorkflowRun,
} from "@amw/shared";
import type { Db } from "./db";
import type * as P from "./generated/prisma/client";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function json<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

export class NotFoundError extends Error {
  statusCode = 404;
  constructor(what: string) {
    super(`${what} not found`);
  }
}

export class BadRequestError extends Error {
  statusCode = 400;
}

export const toProject = (r: P.Project): Project => ({
  id: r.id,
  name: r.name,
  description: r.description,
  settings: json(r.settings, {}),
  createdAt: iso(r.createdAt)!,
  updatedAt: iso(r.updatedAt)!,
});

export const toSpace = (r: P.Space): Space => ({
  id: r.id,
  projectId: r.projectId,
  name: r.name,
  description: r.description,
  targetPlatform: r.targetPlatform,
  aspectRatio: r.aspectRatio,
  createdAt: iso(r.createdAt)!,
  updatedAt: iso(r.updatedAt)!,
});

export const toAsset = (r: P.Asset): Asset => ({
  id: r.id,
  projectId: r.projectId,
  spaceId: r.spaceId,
  kind: r.kind as Asset["kind"],
  filename: r.filename,
  path: r.path,
  mimeType: r.mimeType,
  size: r.size,
  createdAt: iso(r.createdAt)!,
});

export const toReference = (r: P.Reference): Reference => ({
  id: r.id,
  code: r.code,
  spaceId: r.spaceId,
  type: r.type as Reference["type"],
  name: r.name,
  description: r.description,
  prompt: r.prompt,
  settings: json(r.settings, {}),
  assetIds: json(r.assetIds, []),
  version: r.version,
  createdAt: iso(r.createdAt)!,
  updatedAt: iso(r.updatedAt)!,
});

export const toMasterScript = (r: P.MasterScript): MasterScript => ({
  ...r,
  createdAt: iso(r.createdAt)!,
  updatedAt: iso(r.updatedAt)!,
});

export const toScene = (r: P.Scene): Scene => ({
  ...r,
  imageStatus: r.imageStatus as Scene["imageStatus"],
  videoStatus: r.videoStatus as Scene["videoStatus"],
  voiceStatus: r.voiceStatus as Scene["voiceStatus"],
  createdAt: iso(r.createdAt)!,
  updatedAt: iso(r.updatedAt)!,
});

export const toPrompt = (r: P.PromptTemplate): PromptTemplate => ({
  ...r,
  variables: json(r.variables, []),
  createdAt: iso(r.createdAt)!,
  updatedAt: iso(r.updatedAt)!,
});

export const toOutput = (r: P.Output): Output => ({
  ...r,
  kind: r.kind as Output["kind"],
  createdAt: iso(r.createdAt)!,
});

export const toJob = (r: P.Job): Job => ({
  id: r.id,
  runId: r.runId,
  spaceId: r.spaceId,
  nodeId: r.nodeId,
  nodeType: r.nodeType,
  status: r.status as Job["status"],
  attempts: r.attempts,
  maxAttempts: r.maxAttempts,
  error: r.error,
  logs: json(r.logs, []),
  outputIds: json(r.outputIds, []),
  createdAt: iso(r.createdAt)!,
  startedAt: iso(r.startedAt),
  finishedAt: iso(r.finishedAt),
});

export const toRun = (r: P.WorkflowRun): WorkflowRun => ({
  id: r.id,
  spaceId: r.spaceId,
  status: r.status as WorkflowRun["status"],
  order: json(r.order, []),
  error: r.error,
  createdAt: iso(r.createdAt)!,
  finishedAt: iso(r.finishedAt),
});

export const toVersion = (r: P.EntityVersion): EntityVersion => ({
  id: r.id,
  entityType: r.entityType as EntityVersion["entityType"],
  entityId: r.entityId,
  version: r.version,
  note: r.note,
  snapshot: json(r.snapshot, {}),
  createdAt: iso(r.createdAt)!,
});

export async function getSpaceOr404(db: Db, spaceId: string) {
  const s = await db.space.findUnique({ where: { id: spaceId } });
  if (!s) throw new NotFoundError(`Space ${spaceId}`);
  return s;
}

export async function loadWorkflow(db: Db, spaceId: string): Promise<WorkflowDoc> {
  const space = await getSpaceOr404(db, spaceId);
  const wf = await db.workflow.findUnique({ where: { spaceId } });
  if (!wf) return createEmptyWorkflow(space.projectId, spaceId);
  return normalizeWorkflow(JSON.parse(wf.json));
}

export async function loadBundle(db: Db, spaceId: string): Promise<SpaceBundle> {
  const space = await getSpaceOr404(db, spaceId);
  const project = await db.project.findUniqueOrThrow({ where: { id: space.projectId } });
  const [references, assets, ms, scenes, prompts, outputs] = await Promise.all([
    db.reference.findMany({ where: { spaceId }, orderBy: { code: "asc" } }),
    db.asset.findMany({ where: { projectId: project.id }, orderBy: { createdAt: "asc" } }),
    db.masterScript.findUnique({ where: { spaceId } }),
    db.scene.findMany({ where: { spaceId }, orderBy: { sceneNumber: "asc" } }),
    db.promptTemplate.findMany({ orderBy: { id: "asc" } }),
    db.output.findMany({ where: { spaceId }, orderBy: [{ createdAt: "asc" }, { index: "asc" }] }),
  ]);
  return {
    project: toProject(project),
    space: toSpace(space),
    references: references.map(toReference),
    assets: assets.map(toAsset),
    masterScript: ms ? toMasterScript(ms) : null,
    scenes: scenes.map(toScene),
    prompts: prompts.map(toPrompt),
    workflow: await loadWorkflow(db, spaceId),
    outputs: outputs.map(toOutput),
  };
}

/** Picks only allowed keys from an untrusted body. */
export function pick<T extends Record<string, unknown>>(body: unknown, keys: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  if (body && typeof body === "object") {
    for (const k of keys) if (k in (body as Record<string, unknown>)) out[k] = (body as Record<string, unknown>)[k];
  }
  return out as Partial<T>;
}
