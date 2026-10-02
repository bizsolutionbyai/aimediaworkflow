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

### 1. Prerequisites

| What | Why | How |
|---|---|---|
| **Node.js 20.19+ (22 LTS recommended)** | runs the app | Install the "LTS" Windows installer from <https://nodejs.org/>. Keep the default options. |
| Git (optional) | clone the repo | <https://git-scm.com/download/win>, or download the repository as a ZIP and extract it. |
| ffmpeg (optional) | only for the **Final Video** node (concatenates clips) | `winget install Gyan.FFmpeg`, or download from <https://www.gyan.dev/ffmpeg/builds/> and add its `bin` folder to `PATH` (or set `FFMPEG_PATH` in `.env`). |

Check Node in a new Command Prompt: `node -v` should print `v20.19.0` or newer.

### 2. Get the code

```bat
git clone https://github.com/bizsolutionbyai/aimediaworkflow.git
cd aimediaworkflow
```

Use a folder path without special permissions (e.g. `C:\Projects\aimediaworkflow`), not `C:\Program Files`.

### 3. Start

Double-click **`start.bat`** (or run it from Command Prompt). On the first run it:

1. creates `.env` from `.env.example`,
2. runs `npm install` (a few minutes; downloads dependencies including a prebuilt SQLite driver),
3. creates/updates the SQLite database `data\app.db` (`npm run setup`),
4. builds the web UI,
5. starts the server and opens <http://127.0.0.1:8787> in your browser.

Leave the window open while you work. To stop, close the window or double-click **`stop.bat`**.

### 4. (Optional) Add API keys

Open `.env` in a text editor, fill in the keys you have, save, then restart (`stop.bat`, `start.bat`):

```ini
OPENAI_API_KEY=sk-...        # GPT Image, Sora video, OpenAI TTS, OpenAI chat assistant
GOOGLE_API_KEY=...           # Gemini image, Veo video
GROK_API_KEY=...             # xAI Grok image
ELEVENLABS_API_KEY=...       # ElevenLabs voice
ANTHROPIC_API_KEY=...        # Claude for the AI Assistant
```

Keys are read only by the local server. They are never stored in the database, sent to the browser, or written to exported Markdown.
**Settings (gear icon) → Providers** shows which providers are configured.

### Developer mode (hot reload)

```bat
npm install
npm run dev
```

`npm run dev` starts the API on port 8787 and the Vite dev server on <http://127.0.0.1:5173> (open that one).

Other commands: `npm test` (unit + integration tests), `npm run typecheck`, `npm run build`, `npm run start` (production build on port 8787).
All scripts work in Command Prompt, PowerShell and on macOS/Linux.

---

## Quick start (Vietnamese)

1. Cài **Node.js 22 LTS** từ nodejs.org.
2. Tải mã nguồn, mở thư mục, chạy **`start.bat`**. Trình duyệt mở <http://127.0.0.1:8787>.
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
8. **Outputs** — generated files are saved under `data/outputs/<space>/<node>/` and previewed on the node and in the editor.
   With `count > 1`, choose which output is the **input** for the next node.
9. **Versions** — scenes, master script, references, prompt templates and the workflow keep a version on every save.
   *Versions → show* lets you compare with the current state, restore, or save a named version.
10. **Export MD / Import** — see below.
11. **AI Assistant** — brief → master script + scenes + prompts, split scenes, write/improve prompts, continuity review.
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
| Lip Sync | video | — | **No adapter.** The node exists; running it fails with "Provider not configured". |
| ffmpeg | Final Video concat | `FFMPEG_PATH` or PATH | Implemented and tested with real ffmpeg. |

Vendor APIs and model names change; if a call fails, the job log shows the provider's error message.
Model names can be overridden per node or with `<PROVIDER>_MODEL` in `.env`. Adding a provider: [docs/PROVIDER-SDK.md](docs/PROVIDER-SDK.md).

## Current limitations

- Provider adapters have not been run against live vendor APIs in this repository (no keys in CI). Expect to adjust parameters if a vendor changed its API.
- **Loop** is a pass-through node; **Condition** only supports "upstream produced outputs"; **Batch** sets the count of downstream generators.
- **Final Video** concatenates video clips only (no audio mixing, transitions or subtitles yet). Voice audio is generated per scene but not muxed.
- **Lip Sync** has no adapter.
- Runs execute one at a time, nodes sequentially within a run (single local queue). Jobs interrupted by a server restart are marked FAILED.
- Import does not copy media files: `ASSETS.md` lists paths relative to `data/`; assets whose files are missing are reported as warnings.
- Workflow import uses the `Workflow JSON` block in `WORKFLOW.md`; edits to the human-readable tables there are not parsed.
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
start.bat / stop.bat / .env.example
```

## Next recommended phase

Phase 5 — **MarketingOS integration API**: an authenticated, versioned REST surface (`/api/v1`) over the existing services
(create space from a product record, push references, trigger runs, webhook on run completion, fetch exported Markdown/outputs),
plus: audio muxing and subtitles in Final Video, a lip-sync adapter, parallel job execution with per-provider rate limits,
and live smoke tests per provider behind opt-in API keys.

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — modules, data flow, execution engine
- [docs/WORKFLOW-SCHEMA.md](docs/WORKFLOW-SCHEMA.md) — workflow JSON, node types, statuses
- [docs/MARKDOWN-SCHEMA.md](docs/MARKDOWN-SCHEMA.md) — export/import format
- [docs/PROVIDER-SDK.md](docs/PROVIDER-SDK.md) — writing a provider adapter
