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

export interface ProbeResult {
  duration: number;
  hasAudio: boolean;
}

/** Reads duration and audio presence from `ffmpeg -i` output (no ffprobe needed). */
export async function probe(env: Record<string, string | undefined>, file: string): Promise<ProbeResult> {
  const r = await run(ffmpegPath(env), ["-hide_banner", "-i", file]);
  const m = r.stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  return { duration, hasAudio: /Stream #[^\n]*Audio:/.test(r.stderr) };
}

/**
 * Normalizes one clip for concatenation: H.264 + AAC stereo 44.1 kHz.
 * - voice given, mode "replace" (or clip has no audio): voice becomes the soundtrack (padded with silence to the clip length)
 * - voice given, mode "mix" and the clip has audio: both are mixed
 * - no voice: keeps the clip audio, or adds silence so every clip has an audio stream
 */
export async function muxClip(
  env: Record<string, string | undefined>,
  video: string,
  voice: string | null,
  output: string,
  mode: "mix" | "replace",
  signal?: AbortSignal,
): Promise<void> {
  const { hasAudio } = await probe(env, video);
  const args = ["-y", "-i", video];
  if (voice) args.push("-i", voice);
  else if (!hasAudio) args.push("-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo");
  let filter: string;
  if (voice && hasAudio && mode === "mix") filter = "[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0,aresample=44100[a]";
  else if (voice || !hasAudio) filter = "[1:a]apad,aresample=44100[a]";
  else filter = "[0:a]aresample=44100[a]";
  args.push("-filter_complex", filter, "-map", "0:v:0", "-map", "[a]", "-shortest", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-c:a", "aac", "-ac", "2", output);
  const r = await run(ffmpegPath(env), args, signal);
  if (r.code !== 0) throw new Error(`ffmpeg mux failed: ${r.stderr.split("\n").slice(-4).join(" ")}`);
}

/** Burns an .srt file into the video (requires an ffmpeg build with libass). */
export async function burnSubtitles(env: Record<string, string | undefined>, input: string, srt: string, output: string, signal?: AbortSignal): Promise<void> {
  // The subtitles filter needs ':' and '\' escaped in the path (Windows drive letters).
  const escaped = srt.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const r = await run(ffmpegPath(env), ["-y", "-i", input, "-vf", `subtitles='${escaped}'`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "copy", output], signal);
  if (r.code !== 0) throw new Error(`subtitle burn-in failed: ${r.stderr.split("\n").slice(-3).join(" ")}`);
}

function srtTime(t: number): string {
  const ms = Math.round(t * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/** Builds SRT cues: one cue per clip with text, timed by the clip durations. */
export function buildSrt(clips: { duration: number; text: string }[]): string {
  let t = 0;
  let n = 0;
  const cues: string[] = [];
  for (const c of clips) {
    const text = c.text.trim();
    if (text && c.duration > 0) cues.push(`${++n}\n${srtTime(t)} --> ${srtTime(t + c.duration)}\n${text}\n`);
    t += c.duration;
  }
  return cues.join("\n");
}
