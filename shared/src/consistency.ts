// Consistency checker run before workflow execution (and on demand from the UI).
import { getNodeTypeDef } from "./nodeTypes";
import { resolveSceneRefs } from "./prompt";
import type { ProviderInfo, Reference, Scene, SpaceBundle } from "./types";
import { upstreamIds, validateGraph, type WorkflowDoc, type WorkflowNode } from "./workflow";

export type CheckLevel = "ok" | "warning" | "error";

export interface CheckItem {
  level: CheckLevel;
  code: string;
  subject: string;
  message: string;
  nodeId?: string;
  sceneId?: string;
}

export interface CheckReport {
  items: CheckItem[];
  errors: number;
  warnings: number;
  ok: boolean;
}

export function sceneLabel(s: Pick<Scene, "sceneNumber">): string {
  return `Scene ${String(s.sceneNumber).padStart(2, "0")}`;
}

/** The scene that feeds a node, walking upstream through non-scene nodes. */
export function findUpstreamScene(doc: WorkflowDoc, nodeId: string): WorkflowNode | undefined {
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>();
  const queue = upstreamIds(doc, nodeId);
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const n = byId.get(id);
    if (!n) continue;
    if (n.type === "scene") return n;
    queue.push(...upstreamIds(doc, id));
  }
  return undefined;
}

/** Provider for a generator node: explicit node setting, else the upstream scene's provider field. */
export function resolveNodeProvider(doc: WorkflowDoc, node: WorkflowNode, scenes: Scene[]): string {
  const explicit = typeof node.data.provider === "string" ? node.data.provider : "";
  if (explicit) return explicit;
  const sceneNode = findUpstreamScene(doc, node.id);
  const scene = sceneNode ? scenes.find((s) => s.id === sceneNode.data.sceneId) : undefined;
  if (!scene) return "";
  const kind = getNodeTypeDef(node.type)?.providerKind;
  if (kind === "image") return scene.imageProvider;
  if (kind === "video") return scene.videoProvider;
  if (kind === "voice") return scene.voiceProvider;
  return "";
}

const IMAGE_SOURCE_TYPES = new Set(["imageGenerator", "imageEditor", "imageReference", "merge", "batch", "condition", "delay", "loop"]);

