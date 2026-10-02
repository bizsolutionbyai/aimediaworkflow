import { describe, expect, it } from "vitest";
import {
  ProviderNotConfiguredError,
  ProviderRegistry,
  anthropicLlm,
  elevenlabs,
  googleImage,
  openAiImageSize,
  openaiTts,
  soraSeconds,
  soraSize,
  type ProviderContext,
} from "../src";

function ctx(env: Record<string, string>, handler: (url: string, init?: RequestInit) => Response): ProviderContext & { seen: { url: string; init?: RequestInit }[] } {
  const seen: { url: string; init?: RequestInit }[] = [];
  return {
    env,
    seen,
    log: () => {},
    fetch: (async (u: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(u), init });
      return handler(String(u), init);
    }) as typeof fetch,
  };
}

describe("provider registry", () => {
  it("reports configuration without exposing keys", () => {
    const r = new ProviderRegistry({ OPENAI_API_KEY: "sk-secret", OPENAI_IMAGE_MODEL: "gpt-image-1-mini" });
    const list = r.list();
    expect(JSON.stringify(list)).not.toContain("sk-secret");
    expect(list.find((p) => p.id === "openai-image")).toMatchObject({ configured: true, defaultModel: "gpt-image-1-mini" });
    expect(list.find((p) => p.id === "google-veo")?.configured).toBe(false);
    expect(r.defaultFor("video")?.id).toBe("openai-sora");
  });
});

describe("adapters", () => {
  it("throws ProviderNotConfiguredError without a key", async () => {
    await expect(googleImage.generateImage({ prompt: "x", aspectRatio: "9:16", count: 1, referenceImages: [] }, ctx({}, () => new Response()))).rejects.toBeInstanceOf(ProviderNotConfiguredError);
  });

  it("maps sizes and durations", () => {
    expect(openAiImageSize("9:16")).toBe("1024x1536");
    expect(openAiImageSize("16:9")).toBe("1536x1024");
    expect(openAiImageSize("1:1")).toBe("1024x1024");
    expect(soraSeconds(15)).toBe(12);
    expect(soraSeconds(6)).toBe(4);
    expect(soraSize("9:16")).toBe("720x1280");
  });

  it("google image sends reference images inline", async () => {
    const c = ctx({ GOOGLE_API_KEY: "g" }, () =>
      Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }] }),
    );
    const out = await googleImage.generateImage({ prompt: "p", aspectRatio: "9:16", count: 2, referenceImages: [{ data: new Uint8Array([1, 2]), mimeType: "image/png", filename: "a.png" }] }, c);
    expect(out).toHaveLength(2);
    const body = JSON.parse(String(c.seen[0].init?.body));
    expect(body.contents[0].parts[1].inline_data.mime_type).toBe("image/png");
    expect(body.generationConfig.imageConfig.aspectRatio).toBe("9:16");
    expect(new Headers(c.seen[0].init?.headers).get("x-goog-api-key")).toBe("g");
  });

  it("openai tts posts instructions and returns mp3", async () => {
    const c = ctx({ OPENAI_API_KEY: "k" }, () => new Response(new Uint8Array([9, 9])));
    const out = await openaiTts.generateVoice({ text: "Xin chào", instructions: "warm", voice: "nova" }, c);
    expect(out[0]).toMatchObject({ mimeType: "audio/mpeg", ext: "mp3" });
    expect(JSON.parse(String(c.seen[0].init?.body))).toMatchObject({ input: "Xin chào", instructions: "warm", voice: "nova" });
  });

  it("elevenlabs requires a voice id", async () => {
    await expect(elevenlabs.generateVoice({ text: "x", instructions: "" }, ctx({ ELEVENLABS_API_KEY: "e" }, () => new Response()))).rejects.toThrow(/voice id/);
  });

  it("surfaces HTTP errors without leaking the key", async () => {
    const c = ctx({ ANTHROPIC_API_KEY: "secret-key" }, () => Response.json({ error: { message: "overloaded" } }, { status: 529 }));
    const err = await anthropicLlm.complete({ system: "s", prompt: "p" }, c).catch((e) => e);
    expect(err.message).toMatch(/HTTP 529: overloaded/);
    expect(err.message).not.toContain("secret-key");
    expect(err.retryable).toBe(true);
  });
});
