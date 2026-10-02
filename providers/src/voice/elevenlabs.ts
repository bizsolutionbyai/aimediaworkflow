// ElevenLabs text-to-speech adapter. The voice id comes from the voice profile (settings.voiceName)
// or ELEVENLABS_VOICE_ID.
import { checked } from "../http";
import { requireKey, resolveModel, ProviderError, type VoiceProvider } from "../types";

export const elevenlabs: VoiceProvider = {
  id: "elevenlabs",
  kind: "voice",
  label: "ElevenLabs",
  envKeys: ["ELEVENLABS_API_KEY"],
  models: ["eleven_multilingual_v2", "eleven_turbo_v2_5"],
  defaultModel: "eleven_multilingual_v2",
  notes: "Set the voice id on the voice profile (Voice name field) or ELEVENLABS_VOICE_ID.",
  async generateVoice(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    const voice = input.voice || ctx.env.ELEVENLABS_VOICE_ID;
    if (!voice) throw new ProviderError(this.id, "no voice id (set it on the voice profile or ELEVENLABS_VOICE_ID)");
    ctx.log(`POST text-to-speech/${voice} model=${model}`);
    const res = await checked(this.id, await ctx.fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: input.text, model_id: model }),
      signal: ctx.signal,
    }));
    return [{ data: new Uint8Array(await res.arrayBuffer()), mimeType: "audio/mpeg", ext: "mp3", model }];
  },
};
