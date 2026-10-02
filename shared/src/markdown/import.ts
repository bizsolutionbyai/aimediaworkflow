// Markdown files → plain entity data. Pure parsing; the backend applies the result to the database.
import YAML from "yaml";
import { extractVariables } from "../prompt";
import { REFERENCE_TYPES, type AssetKind, type ReferenceSettings, type ReferenceType, type SceneInput } from "../types";
import { normalizeWorkflow, type WorkflowDoc } from "../workflow";
import { fencedBlocks, num, parseFrontmatter, parseSections, sectionValue, str, stripSecrets } from "./format";

export interface ImportedReference {
  code: string;
  type: ReferenceType;
  name: string;
  description: string;
  prompt: string;
  settings: ReferenceSettings;
  assetIds: string[];
}

export interface ImportedScene extends SceneInput {
  code: string;
  sceneNumber: number;
  file: string;
}

export interface ImportedPrompt {
  id: string;
  name: string;
  category: string;
  description: string;
  template: string;
  variables: string[];
  version: number;
}

export interface ImportedAsset {
  id: string;
  kind: AssetKind;
  filename: string;
  path: string;
  mimeType: string;
  size: number;
}

export interface ImportedMarkdown {
  project: { id: string; name: string; description: string; settings: Record<string, unknown> };
  space: { id: string; name: string; description: string; targetPlatform: string; aspectRatio: string };
  references: ImportedReference[];
  masterScript: {
    title: string;
    objective: string;
    targetPlatform: string;
    aspectRatio: string;
    duration: number;
    characterId: string;
    productId: string;
    styleId: string;
    voiceId: string;
    globalInstruction: string;
    scriptText: string;
  } | null;
  scenes: ImportedScene[];
  prompts: ImportedPrompt[];
  /** Portable workflow: scene nodes carry `sceneCode` instead of internal `sceneId`. */
  workflow: WorkflowDoc | null;
  assets: ImportedAsset[];
  warnings: string[];
}

export class MarkdownImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MarkdownImportError";
  }
}

