# AI Media Workflow

A local-first web app for planning and producing short product videos on a visual node canvas:
**Project → Space → References → Master Script → Storyboard → Scenes → Image → Video → Merge → Final Video**,
with a layered prompt engine, provider adapters (OpenAI, Google, xAI, ElevenLabs, Anthropic), version history,
and a two-way **Markdown export/import** that Claude Code can read and edit.

Everything runs on your machine. Data lives in `./data`, Markdown exports in `./exports`. No Docker, no cloud storage.
You can design workflows, write scripts and prompts, and export Markdown **without any API key**; generation nodes
then show **"Provider not configured"** instead of pretending to work.

---

## Install and run on Windows 10/11

**One click:** download the repository (GitHub → **Code → Download ZIP**), extract it to a folder you can write to
(e.g. `C:\AIMediaWorkflow`, not `C:\Program Files`), then double-click **`khoidong.bat`**.
Vietnamese step-by-step guide: [HUONG-DAN-CAI-DAT.txt](HUONG-DAN-CAI-DAT.txt).

On the first run (needs Internet, a few minutes) `khoidong.bat` → `scripts/khoidong.ps1`:

1. uses Node.js **22.12+** if it is installed; otherwise downloads **portable Node.js 22 LTS** into `runtime\node`
   (no admin rights, nothing installed system-wide),
2. creates `.env` from `.env.example`,
3. runs `npm install` (again only when `package-lock.json` changes),
4. builds the web UI (again only when the UI source changes),
5. starts the server — the SQLite database `data\app.db` is created/migrated automatically — and opens <http://127.0.0.1:8787>.

Later runs start in seconds. Running `khoidong.bat` while the app is already running just opens the browser.
Stop with **`dung.bat`** or by closing the window. (`start.bat` / `stop.bat` are English aliases.)

If Windows SmartScreen says "Windows protected your PC", click **More info → Run anyway**.

Optional:
- **API keys**: edit `.env` (next to `khoidong.bat`), then restart:

  ```ini
  OPENAI_API_KEY=sk-...        # GPT Image, Sora video, OpenAI TTS, OpenAI chat assistant
  GOOGLE_API_KEY=...           # Gemini image, Veo video
  GROK_API_KEY=...             # xAI Grok image
  ELEVENLABS_API_KEY=...       # ElevenLabs voice
  REPLICATE_API_TOKEN=...      # Lip Sync (Replicate)
  ANTHROPIC_API_KEY=...        # Claude for the AI Assistant
  ```

  Keys are read only by the local server. They are never stored in the database, sent to the browser, or written to exported Markdown.
  **Settings (gear icon) → Providers** shows which providers are configured.
- **ffmpeg** (Final Video node): `winget install Gyan.FFmpeg`, or set `FFMPEG_PATH` in `.env`.

### Developer mode (hot reload)

```bat
npm install
npm run dev
```

`npm run dev` starts the API on port 8787 and the Vite dev server on <http://127.0.0.1:5173> (open that one).

Other commands: `npm test` (unit + integration tests), `npm run typecheck`, `npm run build`, `npm run start` (production build on port 8787),
`npm run smoke` (live provider check with your keys).
All scripts work in Command Prompt, PowerShell and on macOS/Linux.

---

## Quick start (Vietnamese)

