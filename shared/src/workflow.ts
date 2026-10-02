// Workflow graph document: serialization, validation, dependency resolution and auto-layout.
import { canConnect, getNodeTypeDef } from "./nodeTypes";

export const WORKFLOW_SCHEMA_VERSION = "1.0";

export interface XY {
  x: number;
  y: number;
}

export interface WorkflowNode {
  id: string;
  type: string;
  position: XY;
  data: Record<string, unknown>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
}

export interface WorkflowDoc {
  version: string;
  projectId: string;
  spaceId: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

export class WorkflowError extends Error {
  constructor(
    message: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

/** Strings longer than this are not allowed in node data (prevents inlining media/base64). */
export const MAX_NODE_STRING = 20000;

export function createEmptyWorkflow(projectId: string, spaceId: string): WorkflowDoc {
  return { version: WORKFLOW_SCHEMA_VERSION, projectId, spaceId, nodes: [], edges: [] };
}

export function edgeId(source: string, target: string, sourceHandle?: string | null, targetHandle?: string | null): string {
  return `e_${source}${sourceHandle ? `.${sourceHandle}` : ""}__${target}${targetHandle ? `.${targetHandle}` : ""}`;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Recursively removes values that look like embedded media or are oversized. */
export function sanitizeNodeData(data: Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      if (v.startsWith("data:") && v.length > 256) return undefined;
      if (v.length > MAX_NODE_STRING) return v.slice(0, MAX_NODE_STRING);
      return v;
    }
    if (Array.isArray(v)) return v.map(walk).filter((x) => x !== undefined);
    if (isPlainObject(v)) {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        const w = walk(val);
        if (w !== undefined) out[k] = w;
      }
      return out;
    }
    return v;
  };
  return walk(data) as Record<string, unknown>;
}

/** Normalizes any loosely-shaped object (e.g. React Flow state) into a WorkflowDoc. */
export function normalizeWorkflow(input: unknown): WorkflowDoc {
  if (!isPlainObject(input)) throw new WorkflowError("Workflow must be a JSON object");
  const errors: string[] = [];
  const nodesIn = Array.isArray(input.nodes) ? input.nodes : [];
  const edgesIn = Array.isArray(input.edges) ? input.edges : [];
  if (!Array.isArray(input.nodes)) errors.push("`nodes` must be an array");
  if (!Array.isArray(input.edges)) errors.push("`edges` must be an array");

  const nodes: WorkflowNode[] = [];
  nodesIn.forEach((n, i) => {
    if (!isPlainObject(n)) return errors.push(`nodes[${i}] is not an object`);
    if (typeof n.id !== "string" || !n.id) return errors.push(`nodes[${i}].id is missing`);
    if (typeof n.type !== "string" || !n.type) return errors.push(`nodes[${i}].type is missing`);
    const pos = isPlainObject(n.position) ? n.position : {};
    nodes.push({
      id: n.id,
      type: n.type,
      position: { x: Number(pos.x) || 0, y: Number(pos.y) || 0 },
      data: sanitizeNodeData(isPlainObject(n.data) ? n.data : {}),
    });
  });

  const edges: WorkflowEdge[] = [];
  edgesIn.forEach((e, i) => {
    if (!isPlainObject(e)) return errors.push(`edges[${i}] is not an object`);
    if (typeof e.source !== "string" || typeof e.target !== "string")
      return errors.push(`edges[${i}] needs string source and target`);
    const sourceHandle = typeof e.sourceHandle === "string" ? e.sourceHandle : null;
    const targetHandle = typeof e.targetHandle === "string" ? e.targetHandle : null;
    edges.push({
      id: typeof e.id === "string" && e.id ? e.id : edgeId(e.source, e.target, sourceHandle, targetHandle),
      source: e.source,
      target: e.target,
      ...(sourceHandle ? { sourceHandle } : {}),
      ...(targetHandle ? { targetHandle } : {}),
    });
  });

  if (errors.length) throw new WorkflowError("Invalid workflow JSON", errors);

  const doc: WorkflowDoc = {
    version: typeof input.version === "string" ? input.version : WORKFLOW_SCHEMA_VERSION,
    projectId: typeof input.projectId === "string" ? input.projectId : "",
    spaceId: typeof input.spaceId === "string" ? input.spaceId : "",
    nodes,
    edges,
  };
  if (isPlainObject(input.viewport)) {
    const v = input.viewport;
    doc.viewport = { x: Number(v.x) || 0, y: Number(v.y) || 0, zoom: Number(v.zoom) || 1 };
  }
  return doc;
}

export function serializeWorkflow(doc: WorkflowDoc): string {
  return JSON.stringify(normalizeWorkflow(doc), null, 2);
}

export function parseWorkflow(json: string): WorkflowDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (err) {
    throw new WorkflowError(`Workflow is not valid JSON: ${(err as Error).message}`);
  }
  return normalizeWorkflow(raw);
}

