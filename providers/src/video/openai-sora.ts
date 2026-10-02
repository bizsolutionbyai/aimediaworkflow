// OpenAI Sora video adapter: create job (POST /v1/videos, multipart with optional input_reference),
// poll GET /v1/videos/{id}, download GET /v1/videos/{id}/content.
import { blobFrom, checked, getBytes, sleep } from "../http";
import { requireKey, resolveModel, ProviderError, type VideoProvider } from "../types";

const SECONDS = [4, 8, 12];

export function soraSeconds(d: number): number {
  return SECONDS.reduce((best, s) => (Math.abs(s - d) < Math.abs(best - d) ? s : best), SECONDS[0]);
}

export function soraSize(aspect: string): string {
  const [w, h] = aspect.split(":").map(Number);
  return w && h && w > h ? "1280x720" : "720x1280";
}

export const openaiSora: VideoProvider = {
  id: "openai-sora",
  kind: "video",
  label: "OpenAI Sora",
  envKeys: ["OPENAI_API_KEY"],
  models: ["sora-2", "sora-2-pro"],
  defaultModel: "sora-2",
  supportsReferenceImages: true,
  notes: "Duration snaps to 4/8/12 s; sizes 720x1280 or 1280x720. The input image must match the output size.",
  async generateVideo(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    const base = ctx.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com/v1";
    const auth = { authorization: `Bearer ${key}` };
    const form = new FormData();
    form.set("model", model);
    form.set("prompt", input.prompt);
    form.set("seconds", String(soraSeconds(input.duration || 8)));
    form.set("size", soraSize(input.aspectRatio));
    if (input.inputImage) form.set("input_reference", blobFrom(input.inputImage), input.inputImage.filename);
    ctx.log(`POST videos model=${model} seconds=${form.get("seconds")} size=${form.get("size")} image=${!!input.inputImage}`);
    const created = await checked(this.id, await ctx.fetch(`${base}/videos`, { method: "POST", headers: auth, body: form, signal: ctx.signal }));
    let job = (await created.json()) as { id: string; status: string; error?: { message?: string } };
    const pollMs = Number(ctx.env.VIDEO_POLL_INTERVAL_MS) || 10000;
    const deadline = Date.now() + (Number(ctx.env.VIDEO_TIMEOUT_MS) || 20 * 60 * 1000);
    while (job.status !== "completed") {
      if (job.status === "failed") throw new ProviderError(this.id, job.error?.message ?? "video generation failed");
      if (Date.now() > deadline) throw new ProviderError(this.id, `timed out waiting for video ${job.id}`, undefined, true);
      await sleep(pollMs, ctx.signal);
      const r = await checked(this.id, await ctx.fetch(`${base}/videos/${job.id}`, { headers: auth, signal: ctx.signal }));
      job = await r.json();
      ctx.log(`video ${job.id}: ${job.status}`);
    }
    const data = await getBytes(this.id, ctx, `${base}/videos/${job.id}/content`, auth);
    return [{ data, mimeType: "video/mp4", ext: "mp4", model }];
  },
};