1. Không cần cài gì trước (xem chi tiết trong HUONG-DAN-CAI-DAT.txt).
2. Tải mã nguồn (Code → Download ZIP), giải nén, bấm đúp **`khoidong.bat`**. Lần đầu script tự tải Node.js portable và thư viện; trình duyệt tự mở <http://127.0.0.1:8787>. Tắt bằng **`dung.bat`**.
3. Tạo **Project** (vd. "Dầu xả ABC") → tạo **Space** (vd. "TikTok Review 60s").
4. Tab **Characters / Products**: tạo MODEL_001, PRODUCT_001, upload ảnh tham chiếu.
5. Tab **Scripts** → **Open Master Script editor**: viết kịch bản dạng `Scene 1: Hook` … → **Save** → **Generate storyboard**.
6. Canvas tự dựng: References → Master Script → Storyboard → 5 Scene → Image → Video → Merge → Final Video.
7. Bấm **Open** trên Scene node để sửa Action/Dialogue/Camera/Prompt. **Compose** điền prompt từ các trường.
8. **Export MD** → thư mục `exports\<project>--<space>\`. Sửa file `.md` (bằng tay hoặc Claude Code) → **Import** để cập nhật lại app.
9. Thêm API key vào `.env` để tạo ảnh/video/giọng nói thật. Không có key, app vẫn thiết kế workflow, viết prompt và export Markdown.

---

## How to use

1. **Projects & Spaces** — top bar **+ New**. A project (product) contains spaces (one video or a set of videos).
2. **References** — sidebar *Characters*, *Products*, *Styles, Voices & Env*. Each profile has a stable ID (`MODEL_001`,
   `PRODUCT_001`, `STYLE_001`, `VOICE_001`, …), a prompt descriptor, lock flags (face/hair/outfit/identity, logo/shape/color/label/packaging)
   and uploaded reference files. Scenes and nodes refer to the ID, never to free text.
3. **Master Script** — sidebar *Scripts*. Title, objective, platform, aspect ratio, duration, default character/product/style/voice,
   global instruction and the script text. Headings like `Scene 1: Hook` (also `SCENE 01 - Hook (8s)`, `Cảnh 1:`) define scenes;
   optional `Action:`, `Dialogue:`, `Camera:`, `Location:`, `Duration:` lines fill fields.
4. **Storyboard Generator** — *Generate storyboard* splits the script into scenes (deterministic parser, no AI) and builds the production board.
   Re-generating updates scenes in place by number, so IDs, outputs and history are kept.
5. **Scene Editor** — click **Open** on a scene node (or a scene in the sidebar). Edit every field, pick references and providers,
   see the layered **final prompt** live, **Compose** prompts from fields or **AI write/improve** them (needs an assistant key),
   then **Generate image / video / voice**.
6. **Canvas** — drag nodes from the *Nodes* tab, connect bottom handle → top handle. Every edge is a data dependency.
   Shortcuts: `Ctrl+S` save, `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` undo/redo, `Ctrl+C` / `Ctrl+V` copy/paste, `Ctrl+D` duplicate,
   `Del` delete, `Ctrl+A` select all, `Shift+L` auto-layout, `F` fit view, `Ctrl+Enter` run. Drag on empty canvas to box-select,
   right/middle-drag or scroll to pan, `Ctrl`+scroll to zoom.
7. **Check / Run** — *Check* runs the consistency checker (missing references, durations, prompts, providers, image input before video,
   broken connections, missing assets, cycles). *Run* executes the graph in dependency order; nodes that already have outputs are reused
   unless **force** is ticked. A generator's **Generate** button runs just that node and its ancestors. Click the status bar to see the run log
   and cancel a run.
8. **Final Video** — joins the scene videos in order, adds each scene's voice-over (replace or mix with the clip audio) and writes
   an `.srt` subtitle file from the dialogue (optional burn-in). Needs ffmpeg.
9. **Outputs** — generated files are saved under `data/outputs/<space>/<node>/` and previewed on the node and in the editor.
   With `count > 1`, choose which output is the **input** for the next node.
10. **Versions** — scenes, master script, references, prompt templates and the workflow keep a version on every save.
   *Versions → show* lets you compare with the current state, restore, or save a named version.
11. **Export MD / Import** — see below.
12. **AI Assistant** — brief → master script + scenes + prompts, split scenes, write/improve prompts, continuity review.
    Results are editable drafts; nothing is saved until **Apply**.

## Markdown export / import (Claude Code workflow)

**Export MD → Export current space** writes:

```
exports/
└── <project-slug>--<space-slug>/
    ├── PROJECT.md          project, space, global settings, all reference profiles (YAML blocks)
    ├── MASTER-SCRIPT.md    master script
    ├── STORYBOARD.md       scene table + summaries (read-only overview)
    ├── WORKFLOW.md         nodes, dependency graph, execution order, provider config, outputs, Workflow JSON
    ├── PROMPTS.md          prompt templates with versions
    ├── ASSETS.md           asset IDs and file locations
    └── scenes/
        ├── SCENE-01.md     YAML frontmatter + ## Script / Action / Dialogue / Camera / Image Prompt / Video Prompt / Voice Prompt / Continuity
        └── …
