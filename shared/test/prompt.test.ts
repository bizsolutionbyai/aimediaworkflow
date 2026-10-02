import { describe, expect, it } from "vitest";
import { buildPromptLayers, draftScenePrompt, extractVariables, renderTemplate, splitScriptIntoScenes } from "../src";
import { makeBundle } from "./fixtures";

describe("prompt engine", () => {
  it("renders variables and keeps unknown ones visible", () => {
    expect(renderTemplate("Hi {{ character }} at {{location}} {{unknown}}", { character: "MODEL_001", location: "Bath" })).toBe("Hi MODEL_001 at Bath {{unknown}}");
    expect(extractVariables("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });

  it("builds layered image prompts with inherited references and locks", () => {
    const b = makeBundle();
    const c = buildPromptLayers({ ...b, scene: b.scenes[0] }, "image");
    const keys = c.layers.map((l) => l.key);
    expect(keys).toEqual(["global", "character", "product", "style", "scene", "camera", "continuity", "provider"]);
    expect(c.refs.character).toBe("MODEL_001");
    expect(c.layers.find((l) => l.key === "character")!.text).toMatch(/MODEL_001.*Keep face, hairstyle identical/);
    expect(c.final).toContain("Image prompt 1");
    expect(c.final).toContain("Aspect ratio 9:16");
    expect(c.referenceAssetIds).toEqual(["asset_MODEL_001", "asset_PRODUCT_001"]);
  });

  it("warns about missing references", () => {
    const b = makeBundle();
    const c = buildPromptLayers({ ...b, scene: { ...b.scenes[0], productId: "PRODUCT_999" } }, "image");
    expect(c.warnings.join()).toMatch(/PRODUCT_999/);
  });

  it("voice prompt speaks the dialogue", () => {
    const b = makeBundle();
    const c = buildPromptLayers({ ...b, scene: b.scenes[0] }, "voice");
    expect(c.speechText).toBe("Line 1");
  });

  it("drafts prompts from scene fields", () => {
    const b = makeBundle();
    expect(draftScenePrompt({ ...b, scene: b.scenes[0] }, "image")).toMatch(/Location: Bathroom/);
  });
});

describe("storyboard generator", () => {
  it("splits the spec example into scenes with titles and durations", () => {
    const text = "Scene 1:\nHook\nScene 2:\nGiới thiệu sản phẩm\nScene 3:\nCách sử dụng\nScene 4:\nCảm nhận\nScene 5:\nCTA";
    const s = splitScriptIntoScenes(text, 60);
    expect(s.map((x) => x.title)).toEqual(["Hook", "Giới thiệu sản phẩm", "Cách sử dụng", "Cảm nhận", "CTA"]);
    expect(s.reduce((a, x) => a + x.duration, 0)).toBe(60);
  });

  it("parses labeled fields and explicit durations", () => {
    const s = splitScriptIntoScenes("SCENE 01 - Hook (8s)\nAction: She lifts the bottle\nDialogue: Tóc khô?\nCamera: close up\nLooks at camera.", 30);
    expect(s[0]).toMatchObject({ title: "Hook", duration: 8, action: "She lifts the bottle", dialogue: "Tóc khô?", camera: "close up", script: "Looks at camera." });
  });
});
