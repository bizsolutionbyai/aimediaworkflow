// Markdown export (writes files to EXPORT_DIR) and import (applies parsed files to the database).
import fs from "node:fs";
import path from "node:path";
import {
  exportSpaceToMarkdown,
  extractVariables,
  importMarkdownProject,
  normalizeWorkflow,
  randomId,
  sceneCode,
  serializeWorkflow,
  slugify,
  stripSecrets,
  type ImportedMarkdown,
} from "@amw/shared";
import type { ProviderRegistry } from "@amw/providers";
import type { Db } from "../db";
import { loadBundle } from "../repo";
import { resolveData, writeDataFile } from "./storage";
import { recordVersion } from "./versions";

export function exportFolderName(projectName: string, spaceName: string): string {
  return `${slugify(projectName)}--${slugify(spaceName)}`;
}

/**
 * Writes the export folder. With `includeMedia`, reference assets and generated outputs are copied to
 * `media/<path relative to data>` so the folder is self-contained (import copies them back).
 */
export async function exportSpace(db: Db, spaceId: string, exportDir: string, registry: ProviderRegistry, opts: { includeMedia?: boolean; dataDir?: string } = {}) {
  const bundle = await loadBundle(db, spaceId);
  const files = exportSpaceToMarkdown(bundle, { exportedAt: new Date().toISOString(), providers: registry.list(), providerDefaults: registry.defaults() });
  const folder = exportFolderName(bundle.project.name, bundle.space.name);
  const dir = path.join(exportDir, folder);
  // Remove stale scene files so deleted scenes do not linger in the export.
  fs.rmSync(path.join(dir, "scenes"), { recursive: true, force: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  }
  fs.rmSync(path.join(dir, "media"), { recursive: true, force: true });
  let mediaCount = 0;
  if (opts.includeMedia && opts.dataDir) {
    for (const rel of [...bundle.assets.map((a) => a.path), ...bundle.outputs.map((o) => o.path)]) {
      const src = resolveData(opts.dataDir, rel);
      if (!fs.existsSync(src)) continue;
      const dst = path.join(dir, "media", ...rel.split("/"));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      mediaCount++;
    }
  }
  return { folder, dir, files: Object.keys(files).sort(), mediaCount };
}

export function listExports(exportDir: string) {
  if (!fs.existsSync(exportDir)) return [];
  return fs
    .readdirSync(exportDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(exportDir, d.name, "PROJECT.md")))
    .map((d) => ({ folder: d.name, modifiedAt: fs.statSync(path.join(exportDir, d.name, "PROJECT.md")).mtime.toISOString() }))
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Reads every .md file of an export folder into a path → content map. */
export function readMarkdownFolder(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.name.toLowerCase().endsWith(".md")) out[path.relative(dir, abs).split(path.sep).join("/")] = fs.readFileSync(abs, "utf8");
    }
  };
  walk(dir);
  return out;
}

export interface ImportOptions {
  /** Delete scenes that exist in the app but have no scene file. Default false. */
  removeMissingScenes?: boolean;
  dataDir: string;
  /** Returns the bytes of `media/<relPath>` from the imported folder, if present. */
  media?: (relPath: string) => Uint8Array | null;
}

/** Media lookup for an export folder on disk. */
export function folderMedia(dir: string) {
  return (rel: string) => {
    const f = path.join(dir, "media", ...rel.split("/"));
    return fs.existsSync(f) ? new Uint8Array(fs.readFileSync(f)) : null;
  };
}

export interface ImportSummary {
  projectId: string;
  spaceId: string;
  created: string[];
  updated: string[];
  unchanged: string[];
  removed: string[];
  warnings: string[];
}