/** Normalizes paths and strips the common folder prefix so PROJECT.md sits at the root. */
export function normalizeImportFiles(files: Record<string, string>): Record<string, string> {
  const entries = Object.entries(files).map(([p, c]) => [p.replace(/\\/g, "/").replace(/^\.\//, ""), c] as const);
  const project = entries.find(([p]) => p === "PROJECT.md" || p.endsWith("/PROJECT.md"));
  const prefix = project ? project[0].slice(0, project[0].length - "PROJECT.md".length) : "";
  const out: Record<string, string> = {};
  for (const [p, c] of entries) {
    if (prefix && !p.startsWith(prefix)) continue;
    out[p.slice(prefix.length)] = c;
  }
  return out;
}

function parseYamlSafe(src: string, where: string, warnings: string[]): unknown {
  try {
    return YAML.parse(src);
  } catch (err) {
    warnings.push(`${where}: invalid YAML (${(err as Error).message.split("\n")[0]})`);
    return null;
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function parseReferences(body: string, warnings: string[]): ImportedReference[] {
  const refs: ImportedReference[] = [];
  for (const block of fencedBlocks(body, "yaml")) {
    const d = asRecord(parseYamlSafe(block, "PROJECT.md reference", warnings));
    if (!d.reference_id) continue;
    const type = str(d.type) as ReferenceType;
    if (!REFERENCE_TYPES.includes(type)) {
      warnings.push(`PROJECT.md: reference ${str(d.reference_id)} has unknown type "${str(d.type)}"; skipped`);
      continue;
    }
    const assets = Array.isArray(d.assets) ? d.assets : [];
    refs.push({
      code: str(d.reference_id).trim(),
      type,
      name: str(d.name),
      description: str(d.description),
      prompt: str(d.prompt),
      settings: stripSecrets(asRecord(d.settings)) as ReferenceSettings,
      assetIds: assets.map((a) => (typeof a === "string" ? a : str(asRecord(a).asset_id))).filter(Boolean),
    });
  }
  return refs;
}

function parseScene(path: string, text: string, warnings: string[]): ImportedScene | null {
  const { data, body } = parseFrontmatter(text);
  if (data.type && data.type !== "scene") {
    warnings.push(`${path}: type is "${str(data.type)}", expected scene; skipped`);
    return null;
  }
  const sections = parseSections(body);
  const fileNum = Number(path.match(/SCENE-(\d+)\.md$/i)?.[1] ?? 0);
  const sceneNumber = num(data.scene_number, fileNum) || fileNum;
  const code = str(data.scene_id).trim();
  if (!code) {
    warnings.push(`${path}: missing scene_id; skipped`);
    return null;
  }
  const scene: ImportedScene = {
    file: path,
    code,
    sceneNumber,
    title: str(data.title),
    duration: num(data.duration, 0),
    characterId: str(data.character_id),
    productId: str(data.product_id),
    styleId: str(data.style_id),
    voiceId: str(data.voice_id),
    shotType: str(data.shot_type),
    cameraMovement: str(data.camera_movement),
    location: str(data.location),
    lighting: str(data.lighting),
    expression: str(data.expression),
    imageProvider: str(data.image_provider),
    videoProvider: str(data.video_provider),
    voiceProvider: str(data.voice_provider),
  };
  const map: [string, keyof ImportedScene][] = [
    ["Script", "script"],
    ["Action", "action"],
    ["Dialogue", "dialogue"],
    ["Camera", "camera"],
    ["Image Prompt", "imagePrompt"],
    ["Video Prompt", "videoPrompt"],
    ["Voice Prompt", "voicePrompt"],
    ["Continuity", "continuity"],
  ];
  for (const [heading, field] of map) {
    if (sections.has(heading)) (scene as unknown as Record<string, unknown>)[field] = sectionValue(sections.get(heading));
  }
  return scene;
}

export function importMarkdownProject(input: Record<string, string>): ImportedMarkdown {
  const files = normalizeImportFiles(input);
  const warnings: string[] = [];
  const projectText = files["PROJECT.md"];
  if (!projectText) throw new MarkdownImportError("PROJECT.md not found in the selected folder");

  const pfm = parseFrontmatter(projectText);
  if (pfm.data.type && pfm.data.type !== "project") throw new MarkdownImportError(`PROJECT.md has type "${str(pfm.data.type)}", expected project`);
  const psec = parseSections(pfm.body);
  const projectId = str(pfm.data.project_id).trim();
  const spaceId = str(pfm.data.space_id).trim();
  if (!projectId) warnings.push("PROJECT.md: project_id missing; a new project will be created");
  if (!spaceId) warnings.push("PROJECT.md: space_id missing; a new space will be created");

  const references: ImportedReference[] = [];
  for (const title of ["Characters", "Products", "Styles", "Voices", "Environments", "Media References"]) {
    references.push(...parseReferences(psec.get(title) ?? "", warnings));
  }
  const seenRefs = new Set<string>();
  for (const r of references) {
    if (seenRefs.has(r.code)) warnings.push(`PROJECT.md: duplicate reference ${r.code}; last one wins`);
    seenRefs.add(r.code);
  }

  const result: ImportedMarkdown = {
    project: {
      id: projectId,
      name: str(pfm.data.project_name, "Imported project"),
      description: sectionValue(psec.get("Description")),
      settings: stripSecrets(asRecord(pfm.data.settings)),
    },
    space: {
      id: spaceId,
      name: str(pfm.data.space_name, "Imported space"),
      description: sectionValue(psec.get("Space Description")),
      targetPlatform: str(pfm.data.target_platform),
      aspectRatio: str(pfm.data.aspect_ratio, "9:16"),
    },
    references,
    masterScript: null,
    scenes: [],
    prompts: [],
    workflow: null,
    assets: [],
    warnings,
  };

  const msText = files["MASTER-SCRIPT.md"];
  if (msText) {
    const { data, body } = parseFrontmatter(msText);
    const sec = parseSections(body);
    result.masterScript = {
      title: str(data.title),
      objective: sectionValue(sec.get("Objective")),
      targetPlatform: str(data.target_platform),
      aspectRatio: str(data.aspect_ratio),
      duration: num(data.duration, 0),
      characterId: str(data.character_id),
      productId: str(data.product_id),
      styleId: str(data.style_id),
      voiceId: str(data.voice_id),
      globalInstruction: sectionValue(sec.get("Global Instruction")),
      scriptText: sectionValue(sec.get("Script")),
    };
  } else {
    warnings.push("MASTER-SCRIPT.md not found; master script left unchanged");
  }

  const scenePaths = Object.keys(files)
    .filter((p) => /^scenes\/[^/]+\.md$/i.test(p))
    .sort();
  for (const p of scenePaths) {
    const s = parseScene(p, files[p], warnings);
    if (s) result.scenes.push(s);
  }
  const codes = new Set<string>();
  for (const s of result.scenes) {
    if (codes.has(s.code)) warnings.push(`${s.file}: duplicate scene_id ${s.code}`);
    codes.add(s.code);
  }
  result.scenes.sort((a, b) => a.sceneNumber - b.sceneNumber);

  const promptsText = files["PROMPTS.md"];
  if (promptsText) {
    for (const block of fencedBlocks(parseFrontmatter(promptsText).body, "yaml")) {
      const d = asRecord(parseYamlSafe(block, "PROMPTS.md", warnings));
      if (!d.id || typeof d.template !== "string") continue;
      const template = str(d.template);
      result.prompts.push({
        id: str(d.id).trim(),
        name: str(d.name, str(d.id)),
        category: str(d.category, "Uncategorized"),
        description: str(d.description),
        template,
        variables: extractVariables(template),
        version: num(d.version, 1) || 1,
      });
    }
  }

  const wfText = files["WORKFLOW.md"];
  if (wfText) {
    const sec = parseSections(parseFrontmatter(wfText).body);
    const block = fencedBlocks(sec.get("Workflow JSON") ?? "", "json")[0];
    if (block) {
      try {
        const doc = normalizeWorkflow(JSON.parse(block));
        result.workflow = doc;
      } catch (err) {
        warnings.push(`WORKFLOW.md: Workflow JSON could not be parsed (${(err as Error).message}); workflow left unchanged`);
      }
    } else {
      warnings.push("WORKFLOW.md: no ```json block under '## Workflow JSON'; workflow left unchanged");
    }
  }

  const assetsText = files["ASSETS.md"];
  if (assetsText) {
    const sec = parseSections(parseFrontmatter(assetsText).body);
    const block = fencedBlocks(sec.get("Asset Data") ?? "", "yaml")[0];
    const list = block ? parseYamlSafe(block, "ASSETS.md", warnings) : null;
    if (Array.isArray(list)) {
      for (const item of list) {
        const a = asRecord(item);
        if (!a.asset_id || !a.path) continue;
        result.assets.push({
          id: str(a.asset_id),
          kind: (["image", "video", "audio", "other"].includes(str(a.kind)) ? str(a.kind) : "other") as AssetKind,
          filename: str(a.filename),
          path: str(a.path),
          mimeType: str(a.mime_type, "application/octet-stream"),
          size: num(a.size, 0),
        });
      }
    }
  }

  return result;
}
