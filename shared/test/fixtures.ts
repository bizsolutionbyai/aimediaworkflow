import type { MasterScript, Reference, Scene, SpaceBundle } from "../src";
import { createEmptyWorkflow } from "../src";

const T = "2026-01-01T00:00:00.000Z";

export function makeScene(n: number, over: Partial<Scene> = {}): Scene {
  return {
    id: `scn_${n}`,
    code: `SCENE_00${n}`,
    spaceId: "space_001",
    masterScriptId: "ms_1",
    sceneNumber: n,
    title: `Title ${n}`,
    duration: 8,
    script: `Script ${n}`,
    action: `Action ${n}`,
    dialogue: `Line ${n}`,
    camera: "Medium shot",
    shotType: "medium",
    cameraMovement: "slow push in",
    location: "Bathroom",
    lighting: "soft",
    expression: "fresh, natural",
    characterId: "",
    productId: "",
    styleId: "",
    voiceId: "",
    imagePrompt: `Image prompt ${n}`,
    videoPrompt: `Video prompt ${n}`,
    voicePrompt: "warm",
    continuity: "",
    imageProvider: "openai-image",
    videoProvider: "openai-sora",
    voiceProvider: "openai-tts",
    imageStatus: "NONE",
    videoStatus: "NONE",
    voiceStatus: "NONE",
    version: 1,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

export function makeRef(code: string, type: Reference["type"], over: Partial<Reference> = {}): Reference {
  return {
    id: `ref_${code}`,
    code,
    spaceId: "space_001",
    type,
    name: `${type} ${code}`,
    description: `${type} description`,
    prompt: `${type} prompt`,
    settings: type === "character" ? { faceLock: true, hairLock: true } : type === "product" ? { logoLock: true } : {},
    assetIds: [`asset_${code}`],
    version: 1,
    createdAt: T,
    updatedAt: T,
    ...over,
  };
}

export function makeBundle(): SpaceBundle {
  const ms: MasterScript = {
    id: "ms_1",
    spaceId: "space_001",
    title: "Review dầu xả ABC",
    objective: "Video TikTok giới thiệu sản phẩm.",
    targetPlatform: "TikTok",
    aspectRatio: "9:16",
    duration: 40,
    characterId: "MODEL_001",
    productId: "PRODUCT_001",
    styleId: "",
    voiceId: "VOICE_001",
    globalInstruction: "Bright, clean look.",
    scriptText: "Scene 1:\nHook\nScene 2:\nIntro",
    version: 1,
    createdAt: T,
    updatedAt: T,
  };
  const refs = [makeRef("MODEL_001", "character"), makeRef("PRODUCT_001", "product"), makeRef("VOICE_001", "voice", { assetIds: [] })];
  const wf = createEmptyWorkflow("project_001", "space_001");
  wf.nodes = [
    { id: "scene_1", type: "scene", position: { x: 0, y: 0 }, data: { sceneId: "scn_1" } },
    { id: "img_1", type: "imageGenerator", position: { x: 0, y: 200 }, data: { provider: "openai-image", count: 2, aspectRatio: "9:16" } },
    { id: "vid_1", type: "videoGenerator", position: { x: 0, y: 400 }, data: { provider: "openai-sora", duration: 8 } },
  ];
  wf.edges = [
    { id: "e1", source: "scene_1", target: "img_1" },
    { id: "e2", source: "img_1", target: "vid_1" },
  ];
  return {
    project: { id: "project_001", name: "Dầu xả ABC", description: "Desc", settings: { globalPrompt: "Premium", apiKey: "sk-should-never-leak" }, createdAt: T, updatedAt: T },
    space: { id: "space_001", projectId: "project_001", name: "TikTok Review 60s", description: "Space desc", targetPlatform: "TikTok", aspectRatio: "9:16", createdAt: T, updatedAt: T },
    references: refs,
    assets: [
      { id: "asset_MODEL_001", projectId: "project_001", spaceId: "space_001", kind: "image", filename: "face.jpg", path: "assets/project_001/asset_MODEL_001.jpg", mimeType: "image/jpeg", size: 10, createdAt: T },
      { id: "asset_PRODUCT_001", projectId: "project_001", spaceId: "space_001", kind: "image", filename: "front.jpg", path: "assets/project_001/asset_PRODUCT_001.jpg", mimeType: "image/jpeg", size: 10, createdAt: T },
    ],
    masterScript: ms,
    scenes: [makeScene(1), makeScene(2, { productId: "PRODUCT_001", dialogue: "Multi\nline | pipe" })],
    prompts: [{ id: "CHARACTER_CONSISTENCY_V1", name: "Char", category: "Character Consistency", description: "d", template: "Keep {{character}}", variables: ["character"], version: 2, createdAt: T, updatedAt: T }],
    workflow: wf,
    outputs: [],
  };
}
