// Field-level comparison between two versions of an entity.

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

const IGNORED = new Set(["updatedAt", "createdAt", "version"]);

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function diffSnapshots(before: Record<string, unknown>, after: Record<string, unknown>): FieldChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !IGNORED.has(k)).sort();
  return keys.filter((k) => !same(before[k], after[k])).map((k) => ({ field: k, before: before[k], after: after[k] }));
}

interface GraphLike {
  nodes?: { id: string; type: string; position?: { x: number; y: number }; data?: unknown }[];
  edges?: { source: string; target: string }[];
}

/** Node/edge level comparison for workflow snapshots. */
export function diffWorkflows(before: GraphLike, after: GraphLike): FieldChange[] {
  const out: FieldChange[] = [];
  const bn = new Map((before.nodes ?? []).map((n) => [n.id, n]));
  const an = new Map((after.nodes ?? []).map((n) => [n.id, n]));
  for (const [id, n] of an) {
    const o = bn.get(id);
    if (!o) out.push({ field: `node ${id}`, before: null, after: n.type });
    else {
      if (!same(o.data, n.data)) out.push({ field: `node ${id} data`, before: o.data, after: n.data });
      if (!same(o.position, n.position)) out.push({ field: `node ${id} position`, before: o.position, after: n.position });
    }
  }
  for (const [id, o] of bn) if (!an.has(id)) out.push({ field: `node ${id}`, before: o.type, after: null });
  const key = (e: { source: string; target: string }) => `${e.source} → ${e.target}`;
  const be = new Set((before.edges ?? []).map(key));
  const ae = new Set((after.edges ?? []).map(key));
  for (const e of ae) if (!be.has(e)) out.push({ field: `edge ${e}`, before: null, after: "added" });
  for (const e of be) if (!ae.has(e)) out.push({ field: `edge ${e}`, before: "present", after: null });
  return out;
}