export interface GraphIssue {
  level: "error" | "warning";
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

/** Structural validation: ids, node types, dangling/incompatible edges and cycles. */
export function validateGraph(doc: WorkflowDoc): GraphIssue[] {
  const issues: GraphIssue[] = [];
  const ids = new Set<string>();
  for (const n of doc.nodes) {
    if (ids.has(n.id)) issues.push({ level: "error", code: "duplicate_node", message: `Duplicate node id ${n.id}`, nodeId: n.id });
    ids.add(n.id);
    if (!getNodeTypeDef(n.type)) issues.push({ level: "error", code: "unknown_type", message: `Unknown node type "${n.type}"`, nodeId: n.id });
  }
  const byId = new Map(doc.nodes.map((n) => [n.id, n]));
  for (const e of doc.edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s || !t) {
      issues.push({
        level: "error",
        code: "broken_edge",
        message: `Broken connection ${e.source} → ${e.target}: ${!s ? `source ${e.source}` : `target ${e.target}`} does not exist`,
        edgeId: e.id,
      });
      continue;
    }
    if (e.source === e.target) {
      issues.push({ level: "error", code: "self_loop", message: `Node ${e.source} is connected to itself`, edgeId: e.id, nodeId: e.source });
      continue;
    }
    if (getNodeTypeDef(s.type) && getNodeTypeDef(t.type) && !canConnect(s.type, t.type)) {
      issues.push({
        level: "warning",
        code: "incompatible_edge",
        message: `${getNodeTypeDef(s.type)!.label} (${s.id}) output is not a typical input for ${getNodeTypeDef(t.type)!.label} (${t.id})`,
        edgeId: e.id,
      });
    }
  }
  const cycle = findCycle(doc);
  if (cycle) issues.push({ level: "error", code: "cycle", message: `Cycle detected: ${cycle.join(" → ")}`, nodeId: cycle[0] });
  return issues;
}

function validEdges(doc: WorkflowDoc): WorkflowEdge[] {
  const ids = new Set(doc.nodes.map((n) => n.id));
  return doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target);
}

export function upstreamIds(doc: WorkflowDoc, nodeId: string): string[] {
  return validEdges(doc).filter((e) => e.target === nodeId).map((e) => e.source);
}

export function downstreamIds(doc: WorkflowDoc, nodeId: string): string[] {
  return validEdges(doc).filter((e) => e.source === nodeId).map((e) => e.target);
}

/** All transitive ancestors of the given nodes (excluding themselves). */
export function ancestorsOf(doc: WorkflowDoc, nodeIds: string[]): Set<string> {
  const out = new Set<string>();
  const stack = [...nodeIds];
  while (stack.length) {
    const id = stack.pop()!;
    for (const up of upstreamIds(doc, id)) {
      if (!out.has(up)) {
        out.add(up);
        stack.push(up);
      }
    }
  }
  return out;
}

export function findCycle(doc: WorkflowDoc): string[] | null {
  const edges = validEdges(doc);
  const adj = new Map<string, string[]>();
  for (const n of doc.nodes) adj.set(n.id, []);
  for (const e of edges) adj.get(e.source)!.push(e.target);
  const state = new Map<string, 0 | 1 | 2>();
  const path: string[] = [];
  const dfs = (id: string): string[] | null => {
    state.set(id, 1);
    path.push(id);
    for (const next of adj.get(id) ?? []) {
      const s = state.get(next) ?? 0;
      if (s === 1) return [...path.slice(path.indexOf(next)), next];
      if (s === 0) {
        const c = dfs(next);
        if (c) return c;
      }
    }
    path.pop();
    state.set(id, 2);
    return null;
  };
  for (const n of doc.nodes) {
    if ((state.get(n.id) ?? 0) === 0) {
      const c = dfs(n.id);
      if (c) return c;
    }
  }
  return null;
}

