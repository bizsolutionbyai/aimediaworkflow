import { describe, expect, it } from "vitest";
import {
  autoLayout,
  buildExecutionPlan,
  canConnect,
  parseWorkflow,
  serializeWorkflow,
  validateGraph,
  WorkflowError,
  type WorkflowDoc,
} from "../src";

function doc(nodes: [string, string][], edges: [string, string][]): WorkflowDoc {
  return {
    version: "1.0",
    projectId: "p",
    spaceId: "s",
    nodes: nodes.map(([id, type], i) => ({ id, type, position: { x: i * 10, y: 0 }, data: {} })),
    edges: edges.map(([source, target]) => ({ id: `${source}-${target}`, source, target })),
  };
}

describe("workflow serialization", () => {
  it("round-trips through JSON", () => {
    const d = doc([["a", "scene"], ["b", "imageGenerator"]], [["a", "b"]]);
    d.nodes[0].data = { sceneId: "SCENE_001" };
    d.viewport = { x: 1, y: 2, zoom: 0.5 };
    const back = parseWorkflow(serializeWorkflow(d));
    expect(back).toEqual(d);
  });

  it("matches the documented JSON shape", () => {
    const json = JSON.parse(serializeWorkflow(doc([["scene_01", "scene"]], [])));
    expect(Object.keys(json)).toEqual(["version", "projectId", "spaceId", "nodes", "edges"]);
    expect(json.nodes[0]).toEqual({ id: "scene_01", type: "scene", position: { x: 0, y: 0 }, data: {} });
  });

  it("rejects malformed JSON with details", () => {
    expect(() => parseWorkflow("{nope")).toThrow(WorkflowError);
    try {
      parseWorkflow(JSON.stringify({ nodes: [{ type: "scene" }], edges: [{ source: 1 }] }));
    } catch (e) {
      expect((e as WorkflowError).details.length).toBe(2);
    }
  });

  it("strips embedded base64 media from node data", () => {
    const d = doc([["a", "imageOutput"]], []);
    d.nodes[0].data = { preview: "data:image/png;base64," + "A".repeat(5000), path: "outputs/x.png" };
    const back = parseWorkflow(serializeWorkflow(d));
    expect(back.nodes[0].data).toEqual({ path: "outputs/x.png" });
  });
});

describe("execution plan", () => {
  it("orders by dependency", () => {
    const d = doc(
      [["vid", "videoGenerator"], ["img", "imageGenerator"], ["scene", "scene"], ["char", "characterReference"]],
      [["char", "scene"], ["scene", "img"], ["img", "vid"]],
    );
    const plan = buildExecutionPlan(d);
    expect(plan.order).toEqual(["char", "scene", "img", "vid"]);
    expect(plan.levels.length).toBe(4);
  });

  it("plans only ancestors for a target", () => {
    const d = doc([["s1", "scene"], ["i1", "imageGenerator"], ["s2", "scene"], ["i2", "imageGenerator"]], [["s1", "i1"], ["s2", "i2"]]);
    expect(buildExecutionPlan(d, ["i2"]).order).toEqual(["s2", "i2"]);
  });

  it("detects cycles", () => {
    const d = doc([["a", "merge"], ["b", "merge"]], [["a", "b"], ["b", "a"]]);
    expect(() => buildExecutionPlan(d)).toThrow(/Cycle/);
    expect(validateGraph(d).some((i) => i.code === "cycle")).toBe(true);
  });

  it("reports broken edges", () => {
    const d = doc([["a", "scene"]], [["a", "ghost"]]);
    const issues = validateGraph(d);
    expect(issues.find((i) => i.code === "broken_edge")?.message).toMatch(/ghost/);
  });

  it("auto-layouts in layers", () => {
    const d = doc([["a", "scene"], ["b", "imageGenerator"], ["c", "videoGenerator"]], [["a", "b"], ["b", "c"]]);
    const laid = autoLayout(d);
    const y = (id: string) => laid.nodes.find((n) => n.id === id)!.position.y;
    expect(y("a")).toBeLessThan(y("b"));
    expect(y("b")).toBeLessThan(y("c"));
  });

  it("validates connection kinds", () => {
    expect(canConnect("scene", "imageGenerator")).toBe(true);
    expect(canConnect("imageGenerator", "videoGenerator")).toBe(true);
    expect(canConnect("audioOutput", "scene")).toBe(false);
  });
});
