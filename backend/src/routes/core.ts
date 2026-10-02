// CRUD routes: projects, spaces, assets, references, master script, scenes, prompts, workflow, versions.
import fs from "node:fs";
import type { FastifyInstance } from "fastify";
import {
  DEFAULT_PROMPT_TEMPLATES,
  REFERENCE_CODE_PREFIX,
  REFERENCE_TYPES,
  VERSIONED_ENTITIES,
  buildProductionGraph,
  buildPromptLayers,
  createEmptyWorkflow,
  draftScenePrompt,
  extractVariables,
  missingVariables,
  nextCode,
  normalizeWorkflow,
  randomId,
  renderTemplate,
  sceneVariables,
  serializeWorkflow,
  stripSecrets,
  storyboardFromMasterScript,
  type PromptTarget,
  type ReferenceType,
  type VersionedEntity,
} from "@amw/shared";
import type { AppContext } from "../app";
import {
  BadRequestError,
  NotFoundError,
  getSpaceOr404,
  loadBundle,
  loadWorkflow,
  pick,
  toAsset,
  toMasterScript,
  toProject,
  toPrompt,
  toReference,
  toScene,
  toSpace,
} from "../repo";
import { applyStoryboard, cleanSceneInput, createScene, removeSceneNodes, updateScene } from "../services/scenes";
import { kindFromMime, mimeFromName, mirror, resolveData, safeExt, writeDataFile } from "../services/storage";
import { compareVersions, listVersions, recordVersion, restoreVersion, snapshotNow } from "../services/versions";

type P<T extends string> = { Params: Record<T, string> };

const str = (v: unknown, fallback = "") => (v === undefined || v === null ? fallback : String(v));

export async function seedPrompts(ctx: AppContext) {
  for (const t of DEFAULT_PROMPT_TEMPLATES) {
    const exists = await ctx.db.promptTemplate.findUnique({ where: { id: t.id } });
    if (!exists) {
      await ctx.db.promptTemplate.create({ data: { ...t, variables: JSON.stringify(t.variables) } });
      await recordVersion(ctx.db, "prompt", t.id, "Seeded");
    }
  }
}

