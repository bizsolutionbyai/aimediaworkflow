// Core domain types shared by backend, frontend and the Markdown exporter/importer.
// Long-form text lives in dedicated fields; generated media is referenced by asset/output IDs, never inlined.

export type ISODate = string;

export interface ProjectSettings {
  defaultAspectRatio?: string;
  defaultPlatform?: string;
  globalPrompt?: string;
  negativePrompt?: string;
  [key: string]: unknown;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  settings: ProjectSettings;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export interface Space {
  id: string;
  projectId: string;
  name: string;
  description: string;
  targetPlatform: string;
  aspectRatio: string;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export const REFERENCE_TYPES = [
  "character",
  "product",
  "environment",
  "style",
  "voice",
  "image",
  "video",
  "audio",
] as const;
export type ReferenceType = (typeof REFERENCE_TYPES)[number];

/** Lock flags. Character: face/hair/outfit/identity. Product: logo/shape/color/label/packaging. */
export type ReferenceLocks = Partial<
  Record<
    | "faceLock"
    | "hairLock"
    | "outfitLock"
    | "identityLock"
    | "logoLock"
    | "shapeLock"
    | "colorLock"
    | "labelLock"
    | "packagingLock",
    boolean
  >
>;

export interface ReferenceSettings extends ReferenceLocks {
  /** Voice profiles: provider-specific voice name (e.g. "alloy"), language, tone. */
  voiceName?: string;
  language?: string;
  tone?: string;
  [key: string]: unknown;
}

/** A Character / Product / Style / Voice / Environment profile or a raw media reference. */
export interface Reference {
  /** Internal database id. */
  id: string;
  /** Stable human-readable code used by scenes and Markdown, unique per space (e.g. MODEL_001). */
  code: string;
  spaceId: string;
  type: ReferenceType;
  name: string;
  description: string;
  /** Descriptor text injected into the CHARACTER / PRODUCT / STYLE prompt layer. */
  prompt: string;
  settings: ReferenceSettings;
  /** Asset ids of uploaded reference files (face.jpg, front.jpg, ...). */
  assetIds: string[];
  version: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type AssetKind = "image" | "video" | "audio" | "other";

export interface Asset {
  id: string;
  projectId: string;
  spaceId: string | null;
  kind: AssetKind;
  /** Original file name. */
  filename: string;
  /** Path relative to the data directory, using forward slashes (e.g. assets/prj_x/asset_y.jpg). */
  path: string;
  mimeType: string;
  size: number;
  createdAt: ISODate;
}

export interface MasterScript {
  id: string;
  spaceId: string;
  title: string;
  objective: string;
  targetPlatform: string;
  aspectRatio: string;
  /** Seconds. */
  duration: number;
  characterId: string;
  productId: string;
  styleId: string;
  voiceId: string;
  globalInstruction: string;
  scriptText: string;
  version: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export const JOB_STATUSES = ["PENDING", "RUNNING", "SUCCESS", "FAILED", "CANCELLED"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Per-scene generation status shown on scene nodes. */
export type GenerationStatus = "NONE" | JobStatus;

export interface Scene {
  id: string;
  /** Stable code, unique per space (e.g. SCENE_001). */
  code: string;
  spaceId: string;
  masterScriptId: string | null;
  sceneNumber: number;
  title: string;
  /** Seconds. */
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
  /** Reference codes. Empty string = inherit from master script. */
  characterId: string;
  productId: string;
  styleId: string;
  voiceId: string;
  imagePrompt: string;
  videoPrompt: string;
  voicePrompt: string;
  continuity: string;
  imageProvider: string;
  videoProvider: string;
  voiceProvider: string;
  imageStatus: GenerationStatus;
  videoStatus: GenerationStatus;
  voiceStatus: GenerationStatus;
  version: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

/** Editable scene fields (everything except identity/bookkeeping). */
export type SceneInput = Partial<
  Omit<Scene, "id" | "spaceId" | "createdAt" | "updatedAt" | "version">
>;

export const PROMPT_CATEGORIES = [
  "Character Consistency",
  "Product Consistency",
  "Cinematic",
  "Beauty",
  "Product Review",
  "TikTok",
  "Lifestyle",
  "Camera",
  "Lighting",
  "Voice",
  "Video Motion",
  "Transition",
  "Negative Prompt",
] as const;
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

export interface PromptTemplate {
  /** Stable id, e.g. CHARACTER_CONSISTENCY_V1. */
  id: string;
  name: string;
  category: string;
  description: string;
  template: string;
  /** Variable names used in the template, without braces. */
  variables: string[];
  version: number;
  createdAt: ISODate;
  updatedAt: ISODate;
}

export type OutputKind = "image" | "video" | "audio";

export interface Output {
  id: string;
  spaceId: string;
  sceneId: string | null;
  nodeId: string;
  jobId: string | null;
  kind: OutputKind;
  /** Path relative to the data directory. */
  path: string;
  provider: string;
  model: string;
  prompt: string;
  /** Position in a batch (0-based). */
  index: number;
  /** Preferred output used as input for downstream nodes. */
  selected: boolean;
  createdAt: ISODate;
}

export interface Job {
  id: string;
  runId: string | null;
  spaceId: string;
  nodeId: string;
  nodeType: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  error: string | null;
  logs: string[];
  outputIds: string[];
  createdAt: ISODate;
  startedAt: ISODate | null;
  finishedAt: ISODate | null;
}

export interface WorkflowRun {
  id: string;
  spaceId: string;
  status: JobStatus;
  /** Node ids in execution order. */
  order: string[];
  error: string | null;
  createdAt: ISODate;
  finishedAt: ISODate | null;
}

export const VERSIONED_ENTITIES = [
  "workflow",
  "masterScript",
  "scene",
  "prompt",
  "reference",
] as const;
export type VersionedEntity = (typeof VERSIONED_ENTITIES)[number];

export interface EntityVersion {
  id: string;
  entityType: VersionedEntity;
  entityId: string;
  version: number;
  note: string;
  snapshot: Record<string, unknown>;
  createdAt: ISODate;
}

export type ProviderKind = "image" | "video" | "voice" | "llm";

/** Public provider metadata. Never contains secrets. */
export interface ProviderInfo {
  id: string;
  kind: ProviderKind;
  label: string;
  configured: boolean;
  /** Which env var must be set (name only). */
  envKey: string;
  models: string[];
  defaultModel: string;
  supportsReferenceImages?: boolean;
  notes?: string;
}

/** Everything that belongs to one space; used by the exporter, importer and checker. */
export interface SpaceBundle {
  project: Project;
  space: Space;
  references: Reference[];
  assets: Asset[];
  masterScript: MasterScript | null;
  scenes: Scene[];
  prompts: PromptTemplate[];
  workflow: import("./workflow").WorkflowDoc;
  outputs: Output[];
}
