// Provider SDK: every adapter implements one of these interfaces. Workflow logic only talks to
// these interfaces, never to a concrete vendor API.
import type { ProviderInfo, ProviderKind } from "@amw/shared";

export type Env = Record<string, string | undefined>;

export interface ProviderContext {
  env: Env;
  fetch: typeof fetch;
  signal?: AbortSignal;
  log: (message: string) => void;
}

/** A local file handed to a provider (reference image, input frame). */
export interface MediaFile {
  data: Uint8Array;
  mimeType: string;
  filename: string;
}

/** Generated media returned by a provider. The caller stores it under data/outputs. */
export interface MediaResult {
  data: Uint8Array;
  mimeType: string;
  ext: string;
  model: string;
}

export interface ImageInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio: string;
  count: number;
  model?: string;
  /** Character / product / style reference images. */
  referenceImages: MediaFile[];
  /** Image to edit (Image Editor node). */
  inputImage?: MediaFile;
}

export interface VideoInput {
  prompt: string;
  aspectRatio: string;
  /** Seconds. Providers snap this to their supported values. */
  duration: number;
  model?: string;
  inputImage?: MediaFile;
}

export interface VoiceInput {
  text: string;
  instructions: string;
  voice?: string;
  model?: string;
}

export interface LipSyncInput {
  video: MediaFile;
  audio: MediaFile;
  model?: string;
}

export interface LlmInput {
  system: string;
  prompt: string;
  maxTokens?: number;
  model?: string;
}

export interface ProviderBase {
  id: string;
  kind: ProviderKind;
  label: string;
  /** Env var names; the provider is configured when the first one that is set exists. */
  envKeys: string[];
  models: string[];
  defaultModel: string;
  supportsReferenceImages?: boolean;
  notes?: string;
}

export interface ImageProvider extends ProviderBase {
  kind: "image";
  generateImage(input: ImageInput, ctx: ProviderContext): Promise<MediaResult[]>;
}

export interface VideoProvider extends ProviderBase {
  kind: "video";
  generateVideo(input: VideoInput, ctx: ProviderContext): Promise<MediaResult[]>;
}

export interface VoiceProvider extends ProviderBase {
  kind: "voice";
  generateVoice(input: VoiceInput, ctx: ProviderContext): Promise<MediaResult[]>;
}

export interface LipSyncProvider extends ProviderBase {
  kind: "lipsync";
  lipSync(input: LipSyncInput, ctx: ProviderContext): Promise<MediaResult[]>;
}

export interface LlmProvider extends ProviderBase {
  kind: "llm";
  complete(input: LlmInput, ctx: ProviderContext): Promise<string>;
}

export type AnyProvider = ImageProvider | VideoProvider | VoiceProvider | LipSyncProvider | LlmProvider;

export class ProviderNotConfiguredError extends Error {
  constructor(public readonly providerId: string, envKey: string) {
    super(`Provider not configured: ${providerId} (set ${envKey} in .env)`);
    this.name = "ProviderNotConfiguredError";
  }
}

export class ProviderError extends Error {
  constructor(
    public readonly providerId: string,
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(`${providerId}: ${message}`);
    this.name = "ProviderError";
  }
}

export function apiKey(p: ProviderBase, env: Env): string | undefined {
  for (const k of p.envKeys) {
    const v = env[k]?.trim();
    if (v) return v;
  }
  return undefined;
}

export function requireKey(p: ProviderBase, env: Env): string {
  const k = apiKey(p, env);
  if (!k) throw new ProviderNotConfiguredError(p.id, p.envKeys[0]);
  return k;
}

export function toInfo(p: ProviderBase, env: Env): ProviderInfo {
  const modelOverride = env[`${p.id.toUpperCase().replace(/-/g, "_")}_MODEL`]?.trim();
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    configured: !!apiKey(p, env),
    envKey: p.envKeys[0],
    models: p.models,
    defaultModel: modelOverride || p.defaultModel,
    supportsReferenceImages: p.supportsReferenceImages,
    notes: p.notes,
  };
}

export function resolveModel(p: ProviderBase, requested: string | undefined, env: Env): string {
  return requested?.trim() || toInfo(p, env).defaultModel;
}
