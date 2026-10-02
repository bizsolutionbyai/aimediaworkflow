# Workflow schema

A space's canvas is stored as one JSON document (`Workflow.json` in the database, mirrored to `data/workflows/<spaceId>.json`).
Source of truth for the shape: `shared/src/workflow.ts`. Node catalog: `shared/src/nodeTypes.ts`.

## Document

```json
{
  "version": "1.0",
  "projectId": "prj_01948523c618",
  "spaceId": "spc_e27a56b8e74d",
  "nodes": [
    { "id": "scene_01", "type": "scene", "position": { "x": 100, "y": 200 }, "data": { "sceneId": "scn_3f9a1c2b7d10" } },
    { "id": "img_01", "type": "imageGenerator", "position": { "x": 100, "y": 420 },
      "data": { "provider": "openai-image", "model": "", "aspectRatio": "9:16", "count": 4, "promptOverride": "", "useReferenceImages": true } }
  ],
  "edges": [
    { "id": "e_scene_01__img_01", "source": "scene_01", "target": "img_01" }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 0.8 }
}
```

| Field | Type | Notes |
|---|---|---|
| `version` | string | schema version, currently `"1.0"` |
| `projectId`, `spaceId` | string | set by the server on save |
| `nodes[].id` | string | unique within the document; stable across saves |
| `nodes[].type` | string | one of the node types below |
| `nodes[].position` | `{x,y}` | canvas position (saved, restored on reopen) |
| `nodes[].data` | object | **IDs and small config only.** Strings over 20 000 chars are truncated and `data:` URIs are dropped on save — media is referenced by asset/output id or path. |
| `edges[]` | `{id, source, target, sourceHandle?, targetHandle?}` | each edge is a data dependency: `source` must finish before `target` runs |
| `viewport` | optional | last canvas viewport |

In the Markdown export (`WORKFLOW.md → ## Workflow JSON`) scene nodes carry `"sceneCode": "SCENE_001"` instead of the internal
`sceneId`, so the file is portable between databases; import maps it back.

## Node types

| Category | Type | `data` | Behaviour when run |
|---|---|---|---|
| input | `characterReference`, `productReference`, `styleReference`, `voiceReference` | `referenceCode` | pass-through; reference profile feeds prompt layers |
| input | `imageReference`, `videoReference`, `audioReference` | `referenceCode`, `assetId` | pass-through; image refs are sent as reference/input images |
| input | `scriptInput` | `text` | provides text (e.g. to Script Generator, Voice Generator) |
| input | `masterScript` | – | pass-through (the space's master script) |
| input | `scene` | `sceneId` | pass-through; generators downstream use this scene's fields |
| ai | `imageGenerator` | `provider, model, aspectRatio, count, promptOverride, useReferenceImages` | layered image prompt → image provider → outputs |
| ai | `imageEditor` | `provider, model, aspectRatio, count, promptOverride` | edits the upstream selected image |
| ai | `videoGenerator` | `provider, model, aspectRatio, duration, promptOverride` | needs an upstream image (generator output or image reference) |
| ai | `voiceGenerator` | `provider, model, voice, promptOverride` | speaks the scene dialogue; voice prompt = delivery instructions |
| ai | `lipSync` | `provider, model` | lip-syncs the upstream video to the upstream voice/audio (Replicate adapter) |
| ai | `scriptGenerator` | `provider, brief` | LLM writes a new (versioned) master script |
| ai | `storyboardGenerator` | – | pass-through in a run; the **Generate storyboard** action creates scenes |
| ai | `promptGenerator` | `target` | composes the layered prompt for the upstream scene; appended to downstream prompts |
| logic | `prompt` | `templateId`, `text` | renders the template with scene variables; appended to downstream prompts |
| logic | `condition` | `check, value` | `hasOutputs`, `noOutputs`, `minOutputs` (N), `hasKind` (image/video/audio), `sceneHasDialogue`, `sceneDurationAtLeast` (N s). False → downstream nodes are skipped (CANCELLED) |
| logic | `batch` | `count` | sets the output count of downstream generators |
| logic | `loop` | `iterations` (1–20) | generators directly downstream call their provider this many times (variations) |
| logic | `merge` | – | collects upstream outputs ordered by canvas x position |
| logic | `delay` | `seconds` | waits |
| output | `imageOutput`, `videoOutput`, `audioOutput` | – | collect upstream outputs of that kind |
| output | `finalVideo` | `includeAudio, audioMode ("replace"\|"mix"), subtitles, burnSubtitles` | normalizes each upstream clip, adds the scene's voice-over, concatenates with ffmpeg, writes `<output>.srt` from scene dialogue |
| output | `export` | – | writes the Markdown export |

Provider resolution for generators: `data.provider` if set, otherwise the upstream scene's `imageProvider` / `videoProvider` / `voiceProvider`.

## Execution

- Parallelism: nodes on the same dependency level run concurrently (`MAX_PARALLEL_JOBS`, default 2); calls per provider are limited by `PROVIDER_MAX_CONCURRENCY` (default 1).
- Webhook: a finished run is POSTed as `run.finished` to `WEBHOOK_URL` and/or the run's `webhookUrl` (see INTEGRATION-API.md).
- Plan: topological order (Kahn), ties broken by `position.y`, then `position.x`, then id. A cycle is an error.
- Partial run: `POST /api/spaces/:id/run { "targets": ["vid_01"] }` plans the targets and their ancestors.
- Mode: `"missing"` (default) reuses existing outputs of non-target generators; `"all"` regenerates everything.
- Statuses (runs and jobs): `PENDING` → `RUNNING` → `SUCCESS` | `FAILED` | `CANCELLED`.
- Outputs: `Output` rows with `nodeId`, `sceneId`, `kind`, `path`, `index`, `selected`. The selected output of a node is the input
  for downstream nodes (`POST /api/outputs/:id/select`).

## Pre-run checks (consistency checker)

Errors block a run (HTTP 422 with the report); warnings do not:

- broken connection (edge to a missing node), self-loop, cycle, unknown node type, duplicate node id
- scene node pointing to a missing scene; reference node pointing to a missing reference/asset
- reference profile with missing asset files
- scene without duration; scene/master script referencing a missing character/product/style/voice
- generator without provider, with an unknown provider, or with a provider whose API key is not configured
- Video Generator without an image input; Lip Sync without video + audio inputs
- warnings: missing character/product, scene without prompts, unset reference nodes, AI/output nodes without inputs, no reference images
