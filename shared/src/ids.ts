// ID helpers. Internal ids are random; reference/scene codes are stable and human-readable.
import type { ReferenceType } from "./types";

export function randomId(prefix: string): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export const REFERENCE_CODE_PREFIX: Record<ReferenceType, string> = {
  character: "MODEL",
  product: "PRODUCT",
  environment: "ENV",
  style: "STYLE",
  voice: "VOICE",
  image: "IMG",
  video: "VID",
  audio: "AUD",
};

/** Next free code like MODEL_003 given existing codes. */
export function nextCode(prefix: string, existing: string[]): string {
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  const max = existing.reduce((m, c) => {
    const hit = c.match(re);
    return hit ? Math.max(m, Number(hit[1])) : m;
  }, 0);
  return `${prefix}_${String(max + 1).padStart(3, "0")}`;
}

export function sceneCode(n: number): string {
  return `SCENE_${String(n).padStart(3, "0")}`;
}

export function slugify(input: string): string {
  const s = input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "untitled";
}
