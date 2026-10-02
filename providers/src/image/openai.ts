// OpenAI GPT Image adapter. Uses /v1/images/generations, or /v1/images/edits when reference images
// or an input image are supplied (multipart with image[] files).
import { b64ToBytes, blobFrom, checked } from "../http";
import { requireKey, resolveModel, ProviderError, type ImageProvider } from "../types";

export function openAiImageSize(aspect: string): string {
  const [w, h] = aspect.split(":").map(Number);
  if (!w || !h || w === h) return "1024x1024";
  return w > h ? "1536x1024" : "1024x1536";
}

export const openaiImage: ImageProvider = {
  id: "openai-image",
  kind: "image",
  label: "OpenAI GPT Image",
  envKeys: ["OPENAI_API_KEY"],
  models: ["gpt-image-1", "gpt-image-1-mini"],
  defaultModel: "gpt-image-1",
  supportsReferenceImages: true,
  notes: "Sizes are mapped from aspect ratio to 1024x1536 / 1536x1024 / 1024x1024.",
  async generateImage(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    const size = openAiImageSize(input.aspectRatio);
    const n = Math.max(1, Math.min(10, input.count || 1));
    const prompt = input.negativePrompt ? `${input.prompt}\n\nAvoid: ${input.negativePrompt}` : input.prompt;
    const images = [...(input.inputImage ? [input.inputImage] : []), ...input.referenceImages].slice(0, 16);
    const base = ctx.env.OPENAI_BASE_URL?.replace(/\/$/, "") || "https://api.openai.com/v1";
    let res: Response;
    if (images.length) {
      const form = new FormData();
      form.set("model", model);
      form.set("prompt", prompt);
      form.set("n", String(n));
      form.set("size", size);
      for (const img of images) form.append("image[]", blobFrom(img), img.filename);
      ctx.log(`POST images/edits model=${model} n=${n} size=${size} images=${images.length}`);
      res = await ctx.fetch(`${base}/images/edits`, { method: "POST", headers: { authorization: `Bearer ${key}` }, body: form, signal: ctx.signal });
    } else {
      ctx.log(`POST images/generations model=${model} n=${n} size=${size}`);
      res = await ctx.fetch(`${base}/images/generations`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, prompt, n, size }),
        signal: ctx.signal,
      });
    }
    await checked(this.id, res);
    const json = (await res.json()) as { data?: { b64_json?: string }[] };
    const out = (json.data ?? []).filter((d) => d.b64_json).map((d) => ({ data: b64ToBytes(d.b64_json!), mimeType: "image/png", ext: "png", model }));
    if (!out.length) throw new ProviderError(this.id, "response contained no images");
    return out;
  },
};
