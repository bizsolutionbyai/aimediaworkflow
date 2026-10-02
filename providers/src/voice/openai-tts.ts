// OpenAI text-to-speech adapter (/v1/audio/speech). Voice profile instructions are passed through.
import { checked } from "../http";
import { requireKey, resolveModel, type VoiceProvider } from "../types";

export const openaiTts: VoiceProvider = {
  id: "openai-tts",
  kind: "voice",
  label: "OpenAI TTS",
  envKeys: ["OPENAI_API_KEY"],
  models: ["gpt-4o-mini-tts", "tts-1-hd"],
  defaultModel: "gpt-4o-mini-tts",
  notes: "Voice names: alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer.",
  async generateVoice(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    const base = ctx.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com/v1";
    const body: Record<string, unknown> = { model, voice: input.voice || "alloy", input: input.text, response_format: "mp3" };
    if (input.instructions && model !== "tts-1" && model !== "tts-1-hd") body.instructions = input.instructions;
    ctx.log(`POST audio/speech model=${model} voice=${body.voice} chars=${input.text.length}`);
    const res = await checked(this.id, await ctx.fetch(`${base}/audio/speech`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctx.signal,
    }));
    return [{ data: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/mpeg", ext: "mp3", model }];
  },
};
