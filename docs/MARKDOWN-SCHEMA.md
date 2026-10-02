# Markdown schema (export / import)

Export: **Export MD** in the app, or `POST /api/spaces/:spaceId/export`.
Import: **Import** in the app (folder picker or a folder from `exports/`), `POST /api/import { files: { "<path>": "<content>" } }`,
or `POST /api/import/folder { "folder": "<name in exports/>" }`.

Code: `shared/src/markdown/export.ts`, `shared/src/markdown/import.ts`, `backend/src/services/markdown.ts`.

## Rules (written for Claude Code and humans)

- Every file starts with YAML frontmatter (`---` … `---`) with `type` and `version: "1.0"`.
- IDs are stable and deterministic: `project_id`, `space_id`, reference IDs (`MODEL_001`, `PRODUCT_001`, `STYLE_001`, `VOICE_001`, `ENV_001`, …),
  scene IDs (`SCENE_001`), prompt template IDs (`CHARACTER_CONSISTENCY_V1`), asset IDs (`asset_…`).
- File names are deterministic: `scenes/SCENE-<NN>.md` from the scene number.
- Long text lives in `## Heading` sections; short fields live in frontmatter. An empty section is written as `_(empty)_`.
- Sections and frontmatter keys marked "generated" (`resolved_*`, `*_status`, `## … (generated)`, STORYBOARD.md, ASSETS.md tables) are
  rebuilt on every export and ignored on import.
- Files link to each other with relative paths (`master_script: ../MASTER-SCRIPT.md`).
- **No secrets.** Providers appear only as ids (`provider: openai-image`). Key-like fields are stripped on export and import.

## Folder

```
exports/<project-slug>--<space-slug>/
  PROJECT.md  MASTER-SCRIPT.md  STORYBOARD.md  WORKFLOW.md  PROMPTS.md  ASSETS.md
  scenes/SCENE-01.md … SCENE-NN.md
```

## PROJECT.md

````markdown
---
type: project
version: "1.0"
project_id: prj_01948523c618
project_name: Dầu xả ABC
space_id: spc_e27a56b8e74d
space_name: TikTok Review 60s
target_platform: TikTok
aspect_ratio: 9:16
exported_at: 2026-10-02T00:28:38.557Z
settings: { globalPrompt: "...", negativePrompt: "..." }
files: { master_script: MASTER-SCRIPT.md, storyboard: STORYBOARD.md, workflow: WORKFLOW.md, prompts: PROMPTS.md, assets: ASSETS.md, scenes: [scenes/SCENE-01.md, …] }
---

# Project — Dầu xả ABC

## Description
## Space Description
## Objective            (from the master script; read-only here)
## Global Settings      (summary; read-only)
## Characters
### MODEL_001 — Vietnamese Female Presenter
```yaml
reference_id: MODEL_001
type: character
name: Vietnamese Female Presenter
revision: 3
description: ""
prompt: Woman in her 20s, long black hair, white t-shirt.
settings:
  faceLock: true
  hairLock: true
  outfitLock: true
  identityLock: true
assets:
  - asset_id: asset_5d1c0e7a9b21
    file: assets/prj_01948523c618/asset_5d1c0e7a9b21.jpg
```
## Products
## Styles
## Voices               (settings.voiceName / language / tone)
## Environments
## Media References     (image / video / audio)
````

Imported: frontmatter `project_id`, `project_name`, `space_id`, `space_name`, `target_platform`, `aspect_ratio`, `settings`;
sections `Description`, `Space Description`; every ```yaml block with a `reference_id` under the reference sections
(matched by `reference_id` within the space; new IDs create new profiles).

## MASTER-SCRIPT.md

Frontmatter: `type: master_script`, `project_id`, `space_id`, `master_script_id`, `revision`, `title`, `target_platform`,
`aspect_ratio`, `duration` (seconds), `character_id`, `product_id`, `style_id`, `voice_id`.
Sections: `## Objective`, `## Global Instruction`, `## Script`. All imported.