export interface ExecutionPlan {
  /** Topological order (Kahn's algorithm, ties broken by canvas position for determinism). */
  order: string[];
  /** Nodes grouped by dependency depth; nodes in the same level are independent. */
  levels: string[][];
}

/**
 * Converts the graph into an execution plan. When `targets` is given, only those nodes and their
 * ancestors are planned (used for "Generate" on a single node).
 */
export function buildExecutionPlan(doc: WorkflowDoc, targets?: string[]): ExecutionPlan {
  const cycle = findCycle(doc);
  if (cycle) throw new WorkflowError(`Cycle detected: ${cycle.join(" → ")}`);
  let include: Set<string>;
  if (targets && targets.length) {
    include = ancestorsOf(doc, targets);
    for (const t of targets) include.add(t);
  } else {
    include = new Set(doc.nodes.map((n) => n.id));
  }
  const nodes = doc.nodes.filter((n) => include.has(n.id));
  const edges = validEdges(doc).filter((e) => include.has(e.source) && include.has(e.target));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  for (const e of edges) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const pos = new Map(nodes.map((n) => [n.id, n.position]));
  const sortIds = (ids: string[]) =>
    ids.sort((a, b) => {
      const pa = pos.get(a)!;
      const pb = pos.get(b)!;
      return pa.y - pb.y || pa.x - pb.x || a.localeCompare(b);
    });

  const levels: string[][] = [];
  let frontier = sortIds(nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id));
  const order: string[] = [];
  while (frontier.length) {
    levels.push(frontier);
    order.push(...frontier);
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of edges) {
        if (e.source !== id) continue;
        const d = indeg.get(e.target)! - 1;
        indeg.set(e.target, d);
        if (d === 0) next.push(e.target);
      }
    }
    frontier = sortIds(next);
  }
  return { order, levels };
}

export interface LayoutOptions {
  nodeWidth?: number;
  nodeHeight?: number;
  gapX?: number;
  gapY?: number;
}

/** Layered top-to-bottom layout based on longest-path depth. Returns a new doc. */
export function autoLayout(doc: WorkflowDoc, opts: LayoutOptions = {}): WorkflowDoc {
  const { nodeWidth = 240, nodeHeight = 150, gapX = 40, gapY = 70 } = opts;
  const edges = validEdges(doc);
  const depth = new Map<string, number>();
  let order: string[];
  try {
    order = buildExecutionPlan(doc).order;
  } catch {
    order = doc.nodes.map((n) => n.id);
  }
  for (const id of order) {
    const ups = edges.filter((e) => e.target === id).map((e) => depth.get(e.source) ?? 0);
    depth.set(id, ups.length ? Math.max(...ups) + 1 : 0);
  }
  const rows = new Map<number, string[]>();
  for (const id of order) {
    const d = depth.get(id) ?? 0;
    if (!rows.has(d)) rows.set(d, []);
    rows.get(d)!.push(id);
  }
  // Order each row by the average x-index of parents to reduce crossings.
  const xIndex = new Map<string, number>();
  const sortedDepths = [...rows.keys()].sort((a, b) => a - b);
  for (const d of sortedDepths) {
    const row = rows.get(d)!;
    if (d > 0) {
      const score = (id: string) => {
        const ps = edges.filter((e) => e.target === id).map((e) => xIndex.get(e.source) ?? 0);
        return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
      };
      row.sort((a, b) => score(a) - score(b));
    }
    row.forEach((id, i) => xIndex.set(id, i));
  }
  const maxRow = Math.max(1, ...[...rows.values()].map((r) => r.length));
  const totalWidth = maxRow * (nodeWidth + gapX);
  const positions = new Map<string, XY>();
  for (const d of sortedDepths) {
    const row = rows.get(d)!;
    const rowWidth = row.length * (nodeWidth + gapX);
    const offset = (totalWidth - rowWidth) / 2;
    row.forEach((id, i) => positions.set(id, { x: Math.round(offset + i * (nodeWidth + gapX)), y: d * (nodeHeight + gapY) }));
  }
  return { ...doc, nodes: doc.nodes.map((n) => ({ ...n, position: positions.get(n.id) ?? n.position })) };
}
