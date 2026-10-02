// End-to-end walk through the MVP acceptance criteria against a real SQLite database in a temp dir.
// Provider HTTP calls are answered by a stub `fetch` (test double for the vendor APIs).
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";

const BACKEND = path.resolve(__dirname, "..");
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const SECRET = "sk-test-SECRET-should-not-leak-123";

let tmp: string;
let mp4: Uint8Array | null = null;
const calls: string[] = [];

function hasFfmpeg() {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const stubFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  calls.push(`${method} ${url}`);
  const auth = new Headers(init?.headers).get("authorization");
  if (auth !== `Bearer ${SECRET}`) return new Response(JSON.stringify({ error: { message: "bad key" } }), { status: 401 });
  if (url.endsWith("/images/generations") || url.endsWith("/images/edits")) {
    let n = 1;
    if (init?.body instanceof FormData) n = Number(init.body.get("n"));
    else n = JSON.parse(String(init?.body)).n;
    return Response.json({ data: Array.from({ length: n }, () => ({ b64_json: PNG_1PX })) });
  }
  if (url.endsWith("/videos") && method === "POST") return Response.json({ id: "v1", status: "queued" });
  if (url.endsWith("/videos/v1")) return Response.json({ id: "v1", status: "completed" });
  if (url.endsWith("/videos/v1/content")) return new Response(mp4 ?? new Uint8Array([0, 0, 0, 0]), { headers: { "content-type": "video/mp4" } });
  return new Response("not found", { status: 404 });
};

async function makeApp() {
  return buildApp({
    config: { dataDir: path.join(tmp, "data"), exportDir: path.join(tmp, "exports"), env: { OPENAI_API_KEY: SECRET, VIDEO_POLL_INTERVAL_MS: "5", JOB_MAX_ATTEMPTS: "1" } },
    fetch: stubFetch,
  });
}

async function json<T = any>(app: FastifyInstance, method: string, url: string, body?: unknown): Promise<T> {
  const res = await app.inject({ method: method as never, url, payload: body as never });
  if (res.statusCode >= 400) throw new Error(`${method} ${url} → ${res.statusCode}: ${res.body}`);
  return res.json() as T;
}

