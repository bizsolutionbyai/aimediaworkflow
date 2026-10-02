// Catalog of canvas node types. Node `data` only ever holds IDs and small config values.

export type NodeCategory = "input" | "ai" | "logic" | "output";

/** What a node emits/accepts; used for connection validation and the consistency checker. */
export type PortKind = "reference" | "script" | "scene" | "prompt" | "image" | "video" | "audio" | "any";

export interface NodeTypeDef {
  type: string;
  label: string;
  category: NodeCategory;
  description: string;
  /** Kinds this node produces. */
  outputs: PortKind[];
  /** Kinds this node accepts ("any" accepts everything). */
  inputs: PortKind[];
  /** Provider kind this node calls, if any. */
  providerKind?: "image" | "video" | "voice" | "llm";
  defaultData: Record<string, unknown>;
}

export const NODE_TYPES: NodeTypeDef[] = [
  // INPUT
  { type: "imageReference", label: "Image Reference", category: "input", description: "An uploaded image asset or image reference profile.", outputs: ["reference", "image"], inputs: [], defaultData: { referenceCode: "", assetId: "" } },
  { type: "characterReference", label: "Character Reference", category: "input", description: "A character profile (MODEL_xxx) with face/hair/outfit locks.", outputs: ["reference"], inputs: [], defaultData: { referenceCode: "" } },
  { type: "productReference", label: "Product Reference", category: "input", description: "A product profile (PRODUCT_xxx) with logo/shape/label locks.", outputs: ["reference"], inputs: [], defaultData: { referenceCode: "" } },
  { type: "styleReference", label: "Style Reference", category: "input", description: "A visual style profile (STYLE_xxx).", outputs: ["reference"], inputs: [], defaultData: { referenceCode: "" } },
  { type: "voiceReference", label: "Voice Reference", category: "input", description: "A voice profile (VOICE_xxx).", outputs: ["reference"], inputs: [], defaultData: { referenceCode: "" } },
  { type: "videoReference", label: "Video Reference", category: "input", description: "An uploaded video asset.", outputs: ["reference", "video"], inputs: [], defaultData: { referenceCode: "", assetId: "" } },
  { type: "audioReference", label: "Audio Reference", category: "input", description: "An uploaded audio asset.", outputs: ["reference", "audio"], inputs: [], defaultData: { referenceCode: "", assetId: "" } },
  { type: "scriptInput", label: "Script Input", category: "input", description: "Free text script input.", outputs: ["script"], inputs: [], defaultData: { text: "" } },
  { type: "masterScript", label: "Master Script", category: "input", description: "The space's master script.", outputs: ["script"], inputs: ["reference", "script"], defaultData: {} },
  { type: "scene", label: "Scene", category: "input", description: "One storyboard scene.", outputs: ["scene"], inputs: ["reference", "script", "prompt", "scene"], defaultData: { sceneId: "" } },

  // AI
  { type: "imageGenerator", label: "Image Generator", category: "ai", description: "Generates images for the upstream scene.", outputs: ["image"], inputs: ["scene", "reference", "prompt", "image"], providerKind: "image", defaultData: { provider: "", model: "", aspectRatio: "9:16", count: 1, promptOverride: "", useReferenceImages: true } },
  { type: "imageEditor", label: "Image Editor", category: "ai", description: "Edits an upstream image with a prompt.", outputs: ["image"], inputs: ["image", "prompt", "scene", "reference"], providerKind: "image", defaultData: { provider: "", model: "", aspectRatio: "9:16", count: 1, promptOverride: "" } },
  { type: "videoGenerator", label: "Video Generator", category: "ai", description: "Generates a video from an upstream image and the scene's video prompt.", outputs: ["video"], inputs: ["image", "scene", "prompt", "reference"], providerKind: "video", defaultData: { provider: "", model: "", aspectRatio: "9:16", duration: 8, promptOverride: "" } },
  { type: "voiceGenerator", label: "Voice Generator", category: "ai", description: "Generates voice-over audio from the scene's dialogue.", outputs: ["audio"], inputs: ["scene", "reference", "prompt", "script"], providerKind: "voice", defaultData: { provider: "", model: "", voice: "", promptOverride: "" } },
  { type: "lipSync", label: "Lip Sync", category: "ai", description: "Lip-syncs a video to audio (no adapter shipped yet).", outputs: ["video"], inputs: ["video", "audio"], providerKind: "video", defaultData: { provider: "" } },
  { type: "scriptGenerator", label: "Script Generator", category: "ai", description: "Uses the AI assistant LLM to draft a master script.", outputs: ["script"], inputs: ["reference", "script"], providerKind: "llm", defaultData: { provider: "", brief: "" } },
  { type: "storyboardGenerator", label: "Storyboard Generator", category: "ai", description: "Splits the master script into scenes (deterministic parser).", outputs: ["scene"], inputs: ["script"], defaultData: {} },
  { type: "promptGenerator", label: "Prompt Generator", category: "ai", description: "Composes layered prompts for the upstream scene.", outputs: ["prompt"], inputs: ["scene", "reference", "prompt"], defaultData: { target: "image" } },

  // LOGIC
  { type: "prompt", label: "Prompt", category: "logic", description: "A prompt template from the library, or inline text.", outputs: ["prompt"], inputs: ["any"], defaultData: { templateId: "", text: "" } },
  { type: "condition", label: "Condition", category: "logic", description: "Continues only if upstream nodes produced outputs.", outputs: ["any"], inputs: ["any"], defaultData: { check: "hasOutputs" } },
  { type: "batch", label: "Batch", category: "logic", description: "Sets the output count for downstream generators.", outputs: ["any"], inputs: ["any"], defaultData: { count: 4 } },
  { type: "loop", label: "Loop", category: "logic", description: "Pass-through grouping node (iteration not executed in MVP).", outputs: ["any"], inputs: ["any"], defaultData: { iterations: 1 } },
  { type: "merge", label: "Merge", category: "logic", description: "Collects upstream outputs in order.", outputs: ["image", "video", "audio"], inputs: ["any"], defaultData: {} },
  { type: "delay", label: "Delay", category: "logic", description: "Waits before continuing.", outputs: ["any"], inputs: ["any"], defaultData: { seconds: 1 } },

  // OUTPUT
  { type: "imageOutput", label: "Image Output", category: "output", description: "Collects images.", outputs: [], inputs: ["image", "any"], defaultData: {} },
  { type: "videoOutput", label: "Video Output", category: "output", description: "Collects videos.", outputs: [], inputs: ["video", "any"], defaultData: {} },
  { type: "audioOutput", label: "Audio Output", category: "output", description: "Collects audio.", outputs: [], inputs: ["audio", "any"], defaultData: {} },
  { type: "finalVideo", label: "Final Video", category: "output", description: "Concatenates upstream videos with ffmpeg.", outputs: ["video"], inputs: ["video", "audio", "any"], defaultData: {} },
  { type: "export", label: "Export", category: "output", description: "Exports the space as Markdown.", outputs: [], inputs: ["any"], defaultData: {} },
];

export const NODE_TYPE_MAP: Record<string, NodeTypeDef> = Object.fromEntries(
  NODE_TYPES.map((d) => [d.type, d]),
);

export function getNodeTypeDef(type: string): NodeTypeDef | undefined {
  return NODE_TYPE_MAP[type];
}

/** Maps reference types to their canvas node type. */
export const REFERENCE_NODE_TYPE: Record<string, string> = {
  character: "characterReference",
  product: "productReference",
  style: "styleReference",
  voice: "voiceReference",
  environment: "imageReference",
  image: "imageReference",
  video: "videoReference",
  audio: "audioReference",
};

export function canConnect(sourceType: string, targetType: string): boolean {
  const s = getNodeTypeDef(sourceType);
  const t = getNodeTypeDef(targetType);
  if (!s || !t) return false;
  if (t.inputs.length === 0 || s.outputs.length === 0) return false;
  if (t.inputs.includes("any") || s.outputs.includes("any")) return true;
  return s.outputs.some((o) => t.inputs.includes(o));
}
