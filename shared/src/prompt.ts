// Layered prompt engine. Prompts are never stored as one opaque string: each layer is derived from
// structured data (project, references, scene) and only composed into a FINAL PROMPT at generation time.
import type { MasterScript, Project, Reference, Scene, Space } from "./types";

export type PromptTarget = "image" | "video" | "voice";

export const PROMPT_LAYER_KEYS = [
  "global",
  "character",
  "product",
  "style",
  "scene",
  "camera",
  "continuity",
  "provider",
] as const;
export type PromptLayerKey = (typeof PROMPT_LAYER_KEYS)[number];

export interface PromptLayer {
  key: PromptLayerKey;
  label: string;
  text: string;
}

export interface ComposedPrompt {
  target: PromptTarget;
  layers: PromptLayer[];
  /** Final prompt sent to the provider. */
  final: string;
  negative: string;
  /** For voice: the text that is spoken. */
  speechText?: string;
  /** Reference codes that were resolved for this scene. */
  refs: { character: string; product: string; style: string; voice: string };
  /** Asset ids of reference images (character, product, style) for providers that accept them. */
  referenceAssetIds: string[];
  warnings: string[];
}

export interface PromptContext {
  project: Pick<Project, "name" | "settings">;
  space: Pick<Space, "targetPlatform" | "aspectRatio">;
  masterScript: MasterScript | null;
  scene: Scene;
  references: Reference[];
}

export interface ProviderPromptHints {
  aspectRatio?: string;
  duration?: number;
  providerId?: string;
}

const VAR_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function extractVariables(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(VAR_RE)) out.add(m[1]);
  return [...out];
}

/** Replaces {{var}}. Unknown variables are kept verbatim so they stay visible to the user. */
export function renderTemplate(template: string, vars: Record<string, string | number | undefined | null>): string {
  return template.replace(VAR_RE, (whole, name: string) => {
    const v = vars[name];
    return v === undefined || v === null ? whole : String(v);
  });
}

export function missingVariables(template: string, vars: Record<string, unknown>): string[] {
  return extractVariables(template).filter((v) => vars[v] === undefined || vars[v] === null || vars[v] === "");
}

/** Scene reference codes, falling back to the master script when the scene leaves them empty. */
export function resolveSceneRefs(scene: Pick<Scene, "characterId" | "productId" | "styleId" | "voiceId">, master: MasterScript | null) {
  return {
    character: scene.characterId || master?.characterId || "",
    product: scene.productId || master?.productId || "",
    style: scene.styleId || master?.styleId || "",
    voice: scene.voiceId || master?.voiceId || "",
  };
}

function findRef(refs: Reference[], code: string): Reference | undefined {
  return code ? refs.find((r) => r.code === code) : undefined;
}

function refLabel(ref: Reference | undefined, code: string): string {
  if (!code) return "";
  return ref ? `${ref.code} (${ref.name})` : code;
}

/** Variables available to prompt templates ({{character}}, {{product}}, ...). */
export function sceneVariables(ctx: PromptContext): Record<string, string> {
  const { scene, masterScript, references } = ctx;
  const codes = resolveSceneRefs(scene, masterScript);
  const camera = [scene.shotType, scene.camera, scene.cameraMovement].filter(Boolean).join(", ");
  return {
    character: refLabel(findRef(references, codes.character), codes.character),
    product: refLabel(findRef(references, codes.product), codes.product),
    style: refLabel(findRef(references, codes.style), codes.style),
    voice: refLabel(findRef(references, codes.voice), codes.voice),
    scene: scene.title,
    camera,
    duration: scene.duration ? `${scene.duration} seconds` : "",
    dialogue: scene.dialogue,
    location: scene.location,
    action: scene.action,
    expression: scene.expression,
    lighting: scene.lighting,
    platform: ctx.space.targetPlatform,
    aspectRatio: ctx.space.aspectRatio,
  };
}

function lockSentence(ref: Reference): string {
  const s = ref.settings ?? {};
  const parts: string[] = [];
  if (ref.type === "character") {
    if (s.identityLock) parts.push("identity");
    if (s.faceLock) parts.push("face");
    if (s.hairLock) parts.push("hairstyle");
    if (s.outfitLock) parts.push("outfit");
  } else if (ref.type === "product") {
    if (s.logoLock) parts.push("logo");
    if (s.shapeLock) parts.push("shape");
    if (s.colorLock) parts.push("colors");
    if (s.labelLock) parts.push("label text");
    if (s.packagingLock) parts.push("packaging");
  }
  return parts.length ? `Keep ${parts.join(", ")} identical to the reference images.` : "";
}

function describeRef(kind: string, ref: Reference | undefined, code: string, warnings: string[]): string {
  if (!code) return "";
  if (!ref) {
    warnings.push(`${kind} reference ${code} does not exist`);
    return `Use ${kind} ${code}.`;
  }
  const lines = [`Use ${kind} ${ref.code} (${ref.name}).`];
  const desc = ref.prompt || ref.description;
  if (desc) lines.push(desc.trim());
  const locks = lockSentence(ref);
  if (locks) lines.push(locks);
  return lines.join(" ");
}

