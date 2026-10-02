// Small HTTP helpers shared by adapters. Errors never include request headers (API keys).
import { ProviderError, type ProviderContext } from "./types";

export async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text);
    const msg = j?.error?.message ?? j?.error ?? j?.message ?? j?.detail;
    if (msg) return typeof msg === "string" ? msg : JSON.stringify(msg);
  } catch {
    /* not JSON */
  }
  return text.slice(0, 500) || res.statusText;
}

export async function checked(providerId: string, res: Response): Promise<Response> {
  if (res.ok) return res;
  const retryable = res.status === 429 || res.status >= 500;
  throw new ProviderError(providerId, `HTTP ${res.status}: ${await readError(res)}`, res.status, retryable);
}

export async function postJson<T>(providerId: string, ctx: ProviderContext, url: string, body: unknown, headers: Record<string, string>): Promise<T> {
  const res = await ctx.fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: ctx.signal,
  });
  await checked(providerId, res);
  return (await res.json()) as T;
}

export async function getBytes(providerId: string, ctx: ProviderContext, url: string, headers: Record<string, string> = {}): Promise<Uint8Array> {
  const res = await ctx.fetch(url, { headers, signal: ctx.signal });
  await checked(providerId, res);
  return new Uint8Array(await res.arrayBuffer());
}

export function b64ToBytes(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

export function bytesToB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Cancelled"));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(new Error("Cancelled"));
    }, { once: true });
  });
}

export function extFromMime(mime: string): string {
  const m: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
  };
  return m[mime] ?? "bin";
}

export function blobFrom(file: { data: Uint8Array; mimeType: string }): Blob {
  return new Blob([file.data as unknown as ArrayBuffer], { type: file.mimeType });
}
