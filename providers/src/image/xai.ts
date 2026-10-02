// xAI Grok image adapter (OpenAI-compatible /v1/images/generations). No reference image support.
import { b64ToBytes, postJson } from "../http";
import { requireKey, resolveModel, ProviderError, type ImageProvider } from "../types";

export const xaiImage: ImageProvider = {
  id: "xai-image",
  kind: "image",
  label: "xAI Grok Image",
  envKeys: ["GROK_API_KEY", "XAI_API_KEY"],
  models: ["grok-2-image"],
  defaultModel: "grok-2-image",
  supportsReferenceImages: false,
  notes: "Ignores aspect ratio and reference images.",
  async generateImage(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    const n = Math.max(1, Math.min(10, input.count || 1));
    if (input.referenceImages.length) ctx.log("xai-image does not accept reference images; sending prompt only");
    ctx.log(`POST images/generations model=${model} n=${n}`);
    const json = await postJson<{ data?: { b64_json?: string }[] }>(
      this.id,
      ctx,
      "https://api.x.ai/v1/images/generations",
      { model, prompt: input.prompt, n, response_format: "b64_json" },
      { authorization: `Bearer ${key}` },
    );
    const out = (json.data ?? []).filter((d) => d.b64_json).map((d) => ({ data: b64ToBytes(d.b64_json!), mimeType: "image/jpeg", ext: "jpg", model }));
    if (!out.length) throw new ProviderError(this.id, "response contained no images");
    return out;
  },
};
