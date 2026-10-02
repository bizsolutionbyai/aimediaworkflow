// Builds or extends the standard production board:
// REFERENCES → MASTER SCRIPT → STORYBOARD → SCENE xN → IMAGE → VIDEO → MERGE → FINAL VIDEO
import { REFERENCE_NODE_TYPE } from "./nodeTypes";
import type { Reference, Scene } from "./types";
import { autoLayout, edgeId, type WorkflowDoc, type WorkflowEdge, type WorkflowNode } from "./workflow";

export interface ProductionGraphOptions {
  scenes: Scene[];
  references: Reference[];
  includeImage?: boolean;
  includeVideo?: boolean;
  includeVoice?: boolean;
  includeMerge?: boolean;
  imageProvider?: string;
  videoProvider?: string;
  voiceProvider?: string;
  aspectRatio?: string;
}

/** Adds missing nodes/edges; existing nodes (matched by stable ids) are kept with their positions and data. */
export function buildProductionGraph(doc: WorkflowDoc, opts: ProductionGraphOptions): WorkflowDoc {
  const nodes: WorkflowNode[] = doc.nodes.map((n) => ({ ...n }));
  const edges: WorkflowEdge[] = doc.edges.map((e) => ({ ...e }));
  const has = (id: string) => nodes.some((n) => n.id === id);
  const added = new Set<string>();
  const addNode = (id: string, type: string, data: Record<string, unknown>) => {
    if (has(id)) return;
    nodes.push({ id, type, position: { x: 0, y: 0 }, data });
    added.add(id);
  };
  const link = (source: string, target: string) => {
    if (!edges.some((e) => e.source === source && e.target === target)) edges.push({ id: edgeId(source, target), source, target });
  };
  const { includeImage = true, includeVideo = true, includeVoice = false, includeMerge = true } = opts;
  const aspectRatio = opts.aspectRatio || "9:16";

  // Reference nodes for character/product/style/voice profiles.
  const refNodeIds: string[] = [];
  for (const r of opts.references.filter((x) => ["character", "product", "style", "voice"].includes(x.type))) {
    const existing = nodes.find((n) => n.data.referenceCode === r.code);
    const id = existing?.id ?? `ref_${r.code.toLowerCase()}`;
    addNode(id, REFERENCE_NODE_TYPE[r.type], { referenceCode: r.code });
    refNodeIds.push(id);
  }

  const master = nodes.find((n) => n.type === "masterScript")?.id ?? "master_script";
  addNode(master, "masterScript", {});
  for (const id of refNodeIds) link(id, master);
  const storyboard = nodes.find((n) => n.type === "storyboardGenerator")?.id ?? "storyboard";
  addNode(storyboard, "storyboardGenerator", {});
  link(master, storyboard);

  const sorted = [...opts.scenes].sort((a, b) => a.sceneNumber - b.sceneNumber);
  const lastPerScene: string[] = [];
  for (const s of sorted) {
    const tag = String(s.sceneNumber).padStart(2, "0");
    const sceneNode = nodes.find((n) => n.type === "scene" && n.data.sceneId === s.id)?.id ?? `scene_${tag}`;
    const stale = nodes.find((n) => n.id === sceneNode && n.type === "scene" && !opts.scenes.some((x) => x.id === n.data.sceneId));
    if (stale) stale.data = { ...stale.data, sceneId: s.id };
    addNode(sceneNode, "scene", { sceneId: s.id });
    link(storyboard, sceneNode);
    let last = sceneNode;
    if (includeImage) {
      const id = `img_${tag}`;
      addNode(id, "imageGenerator", { provider: opts.imageProvider ?? "", model: "", aspectRatio, count: 1, promptOverride: "", useReferenceImages: true });
      link(sceneNode, id);
      last = id;
    }
    if (includeVideo && includeImage) {
      const id = `vid_${tag}`;
      addNode(id, "videoGenerator", { provider: opts.videoProvider ?? "", model: "", aspectRatio, duration: s.duration || 8, promptOverride: "" });
      link(last, id);
      last = id;
    }
    if (includeVoice) {
      const id = `voice_${tag}`;
      addNode(id, "voiceGenerator", { provider: opts.voiceProvider ?? "", model: "", voice: "", promptOverride: "" });
      link(sceneNode, id);
    }
    lastPerScene.push(last);
  }

  if (includeMerge && sorted.length && includeVideo && includeImage) {
    const merge = nodes.find((n) => n.type === "merge")?.id ?? "merge";
    addNode(merge, "merge", {});
    for (const id of lastPerScene) link(id, merge);
    const final = nodes.find((n) => n.type === "finalVideo")?.id ?? "final_video";
    addNode(final, "finalVideo", {});
    link(merge, final);
  }

  const result: WorkflowDoc = { ...doc, nodes, edges };
  // Only lay out when the board was empty; otherwise place new nodes using a layout pass but keep old positions.
  const laid = autoLayout(result);
  if (!doc.nodes.length) return laid;
  return { ...result, nodes: result.nodes.map((n) => (added.has(n.id) ? laid.nodes.find((l) => l.id === n.id)! : n)) };
}
