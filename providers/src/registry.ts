// Provider registry: the single place adapters are listed. Add a new adapter by importing it here.
import type { ProviderInfo, ProviderKind } from "@amw/shared";
import { googleImage } from "./image/google";
import { openaiImage } from "./image/openai";
import { xaiImage } from "./image/xai";
import { anthropicLlm } from "./llm/anthropic";
import { openaiLlm } from "./llm/openai";
import { googleVeo } from "./video/google-veo";
import { openaiSora } from "./video/openai-sora";
import { elevenlabs } from "./voice/elevenlabs";
import { openaiTts } from "./voice/openai-tts";
import { toInfo, type AnyProvider, type Env, type ImageProvider, type LlmProvider, type VideoProvider, type VoiceProvider } from "./types";

export const BUILTIN_PROVIDERS: AnyProvider[] = [openaiImage, googleImage, xaiImage, openaiSora, googleVeo, openaiTts, elevenlabs, anthropicLlm, openaiLlm];

export class ProviderRegistry {
  private readonly providers = new Map<string, AnyProvider>();

  constructor(private readonly env: Env, providers: AnyProvider[] = BUILTIN_PROVIDERS) {
    for (const p of providers) this.register(p);
  }

  register(p: AnyProvider): void {
    this.providers.set(p.id, p);
  }

  get(id: string): AnyProvider | undefined {
    return this.providers.get(id);
  }

  list(kind?: ProviderKind): ProviderInfo[] {
    return [...this.providers.values()].filter((p) => !kind || p.kind === kind).map((p) => toInfo(p, this.env));
  }

  image(id: string): ImageProvider | undefined {
    const p = this.get(id);
    return p?.kind === "image" ? p : undefined;
  }

  video(id: string): VideoProvider | undefined {
    const p = this.get(id);
    return p?.kind === "video" ? p : undefined;
  }

  voice(id: string): VoiceProvider | undefined {
    const p = this.get(id);
    return p?.kind === "voice" ? p : undefined;
  }

  llm(id: string): LlmProvider | undefined {
    const p = this.get(id);
    return p?.kind === "llm" ? p : undefined;
  }

  /** First configured provider of a kind, preferring DEFAULT_<KIND>_PROVIDER from env. */
  defaultFor(kind: ProviderKind): ProviderInfo | undefined {
    const list = this.list(kind);
    const preferred = this.env[`DEFAULT_${kind.toUpperCase()}_PROVIDER`]?.trim();
    return list.find((p) => p.id === preferred && p.configured) ?? list.find((p) => p.configured);
  }
}