async function upload(app: FastifyInstance, projectId: string, files: [string, Uint8Array, string][], fields: Record<string, string>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  for (const [name, data, type] of files) form.append("file", new Blob([data as unknown as ArrayBuffer], { type }), name);
  const req = new Request("http://local/upload", { method: "POST", body: form });
  const res = await app.inject({
    method: "POST",
    url: `/api/projects/${projectId}/assets`,
    payload: Buffer.from(await req.arrayBuffer()),
    headers: { "content-type": req.headers.get("content-type")! },
  });
  expect(res.statusCode).toBe(200);
  return res.json() as { id: string; path: string }[];
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "amw-"));
  execSync("npx prisma db push", { cwd: BACKEND, env: { ...process.env, DATA_DIR: path.join(tmp, "data") }, stdio: "ignore" });
  if (hasFfmpeg()) {
    const f = path.join(tmp, "clip.mp4");
    execFileSync("ffmpeg", ["-y", "-f", "lavfi", "-i", "color=c=red:s=64x112:d=1", "-pix_fmt", "yuv420p", f], { stdio: "ignore" });
    mp4 = new Uint8Array(fs.readFileSync(f));
  }
}, 120000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("MVP acceptance flow", () => {
  const state: Record<string, any> = {};

  it("1-7: project, space, references, master script, 5 scenes on the canvas", async () => {
    const { app } = await makeApp();
    const project = await json(app, "POST", "/api/projects", { name: "Dầu xả ABC", description: "Product Media AI" });
    const space = await json(app, "POST", `/api/projects/${project.id}/spaces`, { name: "TikTok Review 60s", targetPlatform: "TikTok", aspectRatio: "9:16" });
    const character = await json(app, "POST", `/api/spaces/${space.id}/references`, { type: "character", name: "Vietnamese Female Presenter", prompt: "Woman in her 20s, long black hair, white t-shirt." });
    const product = await json(app, "POST", `/api/spaces/${space.id}/references`, { type: "product", name: "ABC Conditioner", prompt: "Green bottle with white label." });
    expect(character.code).toBe("MODEL_001");
    expect(product.code).toBe("PRODUCT_001");
    expect(character.settings).toMatchObject({ faceLock: true, identityLock: true });

    const png = new Uint8Array(Buffer.from(PNG_1PX, "base64"));
    const faces = await upload(app, project.id, [["face.png", png, "image/png"], ["fullbody.png", png, "image/png"]], { spaceId: space.id, referenceId: character.id });
    await upload(app, project.id, [["front.png", png, "image/png"]], { spaceId: space.id, referenceId: product.id });
    expect(fs.existsSync(path.join(tmp, "data", faces[0].path))).toBe(true);
    const refs = await json(app, "GET", `/api/spaces/${space.id}/references`);
    expect(refs.find((r: any) => r.code === "MODEL_001").assetIds).toHaveLength(2);

    await json(app, "PUT", `/api/spaces/${space.id}/master-script`, {
      title: "Review dầu xả ABC",
      objective: "Video TikTok giới thiệu sản phẩm.",
      duration: 60,
      aspectRatio: "9:16",
      characterId: "MODEL_001",
      productId: "PRODUCT_001",
      scriptText: "Scene 1:\nHook\nScene 2:\nGiới thiệu sản phẩm\nScene 3:\nCách sử dụng\nScene 4:\nCảm nhận\nScene 5:\nCTA",
    });
    const sb = await json(app, "POST", `/api/spaces/${space.id}/storyboard`, { mode: "replace" });
    expect(sb.scenes).toHaveLength(5);
    expect(sb.scenes.map((s: any) => s.code)).toEqual(["SCENE_001", "SCENE_002", "SCENE_003", "SCENE_004", "SCENE_005"]);
    expect(sb.workflow.nodes.filter((n: any) => n.type === "scene")).toHaveLength(5);
    expect(sb.workflow.nodes.map((n: any) => n.id)).toEqual(expect.arrayContaining(["master_script", "storyboard", "img_01", "vid_01", "merge", "final_video", "ref_model_001"]));
    Object.assign(state, { projectId: project.id, spaceId: space.id, scene1: sb.scenes[0] });
    await app.close();
  });

  it("8-12: edit scene, prompts, connect Scene → Image → Video", async () => {
    const { app } = await makeApp();
    const { spaceId, scene1 } = state;
    const updated = await json(app, "PATCH", `/api/scenes/${scene1.id}`, { action: "Cô gái cầm sản phẩm và mỉm cười", dialogue: "Tóc khô xơ? Thử cái này!", location: "Bathroom", camera: "Medium shot", cameraMovement: "Slow push in" });
    expect(updated.version).toBe(scene1.version + 1);
    const drafts = await json(app, "POST", `/api/scenes/${scene1.id}/draft-prompts`, {});
    expect(drafts.imagePrompt).toContain("Bathroom");
    await json(app, "PATCH", `/api/scenes/${scene1.id}`, { imagePrompt: drafts.imagePrompt, videoPrompt: drafts.videoPrompt, voicePrompt: drafts.voicePrompt });
    const preview = await json(app, "GET", `/api/scenes/${scene1.id}/prompt-preview?target=image`);
    expect(preview.layers.map((l: any) => l.key)).toEqual(["global", "character", "product", "style", "scene", "camera", "continuity", "provider"]);
    expect(preview.final).toContain("MODEL_001");

    const wf = (await json(app, "GET", `/api/spaces/${spaceId}/workflow`)).workflow;
    expect(wf.edges.some((e: any) => e.source === "scene_01" && e.target === "img_01")).toBe(true);
    expect(wf.edges.some((e: any) => e.source === "img_01" && e.target === "vid_01")).toBe(true);
    // 13: save (move a node so we can verify persistence)
    wf.nodes.find((n: any) => n.id === "img_01").position = { x: 1234, y: 567 };
    await json(app, "PUT", `/api/spaces/${spaceId}/workflow`, { workflow: wf });
    await app.close(); // 14: close application
  });

  it("15-16: reopen application, workflow is restored", async () => {
    const { app } = await makeApp();
    const wf = (await json(app, "GET", `/api/spaces/${state.spaceId}/workflow`)).workflow;
    expect(wf.nodes.find((n: any) => n.id === "img_01").position).toEqual({ x: 1234, y: 567 });
    expect(wf.edges.length).toBeGreaterThan(10);
    const versions = await json(app, "GET", `/api/versions/workflow/${(await json(app, "GET", `/api/spaces/${state.spaceId}/workflow`)).id}`);
    expect(versions.length).toBeGreaterThanOrEqual(2);
    await app.close();
  });

  it("23: broken dependencies are detected before execution", async () => {
    const { app } = await makeApp();
    const { spaceId } = state;
    const wf = (await json(app, "GET", `/api/spaces/${spaceId}/workflow`)).workflow;
    const broken = { ...wf, edges: [...wf.edges, { id: "bad", source: "vid_01", target: "ghost_node" }] };
    await json(app, "PUT", `/api/spaces/${spaceId}/workflow`, { workflow: broken });
    const check = await json(app, "POST", `/api/spaces/${spaceId}/check`);
    expect(check.ok).toBe(false);
    expect(check.text).toMatch(/✕ Broken connection vid_01 → ghost_node/);
    const res = await app.inject({ method: "POST", url: `/api/spaces/${spaceId}/run`, payload: { targets: ["img_01"] } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("workflow_check_failed");
    await json(app, "PUT", `/api/spaces/${spaceId}/workflow`, { workflow: wf });
    await app.close();
  });

  it("runs Scene → Image → Video through provider adapters and tracks outputs", async () => {
    const { app, ctx } = await makeApp();
    const { spaceId } = state;
    // set count=2 on the image node to exercise batch outputs
    const wf = (await json(app, "GET", `/api/spaces/${spaceId}/workflow`)).workflow;
    wf.nodes.find((n: any) => n.id === "img_01").data.count = 2;
    await json(app, "PUT", `/api/spaces/${spaceId}/workflow`, { workflow: wf });

    const started = await app.inject({ method: "POST", url: `/api/spaces/${spaceId}/run`, payload: { targets: ["vid_01"] } });
    expect(started.statusCode).toBe(202);
    await ctx.engine.whenIdle();
    const { run, jobs } = await json(app, "GET", `/api/runs/${started.json().run.id}`);
    expect(run.status, JSON.stringify(jobs.map((j: any) => [j.nodeId, j.status, j.error]))).toBe("SUCCESS");
    expect(jobs.map((j: any) => j.nodeId)).toEqual(["ref_model_001", "ref_product_001", "master_script", "storyboard", "scene_01", "img_01", "vid_01"]);
    expect(calls.some((c) => c.endsWith("/images/edits"))).toBe(true); // reference images were sent
    const outputs = await json(app, "GET", `/api/spaces/${spaceId}/outputs`);
    const images = outputs.filter((o: any) => o.nodeId === "img_01");
    expect(images).toHaveLength(2);
    expect(images.filter((o: any) => o.selected)).toHaveLength(1);
    await json(app, "POST", `/api/outputs/${images.find((o: any) => !o.selected).id}/select`);
    expect(outputs.filter((o: any) => o.nodeId === "vid_01")).toHaveLength(1);
    const scene = await json(app, "GET", `/api/scenes/${state.scene1.id}`);
    expect(scene.imageStatus).toBe("SUCCESS");
    expect(scene.videoStatus).toBe("SUCCESS");
    // the video file is served
    const file = await app.inject({ method: "GET", url: `/files/${outputs.find((o: any) => o.nodeId === "vid_01").path}` });
    expect(file.statusCode).toBe(200);
    await app.close();
  });

  it("fails clearly when a provider is not configured", async () => {
    const { app, ctx } = await buildApp({ config: { dataDir: path.join(tmp, "data"), exportDir: path.join(tmp, "exports"), env: { OPENAI_API_KEY: "" } }, fetch: stubFetch });
    const res = await app.inject({ method: "POST", url: `/api/spaces/${state.spaceId}/run`, payload: { targets: ["img_02"] } });
    expect(res.statusCode).toBe(422);
    expect(JSON.stringify(res.json().blocking)).toMatch(/not configured/);
    expect(ctx.registry.list().every((p) => !p.configured || p.kind === "llm" || p.id.startsWith("google") || p.id.startsWith("xai") || p.id === "elevenlabs")).toBe(true);
    const assistant = await app.inject({ method: "POST", url: "/api/assistant/master-script", payload: { spaceId: state.spaceId, brief: "x" } });
    expect(assistant.statusCode).toBe(503);
    expect(assistant.json().error).toMatch(/Provider not configured/);
    await app.close();
  });

  it("17-22: export Markdown, edit a file, import, no API key exposed", async () => {
    const { app } = await makeApp();
    const { spaceId } = state;
    const exp = await json(app, "POST", `/api/spaces/${spaceId}/export`);
    const dir = exp.absoluteDir as string;
    for (const f of ["PROJECT.md", "MASTER-SCRIPT.md", "STORYBOARD.md", "WORKFLOW.md", "PROMPTS.md", "ASSETS.md", "scenes/SCENE-01.md", "scenes/SCENE-05.md"]) {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
    }
    const all = exp.files.map((f: string) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n");
    expect(all).not.toContain(SECRET);
    expect(all).not.toMatch(/api[_-]?key\s*:/i);
    expect(all).toContain("provider: openai-image");

    const scenePath = path.join(dir, "scenes", "SCENE-02.md");
    const md = fs.readFileSync(scenePath, "utf8");
    fs.writeFileSync(
      scenePath,
      md.replace(/## Dialogue\n\n[\s\S]*?\n## /, "## Dialogue\n\nDầu xả ABC giúp tóc mềm mượt ngay lần đầu.\n\n## ").replace(/duration: \d+/, "duration: 9"),
    );
    const wfPath = path.join(dir, "WORKFLOW.md");
    const wfMd = fs.readFileSync(wfPath, "utf8").replace('"id": "merge",\n      "type": "merge",\n      "position": {\n        "x": ', '"id": "merge",\n      "type": "merge",\n      "position": {\n        "x": 9');
    fs.writeFileSync(wfPath, wfMd);

    const summary = await json(app, "POST", "/api/import/folder", { folder: exp.folder });
    expect(summary.spaceId).toBe(spaceId);
    expect(summary.updated).toContain("scene SCENE_002");
    expect(summary.unchanged).toContain("scene SCENE_001");
    expect(summary.updated).toContain("workflow");
    const scenes = await json(app, "GET", `/api/spaces/${spaceId}/scenes`);
    const s2 = scenes.find((s: any) => s.code === "SCENE_002");
    expect(s2.dialogue).toBe("Dầu xả ABC giúp tóc mềm mượt ngay lần đầu.");
    expect(s2.duration).toBe(9);
    // scene nodes are re-bound to the same scene ids after import
    const wf = (await json(app, "GET", `/api/spaces/${spaceId}/workflow`)).workflow;
    expect(wf.nodes.find((n: any) => n.id === "scene_02").data.sceneId).toBe(s2.id);
    const versions = await json(app, "GET", `/api/versions/scene/${s2.id}`);
    expect(versions[0].note).toBe("Imported from Markdown");
    const cmp = await json(app, "GET", `/api/version/${versions[1].id}/compare?with=${versions[0].id}`);
    expect(cmp.changes.map((c: any) => c.field)).toEqual(expect.arrayContaining(["dialogue", "duration"]));

    // Import into a fresh database (browser upload path) reconstructs everything.
    const files: Record<string, string> = {};
    for (const f of exp.files) files[`picked/${f}`] = fs.readFileSync(path.join(dir, f), "utf8");
    await app.close();
    const fresh = path.join(tmp, "fresh");
    execSync("npx prisma db push", { cwd: BACKEND, env: { ...process.env, DATA_DIR: fresh }, stdio: "ignore" });
    const { app: app2 } = await buildApp({ config: { dataDir: fresh, exportDir: path.join(tmp, "exports2"), env: {} } });
    const r = await json(app2, "POST", "/api/import", { files });
    expect(r.created).toEqual(expect.arrayContaining(["project " + state.projectId, "space " + spaceId, "reference MODEL_001", "scene SCENE_005", "workflow"]));
    expect(r.warnings.join("\n")).toMatch(/not found in data directory/); // asset files live in the other data dir
    const bundle = await json(app2, "GET", `/api/spaces/${spaceId}/bundle`);
    expect(bundle.scenes).toHaveLength(5);
    expect(bundle.masterScript.title).toBe("Review dầu xả ABC");
    expect(bundle.workflow.nodes.filter((n: any) => n.type === "scene" && n.data.sceneId).length).toBe(5);
    await app2.close();
  });

  it.runIf(hasFfmpeg())("final video concatenates clips with ffmpeg", async () => {
    const { app, ctx } = await makeApp();
    const { spaceId } = state;
    const wf = (await json(app, "GET", `/api/spaces/${spaceId}/workflow`)).workflow;
    // Keep just scene 1's chain feeding merge → final video.
    wf.edges = wf.edges.filter((e: any) => e.target !== "merge" || e.source === "vid_01");
    await json(app, "PUT", `/api/spaces/${spaceId}/workflow`, { workflow: wf });
    const started = await json(app, "POST", `/api/spaces/${spaceId}/run`, { targets: ["final_video"] });
    await ctx.engine.whenIdle();
    const { run, jobs } = await json(app, "GET", `/api/runs/${started.run.id}`);
    expect(run.status, JSON.stringify(jobs.map((j: any) => [j.nodeId, j.status, j.error]))).toBe("SUCCESS");
    expect(jobs.find((j: any) => j.nodeId === "vid_01").logs.join()).toMatch(/Reused/);
    const final = (await json(app, "GET", `/api/spaces/${spaceId}/outputs`)).find((o: any) => o.nodeId === "final_video");
    expect(fs.statSync(path.join(tmp, "data", final.path)).size).toBeGreaterThan(100);
    await app.close();
  });
});
