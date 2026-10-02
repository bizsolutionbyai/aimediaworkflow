// Integration API (v1), webhooks, Loop/Condition, parallel runs, lip sync, Final Video with voice + subtitles,
// and self-contained export/import. Vendor HTTP is stubbed; ffmpeg is real when installed.
import { execFileSync, execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

const BACKEND = path.resolve(__dirname, "..");
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TOKEN = "integration-test-token";
let tmp: string;
let mp4: Uint8Array = new Uint8Array([0, 0, 0, 0]);
let mp3: Uint8Array = new Uint8Array([0, 0, 0, 0]);
const hooks: { url: string; headers: Headers; body: string }[] = [];

const hasFfmpeg = (() => {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

const stubFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (url.startsWith("http://hook.test/")) {
    hooks.push({ url, headers: new Headers(init?.headers), body: String(init?.body) });
    return new Response("ok");
  }
  if (url === "https://cdn.test/product.png") return new Response(Buffer.from(PNG_1PX, "base64"), { headers: { "content-type": "image/png" } });
  if (url.endsWith("/images/generations") || url.endsWith("/images/edits")) {
    const n = init?.body instanceof FormData ? Number(init.body.get("n")) : JSON.parse(String(init?.body)).n;
    return Response.json({ data: Array.from({ length: n }, () => ({ b64_json: PNG_1PX })) });
  }
  if (url.endsWith("/videos") && method === "POST") return Response.json({ id: "v1", status: "queued" });
  if (url.endsWith("/videos/v1")) return Response.json({ id: "v1", status: "completed" });
  if (url.endsWith("/videos/v1/content")) return new Response(mp4 as unknown as BodyInit);
  if (url.endsWith("/audio/speech")) return new Response(mp3 as unknown as BodyInit);
  if (url === "https://api.replicate.com/v1/files") return Response.json({ urls: { get: `https://api.replicate.com/v1/files/f${Math.random()}` } });
  if (url === "https://api.replicate.com/v1/models/sync/lipsync-2/predictions") {
    const body = JSON.parse(String(init?.body));
    if (!body.input.video || !body.input.audio) return Response.json({ detail: "missing inputs" }, { status: 422 });
    return Response.json({ id: "p1", status: "starting", urls: { get: "https://api.replicate.com/v1/predictions/p1" } });
  }
  if (url === "https://api.replicate.com/v1/predictions/p1") return Response.json({ id: "p1", status: "succeeded", output: "https://cdn.test/lipsync.mp4" });
  if (url === "https://cdn.test/lipsync.mp4") return new Response(mp4 as unknown as BodyInit);
  return new Response(`unexpected ${method} ${url}`, { status: 404 });
};

const env = {
  OPENAI_API_KEY: "sk-test",
  REPLICATE_API_TOKEN: "r8-test",
  INTEGRATION_TOKEN: TOKEN,
  WEBHOOK_SECRET: "whsec",
  VIDEO_POLL_INTERVAL_MS: "5",
  JOB_MAX_ATTEMPTS: "1",
  MAX_PARALLEL_JOBS: "3",
};

async function makeApp(dataDir = path.join(tmp, "data"), extraEnv: Record<string, string> = {}) {
  return buildApp({ config: { dataDir, exportDir: path.join(tmp, "exports"), env: { ...env, ...extraEnv } }, fetch: stubFetch });
}

async function api<T = any>(app: FastifyInstance, method: string, url: string, body?: unknown, token: string | null = TOKEN): Promise<T> {
  const res = await app.inject({ method: method as never, url, payload: body as never, headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (res.statusCode >= 400) throw Object.assign(new Error(`${method} ${url} → ${res.statusCode}: ${res.body}`), { status: res.statusCode });
  return res.json() as T;
}

async function runAndWait(app: FastifyInstance, engine: { whenIdle(): Promise<void> }, spaceId: string, body: unknown) {
  const started = await api(app, "POST", `/api/v1/spaces/${spaceId}/runs`, body);
  await engine.whenIdle();
  return api(app, "GET", `/api/v1/runs/${started.run.id}`);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amw-f-"));
  execSync("npx prisma db push", { cwd: BACKEND, env: { ...process.env, DATA_DIR: path.join(tmp, "data") }, stdio: "ignore" });
  if (hasFfmpeg) {
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=blue:s=64x112:d=2", "-pix_fmt", "yuv420p", path.join(tmp, "clip.mp4")], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=1", path.join(tmp, "voice.mp3")], { stdio: "ignore" });
    mp4 = new Uint8Array(fs.readFileSync(path.join(tmp, "clip.mp4")));
    mp3 = new Uint8Array(fs.readFileSync(path.join(tmp, "voice.mp3")));
  }
}, 120000);

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("integration API v1", () => {
  const state: Record<string, any> = {};

  it("is disabled without a token and rejects bad tokens", async () => {
    const { app: off } = await makeApp(undefined, { INTEGRATION_TOKEN: "" });
    expect((await off.inject({ method: "GET", url: "/api/v1/health" })).statusCode).toBe(503);
    await off.close();
    const { app } = await makeApp();
    expect((await app.inject({ method: "GET", url: "/api/v1/health", headers: { authorization: "Bearer nope" } })).statusCode).toBe(401);
    expect((await api(app, "GET", "/api/v1/health")).ok).toBe(true);
    await app.close();
  });

  it("creates a full production space from a product record in one call", async () => {
    const { app } = await makeApp();
    const r = await api(app, "POST", "/api/v1/spaces", {
      project: { name: "Dầu xả ABC" },
      space: { name: "TikTok 30s", targetPlatform: "TikTok", aspectRatio: "9:16" },
      references: [
        { type: "character", name: "Presenter", prompt: "Young woman, long black hair", images: [{ base64: PNG_1PX, filename: "face.png" }] },
        { type: "product", name: "ABC Conditioner", images: [{ url: "https://cdn.test/product.png" }] },
        { type: "voice", name: "Warm female", settings: { voiceName: "nova" } },
      ],
      masterScript: {
        title: "Review",
        duration: 20,
        scriptText: "Scene 1: Hook\nDialogue: Tóc khô xơ?\nScene 2: CTA\nDialogue: Mua ngay hôm nay!",
      },
      storyboard: { generate: true, includeVoice: true },
    });
    expect(r.references.map((x: any) => x.code)).toEqual(["MODEL_001", "PRODUCT_001", "VOICE_001"]);
    expect(r.references[1].assetIds).toHaveLength(1);
    expect(r.masterScript).toMatchObject({ characterId: "MODEL_001", productId: "PRODUCT_001", voiceId: "VOICE_001" });
    expect(r.scenes.map((s: any) => s.dialogue)).toEqual(["Tóc khô xơ?", "Mua ngay hôm nay!"]);
    expect(r.check.errors).toBe(0);
    const space = await api(app, "GET", `/api/v1/spaces/${r.spaceId}`);
    expect(space.workflow.nodes.map((n: any) => n.id)).toEqual(expect.arrayContaining(["voice_01", "voice_02", "final_video"]));
    Object.assign(state, { spaceId: r.spaceId, projectId: r.projectId, scenes: r.scenes });
    await app.close();
  });

  it("runs in parallel and sends a signed run.finished webhook", async () => {
    const { app, ctx } = await makeApp();
    const detail = await runAndWait(app, ctx.engine, state.spaceId, { targets: ["vid_01", "vid_02", "voice_01", "voice_02"], webhookUrl: "http://hook.test/run" });
    expect(detail.run.status, JSON.stringify(detail.jobs.map((j: any) => [j.nodeId, j.status, j.error]))).toBe("SUCCESS");
    const hook = hooks.find((h) => h.url === "http://hook.test/run")!;
    expect(hook).toBeTruthy();
    expect(hook.headers.get("x-amw-signature")).toBe(`sha256=${createHmac("sha256", "whsec").update(hook.body).digest("hex")}`);
    const payload = JSON.parse(hook.body);
    expect(payload.event).toBe("run.finished");
    expect(payload.outputs.some((o: any) => o.kind === "audio")).toBe(true);
    await app.close();
  });

  it.runIf(hasFfmpeg)("Final Video adds scene voice-over and writes subtitles", async () => {
    const { app, ctx } = await makeApp();
    const detail = await runAndWait(app, ctx.engine, state.spaceId, { targets: ["final_video"] });
    expect(detail.run.status, JSON.stringify(detail.jobs.map((j: any) => [j.nodeId, j.status, j.error]))).toBe("SUCCESS");
    const space = await api(app, "GET", `/api/v1/spaces/${state.spaceId}`);
    const final = space.outputs.find((o: any) => o.nodeId === "final_video");
    const file = path.join(tmp, "data", final.path);
    const info = (() => {
      try {
        execFileSync("ffmpeg", ["-hide_banner", "-i", file], { stdio: "pipe" });
        return "";
      } catch (e) {
        return String((e as { stderr: Buffer }).stderr);
      }
    })();
    expect(info).toMatch(/Audio: aac/);
    expect(info).toMatch(/Duration: 00:00:0[34]/);
    const srt = fs.readFileSync(file.replace(/\.mp4$/, ".srt"), "utf8");
    expect(srt).toContain("00:00:00,000 --> 00:00:02,0");
    expect(srt).toContain("Tóc khô xơ?");
    expect(srt).toContain("Mua ngay hôm nay!");
    const dl = await app.inject({ method: "GET", url: final.url, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(dl.statusCode).toBe(200);
    await app.close();
  });

  it("Loop repeats generator calls and Condition skips downstream nodes", async () => {
    const { app, ctx } = await makeApp();
    const { workflow } = await api(app, "GET", `/api/spaces/${state.spaceId}/workflow`, undefined, null);
    workflow.nodes.push(
      { id: "loop_1", type: "loop", position: { x: 0, y: 0 }, data: { iterations: 3 } },
      { id: "img_loop", type: "imageGenerator", position: { x: 0, y: 0 }, data: { provider: "openai-image", count: 1, aspectRatio: "9:16" } },
      { id: "cond_1", type: "condition", position: { x: 0, y: 0 }, data: { check: "sceneDurationAtLeast", value: "999" } },
      { id: "img_cond", type: "imageGenerator", position: { x: 0, y: 0 }, data: { provider: "openai-image", count: 1 } },
    );
    workflow.edges.push(
      { id: "l1", source: "scene_01", target: "loop_1" },
      { id: "l2", source: "loop_1", target: "img_loop" },
      { id: "c1", source: "scene_01", target: "cond_1" },
      { id: "c2", source: "cond_1", target: "img_cond" },
    );
    await api(app, "PUT", `/api/v1/spaces/${state.spaceId}/workflow`, { workflow });
    const detail = await runAndWait(app, ctx.engine, state.spaceId, { targets: ["img_loop", "img_cond"] });
    const job = (id: string) => detail.jobs.find((j: any) => j.nodeId === id);
    expect(job("img_loop").status).toBe("SUCCESS");
    expect(job("img_loop").outputIds).toHaveLength(3);
    expect(job("img_cond").status).toBe("CANCELLED");
    expect(job("img_cond").error).toMatch(/condition cond_1 is false/);
    await app.close();
  });

  it("Lip Sync runs through the Replicate adapter", async () => {
    const { app, ctx } = await makeApp();
    const { workflow } = await api(app, "GET", `/api/spaces/${state.spaceId}/workflow`, undefined, null);
    workflow.nodes.push({ id: "lips_01", type: "lipSync", position: { x: 0, y: 0 }, data: { provider: "replicate-lipsync" } });
    workflow.edges.push({ id: "ls1", source: "vid_01", target: "lips_01" }, { id: "ls2", source: "voice_01", target: "lips_01" });
    await api(app, "PUT", `/api/v1/spaces/${state.spaceId}/workflow`, { workflow });
    const detail = await runAndWait(app, ctx.engine, state.spaceId, { targets: ["lips_01"] });
    const job = detail.jobs.find((j: any) => j.nodeId === "lips_01");
    expect(job.status, job.error).toBe("SUCCESS");
    expect(job.outputIds).toHaveLength(1);
    await app.close();
  });

  it("exports a self-contained folder with media and imports it into a fresh install", async () => {
    const { app } = await makeApp();
    const exp = await api(app, "POST", `/api/v1/spaces/${state.spaceId}/export`, { includeMedia: true });
    expect(exp.mediaCount).toBeGreaterThan(2);
    expect(Object.keys(exp.files)).toEqual(expect.arrayContaining(["PROJECT.md", "scenes/SCENE-02.md"]));
    await app.close();

    const fresh = path.join(tmp, "fresh");
    execSync("npx prisma db push", { cwd: BACKEND, env: { ...process.env, DATA_DIR: fresh }, stdio: "ignore" });
    const { app: app2 } = await makeApp(fresh);
    const summary = await api(app2, "POST", "/api/import/folder", { folder: exp.folder }, null);
    expect(summary.warnings.filter((w: string) => /not found/.test(w))).toEqual([]);
    const bundle = await api(app2, "GET", `/api/spaces/${state.spaceId}/bundle`, undefined, null);
    expect(bundle.assets).toHaveLength(2);
    for (const a of bundle.assets) expect(fs.existsSync(path.join(fresh, a.path))).toBe(true);
    await app2.close();
  });
});
