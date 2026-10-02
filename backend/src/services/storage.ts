// File storage under the data directory. Stored paths are relative to dataDir with forward slashes.
import fs from "node:fs";
import path from "node:path";
import { randomId, type Asset } from "@amw/shared";
import type { Db } from "../db";
import { toAsset } from "../repo";

export function toRel(dataDir: string, abs: string): string {
  return path.relative(dataDir, abs).split(path.sep).join("/");
}

/** Resolves a stored relative path, refusing anything that escapes the data directory. */
export function resolveData(dataDir: string, rel: string): string {
  const abs = path.resolve(dataDir, rel);
  const root = path.resolve(dataDir) + path.sep;
  if (!abs.startsWith(root)) throw new Error(`Path escapes data directory: ${rel}`);
  return abs;
}

export function writeDataFile(dataDir: string, rel: string, data: Uint8Array | string): string {
  const abs = resolveData(dataDir, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
  return rel;
}

export function kindFromMime(mime: string): "image" | "video" | "audio" | "other" {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "other";
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
};

export function mimeFromName(name: string): string {
  return MIME_BY_EXT[path.extname(name).toLowerCase()] ?? "application/octet-stream";
}

export function safeExt(name: string): string {
  const e = path.extname(name).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(e) ? e : "";
}

/** Best-effort JSON/text mirror files (data/projects, data/workflows, data/scripts, data/prompts). */
export function mirror(dataDir: string, rel: string, content: string): void {
  try {
    writeDataFile(dataDir, rel, content);
  } catch {
    /* mirrors are convenience copies; the database is the source of truth */
  }
}

/** Stores an uploaded/downloaded file under data/assets/<projectId>/ and creates its Asset row. */
export async function recordAsset(
  db: Db,
  dataDir: string,
  a: { projectId: string; spaceId: string | null; filename: string; mimeType: string; kind: Asset["kind"]; bytes: Uint8Array },
): Promise<Asset> {
  const id = randomId("asset");
  const rel = writeDataFile(dataDir, `assets/${a.projectId}/${id}${safeExt(a.filename)}`, a.bytes);
  const row = await db.asset.create({ data: { id, projectId: a.projectId, spaceId: a.spaceId, kind: a.kind, filename: a.filename, path: rel, mimeType: a.mimeType, size: a.bytes.length } });
  return toAsset(row);
}