export function checkConsistency(bundle: SpaceBundle, providers: ProviderInfo[]): CheckReport {
  const items: CheckItem[] = [];
  const { references, scenes, masterScript, workflow, assets } = bundle;
  const refByCode = new Map(references.map((r) => [r.code, r]));
  const assetIds = new Set(assets.map((a) => a.id));
  const providerById = new Map(providers.map((p) => [p.id, p]));

  const checkRef = (subject: string, code: string, expected: Reference["type"], required: boolean, sceneId?: string) => {
    if (!code) {
      if (required) items.push({ level: "warning", code: `missing_${expected}`, subject, message: `${subject} missing ${expected} reference`, sceneId });
      return;
    }
    const ref = refByCode.get(code);
    if (!ref) items.push({ level: "error", code: `unknown_${expected}`, subject, message: `${subject} references ${expected} ${code}, which does not exist`, sceneId });
    else if (ref.type !== expected) items.push({ level: "warning", code: `wrong_type_${expected}`, subject, message: `${subject}: ${code} is a ${ref.type}, expected ${expected}`, sceneId });
  };

  // References
  const characters = references.filter((r) => r.type === "character");
  const products = references.filter((r) => r.type === "product");
  if (!characters.length) items.push({ level: "warning", code: "no_character", subject: "Character", message: "No character reference defined" });
  if (!products.length) items.push({ level: "warning", code: "no_product", subject: "Product", message: "No product reference defined" });
  for (const r of references) {
    const missing = r.assetIds.filter((id) => !assetIds.has(id));
    if (missing.length) items.push({ level: "error", code: "missing_asset", subject: r.code, message: `${r.code} references missing asset(s): ${missing.join(", ")}` });
    else if ((r.type === "character" || r.type === "product") && !r.assetIds.length)
      items.push({ level: "warning", code: "no_reference_images", subject: r.code, message: `${r.code} (${r.type}) has no reference images uploaded` });
    else items.push({ level: "ok", code: "reference_ok", subject: `${r.type === "character" ? "Character" : r.type === "product" ? "Product" : r.type[0].toUpperCase() + r.type.slice(1)} ${r.code}`, message: "ok" });
  }

  // Master script
  if (!masterScript) {
    items.push({ level: "warning", code: "no_master_script", subject: "Master Script", message: "No master script" });
  } else {
    checkRef("Master Script", masterScript.characterId, "character", true);
    checkRef("Master Script", masterScript.productId, "product", true);
    if (masterScript.styleId) checkRef("Master Script", masterScript.styleId, "style", false);
    if (masterScript.voiceId) checkRef("Master Script", masterScript.voiceId, "voice", false);
    if (!masterScript.scriptText.trim()) items.push({ level: "warning", code: "empty_script", subject: "Master Script", message: "Master script text is empty" });
  }

  // Scenes
  if (!scenes.length) items.push({ level: "warning", code: "no_scenes", subject: "Storyboard", message: "No scenes yet" });
  const sortedScenes = [...scenes].sort((a, b) => a.sceneNumber - b.sceneNumber);
  for (const s of sortedScenes) {
    const label = sceneLabel(s);
    const before = items.length;
    const codes = resolveSceneRefs(s, masterScript);
    checkRef(label, codes.character, "character", true, s.id);
    checkRef(label, codes.product, "product", true, s.id);
    if (codes.style) checkRef(label, codes.style, "style", false, s.id);
    if (codes.voice) checkRef(label, codes.voice, "voice", false, s.id);
    if (!s.duration || s.duration <= 0) items.push({ level: "error", code: "no_duration", subject: label, message: `${label} has no duration`, sceneId: s.id });
    if (!s.imagePrompt.trim() && !s.videoPrompt.trim())
      items.push({ level: "warning", code: "no_prompt", subject: label, message: `${label} has no image or video prompt`, sceneId: s.id });
    if (items.length === before) items.push({ level: "ok", code: "scene_ok", subject: label, message: "ok", sceneId: s.id });
  }

  // Workflow graph
  for (const issue of validateGraph(workflow)) {
    items.push({ level: issue.level, code: issue.code, subject: "Workflow", message: issue.message, nodeId: issue.nodeId });
  }
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]));
  for (const node of workflow.nodes) {
    const def = getNodeTypeDef(node.type);
    if (!def) continue;
    const subject = `${def.label} (${node.id})`;
    if (node.type === "scene") {
      const sid = String(node.data.sceneId ?? "");
      if (!sid || !sceneById.has(sid)) items.push({ level: "error", code: "missing_scene", subject, message: `${subject} points to a scene that does not exist`, nodeId: node.id });
      continue;
    }
    if (def.category === "input" && node.type !== "masterScript" && node.type !== "scriptInput") {
      const code = String(node.data.referenceCode ?? "");
      const assetId = String(node.data.assetId ?? "");
      if (code && !refByCode.has(code)) items.push({ level: "error", code: "missing_reference", subject, message: `${subject} references ${code}, which does not exist`, nodeId: node.id });
      if (assetId && !assetIds.has(assetId)) items.push({ level: "error", code: "missing_asset", subject, message: `${subject} references missing asset ${assetId}`, nodeId: node.id });
      if (["characterReference", "productReference", "styleReference", "voiceReference"].includes(node.type) && !code)
        items.push({ level: "warning", code: "unset_reference", subject, message: `${subject} has no reference selected`, nodeId: node.id });
    }
    if (def.providerKind && def.providerKind !== "llm" && node.type !== "storyboardGenerator") {
      const pid = resolveNodeProvider(workflow, node, scenes);
      const p = pid ? providerById.get(pid) : undefined;
      if (!pid) items.push({ level: "error", code: "provider_unset", subject, message: `${def.label} provider not configured`, nodeId: node.id });
      else if (!p) items.push({ level: "error", code: "provider_unknown", subject, message: `${def.label} uses unknown provider "${pid}"`, nodeId: node.id });
      else if (!p.configured) items.push({ level: "error", code: "provider_not_configured", subject, message: `${def.label}: provider ${p.label} not configured (set ${p.envKey} in .env)`, nodeId: node.id });
      else if (p.kind !== def.providerKind) items.push({ level: "error", code: "provider_wrong_kind", subject, message: `${def.label}: ${p.label} is a ${p.kind} provider`, nodeId: node.id });
    }
    if (node.type === "videoGenerator" || node.type === "lipSync") {
      const ups = upstreamIds(workflow, node.id).map((id) => byId.get(id)).filter(Boolean) as WorkflowNode[];
      if (node.type === "videoGenerator" && !ups.some((u) => IMAGE_SOURCE_TYPES.has(u.type)))
        items.push({ level: "error", code: "video_without_image", subject, message: `${subject} has no image input (connect an Image Generator or Image Reference)`, nodeId: node.id });
      if (node.type === "lipSync" && !(ups.some((u) => u.type === "videoGenerator" || u.type === "videoReference") && ups.some((u) => u.type === "voiceGenerator" || u.type === "audioReference")))
        items.push({ level: "error", code: "lipsync_inputs", subject, message: `${subject} needs a video and an audio input`, nodeId: node.id });
    }
    if ((def.category === "ai" || def.category === "output") && upstreamIds(workflow, node.id).length === 0 && node.type !== "scriptGenerator")
      items.push({ level: "warning", code: "no_inputs", subject, message: `${subject} has no inputs`, nodeId: node.id });
  }

  const errors = items.filter((i) => i.level === "error").length;
  const warnings = items.filter((i) => i.level === "warning").length;
  return { items, errors, warnings, ok: errors === 0 };
}

export function formatCheckReport(report: CheckReport): string {
  const icon = { ok: "✓", warning: "⚠", error: "✕" } as const;
  return ["WORKFLOW CHECK", ...report.items.map((i) => `${icon[i.level]} ${i.level === "ok" ? i.subject : i.message}`)].join("\n");
}
