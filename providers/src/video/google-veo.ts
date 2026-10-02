// Google Veo adapter via the Gemini API long-running predict endpoint.
import { bytesToB64, getBytes, postJson, sleep, checked } from "../http";
import { requireKey, resolveModel, ProviderError, type VideoProvider } from "../types";

interface Operation {
  name: string;
  done?: boolean;
  error?: { message?: string };
  response?: { generateVideoResponse?: { generatedSamples?: { video?: { uri?: string } }[] } };
}

export const googleVeo: VideoProvider = {
  id: "google-veo",
  kind: "video",
  label: "Google Veo",
  envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  models: ["veo-3.0-generate-001", "veo-3.0-fast-generate-001"],
  defaultModel: "veo-3.0-generate-001",
  supportsReferenceImages: true,
  notes: "Aspect ratio 16:9 or 9:16. Duration is decided by the model.",
  async generateVideo(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    const headers = { "x-goog-api-key": key };
    const base = "https://generativelanguage.googleapis.com/v1beta";
    const instance: Record<string, unknown> = { prompt: input.prompt };
    if (input.inputImage) instance.image = { bytesBase64Encoded: bytesToB64(input.inputImage.data), mimeType: input.inputImage.mimeType };
    const [w, h] = input.aspectRatio.split(":").map(Number);
    ctx.log(`POST ${model}:predictLongRunning image=${!!input.inputImage}`);
    let op = await postJson<Operation>(this.id, ctx, `${base}/models/${encodeURIComponent(model)}:predictLongRunning`, {
      instances: [instance],
      parameters: { aspectRatio: w && h && w > h ? "16:9" : "9:16" },
    }, headers);
    const pollMs = Number(ctx.env.VIDEO_POLL_INTERVAL_MS) || 10000;
    const deadline = Date.now() + (Number(ctx.env.VIDEO_TIMEOUT_MS) || 20 * 60 * 1000);
    while (!op.done) {
      if (Date.now() > deadline) throw new ProviderError(this.id, `timed out waiting for ${op.name}`, undefined, true);
      await sleep(pollMs, ctx.signal);
      op = (await (await checked(this.id, await ctx.fetch(`${base}/${op.name}`, { headers, signal: ctx.signal }))).json()) as Operation;
      ctx.log(`operation ${op.name}: done=${!!op.done}`);
    }
    if (op.error) throw new ProviderError(this.id, op.error.message ?? "video generation failed");
    const uri = op.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri;
    if (!uri) throw new ProviderError(this.id, "operation finished without a video");
    const data = await getBytes(this.id, ctx, uri, headers);
    return [{ data, mimeType: "video/mp4", ext: "mp4", model }];
  },
};