function cameraText(scene: Scene): string {
  return [
    scene.shotType && `Shot: ${scene.shotType}.`,
    scene.camera && `Camera: ${scene.camera}.`,
    scene.cameraMovement && `Movement: ${scene.cameraMovement}.`,
    scene.lighting && `Lighting: ${scene.lighting}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

/** Fallback scene description used when the user has not written a target-specific prompt. */
export function describeScene(scene: Scene): string {
  return [
    scene.location && `Location: ${scene.location}.`,
    scene.action && `Action: ${scene.action}`,
    scene.expression && `Expression: ${scene.expression}.`,
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function continuityText(ctx: PromptContext, refs: { character?: Reference; product?: Reference }): string {
  const parts: string[] = [];
  if (refs.character) parts.push("Maintain identical face, hairstyle, body proportions and outfit across all scenes.");
  if (refs.product) parts.push("Maintain identical product packaging, logo, label and colors across all scenes.");
  if (ctx.scene.continuity) parts.push(ctx.scene.continuity.trim());
  return parts.join(" ");
}

export function buildPromptLayers(ctx: PromptContext, target: PromptTarget, hints: ProviderPromptHints = {}): ComposedPrompt {
  const { scene, masterScript, references, project, space } = ctx;
  const warnings: string[] = [];
  const codes = resolveSceneRefs(scene, masterScript);
  const character = findRef(references, codes.character);
  const product = findRef(references, codes.product);
  const style = findRef(references, codes.style);
  const voice = findRef(references, codes.voice);

  const globalParts = [
    "Maintain visual consistency across the entire project.",
    project.settings?.globalPrompt as string | undefined,
    masterScript?.globalInstruction,
  ].filter((x): x is string => !!x && !!x.trim());

  const userPrompt = target === "image" ? scene.imagePrompt : target === "video" ? scene.videoPrompt : scene.voicePrompt;
  let sceneText = userPrompt?.trim() || "";
  if (!sceneText && target !== "voice") sceneText = describeScene(scene);
  const vars = sceneVariables(ctx);
  sceneText = renderTemplate(sceneText, vars);

  const aspect = hints.aspectRatio || masterScript?.aspectRatio || space.aspectRatio;
  const providerParts: string[] = [];
  if (target !== "voice" && aspect) providerParts.push(`Aspect ratio ${aspect}.`);
  if (target === "video") {
    const d = hints.duration || scene.duration;
    if (d) providerParts.push(`Duration ${d} seconds.`);
  }
  if (target !== "voice" && space.targetPlatform) providerParts.push(`Optimized for ${space.targetPlatform}.`);

  let layers: PromptLayer[];
  if (target === "voice") {
    layers = [
      { key: "global", label: "Global", text: masterScript?.globalInstruction?.trim() ?? "" },
      {
        key: "character",
        label: "Voice profile",
        text: voice
          ? [`Voice ${voice.code} (${voice.name}).`, voice.prompt || voice.description, voice.settings?.tone ? `Tone: ${voice.settings.tone}.` : ""]
              .filter(Boolean)
              .join(" ")
          : codes.voice
            ? (warnings.push(`voice reference ${codes.voice} does not exist`), `Voice ${codes.voice}.`)
            : "",
      },
      { key: "product", label: "Product", text: "" },
      { key: "style", label: "Style", text: "" },
      { key: "scene", label: "Scene (delivery)", text: sceneText || (scene.expression ? `Deliver with this emotion: ${scene.expression}.` : "") },
      { key: "camera", label: "Camera", text: "" },
      { key: "continuity", label: "Continuity", text: voice ? "Use the same voice, pace and tone as all other scenes." : "" },
      { key: "provider", label: "Provider", text: "" },
    ];
  } else {
    layers = [
      { key: "global", label: "Global", text: globalParts.join(" ") },
      { key: "character", label: "Character", text: describeRef("character", character, codes.character, warnings) },
      { key: "product", label: "Product", text: describeRef("product", product, codes.product, warnings) },
      { key: "style", label: "Style", text: describeRef("style", style, codes.style, warnings) },
      { key: "scene", label: "Scene", text: sceneText },
      { key: "camera", label: "Camera", text: cameraText(scene) },
      { key: "continuity", label: "Continuity", text: continuityText(ctx, { character, product }) },
      { key: "provider", label: "Provider", text: providerParts.join(" ") },
    ];
  }

  if (!sceneText && target !== "voice") warnings.push(`scene ${scene.code} has no ${target} prompt and no action/location to derive one`);
  if (target === "voice" && !scene.dialogue.trim()) warnings.push(`scene ${scene.code} has no dialogue to speak`);

  const final = composeFinalPrompt(layers);
  const referenceAssetIds = [character, product, style].flatMap((r) => r?.assetIds ?? []);
  return {
    target,
    layers,
    final,
    negative: String(project.settings?.negativePrompt ?? ""),
    speechText: target === "voice" ? scene.dialogue.trim() : undefined,
    refs: codes,
    referenceAssetIds,
    warnings,
  };
}

export function composeFinalPrompt(layers: PromptLayer[]): string {
  return layers
    .map((l) => l.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * Drafts target-specific prompt text from scene fields (deterministic; no AI involved).
 * Used by "Compose from fields" buttons in the Scene Editor.
 */
export function draftScenePrompt(ctx: PromptContext, target: PromptTarget): string {
  const s = ctx.scene;
  const v = sceneVariables(ctx);
  if (target === "image") {
    return [
      `Photorealistic still frame${v.character ? ` featuring ${v.character}` : ""}${v.product ? ` with ${v.product}` : ""}.`,
      s.location && `Location: ${s.location}.`,
      s.action && `Action: ${s.action}`,
      s.expression && `Expression: ${s.expression}.`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  if (target === "video") {
    return [
      `Animate the scene image${s.duration ? ` over ${s.duration} seconds` : ""}.`,
      s.action && `Motion: ${s.action}`,
      s.cameraMovement && `Camera movement: ${s.cameraMovement}.`,
      s.dialogue && `The character speaks: "${s.dialogue}"`,
      "Natural, smooth motion; keep the character and product unchanged.",
    ]
      .filter(Boolean)
      .join("\n");
  }
  return [s.expression ? `Speak in a ${s.expression} tone.` : "Speak naturally and warmly.", "Clear pronunciation, conversational pace."].join(" ");
}
