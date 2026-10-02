# Provider SDK

Providers live in `providers/src/` and implement one interface from `providers/src/types.ts`.
The workflow engine and the UI only use these interfaces and the registry — no vendor logic exists outside `providers/`.

## Interfaces

```ts
interface ProviderBase {
  id: string;                    // stable id used in workflows and Markdown, e.g. "openai-image"
  kind: "image" | "video" | "voice" | "llm";
  label: string;
  envKeys: string[];             // configured when the first non-empty one is set, e.g. ["GOOGLE_API_KEY", "GEMINI_API_KEY"]
  models: string[];              // suggestions shown in the UI (free text is allowed)
  defaultModel: string;          // overridable with <ID>_MODEL in .env (dashes → underscores)
  supportsReferenceImages?: boolean;
  notes?: string;
}

interface ImageProvider extends ProviderBase { kind: "image"; generateImage(input: ImageInput, ctx: ProviderContext): Promise<MediaResult[]> }
interface VideoProvider extends ProviderBase { kind: "video"; generateVideo(input: VideoInput, ctx: ProviderContext): Promise<MediaResult[]> }
interface VoiceProvider extends ProviderBase { kind: "voice"; generateVoice(input: VoiceInput, ctx: ProviderContext): Promise<MediaResult[]> }
interface LlmProvider   extends ProviderBase { kind: "llm";   complete(input: LlmInput, ctx: ProviderContext): Promise<string> }
```

Inputs (built by the engine from the prompt layers):

```ts
ImageInput { prompt, negativePrompt?, aspectRatio, count, model?, referenceImages: MediaFile[], inputImage?: MediaFile }
VideoInput { prompt, aspectRatio, duration, model?, inputImage?: MediaFile }
VoiceInput { text, instructions, voice?, model? }
LlmInput   { system, prompt, maxTokens?, model? }
MediaFile  { data: Uint8Array, mimeType, filename }
MediaResult { data: Uint8Array, mimeType, ext, model }    // the engine writes the file and the Output row
ProviderContext { env, fetch, signal?: AbortSignal, log(message) }
```

## Rules

1. **Read keys only through `requireKey(this, ctx.env)`.** It throws `ProviderNotConfiguredError`, which the UI shows as
   "Provider not configured" and the engine never retries.
2. **Use `ctx.fetch` and pass `ctx.signal`** so runs can be cancelled and tests can stub HTTP.
3. **Throw `ProviderError(id, message, status, retryable)`** for vendor errors. `checked()` / `postJson()` in `http.ts` do this and mark
   HTTP 429/5xx as retryable. Never put headers or keys in error messages.
4. **Return bytes, not URLs.** Download results (polling long-running jobs with `sleep(ms, ctx.signal)`), then return `MediaResult[]`.
5. **Do not fake results.** If the vendor returns nothing, throw.
6. Log progress with `ctx.log(...)`; it appears in the job log in the UI.
7. Map structured inputs to vendor parameters (aspect ratio → size, duration → allowed values) inside the adapter.

## Adding a provider

1. Create `providers/src/<kind>/<name>.ts`:

```ts
import { b64ToBytes, postJson } from "../http";
import { requireKey, resolveModel, ProviderError, type ImageProvider } from "../types";

export const acmeImage: ImageProvider = {
  id: "acme-image",
  kind: "image",
  label: "Acme Image",
  envKeys: ["ACME_API_KEY"],
  models: ["acme-v2"],
  defaultModel: "acme-v2",
  supportsReferenceImages: false,
  async generateImage(input, ctx) {
    const key = requireKey(this, ctx.env);
    const model = resolveModel(this, input.model, ctx.env);
    ctx.log(`POST acme model=${model} n=${input.count}`);
    const json = await postJson<{ images: string[] }>(this.id, ctx, "https://api.acme.example/v1/images",
      { model, prompt: input.prompt, n: input.count, aspect_ratio: input.aspectRatio },
      { authorization: `Bearer ${key}` });
    if (!json.images?.length) throw new ProviderError(this.id, "no images returned");
    return json.images.map((b64) => ({ data: b64ToBytes(b64), mimeType: "image/png", ext: "png", model }));
  },
};
```

2. Register it in `providers/src/registry.ts` (`BUILTIN_PROVIDERS`) and export it from `providers/src/index.ts`.
3. Add `ACME_API_KEY=` to `.env.example`.
4. Add a test in `providers/test/` with a stubbed `fetch` that checks the request body/headers and the parsed result.

The UI discovers the new provider from `GET /api/providers` automatically (provider dropdowns, Settings, consistency checker).

## Built-in adapters

| id | kind | API used |
|---|---|---|
| `openai-image` | image | `POST /v1/images/generations`; `POST /v1/images/edits` (multipart `image[]`) when reference/input images exist |
| `google-image` | image | Gemini `models/{model}:generateContent` with `responseModalities: ["IMAGE"]`, reference images as `inline_data` |
| `xai-image` | image | `POST https://api.x.ai/v1/images/generations` (`response_format: b64_json`) |
| `openai-sora` | video | `POST /v1/videos` (multipart, `input_reference`), poll `GET /v1/videos/{id}`, download `/content` |
| `google-veo` | video | `models/{model}:predictLongRunning`, poll the operation, download the sample URI |
| `openai-tts` | voice | `POST /v1/audio/speech` (mp3, `instructions` for gpt-4o-mini-tts) |
| `elevenlabs` | voice | `POST /v1/text-to-speech/{voice_id}` |
| `anthropic` | llm | `POST /v1/messages` |
| `openai-llm` | llm | `POST /v1/chat/completions` |

`OPENAI_BASE_URL` can point OpenAI adapters at a compatible endpoint.