## STORYBOARD.md (read-only overview)

Frontmatter: `type: storyboard`, `scene_count`, `total_duration`, `scenes: [{scene_id, scene_number, file}]`.
Sections: `## Scenes` (table), `## Scene Summaries`. Not imported — edit the scene files.

## scenes/SCENE-NN.md

```markdown
---
type: scene
version: "1.0"
project_id: prj_01948523c618
space_id: spc_e27a56b8e74d
scene_id: SCENE_001
scene_number: 1
revision: 2
title: Hook
duration: 8
character_id: ""            # empty = inherit from the master script
product_id: ""
style_id: ""
voice_id: ""
resolved_character_id: MODEL_001   # generated
resolved_product_id: PRODUCT_001   # generated
shot_type: medium
camera_movement: Slow push in
location: Bathroom
lighting: soft window light
expression: Tươi tắn, tự nhiên
image_provider: openai-image
video_provider: openai-sora
voice_provider: openai-tts
image_status: SUCCESS              # generated
video_status: NONE                 # generated
voice_status: NONE                 # generated
master_script: ../MASTER-SCRIPT.md
project: ../PROJECT.md
---

# Scene 01 — Hook

## Script
## Action
## Dialogue
## Camera
## Image Prompt
## Video Prompt
## Voice Prompt
## Continuity
## Continuity Rules (generated)
## Final Image Prompt (generated)
## Final Video Prompt (generated)
## Final Voice Instructions (generated)
## Outputs (generated)
```

Imported: all non-generated frontmatter keys and the 8 editable sections. Matched by `scene_id` within the space;
an unknown `scene_id` creates a new scene. A missing section leaves the field unchanged; `_(empty)_` clears it.
With "Delete scenes that have no scene file", scenes without a file are removed.

Prompt sections may use template variables: `{{character}}`, `{{product}}`, `{{scene}}`, `{{camera}}`, `{{style}}`, `{{duration}}`,
`{{dialogue}}`, `{{location}}`, `{{action}}`, `{{expression}}`, `{{lighting}}`, `{{platform}}`, `{{aspectRatio}}`, `{{voice}}`.

## WORKFLOW.md

Frontmatter: `type: workflow`, `workflow_schema_version`, `project_id`, `space_id`, `node_count`, `edge_count`.
Sections:

- `## Description`
- `## Nodes` — table `node_id | type | category | refers_to` (scene code / reference id / asset id / template id)
- `## Dependency Graph` — `- source (Type) → target (Type)`
- `## Execution Order` — numbered topological order (or the cycle that prevents one)
- `## Provider Configuration` — one ```yaml block per generator: `node_id, type, provider, provider_status, model, aspect_ratio, count, duration, voice`
- `## Output Mapping` — node → output ids and paths
- `## Workflow JSON` — ```json block, the full workflow document with scene nodes as `sceneCode` (**authoritative for import**)

Only the `Workflow JSON` block is imported. To change the graph from Markdown, edit that block (add nodes/edges, change `data`).

## PROMPTS.md

`## <Category>` sections, each template as `### <ID> — <Name>` + ```yaml block with
`id, name, category, description, version, variables, template`. Imported by `id`; a changed template creates a new version
(`version` in the file is informational; the app increments it).

## ASSETS.md

Tables of reference assets and generated outputs (paths relative to `data/`), plus `## Asset Data` (```yaml list:
`asset_id, kind, filename, path, mime_type, size`). On import, assets that do not exist in the database are registered only if
the file exists in the local `data/` directory; otherwise a warning is reported. Files are not copied.

## Example: editing with Claude Code

```
> In exports/dau-xa-abc--tiktok-review-60s, make every scene's Video Prompt end with a 1-second hold on the product,
  and change SCENE_003 duration to 10.
```

Then **Import** in the app. The import summary lists created/updated/unchanged items; each updated item gets a new version
("Imported from Markdown"), so you can compare or restore it.
