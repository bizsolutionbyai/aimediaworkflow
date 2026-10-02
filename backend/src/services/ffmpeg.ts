// Optional ffmpeg integration for the Final Video node. Nothing is faked: without ffmpeg the node fails
// with a clear message.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function ffmpegPath(env: Record<string, string | undefined>): string {
  return env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function run(bin: string, args: string[], signal?: AbortSignal): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true, signal });
    let stderr = "";
    p.stderr.on("data", (d) => (stderr = (stderr + d.toString()).slice(-4000)));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

let cached: { bin: string; ok: boolean; at: number } | null = null;

export async function ffmpegAvailable(env: Record<string, string | undefined>): Promise<boolean> {
  const bin = ffmpegPath(env);
  if (cached && cached.bin === bin && Date.now() - cached.at < 60_000) return cached.ok;
  let ok = false;
  try {
    ok = (await run(bin, ["-version"])).code === 0;
  } catch {
    ok = false;
  }
  cached = { bin, ok, at: Date.now() };
  return ok;
}

/** Concatenates videos in order. Tries stream copy first, then re-encodes. */
export async function concatVideos(env: Record<string, string | undefined>, inputs: string[], output: string, signal?: AbortSignal, log?: (m: string) => void): Promise<void> {
  const bin = ffmpegPath(env);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const list = `${output}.txt`;
  fs.writeFileSync(list, inputs.map((f) => `file '${f.replace(/\\/g, "/").replace(/'/g, "'\\''")}'`).join("\n"));
  try {
    log?.(`ffmpeg concat (copy) ${inputs.length} clips`);
    let r = await run(bin, ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", output], signal);
    if (r.code !== 0) {
      log?.("stream copy failed; re-encoding");
      r = await run(bin, ["-y", "-f", "concat", "-safe", "0", "-i", list, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", output], signal);
    }
    if (r.code !== 0) throw new Error(`ffmpeg failed: ${r.stderr.split("\n").slice(-4).join(" ")}`);
  } finally {
    fs.rmSync(list, { force: true });
  }
}