export function coreRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db, cfg } = ctx;

  // ---------- Projects ----------
  app.get("/api/projects", async () => (await db.project.findMany({ orderBy: { updatedAt: "desc" } })).map(toProject));

  app.post("/api/projects", async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const name = str(b.name).trim();
    if (!name) throw new BadRequestError("name is required");
    const row = await db.project.create({
      data: { id: randomId("prj"), name, description: str(b.description), settings: JSON.stringify(stripSecrets(b.settings ?? {})) },
    });
    mirror(cfg.dataDir, `projects/${row.id}.json`, JSON.stringify(toProject(row), null, 2));
    return toProject(row);
  });

  app.get<P<"id">>("/api/projects/:id", async (req) => {
    const row = await db.project.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError("Project");
    return toProject(row);
  });

  app.patch<P<"id">>("/api/projects/:id", async (req) => {
    const b = pick<Record<string, unknown>>(req.body, ["name", "description", "settings"]);
    const data: Record<string, unknown> = {};
    if (b.name !== undefined) data.name = str(b.name);
    if (b.description !== undefined) data.description = str(b.description);
    if (b.settings !== undefined) data.settings = JSON.stringify(stripSecrets(b.settings));
    const row = await db.project.update({ where: { id: req.params.id }, data });
    mirror(cfg.dataDir, `projects/${row.id}.json`, JSON.stringify(toProject(row), null, 2));
    return toProject(row);
  });

  app.delete<P<"id">>("/api/projects/:id", async (req) => {
    await db.project.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  // ---------- Spaces ----------
  app.get<P<"id">>("/api/projects/:id/spaces", async (req) =>
    (await db.space.findMany({ where: { projectId: req.params.id }, orderBy: { createdAt: "asc" } })).map(toSpace),
  );

  app.post<P<"id">>("/api/projects/:id/spaces", async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const project = await db.project.findUnique({ where: { id: req.params.id } });
    if (!project) throw new NotFoundError("Project");
    const name = str(b.name).trim();
    if (!name) throw new BadRequestError("name is required");
    const row = await db.space.create({
      data: { id: randomId("spc"), projectId: project.id, name, description: str(b.description), targetPlatform: str(b.targetPlatform, "TikTok"), aspectRatio: str(b.aspectRatio, "9:16") },
    });
    await db.workflow.create({ data: { id: randomId("wf"), spaceId: row.id, json: serializeWorkflow(createEmptyWorkflow(project.id, row.id)) } });
    return toSpace(row);
  });

  app.get<P<"id">>("/api/spaces/:id", async (req) => toSpace(await getSpaceOr404(db, req.params.id)));

  app.patch<P<"id">>("/api/spaces/:id", async (req) => {
    const b = pick<Record<string, unknown>>(req.body, ["name", "description", "targetPlatform", "aspectRatio"]);
    const data = Object.fromEntries(Object.entries(b).map(([k, v]) => [k, str(v)]));
    return toSpace(await db.space.update({ where: { id: req.params.id }, data }));
  });

  app.delete<P<"id">>("/api/spaces/:id", async (req) => {
    await db.space.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  /** Everything the editor needs in one request. */
  app.get<P<"id">>("/api/spaces/:id/bundle", async (req) => loadBundle(db, req.params.id));

  // ---------- Assets ----------
  app.get<P<"id">>("/api/projects/:id/assets", async (req) =>
    (await db.asset.findMany({ where: { projectId: req.params.id }, orderBy: { createdAt: "asc" } })).map(toAsset),
  );

  app.post<P<"id">>("/api/projects/:id/assets", async (req) => {
    const project = await db.project.findUnique({ where: { id: req.params.id } });
    if (!project) throw new NotFoundError("Project");
    const created = [];
    let spaceId: string | null = null;
    let referenceId: string | null = null;
    for await (const part of req.parts()) {
      if (part.type === "field") {
        if (part.fieldname === "spaceId") spaceId = str(part.value) || null;
        if (part.fieldname === "referenceId") referenceId = str(part.value) || null;
        continue;
      }
      const buf = await part.toBuffer();
      const id = randomId("asset");
      const mime = part.mimetype && part.mimetype !== "application/octet-stream" ? part.mimetype : mimeFromName(part.filename);
      const rel = writeDataFile(cfg.dataDir, `assets/${project.id}/${id}${safeExt(part.filename)}`, buf);
      const row = await db.asset.create({ data: { id, projectId: project.id, spaceId, kind: kindFromMime(mime), filename: part.filename, path: rel, mimeType: mime, size: buf.length } });
      created.push(toAsset(row));
    }
    if (referenceId && created.length) {
      const ref = await db.reference.findUnique({ where: { id: referenceId } });
      if (ref) {
        const ids = [...JSON.parse(ref.assetIds), ...created.map((a) => a.id)];
        await db.reference.update({ where: { id: ref.id }, data: { assetIds: JSON.stringify(ids), version: { increment: 1 } } });
        await recordVersion(db, "reference", ref.id, "Added reference files");
      }
    }
    return created;
  });

  app.delete<P<"id">>("/api/assets/:id", async (req) => {
    const a = await db.asset.findUnique({ where: { id: req.params.id } });
    if (!a) throw new NotFoundError("Asset");
    const refs = await db.reference.findMany({ where: { assetIds: { contains: a.id } } });
    for (const r of refs) {
      const ids = (JSON.parse(r.assetIds) as string[]).filter((x) => x !== a.id);
      await db.reference.update({ where: { id: r.id }, data: { assetIds: JSON.stringify(ids) } });
    }
    await db.asset.delete({ where: { id: a.id } });
    fs.rmSync(resolveData(cfg.dataDir, a.path), { force: true });
    return { ok: true };
  });

  // ---------- References (Character / Product / Style / Voice / ...) ----------
  const REF_FIELDS = ["code", "type", "name", "description", "prompt", "settings", "assetIds"];

  app.get<P<"id">>("/api/spaces/:id/references", async (req) =>
    (await db.reference.findMany({ where: { spaceId: req.params.id }, orderBy: { code: "asc" } })).map(toReference),
  );

  app.post<P<"id">>("/api/spaces/:id/references", async (req) => {
    await getSpaceOr404(db, req.params.id);
    const b = pick<Record<string, unknown>>(req.body, REF_FIELDS);
    const type = str(b.type) as ReferenceType;
    if (!REFERENCE_TYPES.includes(type)) throw new BadRequestError(`type must be one of ${REFERENCE_TYPES.join(", ")}`);
    const existing = (await db.reference.findMany({ where: { spaceId: req.params.id }, select: { code: true } })).map((r) => r.code);
    const code = str(b.code).trim().toUpperCase() || nextCode(REFERENCE_CODE_PREFIX[type], existing);
    if (existing.includes(code)) throw new BadRequestError(`Reference id ${code} already exists in this space`);
    const defaults =
      type === "character"
        ? { faceLock: true, hairLock: true, outfitLock: true, identityLock: true }
        : type === "product"
          ? { logoLock: true, shapeLock: true, colorLock: true, labelLock: true, packagingLock: true }
          : {};
    const row = await db.reference.create({
      data: {
        id: randomId("ref"),
        code,
        spaceId: req.params.id,
        type,
        name: str(b.name, code),
        description: str(b.description),
        prompt: str(b.prompt),
        settings: JSON.stringify(stripSecrets({ ...defaults, ...((b.settings as object) ?? {}) })),
        assetIds: JSON.stringify(Array.isArray(b.assetIds) ? b.assetIds.map(String) : []),
      },
    });
    await recordVersion(db, "reference", row.id, "Created");
    return toReference(row);
  });

  app.patch<P<"id">>("/api/references/:id", async (req) => {
    const b = pick<Record<string, unknown>>(req.body, REF_FIELDS);
    const data: Record<string, unknown> = {};
    for (const k of ["name", "description", "prompt"]) if (b[k] !== undefined) data[k] = str(b[k]);
    if (b.code !== undefined) data.code = str(b.code).trim().toUpperCase();
    if (b.type !== undefined) {
      if (!REFERENCE_TYPES.includes(str(b.type) as ReferenceType)) throw new BadRequestError("invalid type");
      data.type = str(b.type);
    }
    if (b.settings !== undefined) data.settings = JSON.stringify(stripSecrets(b.settings));
    if (b.assetIds !== undefined) data.assetIds = JSON.stringify(Array.isArray(b.assetIds) ? b.assetIds.map(String) : []);
    const row = await db.reference.update({ where: { id: req.params.id }, data: { ...data, version: { increment: 1 } } });
    await recordVersion(db, "reference", row.id, "Saved");
    return toReference(row);
  });

  app.delete<P<"id">>("/api/references/:id", async (req) => {
    await db.reference.delete({ where: { id: req.params.id } });
    return { ok: true };
  });

  // ---------- Master script ----------
  const MS_FIELDS = ["title", "objective", "targetPlatform", "aspectRatio", "duration", "characterId", "productId", "styleId", "voiceId", "globalInstruction", "scriptText"];

  app.get<P<"id">>("/api/spaces/:id/master-script", async (req) => {
    const row = await db.masterScript.findUnique({ where: { spaceId: req.params.id } });
    return row ? toMasterScript(row) : null;
  });

  app.put<P<"id">>("/api/spaces/:id/master-script", async (req) => {
    const space = await getSpaceOr404(db, req.params.id);
    const b = pick<Record<string, unknown>>(req.body, MS_FIELDS);
    const data: Record<string, unknown> = {};
    for (const k of MS_FIELDS) if (b[k] !== undefined) data[k] = k === "duration" ? Math.max(0, Math.round(Number(b[k]) || 0)) : str(b[k]);
    const existing = await db.masterScript.findUnique({ where: { spaceId: space.id } });
    const row = existing
      ? await db.masterScript.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } })
      : await db.masterScript.create({ data: { id: randomId("ms"), spaceId: space.id, targetPlatform: space.targetPlatform, aspectRatio: space.aspectRatio, ...data } });
    await recordVersion(db, "masterScript", row.id, existing ? "Saved" : "Created");
    mirror(cfg.dataDir, `scripts/${space.id}.txt`, row.scriptText);
    await db.scene.updateMany({ where: { spaceId: space.id, masterScriptId: null }, data: { masterScriptId: row.id } });
    return toMasterScript(row);
  });

  /** Storyboard Generator: master script → scenes (deterministic split, or drafts supplied by the assistant). */
  app.post<P<"id">>("/api/spaces/:id/storyboard", async (req) => {
    const spaceId = req.params.id;
    const b = (req.body ?? {}) as { mode?: "replace" | "append"; scenes?: unknown[]; buildGraph?: boolean; includeVoice?: boolean };
    let drafts = Array.isArray(b.scenes) ? b.scenes.map(cleanSceneInput) : null;
    if (!drafts) {
      const ms = await db.masterScript.findUnique({ where: { spaceId } });
      if (!ms || !ms.scriptText.trim()) throw new BadRequestError("Write the master script first");
      drafts = storyboardFromMasterScript(ms).map(cleanSceneInput);
    }
    if (!drafts.length) throw new BadRequestError("No scenes found in the master script");
    const scenes = await applyStoryboard(db, spaceId, drafts, b.mode ?? "replace");
    if (b.buildGraph !== false) {
      const bundle = await loadBundle(db, spaceId);
      const doc = buildProductionGraph(bundle.workflow, {
        scenes: bundle.scenes,
        references: bundle.references,
        includeVoice: !!b.includeVoice,
        imageProvider: ctx.registry.defaultFor("image")?.id ?? "",
        videoProvider: ctx.registry.defaultFor("video")?.id ?? "",
        voiceProvider: ctx.registry.defaultFor("voice")?.id ?? "",
        aspectRatio: bundle.masterScript?.aspectRatio || bundle.space.aspectRatio,
      });
      await saveWorkflow(spaceId, doc, "Storyboard generator");
    }
    return { scenes, workflow: await loadWorkflow(db, spaceId) };
  });

  // ---------- Scenes ----------
  app.get<P<"id">>("/api/spaces/:id/scenes", async (req) =>
    (await db.scene.findMany({ where: { spaceId: req.params.id }, orderBy: { sceneNumber: "asc" } })).map(toScene),
  );

  app.post<P<"id">>("/api/spaces/:id/scenes", async (req) => {
    await getSpaceOr404(db, req.params.id);
    return createScene(db, req.params.id, cleanSceneInput(req.body));
  });

  app.get<P<"id">>("/api/scenes/:id", async (req) => {
    const row = await db.scene.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError("Scene");
    return toScene(row);
  });

  app.patch<P<"id">>("/api/scenes/:id", async (req) => updateScene(db, req.params.id, cleanSceneInput(req.body)));

  app.delete<P<"id">>("/api/scenes/:id", async (req) => {
    const row = await db.scene.delete({ where: { id: req.params.id } });
    await removeSceneNodes(db, row.spaceId, [row.id]);
    return { ok: true };
  });

  app.post<P<"id">>("/api/scenes/:id/duplicate", async (req) => {
    const src = await db.scene.findUnique({ where: { id: req.params.id } });
    if (!src) throw new NotFoundError("Scene");
    const input = cleanSceneInput({ ...toScene(src), code: undefined, sceneNumber: undefined, title: `${src.title} (copy)` });
    return createScene(db, src.spaceId, input, `Duplicated from ${src.code}`);
  });

  app.post<P<"id">>("/api/spaces/:id/scenes/reorder", async (req) => {
    const ids = ((req.body ?? {}) as { ids?: string[] }).ids ?? [];
    // Two passes avoid transient duplicate numbers.
    for (const [i, id] of ids.entries()) await db.scene.update({ where: { id }, data: { sceneNumber: 10000 + i } });
    for (const [i, id] of ids.entries()) await db.scene.update({ where: { id }, data: { sceneNumber: i + 1 } });
    return (await db.scene.findMany({ where: { spaceId: req.params.id }, orderBy: { sceneNumber: "asc" } })).map(toScene);
  });

  /** Layered prompt preview (GLOBAL + CHARACTER + PRODUCT + STYLE + SCENE + CAMERA + CONTINUITY + PROVIDER). */
  app.get<{ Params: { id: string }; Querystring: { target?: PromptTarget } }>("/api/scenes/:id/prompt-preview", async (req) => {
    const row = await db.scene.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError("Scene");
    const bundle = await loadBundle(db, row.spaceId);
    return buildPromptLayers({ ...bundle, scene: toScene(row) }, req.query.target ?? "image");
  });

  /** Deterministic prompt drafts from the scene fields (no AI). */
  app.post<P<"id">>("/api/scenes/:id/draft-prompts", async (req) => {
    const row = await db.scene.findUnique({ where: { id: req.params.id } });
    if (!row) throw new NotFoundError("Scene");
    const bundle = await loadBundle(db, row.spaceId);
    const scene = { ...toScene(row), ...cleanSceneInput(req.body) };
    const c = { ...bundle, scene };
    return { imagePrompt: draftScenePrompt(c, "image"), videoPrompt: draftScenePrompt(c, "video"), voicePrompt: draftScenePrompt(c, "voice") };
  });

  // ---------- Prompt library ----------
  app.get("/api/prompts", async () => (await db.promptTemplate.findMany({ orderBy: [{ category: "asc" }, { id: "asc" }] })).map(toPrompt));

  app.post("/api/prompts", async (req) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const id = str(b.id).trim().toUpperCase().replace(/[^A-Z0-9_]/g, "_");
    if (!id) throw new BadRequestError("id is required (e.g. CINEMATIC_V2)");
    const template = str(b.template);
    const row = await db.promptTemplate.create({
      data: { id, name: str(b.name, id), category: str(b.category, "Cinematic"), description: str(b.description), template, variables: JSON.stringify(extractVariables(template)) },
    });
    await recordVersion(db, "prompt", row.id, "Created");
    mirrorPrompts();
    return toPrompt(row);
  });

  app.patch<P<"id">>("/api/prompts/:id", async (req) => {
    const b = pick<Record<string, unknown>>(req.body, ["name", "category", "description", "template"]);
    const data: Record<string, unknown> = {};
    for (const k of Object.keys(b)) data[k] = str(b[k]);
    if (data.template !== undefined) data.variables = JSON.stringify(extractVariables(String(data.template)));
    const row = await db.promptTemplate.update({ where: { id: req.params.id }, data: { ...data, version: { increment: 1 } } });
    await recordVersion(db, "prompt", row.id, "Saved");
    mirrorPrompts();
    return toPrompt(row);
  });

  app.delete<P<"id">>("/api/prompts/:id", async (req) => {
    await db.promptTemplate.delete({ where: { id: req.params.id } });
    mirrorPrompts();
    return { ok: true };
  });

  app.post<P<"id">>("/api/prompts/:id/render", async (req) => {
    const tpl = await db.promptTemplate.findUnique({ where: { id: req.params.id } });
    if (!tpl) throw new NotFoundError("Prompt");
    const b = (req.body ?? {}) as { sceneId?: string; vars?: Record<string, string> };
    let vars: Record<string, string> = {};
    if (b.sceneId) {
      const row = await db.scene.findUnique({ where: { id: b.sceneId } });
      if (!row) throw new NotFoundError("Scene");
      vars = sceneVariables({ ...(await loadBundle(db, row.spaceId)), scene: toScene(row) });
    }
    vars = { ...vars, ...(b.vars ?? {}) };
    return { text: renderTemplate(tpl.template, vars), missing: missingVariables(tpl.template, vars) };
  });

  async function mirrorPrompts() {
    const all = (await db.promptTemplate.findMany({ orderBy: { id: "asc" } })).map(toPrompt);
    mirror(cfg.dataDir, "prompts/library.json", JSON.stringify(all, null, 2));
  }

  // ---------- Workflow ----------
  async function saveWorkflow(spaceId: string, raw: unknown, note: string) {
    const space = await getSpaceOr404(db, spaceId);
    const doc = normalizeWorkflow(raw);
    doc.projectId = space.projectId;
    doc.spaceId = space.id;
    const json = serializeWorkflow(doc);
    const existing = await db.workflow.findUnique({ where: { spaceId } });
    const row = existing
      ? await db.workflow.update({ where: { id: existing.id }, data: { json, version: { increment: 1 } } })
      : await db.workflow.create({ data: { id: randomId("wf"), spaceId, json } });
    await recordVersion(db, "workflow", row.id, note);
    mirror(cfg.dataDir, `workflows/${spaceId}.json`, json);
    return { id: row.id, version: row.version, workflow: doc };
  }

  app.get<P<"id">>("/api/spaces/:id/workflow", async (req) => {
    const row = await db.workflow.findUnique({ where: { spaceId: req.params.id } });
    return { id: row?.id ?? null, version: row?.version ?? 0, workflow: await loadWorkflow(db, req.params.id) };
  });

  app.put<P<"id">>("/api/spaces/:id/workflow", async (req) => {
    const b = (req.body ?? {}) as { workflow?: unknown; note?: string };
    return saveWorkflow(req.params.id, b.workflow ?? req.body, b.note ?? "Saved");
  });

  // ---------- Versions ----------
  const assertType = (t: string): VersionedEntity => {
    if (!(VERSIONED_ENTITIES as readonly string[]).includes(t)) throw new BadRequestError(`Unknown versioned entity ${t}`);
    return t as VersionedEntity;
  };

  app.get<P<"type" | "id">>("/api/versions/:type/:id", async (req) => listVersions(db, assertType(req.params.type), req.params.id));

  app.post<P<"type" | "id">>("/api/versions/:type/:id", async (req) =>
    snapshotNow(db, assertType(req.params.type), req.params.id, str(((req.body ?? {}) as { note?: string }).note)),
  );

  app.post<P<"versionId">>("/api/version/:versionId/restore", async (req) => restoreVersion(db, req.params.versionId));

  app.get<{ Params: { versionId: string }; Querystring: { with?: string } }>("/api/version/:versionId/compare", async (req) =>
    compareVersions(db, req.params.versionId, req.query.with || "current"),
  );
}
