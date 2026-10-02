// Lip-sync through Replicate: uploads the local video and audio with the Files API, runs the model
// (REPLICATE_LIPSYNC_MODEL, "owner/name" or "owner/name:version"), polls the prediction and downloads the video.
// Input field names differ between models; override with REPLICATE_LIPSYNC_VIDEO_FIELD / REPLICATE_LIPSYNC_AUDIO_FIELD.
import { blobFrom, checked, getBytes, sleep } from "../http";
import { requireKey, resolveModel, ProviderError, type LipSyncProvider, type MediaFile, type ProviderContext } from "../types";

const API = "https://api.replicate.com/v1";

interface Prediction {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: unknown;
  error?: string | null;
  urls?: { get?: string };
}

/** Uploads a file to Replicate's Files API and returns a URL usable as a model input. */
export async function replicateUpload(providerId: string, key: string, file: MediaFile, ctx: ProviderContext): Promise<string> {
  const form = new FormData();
  form.set("content", blobFrom(file), file.filename);
  const res = await checked(providerId, await ctx.fetch(`${API}/files`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: ctx.signal }));
  const json = (await res.json()) as { urls?: { get?: string } };
  if (!json.urls?.get) throw new ProviderError(providerId, "file upload returned no URL");
  return json.urls.get;
}

function firstUrl(output: unknown): string | undefined {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) return output.map(firstUrl).find(Boolean);
  if (output && typeof output === "object") return Object.values(output).map(firstUrl).find(Boolean);
  return undefined;
}

export const replicateLipSync: LipSyncProvider = {
  id: "replicate-lipsync",
  kind: "lipsync",
  label: "Replicate Lip Sync",
  envKeys: ["REPLICATE_API_TOKEN"],
  models: ["sync/lipsync-2", "bytedance/latentsync"],
  defaultModel: "sync/lipsync-2",
  notes: "Model and input field names are configurable (REPLICATE_LIPSYNC_MODEL, REPLICATE_LIPSYNC_VIDEO_FIELD, REPLICATE_LIPSYNC_AUDIO_FIELD).",
  async lipSync(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model || ctx.env.REPLICATE_LIPSYNC_MODEL, ctx.env);
    const auth = { authorization: `Bearer ${key}` };
    ctx.log(`Uploading video (${input.video.data.length} B) and audio (${input.audio.data.length} B) to Replicate`);
    const [videoUrl, audioUrl] = [await replicateUpload(this.id, key, input.video, ctx), await replicateUpload(this.id, key, input.audio, ctx)];
    const fields = { [ctx.env.REPLICATE_LIPSYNC_VIDEO_FIELD || "video"]: videoUrl, [ctx.env.REPLICATE_LIPSYNC_AUDIO_FIELD || "audio"]: audioUrl };
    const [name, version] = model.split(":");
    const url = version ? `${API}/predictions` : `${API}/models/${name}/predictions`;
    const body = version ? { version, input: fields } : { input: fields };
    ctx.log(`POST ${version ? "predictions" : `models/${name}/predictions`}`);
    const created = await checked(this.id, await ctx.fetch(url, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify(body), signal: ctx.signal }));
    let pred = (await created.json()) as Prediction;
    const pollMs = Number(ctx.env.VIDEO_POLL_INTERVAL_MS) || 5000;
    const deadline = Date.now() + (Number(ctx.env.VIDEO_TIMEOUT_MS) || 20 * 60 * 1000);
    while (pred.status === "starting" || pred.status === "processing") {
      if (Date.now() > deadline) throw new ProviderError(this.id, `timed out waiting for prediction ${pred.id}`, undefined, true);
      await sleep(pollMs, ctx.signal);
      pred = (await (await checked(this.id, await ctx.fetch(pred.urls?.get ?? `${API}/predictions/${pred.id}`, { headers: auth, signal: ctx.signal }))).json()) as Prediction;
      ctx.log(`prediction ${pred.id}: ${pred.status}`);
    }
    if (pred.status !== "succeeded") throw new ProviderError(this.id, pred.error || `prediction ${pred.status}`);
    const out = firstUrl(pred.output);
    if (!out) throw new ProviderError(this.id, "prediction returned no output URL");
    const data = await getBytes(this.id, ctx, out);
    return [{ data, mimeType: "video/mp4", ext: "mp4", model }];
  },
};
