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