```

Edit any file by hand or ask Claude Code, e.g. *"In exports/dau-xa-abc--tiktok-review-60s, rewrite the dialogue of every scene in a friendlier tone"*.
Then **Import → Import** (from the exports list) or **Choose folder…**. The app matches project/space/scene/reference/prompt IDs,
updates what changed (with a new version), creates what is new, and reports warnings. See [docs/MARKDOWN-SCHEMA.md](docs/MARKDOWN-SCHEMA.md).

## Provider integration status

| Provider id | Kind | Env var | Status |
|---|---|---|---|
| `openai-image` | image (generate; edits endpoint when reference images are attached) | `OPENAI_API_KEY` | Implemented against the documented Images API. Request shaping covered by tests with a stubbed HTTP layer; **not exercised against the live API in this repository's tests.** |
| `google-image` | image (Gemini image generation, reference images inline) | `GOOGLE_API_KEY` / `GEMINI_API_KEY` | Implemented; not exercised against the live API. |
| `xai-image` | image (no reference images, no aspect ratio) | `GROK_API_KEY` / `XAI_API_KEY` | Implemented; not exercised against the live API. |
| `openai-sora` | video (image-to-video, polling) | `OPENAI_API_KEY` | Implemented; end-to-end engine test uses a stubbed API. Not exercised live. |
| `google-veo` | video (long-running operation) | `GOOGLE_API_KEY` | Implemented; not exercised against the live API. |
| `openai-tts` | voice | `OPENAI_API_KEY` | Implemented; request shaping tested. Not exercised live. |
| `elevenlabs` | voice | `ELEVENLABS_API_KEY` | Implemented; not exercised against the live API. |
| `anthropic` | assistant LLM | `ANTHROPIC_API_KEY` | Implemented (Messages API); not exercised against the live API. |
| `openai-llm` | assistant LLM | `OPENAI_API_KEY` | Implemented (Chat Completions); not exercised against the live API. |
| `replicate-lipsync` | lip sync (Replicate Files API + prediction polling; model configurable) | `REPLICATE_API_TOKEN` | Implemented; flow tested with a stubbed API. Default model `sync/lipsync-2`; input field names configurable because they differ per model. Not exercised live. |
| ffmpeg | Final Video: concat, scene voice-over (replace or mix), `.srt` subtitles, optional burn-in | `FFMPEG_PATH` or PATH | Implemented and tested with real ffmpeg (burn-in needs an ffmpeg build with libass). |

Check providers with your own keys: `npm run smoke` lists them, `npm run smoke -- openai-image` (or `all`) makes one real, minimal call
per provider and saves the result in `data/smoke/` (this uses a little provider credit).

Vendor APIs and model names change; if a call fails, the job log shows the provider's error message.
Model names can be overridden per node or with `<PROVIDER>_MODEL` in `.env`. Adding a provider: [docs/PROVIDER-SDK.md](docs/PROVIDER-SDK.md).

## Current limitations

- Provider adapters have not been run against live vendor APIs in this repository (no keys in CI). Use `npm run smoke` with your keys; expect to adjust parameters if a vendor changed its API.
- **Loop** repeats the provider calls of the generators directly below it (variations); it does not iterate over a list of items.
- **Final Video** has no transitions or background music; burned-in subtitles need an ffmpeg build with libass (otherwise the `.srt` file is still written).
- Runs are queued one at a time; inside a run, independent nodes run in parallel (`MAX_PARALLEL_JOBS`, per-provider limit `PROVIDER_MAX_CONCURRENCY`). Jobs interrupted by a server restart are marked FAILED.
- Import restores reference asset files only when the export included media (`media/` folder); generated outputs are copied in exports but not re-registered on import.
- Workflow import uses the `Workflow JSON` block in `WORKFLOW.md`; edits to the human-readable tables there are not parsed.
- Webhooks are delivered once (no retry queue).
- Prompt templates are a global library (shared by all projects).
- Single user, no authentication; the server listens on `127.0.0.1` only by default.

## File structure

```
/frontend     React + Vite + Tailwind + React Flow UI (Zustand stores: app state vs. canvas state)
/backend      Fastify API, Prisma (SQLite) schema, workflow engine, Markdown import/export services, tests
/shared       Domain types, node catalog, workflow graph (serialize/validate/plan/layout), prompt engine,
              storyboard parser, consistency checker, Markdown exporter/importer — used by backend and frontend
/providers    Provider SDK + adapters: image/, video/, voice/, llm/
/data         app.db, assets/, outputs/, logs/ and mirror copies (projects/, workflows/, scripts/, prompts/)
/exports      Markdown exports
/docs         ARCHITECTURE.md, WORKFLOW-SCHEMA.md, MARKDOWN-SCHEMA.md, PROVIDER-SDK.md
khoidong.bat / dung.bat (+ start.bat / stop.bat aliases), scripts/khoidong.ps1, HUONG-DAN-CAI-DAT.txt, .env.example
/runtime      portable Node.js (created on first run if needed; not in git)
```

## MarketingOS integration (Phase 5)

Set `INTEGRATION_TOKEN` in `.env` to enable the token-protected `/api/v1` API: create a whole production space from a product record
in one call (references with image URLs, master script, storyboard), start runs, receive signed `run.finished` webhooks, download outputs,
and export/import Markdown. See [docs/INTEGRATION-API.md](docs/INTEGRATION-API.md).

## Next recommended phase

Multi-user and deployment: authentication for the UI, Postgres option, object storage for media, a durable job queue with webhook retries,
plus background music/transitions in Final Video and per-project prompt libraries.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, execution engine
- [docs/WORKFLOW-SCHEMA.md](docs/WORKFLOW-SCHEMA.md) — workflow JSON, node types, statuses
- [docs/MARKDOWN-SCHEMA.md](docs/MARKDOWN-SCHEMA.md) — export/import format
- [docs/PROVIDER-SDK.md](docs/PROVIDER-SDK.md) — writing a provider adapter
- [docs/INTEGRATION-API.md](docs/INTEGRATION-API.md) — `/api/v1` for MarketingOS, webhooks
