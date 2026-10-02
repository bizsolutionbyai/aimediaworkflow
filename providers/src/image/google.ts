// Google Gemini image adapter (generateContent with IMAGE response modality). Reference images are
// sent as inline data parts. One request per requested image.
import { b64ToBytes, bytesToB64, extFromMime, postJson } from "../http";
import { requireKey, resolveModel, ProviderError, type ImageProvider } from "../types";

interface GeminiResponse {
  candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string }; text?: string }[] } }[];
}

export const googleImage: ImageProvider = {
  id: "google-image",
  kind: "image",
  label: "Google Gemini Image",
  envKeys: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  models: ["gemini-2.5-flash-image"],
  defaultModel: "gemini-2.5-flash-image",
  supportsReferenceImages: true,
  async generateImage(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    const images = [...(input.inputImage ? [input.inputImage] : []), ...input.referenceImages];
    const parts: unknown[] = [{ text: input.negativePrompt ? `${input.prompt}\n\nAvoid: ${input.negativePrompt}` : input.prompt }];
    for (const img of images) parts.push({ inline_data: { mime_type: img.mimeType, data: bytesToB64(img.data) } });
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const n = Math.max(1, Math.min(8, input.count || 1));
    const out = [];
    for (let i = 0; i < n; i++) {
      ctx.log(`POST ${model}:generateContent (${i + 1}/${n}) refs=${images.length}`);
      const json = await postJson<GeminiResponse>(
        this.id,
        ctx,
        url,
        {
          contents: [{ role: "user", parts }],
          generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: input.aspectRatio || "1:1" } },
        },
        { "x-goog-api-key": key },
      );
      const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
      if (!part?.inlineData) throw new ProviderError(this.id, "response contained no image");
      out.push({ data: b64ToBytes(part.inlineData.data), mimeType: part.inlineData.mimeType, ext: extFromMime(part.inlineData.mimeType), model });
    }
    return out;
  },
};
