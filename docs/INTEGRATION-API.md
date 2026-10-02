# Integration API (MarketingOS / Product Media Agent)

Base path: `/api/v1`. Enabled only when `INTEGRATION_TOKEN` is set in `.env`; every request must send
`Authorization: Bearer <INTEGRATION_TOKEN>` (401 otherwise, 503 when disabled).
The v1 routes call the same internal services as the UI, so validation, versioning and consistency checks are identical.

Code: `backend/src/routes/integration.ts`. Tests: `backend/test/features.test.ts`.

> The server binds to `127.0.0.1` by default. To call it from another machine set `HOST=0.0.0.0` and put it behind HTTPS.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /api/v1/health` | Liveness, provider list (configured flags, no keys), default providers |
| `POST /api/v1/spaces` | **Create a production space from a product record** (project, space, references with images, master script, storyboard) |
| `GET /api/v1/spaces/:id` | Full space bundle; each output has `url` → `/api/v1/outputs/:id/file` |
| `PUT /api/v1/spaces/:id/master-script` | Create/update the master script |
| `POST /api/v1/spaces/:id/storyboard` | `{ mode?: "replace"\|"append", scenes?: [...], includeVoice?: bool }` — split the script (or apply given scenes) and build the board |
| `POST /api/v1/spaces/:id/scenes` | Add a scene |
| `PATCH /api/v1/scenes/:id` | Update scene fields (script, action, dialogue, prompts, providers, …) |
| `GET /api/v1/scenes/:id/prompt?target=image\|video\|voice` | Layered final prompt |
| `PUT /api/v1/spaces/:id/workflow` | Replace the workflow graph (`{ workflow }`, see WORKFLOW-SCHEMA.md) |
| `POST /api/v1/spaces/:id/check` | Consistency check report |
| `POST /api/v1/spaces/:id/runs` | Start a run: `{ targets?: string[], mode?: "missing"\|"all", webhookUrl?: string }` → 202 |
| `GET /api/v1/runs/:id` | Run + jobs (status, attempts, logs, output ids) |
| `POST /api/v1/runs/:id/cancel` | Cancel |
| `GET /api/v1/outputs/:id/file` | Download a generated file |
| `POST /api/v1/outputs/:id/select` | Mark an output as the input for downstream nodes |
| `POST /api/v1/spaces/:id/export` | `{ includeMedia?: bool }` → `{ folder, mediaCount, files: { "PROJECT.md": "…", … } }` |
| `POST /api/v1/import` | `{ files: { path: content }, media?: { "assets/…": base64 }, removeMissingScenes?: bool }` |

Errors: `{ "error": "...", "code"?: "..." }` with HTTP 400 (bad input), 401, 404, 409 (duplicate id), 422 (`workflow_check_failed`, includes `report` and `blocking`), 502 (`provider_error`), 503 (`provider_not_configured` / `integration_disabled`).

## Create a space from a product

```http
POST /api/v1/spaces
Authorization: Bearer <token>
Content-Type: application/json

{
  "project": { "name": "Dầu xả ABC" },
  "space": { "name": "TikTok Review 30s", "targetPlatform": "TikTok", "aspectRatio": "9:16" },
  "references": [
    { "type": "character", "name": "Presenter", "prompt": "Young woman, long black hair", "images": [{ "url": "https://cdn.example.com/face.jpg" }] },
    { "type": "product", "name": "ABC Conditioner", "images": [{ "url": "https://cdn.example.com/front.jpg" }, { "base64": "<...>", "filename": "back.png" }] },
    { "type": "voice", "name": "Warm female", "settings": { "voiceName": "nova" } }
  ],
  "masterScript": {
    "title": "Review dầu xả ABC",
    "duration": 30,
    "scriptText": "Scene 1: Hook\nDialogue: Tóc khô xơ?\nScene 2: CTA\nDialogue: Mua ngay hôm nay!"
  },
  "storyboard": { "generate": true, "includeVoice": true }
}
```

- The project is reused when `project.id` matches, or when a project with the same name exists.
- Images are downloaded (http/https, max 50 MB each) or decoded from base64 and stored as assets of the reference.
- Master script `characterId/productId/styleId/voiceId` default to the first reference of each type.
- Response (201): `{ projectId, spaceId, references, masterScript, scenes, check }`.

## Run and webhook

```http
POST /api/v1/spaces/spc_123/runs
{ "targets": ["final_video"], "webhookUrl": "https://marketingos.example.com/hooks/media" }
```

When the run ends, the app POSTs to `webhookUrl` and to `WEBHOOK_URL` (if set):

```json
{
  "event": "run.finished",
  "run": { "id": "run_…", "spaceId": "spc_123", "status": "SUCCESS", "order": ["…"], "error": null, "createdAt": "…", "finishedAt": "…" },
  "jobs": [{ "nodeId": "vid_01", "nodeType": "videoGenerator", "status": "SUCCESS", "error": null, "outputIds": ["out_…"] }],
  "outputs": [{ "id": "out_…", "kind": "video", "sceneId": "scn_…", "nodeId": "final_video", "path": "outputs/…/out_….mp4", "url": "/files/outputs/…" }]
}
```

Headers: `x-amw-event: run.finished` and, when `WEBHOOK_SECRET` is set, `x-amw-signature: sha256=<hex HMAC-SHA256 of the raw body>`.
Delivery is attempted once (15 s timeout); the result is written to `data/logs/<runId>.log`. Poll `GET /api/v1/runs/:id` as a fallback.
