// Canvas editing state (React Flow nodes/edges), undo/redo history and clipboard.
// This is pure UI state; it becomes a WorkflowDoc only when saved.
import { create } from "zustand";
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type Viewport } from "@xyflow/react";
import { autoLayout, edgeId, getNodeTypeDef, randomId, type WorkflowDoc } from "@amw/shared";

type Snap = { nodes: Node[]; edges: Edge[] };

interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport | null;
  dirty: boolean;
  past: Snap[];
  future: Snap[];
  clipboard: Snap | null;
  load(doc: WorkflowDoc): void;
  toDoc(projectId: string, spaceId: string, viewport?: Viewport): WorkflowDoc;
  markSaved(): void;
  commit(): void;
  onNodesChange(changes: NodeChange[]): void;
  onEdgesChange(changes: EdgeChange[]): void;
  onConnect(c: Connection): void;
  addNode(type: string, position: { x: number; y: number }, data?: Record<string, unknown>): string;
  updateNodeData(id: string, patch: Record<string, unknown>): void;
  removeSelected(): void;
  duplicateSelected(): void;
  copySelected(): void;
  paste(): void;
  undo(): void;
  redo(): void;
  layout(): void;
  selectOnly(id: string): void;
}

const HISTORY = 100;
const SHORT: Record<string, string> = { imageGenerator: "img", videoGenerator: "vid", voiceGenerator: "voice", scene: "scene" };

export function newNodeId(type: string) {
  return randomId(SHORT[type] ?? type.replace(/[A-Z].*/, "")).slice(0, 18);
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const toRfEdge = (e: { id: string; source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }): Edge => ({ ...e, sourceHandle: e.sourceHandle ?? null, targetHandle: e.targetHandle ?? null });

export const useCanvas = create<CanvasState>((set, get) => ({
  nodes: [],
  edges: [],
  viewport: null,
  dirty: false,
  past: [],
  future: [],
  clipboard: null,

  load(doc) {
    set({
      nodes: doc.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.data })),
      edges: doc.edges.map(toRfEdge),
      viewport: doc.viewport ?? null,
      dirty: false,
      past: [],
      future: [],
    });
  },

  toDoc(projectId, spaceId, viewport) {
    const { nodes, edges } = get();
    return {
      version: "1.0",
      projectId,
      spaceId,
      nodes: nodes.map((n) => ({ id: n.id, type: n.type ?? "unknown", position: { x: Math.round(n.position.x), y: Math.round(n.position.y) }, data: n.data as Record<string, unknown> })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.sourceHandle ? { sourceHandle: e.sourceHandle } : {}), ...(e.targetHandle ? { targetHandle: e.targetHandle } : {}) })),
      ...(viewport ? { viewport } : {}),
    };
  },

  markSaved() {
    set({ dirty: false });
  },

  commit() {
    const { nodes, edges, past } = get();
    set({ past: [...past.slice(-HISTORY + 1), clone({ nodes, edges })], future: [] });
  },

  onNodesChange(changes) {
    // Drag history is committed in onNodeDragStart; selection/measurement changes are not edits.
    if (changes.some((c) => c.type === "remove" || c.type === "add")) get().commit();
    const edit = changes.some((c) => c.type === "position" || c.type === "remove" || c.type === "add");
    set({ nodes: applyNodeChanges(changes, get().nodes), dirty: get().dirty || edit });
  },

  onEdgesChange(changes) {
    if (changes.some((c) => c.type === "remove")) get().commit();
    set({ edges: applyEdgeChanges(changes, get().edges), dirty: get().dirty || changes.some((c) => c.type === "remove") });
  },

  onConnect(c) {
    if (!c.source || !c.target || c.source === c.target) return;
    get().commit();
    set({ edges: addEdge({ ...c, id: edgeId(c.source, c.target, c.sourceHandle, c.targetHandle) }, get().edges), dirty: true });
  },

  addNode(type, position, data) {
    get().commit();
    const def = getNodeTypeDef(type);
    const id = newNodeId(type);
    const node: Node = { id, type, position, data: { ...(def?.defaultData ?? {}), ...(data ?? {}) }, selected: true };
    set({ nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), node], dirty: true });
    return id;
  },

  updateNodeData(id, patch) {
    get().commit();
    set({ nodes: get().nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)), dirty: true });
  },

  removeSelected() {
    const ids = new Set(get().nodes.filter((n) => n.selected).map((n) => n.id));
    const edgeSel = get().edges.some((e) => e.selected);
    if (!ids.size && !edgeSel) return;
    get().commit();
    set({
      nodes: get().nodes.filter((n) => !ids.has(n.id)),
      edges: get().edges.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target)),
      dirty: true,
    });
  },

  copySelected() {
    const nodes = get().nodes.filter((n) => n.selected);
    const ids = new Set(nodes.map((n) => n.id));
    const edges = get().edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    if (nodes.length) set({ clipboard: clone({ nodes, edges }) });
  },

  paste() {
    const clip = get().clipboard;
    if (!clip) return;
    get().commit();
    const map = new Map<string, string>();
    const nodes = clip.nodes.map((n) => {
      const id = newNodeId(n.type ?? "node");
      map.set(n.id, id);
      return { ...clone(n), id, position: { x: n.position.x + 40, y: n.position.y + 40 }, selected: true };
    });
    const edges = clip.edges.map((e) => {
      const source = map.get(e.source)!;
      const target = map.get(e.target)!;
      return { ...e, id: edgeId(source, target), source, target, selected: false };
    });
    set({ nodes: [...get().nodes.map((n) => ({ ...n, selected: false })), ...nodes], edges: [...get().edges, ...edges], dirty: true, clipboard: { nodes: nodes.map((n) => ({ ...n, selected: false })), edges } });
  },

  duplicateSelected() {
    get().copySelected();
    get().paste();
  },

  undo() {
    const { past, nodes, edges, future } = get();
    if (!past.length) return;
    const prev = past[past.length - 1];
    set({ nodes: prev.nodes, edges: prev.edges, past: past.slice(0, -1), future: [clone({ nodes, edges }), ...future], dirty: true });
  },

  redo() {
    const { past, nodes, edges, future } = get();
    if (!future.length) return;
    const next = future[0];
    set({ nodes: next.nodes, edges: next.edges, future: future.slice(1), past: [...past, clone({ nodes, edges })], dirty: true });
  },

  layout() {
    get().commit();
    const doc = autoLayout(get().toDoc("", ""));
    const pos = new Map(doc.nodes.map((n) => [n.id, n.position]));
    set({ nodes: get().nodes.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position })), dirty: true });
  },

  selectOnly(id) {
    set({ nodes: get().nodes.map((n) => ({ ...n, selected: n.id === id })) });
  },
}));
