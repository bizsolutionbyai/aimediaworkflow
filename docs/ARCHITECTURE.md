# Architecture

## Overview

```
┌──────────────────────────── frontend (React, Vite, Tailwind, React Flow, Zustand) ────────────────────────────┐
│ TopBar · Sidebar (assets, references, scripts, scenes, prompts, nodes, providers) · Canvas · RightPanel editors │
│ store/app.ts    — domain + execution state (projects, space bundle, providers, selection, latest run)          │
│ store/canvas.ts — canvas UI state (React Flow nodes/edges, undo/redo history, clipboard, dirty flag)           │
└───────────────────────────────────────────────┬────────────────────────────────────────────────────────────────┘
                                                │ REST /api/*, media /files/assets/*, /files/outputs/*
┌───────────────────────────────────────────────▼──────────────── backend (Fastify, Prisma 7, SQLite) ───────────┐
│ routes/core.ts   projects, spaces, assets (multipart), references, master script, storyboard, scenes,           │
│                  prompt library, workflow save/load, versions                                                   │
│ routes/ops.ts    providers, consistency check, runs/jobs, outputs, Markdown export/import, assistant           │
│ services/engine.ts      graph → execution plan → queued jobs (retry, cancel, logs, outputs)                    │
│ services/markdown.ts    write export folder / apply parsed import to the DB                                    │
│ services/versions.ts    snapshots, restore, compare                                                            │
│ services/assistant.ts   LLM drafting (returns drafts; UI applies them)                                         │
│ services/ffmpeg.ts      Final Video concatenation                                                              │
└───────────────┬───────────────────────────────────────────────────────────────┬────────────────────────────────┘
                │                                                               │
┌───────────────▼────────────── shared (pure TypeScript, no I/O) ─┐   ┌─────────▼──────── providers ──────────────┐
│ types.ts           domain model                                  │   │ types.ts  ImageProvider / VideoProvider /  │
│ nodeTypes.ts       node catalog + connection rules               │   │           VoiceProvider / LlmProvider      │
│ workflow.ts        normalize/serialize/parse, validate, cycles,  │   │ registry.ts  discovery + configured flag   │
│                    execution plan (topological), auto-layout     │   │ image/ openai, google, xai                 │
│ graphBuilder.ts    standard production board                     │   │ video/ openai-sora, google-veo             │
│ prompt.ts          layered prompt engine + {{variables}}         │   │ voice/ openai-tts, elevenlabs              │
│ storyboard.ts      deterministic master-script → scenes parser   │   │ llm/   anthropic, openai                   │
│ consistency.ts     pre-run checker                               │   └────────────────────────────────────────────┘
│ markdown/          export, import, frontmatter/section helpers   │
│ diff.ts            version comparison                            │
└──────────────────────────────────────────────────────────────────┘
```

The `shared` package is imported directly as TypeScript by both the backend (via `tsx`) and the frontend (via Vite),
so the prompt preview in the UI and the prompt sent by the engine are produced by the same code.

## Data model (SQLite via Prisma)

`backend/prisma/schema.prisma`:

| Table | Notes |
|---|---|
| Project | `settings` JSON (global/negative prompt). Secrets are stripped on write. |
| Space | belongs to a project; target platform, aspect ratio |
| Asset | uploaded file metadata; file under `data/assets/<projectId>/` |
| Reference | character/product/environment/style/voice/image/video/audio profile. `code` (e.g. `MODEL_001`) is unique per space and is what scenes/nodes reference. `settings` holds lock flags; `assetIds` lists reference files. |
| MasterScript | one per space |
| Scene | `code` (`SCENE_001`) unique per space; empty reference fields inherit from the master script |
| PromptTemplate | global prompt library, id like `CHARACTER_CONSISTENCY_V1` |
| Workflow | one per space; `json` = WorkflowDoc (see WORKFLOW-SCHEMA.md) |
| EntityVersion | snapshots for workflow, masterScript, scene, prompt, reference (last 100 per entity) |
| WorkflowRun, Job | execution state (status, attempts, logs, output ids) |
| Output | generated media; file under `data/outputs/<spaceId>/<nodeId>/`; `selected` marks the preferred input |

