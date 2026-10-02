import { describe, expect, it } from "vitest";
import { checkConsistency, exportSpaceToMarkdown, importMarkdownProject, parseFrontmatter, type ProviderInfo } from "../src";
import { makeBundle } from "./fixtures";

const providers: ProviderInfo[] = [
  { id: "openai-image", kind: "image", label: "OpenAI GPT Image", configured: true, envKey: "OPENAI_API_KEY", models: [], defaultModel: "gpt-image-1" },
  { id: "openai-sora", kind: "video", label: "OpenAI Sora", configured: false, envKey: "OPENAI_API_KEY", models: [], defaultModel: "sora-2" },
];

describe("markdown export", () => {
  const files = exportSpaceToMarkdown(makeBundle(), { exportedAt: "2026-01-01T00:00:00.000Z", providers });

  it("creates the required file set", () => {
    expect(Object.keys(files).sort()).toEqual(
      ["ASSETS.md", "MASTER-SCRIPT.md", "PROJECT.md", "PROMPTS.md", "STORYBOARD.md", "WORKFLOW.md", "scenes/SCENE-01.md", "scenes/SCENE-02.md"].sort(),
    );
  });

  it("writes YAML frontmatter with stable ids", () => {
    const { data, body } = parseFrontmatter(files["scenes/SCENE-01.md"]);
    expect(data).toMatchObject({ type: "scene", version: "1.0", project_id: "project_001", space_id: "space_001", scene_id: "SCENE_001", scene_number: 1, duration: 8, resolved_character_id: "MODEL_001" });
    for (const h of ["Script", "Action", "Dialogue", "Camera", "Image Prompt", "Video Prompt", "Voice Prompt", "Continuity"]) expect(body).toContain(`## ${h}\n`);
    expect(files["scenes/SCENE-01.md"]).toMatch(/^---\ntype: scene\nversion: "1.0"/);
  });

  it("never writes API keys", () => {
    const all = Object.values(files).join("\n");
    expect(all).not.toContain("sk-should-never-leak");
    expect(all).not.toMatch(/api[_-]?key\s*:/i);
    expect(files["WORKFLOW.md"]).toContain("provider: openai-image");
  });

  it("is deterministic", () => {
    expect(exportSpaceToMarkdown(makeBundle(), { exportedAt: "2026-01-01T00:00:00.000Z", providers })).toEqual(files);
  });

  it("includes execution order and dependency graph", () => {
    expect(files["WORKFLOW.md"]).toMatch(/1\. scene_1 \(Scene\)\n2\. img_1 \(Image Generator\)\n3\. vid_1 \(Video Generator\)/);
    expect(files["WORKFLOW.md"]).toContain("scene_1 (Scene) → img_1 (Image Generator)");
    expect(files["WORKFLOW.md"]).toContain('"sceneCode": "SCENE_001"');
  });
});

describe("markdown import", () => {
  it("round-trips export → import", () => {
    const b = makeBundle();
    const files = exportSpaceToMarkdown(b);
    const r = importMarkdownProject(files);
    expect(r.project).toMatchObject({ id: "project_001", name: "Dầu xả ABC", description: "Desc" });
    expect(r.project.settings).toEqual({ globalPrompt: "Premium" });
    expect(r.space).toMatchObject({ id: "space_001", name: "TikTok Review 60s", aspectRatio: "9:16" });
    expect(r.references.map((x) => x.code).sort()).toEqual(["MODEL_001", "PRODUCT_001", "VOICE_001"]);
    expect(r.references.find((x) => x.code === "MODEL_001")).toMatchObject({ type: "character", settings: { faceLock: true, hairLock: true }, assetIds: ["asset_MODEL_001"] });
    expect(r.masterScript).toMatchObject({ title: b.masterScript!.title, scriptText: b.masterScript!.scriptText, duration: 40, characterId: "MODEL_001" });
    expect(r.scenes).toHaveLength(2);
    const s2 = r.scenes[1];
    const orig = b.scenes[1];
    for (const k of ["code", "sceneNumber", "title", "duration", "script", "action", "dialogue", "camera", "imagePrompt", "videoPrompt", "voicePrompt", "productId", "location", "expression"] as const)
      expect(s2[k], k).toEqual(orig[k]);
    expect(r.prompts[0]).toMatchObject({ id: "CHARACTER_CONSISTENCY_V1", version: 2, template: "Keep {{character}}" });
    expect(r.workflow?.nodes.find((n) => n.id === "scene_1")?.data).toEqual({ sceneCode: "SCENE_001" });
    expect(r.assets.map((a) => a.id)).toEqual(["asset_MODEL_001", "asset_PRODUCT_001"]);
    expect(r.warnings).toEqual([]);
  });

  it("picks up manual edits and handles nested folder paths", () => {
    const files = exportSpaceToMarkdown(makeBundle());
    const nested: Record<string, string> = {};
    for (const [p, c] of Object.entries(files)) nested[`my-export/${p}`] = c;
    nested["my-export/scenes/SCENE-01.md"] = nested["my-export/scenes/SCENE-01.md"]
      .replace("## Action\n\nAction 1", "## Action\n\nShe smiles and opens the bottle.\nSecond line.")
      .replace("duration: 8", "duration: 12");
    const r = importMarkdownProject(nested);
    expect(r.scenes[0].action).toBe("She smiles and opens the bottle.\nSecond line.");
    expect(r.scenes[0].duration).toBe(12);
  });

  it("treats the empty marker as empty", () => {
    const b = makeBundle();
    b.scenes[0].continuity = "";
    const r = importMarkdownProject(exportSpaceToMarkdown(b));
    expect(r.scenes[0].continuity).toBe("");
  });

  it("fails without PROJECT.md", () => {
    expect(() => importMarkdownProject({ "scenes/SCENE-01.md": "x" })).toThrow(/PROJECT.md/);
  });
});

describe("consistency checker", () => {
  it("flags broken dependencies and unconfigured providers", () => {
    const b = makeBundle();
    b.workflow.edges.push({ id: "bad", source: "vid_1", target: "missing_node" });
    b.workflow.nodes.push({ id: "vid_2", type: "videoGenerator", position: { x: 0, y: 0 }, data: { provider: "openai-sora" } });
    b.scenes[1].duration = 0;
    const r = checkConsistency(b, providers);
    const msgs = r.items.map((i) => `${i.level}:${i.code}`);
    expect(msgs).toContain("error:broken_edge");
    expect(msgs).toContain("error:provider_not_configured");
    expect(msgs).toContain("error:video_without_image");
    expect(msgs).toContain("error:no_duration");
    expect(msgs).toContain("ok:scene_ok");
    expect(r.ok).toBe(false);
  });
});