function changed(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return Object.keys(b).some((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}

export async function importFiles(db: Db, files: Record<string, string>, opts: ImportOptions): Promise<ImportSummary> {
  const parsed: ImportedMarkdown = importMarkdownProject(files);
  const s: ImportSummary = { projectId: "", spaceId: "", created: [], updated: [], unchanged: [], removed: [], warnings: [...parsed.warnings] };
  const note = (bucket: "created" | "updated" | "unchanged", what: string) => s[bucket].push(what);

  // Project
  const pData = { name: parsed.project.name, description: parsed.project.description, settings: JSON.stringify(stripSecrets(parsed.project.settings)) };
  let project = parsed.project.id ? await db.project.findUnique({ where: { id: parsed.project.id } }) : null;
  if (project) {
    if (changed(project as never, pData)) {
      project = await db.project.update({ where: { id: project.id }, data: pData });
      note("updated", `project ${project.id}`);
    } else note("unchanged", `project ${project.id}`);
  } else {
    project = await db.project.create({ data: { id: parsed.project.id || randomId("prj"), ...pData } });
    note("created", `project ${project.id}`);
  }
  s.projectId = project.id;

  // Space
  const spData = { name: parsed.space.name, description: parsed.space.description, targetPlatform: parsed.space.targetPlatform, aspectRatio: parsed.space.aspectRatio };
  let space = parsed.space.id ? await db.space.findUnique({ where: { id: parsed.space.id } }) : null;
  if (space && space.projectId !== project.id) {
    s.warnings.push(`space ${space.id} belongs to another project; a new space was created`);
    space = null;
    parsed.space.id = "";
  }
  if (space) {
    if (changed(space as never, spData)) {
      space = await db.space.update({ where: { id: space.id }, data: spData });
      note("updated", `space ${space.id}`);
    } else note("unchanged", `space ${space.id}`);
  } else {
    space = await db.space.create({ data: { id: parsed.space.id || randomId("spc"), projectId: project.id, ...spData } });
    note("created", `space ${space.id}`);
  }
  const spaceId = space.id;
  s.spaceId = spaceId;

  // Assets (metadata only; files must already exist in the data directory)
  for (const a of parsed.assets) {
    if (await db.asset.findUnique({ where: { id: a.id } })) continue;
    let exists = false;
    try {
      exists = fs.existsSync(resolveData(opts.dataDir, a.path));
    } catch {
      exists = false;
    }
    if (!exists) {
      const bytes = opts.media?.(a.path);
      if (bytes) {
        writeDataFile(opts.dataDir, a.path, bytes);
        note("created", `file ${a.path}`);
      } else {
        s.warnings.push(`asset ${a.id}: file ${a.path} not found in data directory or export media/; not registered`);
        continue;
      }
    }
    await db.asset.create({ data: { ...a, projectId: project.id, spaceId } });
    note("created", `asset ${a.id}`);
  }

  // References
  for (const r of parsed.references) {
    const data = { type: r.type, name: r.name, description: r.description, prompt: r.prompt, settings: JSON.stringify(r.settings), assetIds: JSON.stringify(r.assetIds) };
    for (const id of r.assetIds) if (!(await db.asset.findUnique({ where: { id } }))) s.warnings.push(`${r.code}: asset ${id} does not exist`);
    const existing = await db.reference.findUnique({ where: { spaceId_code: { spaceId, code: r.code } } });
    if (existing) {
      if (changed(existing as never, data)) {
        await db.reference.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
        await recordVersion(db, "reference", existing.id, "Imported from Markdown");
        note("updated", `reference ${r.code}`);
      } else note("unchanged", `reference ${r.code}`);
    } else {
      const created = await db.reference.create({ data: { id: randomId("ref"), code: r.code, spaceId, ...data } });
      await recordVersion(db, "reference", created.id, "Imported from Markdown");
      note("created", `reference ${r.code}`);
    }
  }

  // Master script
  let masterScriptId: string | null = null;
  if (parsed.masterScript) {
    const existing = await db.masterScript.findUnique({ where: { spaceId } });
    const data = parsed.masterScript;
    if (existing) {
      masterScriptId = existing.id;
      if (changed(existing as never, data as never)) {
        await db.masterScript.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } });
        await recordVersion(db, "masterScript", existing.id, "Imported from Markdown");
        note("updated", "master script");
      } else note("unchanged", "master script");
    } else {
      const created = await db.masterScript.create({ data: { id: randomId("ms"), spaceId, ...data } });
      masterScriptId = created.id;
      await recordVersion(db, "masterScript", created.id, "Imported from Markdown");
      note("created", "master script");
    }
  } else {
    masterScriptId = (await db.masterScript.findUnique({ where: { spaceId } }))?.id ?? null;
  }

  // Scenes
  const importedCodes = new Set<string>();
  for (const sc of parsed.scenes) {
    const { file: _file, code, ...fields } = sc;
    importedCodes.add(code);
    const existing = await db.scene.findUnique({ where: { spaceId_code: { spaceId, code } } });
    if (existing) {
      if (changed(existing as never, fields as never)) {
        await db.scene.update({ where: { id: existing.id }, data: { ...fields, version: { increment: 1 } } as never });
        await recordVersion(db, "scene", existing.id, "Imported from Markdown");
        note("updated", `scene ${code}`);
      } else note("unchanged", `scene ${code}`);
    } else {
      const created = await db.scene.create({ data: { id: randomId("scn"), code: code || sceneCode(sc.sceneNumber), spaceId, masterScriptId, ...fields } as never });
      await recordVersion(db, "scene", created.id, "Imported from Markdown");
      note("created", `scene ${code}`);
    }
  }
  if (opts.removeMissingScenes) {
    const stale = await db.scene.findMany({ where: { spaceId, code: { notIn: [...importedCodes] } } });
    for (const st of stale) {
      await db.scene.delete({ where: { id: st.id } });
      s.removed.push(`scene ${st.code}`);
    }
  }

  // Prompt templates (global library)
  for (const p of parsed.prompts) {
    const data = { name: p.name, category: p.category, description: p.description, template: p.template, variables: JSON.stringify(extractVariables(p.template)) };
    const existing = await db.promptTemplate.findUnique({ where: { id: p.id } });
    if (existing) {
      if (changed(existing as never, data)) {
        await db.promptTemplate.update({ where: { id: p.id }, data: { ...data, version: { increment: 1 } } });
        await recordVersion(db, "prompt", p.id, "Imported from Markdown");
        note("updated", `prompt ${p.id}`);
      } else note("unchanged", `prompt ${p.id}`);
    } else {
      await db.promptTemplate.create({ data: { id: p.id, ...data, version: p.version } });
      await recordVersion(db, "prompt", p.id, "Imported from Markdown");
      note("created", `prompt ${p.id}`);
    }
  }

  // Workflow: map portable sceneCode back to scene ids.
  if (parsed.workflow) {
    const scenes = await db.scene.findMany({ where: { spaceId } });
    const doc = normalizeWorkflow({
      ...parsed.workflow,
      projectId: project.id,
      spaceId,
      nodes: parsed.workflow.nodes.map((n) => {
        if (n.type !== "scene") return n;
        const code = String(n.data.sceneCode ?? "");
        const match = scenes.find((x) => x.code === code) ?? scenes.find((x) => x.id === n.data.sceneId);
        if (!match) s.warnings.push(`workflow node ${n.id}: scene ${code || String(n.data.sceneId)} not found`);
        const { sceneCode: _c, ...rest } = n.data;
        return { ...n, data: { ...rest, sceneId: match?.id ?? "" } };
      }),
    });
    const json = serializeWorkflow(doc);
    const existing = await db.workflow.findUnique({ where: { spaceId } });
    if (existing) {
      const prev = normalizeWorkflow(JSON.parse(existing.json));
      const same = JSON.stringify({ n: prev.nodes, e: prev.edges }) === JSON.stringify({ n: doc.nodes, e: doc.edges });
      if (!same) {
        await db.workflow.update({ where: { id: existing.id }, data: { json, version: { increment: 1 } } });
        await recordVersion(db, "workflow", existing.id, "Imported from Markdown");
        note("updated", "workflow");
      } else note("unchanged", "workflow");
    } else {
      const created = await db.workflow.create({ data: { id: randomId("wf"), spaceId, json } });
      await recordVersion(db, "workflow", created.id, "Imported from Markdown");
      note("created", "workflow");
    }
  }
  return s;
}
