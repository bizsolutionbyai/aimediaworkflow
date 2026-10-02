// Deterministic Storyboard Generator: splits master script text into scene drafts.
// Recognizes headings such as "Scene 1:", "SCENE 01 - Hook", "## Scene 2", "Cảnh 3:" and labeled
// lines inside a scene ("Action:", "Dialogue:", "Camera:", "Location:", "Duration: 8s").
import type { MasterScript } from "./types";

export interface SceneDraft {
  sceneNumber: number;
  title: string;
  duration: number;
  script: string;
  action: string;
  dialogue: string;
  camera: string;
  location: string;
  expression: string;
}

const HEADING_RE = /^\s*(?:#{1,6}\s*)?(?:scene|cảnh|canh|shot)\s*0*(\d+)\s*(?:[:.\-–—)]\s*(.*))?$/i;
const LABEL_RE = /^\s*(action|hành động|dialogue|lời thoại|thoại|camera|location|bối cảnh|địa điểm|expression|biểu cảm|duration|thời lượng|title)\s*:\s*(.*)$/i;
const DURATION_IN_TITLE_RE = /\(?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|secs|seconds|giây)\s*\)?\s*$/i;

const LABEL_FIELD: Record<string, keyof SceneDraft> = {
  action: "action",
  "hành động": "action",
  dialogue: "dialogue",
  "lời thoại": "dialogue",
  thoại: "dialogue",
  camera: "camera",
  location: "location",
  "bối cảnh": "location",
  "địa điểm": "location",
  expression: "expression",
  "biểu cảm": "expression",
  duration: "duration",
  "thời lượng": "duration",
  title: "title",
};

function emptyDraft(n: number): SceneDraft {
  return { sceneNumber: n, title: "", duration: 0, script: "", action: "", dialogue: "", camera: "", location: "", expression: "" };
}

function parseDuration(v: string): number {
  const m = v.match(/(\d+(?:\.\d+)?)/);
  return m ? Math.round(Number(m[1])) : 0;
}

export function splitScriptIntoScenes(scriptText: string, totalDuration = 0): SceneDraft[] {
  const lines = scriptText.replace(/\r\n/g, "\n").split("\n");
  const blocks: { number: number; heading: string; body: string[] }[] = [];
  for (const line of lines) {
    const m = line.match(HEADING_RE);
    if (m) {
      blocks.push({ number: Number(m[1]), heading: (m[2] ?? "").trim(), body: [] });
    } else if (blocks.length) {
      blocks[blocks.length - 1].body.push(line);
    }
  }

  // No scene headings: one scene per paragraph.
  if (!blocks.length) {
    const paras = scriptText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    paras.forEach((p, i) => {
      const [first, ...rest] = p.split("\n");
      blocks.push({ number: i + 1, heading: rest.length ? first.trim() : "", body: rest.length ? rest : [first] });
    });
  }

  const drafts = blocks.map((b, i) => {
    const d = emptyDraft(i + 1);
    let heading = b.heading;
    const dm = heading.match(DURATION_IN_TITLE_RE);
    if (dm && heading.replace(DURATION_IN_TITLE_RE, "").trim()) {
      d.duration = Math.round(Number(dm[1]));
      heading = heading.replace(DURATION_IN_TITLE_RE, "").replace(/[\s\-–—(]+$/, "").trim();
    }
    d.title = heading;
    const scriptLines: string[] = [];
    let lastField: keyof SceneDraft | null = null;
    for (const raw of b.body) {
      const lm = raw.match(LABEL_RE);
      if (lm) {
        const field = LABEL_FIELD[lm[1].toLowerCase()];
        const value = lm[2].trim();
        if (field === "duration") d.duration = parseDuration(value);
        else if (field) (d[field] as string) = value;
        // A label with an empty value ("Dialogue:") collects the following lines until a blank line.
        lastField = field && field !== "duration" && !value ? field : null;
        continue;
      }
      if (!raw.trim()) {
        lastField = null;
        scriptLines.push("");
        continue;
      }
      if (lastField && lastField !== "title") {
        (d[lastField] as string) = `${d[lastField]}\n${raw.trim()}`.trim();
        continue;
      }
      if (!d.title) {
        d.title = raw.trim();
        continue;
      }
      scriptLines.push(raw.trim());
    }
    d.script = scriptLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    if (!d.title) d.title = `Scene ${i + 1}`;
    return d;
  });

  // Distribute remaining duration over scenes that have none.
  const fixed = drafts.reduce((a, d) => a + d.duration, 0);
  const open = drafts.filter((d) => !d.duration);
  if (open.length && totalDuration > fixed) {
    const each = Math.max(1, Math.floor((totalDuration - fixed) / open.length));
    open.forEach((d) => (d.duration = each));
    const remainder = totalDuration - fixed - each * open.length;
    if (remainder > 0) open[open.length - 1].duration += remainder;
  }
  return drafts;
}

export function storyboardFromMasterScript(ms: Pick<MasterScript, "scriptText" | "duration">): SceneDraft[] {
  return splitScriptIntoScenes(ms.scriptText, ms.duration);
}