Generated media is never stored in the workflow JSON or the database — only relative paths and IDs.

Convenience mirror files are written on save (`data/projects/*.json`, `data/workflows/<spaceId>.json`,
`data/scripts/<spaceId>.txt`, `data/prompts/library.json`); the database stays the source of truth.

## Prompt engine

`shared/src/prompt.ts` builds a prompt from layers, never from one stored string:

```
GLOBAL      project global prompt + master script global instruction
CHARACTER   "Use character MODEL_001 (name)." + descriptor + lock sentence
PRODUCT     "Use product PRODUCT_001 (name)." + descriptor + lock sentence
STYLE       style profile
SCENE       scene image/video prompt (with {{variables}} rendered), or derived from location/action/expression
CAMERA      shot type, camera, movement, lighting
CONTINUITY  rules from locks + scene continuity notes
PROVIDER    aspect ratio, duration, platform
→ FINAL PROMPT (layers joined)       + negative prompt + reference image asset ids
```

Voice uses the voice profile, the scene's voice prompt as delivery instructions, and the dialogue as spoken text.
Adapters receive the final prompt plus structured inputs (aspect ratio, count, reference images, input image) and map them to vendor parameters.

## Workflow engine

`backend/src/services/engine.ts`

1. **Check** — `checkConsistency` on the saved space. Errors on planned nodes, their scenes, or graph-level errors
   (broken edges, cycles, unknown types) block the run with HTTP 422 and the report.
2. **Plan** — `buildExecutionPlan` (Kahn topological sort, ties broken by canvas position). With `targets`, only those nodes and their ancestors.
3. **Queue** — a run row and one PENDING job per planned node; runs are processed one at a time.
4. **Execute** — nodes in order. A node whose upstream failed/was cancelled, or whose upstream Condition is false, is CANCELLED with the reason.
   Generator nodes that already have outputs are reused unless the run mode is `all` or the node is a target.
5. **Retry** — up to `JOB_MAX_ATTEMPTS` for retryable errors (HTTP 429/5xx, network). "Provider not configured" is never retried.
6. **Cancel** — aborts the provider request/polling via `AbortSignal`; pending jobs become CANCELLED.
7. **Log & track** — per-job logs in the Job row and `data/logs/<runId>.log`; outputs saved as files + Output rows;
   scene `imageStatus/videoStatus/voiceStatus` updated.
8. **Recover** — on server start, jobs left RUNNING/PENDING are marked FAILED ("Interrupted by server restart").

Statuses: `PENDING`, `RUNNING`, `SUCCESS`, `FAILED`, `CANCELLED`.

## State separation

- Canvas edits (positions, connections, node config) live in `store/canvas.ts` until **Save** (`PUT /api/spaces/:id/workflow`).
- Execution status is read from the server (`/api/runs/:id`) into `store/app.ts` and only *displayed* on nodes.
- Scenes, references, scripts and prompts are saved through their own endpoints with their own versions.

## Security

- API keys only come from `.env`/environment, are read by the backend, and are exposed to the UI only as `configured: true/false` + env var name.
- `stripSecrets` removes key-like fields (`api_key`, `secret`, `token`, `password`, …) from settings on write, on export and on import.
- Exports contain provider **ids** only (`provider: openai-image`). Tests assert that a configured key never appears in exported Markdown.
- Media is served only from `data/assets` and `data/outputs`; the database file is not reachable over HTTP. The server binds to `127.0.0.1` by default.

## Tests

`npm test` runs:

- `shared/test` — workflow serialization/parse/validation/plan/layout, prompt engine, storyboard parser, Markdown export/import round-trip, consistency checker.
- `providers/test` — registry and adapter request shaping with a stubbed `fetch`.
- `backend/test/acceptance.test.ts` — the MVP acceptance flow on a real SQLite database in a temp folder: project → space → references
  with uploads → master script → 5 scenes on the canvas → edit scene/prompts → save → "close" and reopen → workflow restored → broken dependency
  blocks execution → Scene → Image → Video run through adapters (vendor HTTP stubbed) → export → edit a `.md` → import → changes applied,
  no API key in Markdown → import into a fresh database → Final Video with real ffmpeg (when installed).
