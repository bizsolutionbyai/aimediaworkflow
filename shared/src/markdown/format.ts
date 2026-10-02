// Low-level Markdown helpers: YAML frontmatter, "## " sections and fenced code blocks.
import YAML from "yaml";

export const MARKDOWN_SCHEMA_VERSION = "1.0";

export function frontmatter(data: Record<string, unknown>): string {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) if (v !== undefined) clean[k] = v;
  return `---\n${YAML.stringify(clean, { lineWidth: 0 }).trimEnd()}\n---\n`;
}

export function yamlBlock(data: unknown): string {
  return "```yaml\n" + YAML.stringify(data, { lineWidth: 0 }).trimEnd() + "\n```";
}

export function jsonBlock(data: unknown): string {
  return "```json\n" + JSON.stringify(data, null, 2) + "\n```";
}

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(text: string): ParsedMarkdown {
  const src = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: src };
  const parsed = YAML.parse(m[1]);
  return { data: parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}, body: m[2] };
}

/** Splits a body into `## Heading` sections (heading text → trimmed content). Code fences are respected. */
export function parseSections(body: string, level = 2): Map<string, string> {
  const out = new Map<string, string>();
  const marker = "#".repeat(level) + " ";
  let current: string | null = null;
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    if (current !== null) out.set(current, buf.join("\n").trim());
  };
  for (const line of body.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith(marker)) {
      flush();
      current = line.slice(marker.length).trim();
      buf = [];
    } else if (current !== null) {
      buf.push(line);
    }
  }
  flush();
  return out;
}

/** Returns the contents of every fenced block with the given language tag, in order. */
export function fencedBlocks(text: string, lang: string): string[] {
  const out: string[] = [];
  const re = new RegExp("^```" + lang + "\\s*\\n([\\s\\S]*?)\\n```\\s*$", "gm");
  for (const m of text.matchAll(re)) out.push(m[1]);
  return out;
}

/** Section text that represents an empty value. */
export const EMPTY_MARK = "_(empty)_";

export function sectionValue(text: string | undefined): string {
  if (!text) return "";
  const t = text.trim();
  return t === EMPTY_MARK ? "" : t;
}

export function section(title: string, content: string): string {
  return `## ${title}\n\n${content.trim() ? content.trim() : EMPTY_MARK}\n`;
}

export function str(v: unknown, fallback = ""): string {
  if (v === undefined || v === null) return fallback;
  return String(v);
}

export function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function mdEscapeCell(v: string): string {
  return v.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

const SECRET_KEY_RE = /(api[_-]?key|secret|token|password|authorization|credential)/i;

/** Removes anything that looks like a credential from a settings object (defense in depth). */
export function stripSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSecrets) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(k)) continue;
      out[k] = stripSecrets(v);
    }
    return out as T;
  }
  return value;
}
