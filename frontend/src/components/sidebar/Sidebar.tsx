// Left sidebar: Assets, Characters, Products, Styles & Voices, Scripts, Scenes, Prompts, Nodes, Providers.
import { useRef, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { ArrowDown, ArrowUp, Box, Clapperboard, Copy, FileText, Image as ImageIcon, Layers, Palette, Plug, Plus, Sparkles, Trash2, Upload, User, Workflow } from "lucide-react";
import { NODE_TYPES, PROMPT_CATEGORIES, REFERENCE_NODE_TYPE, type Reference, type ReferenceType } from "@amw/shared";
import { del, fileUrl, post } from "../../api";
import { errorText, reloadCanvas, saveWorkflow } from "../../actions";
import { useApp } from "../../store/app";
import { useCanvas } from "../../store/canvas";
import { Badge, Button, Empty, cx, statusTone } from "../ui";

type Tab = "assets" | "characters" | "products" | "styles" | "scripts" | "scenes" | "prompts" | "nodes" | "providers";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "assets", label: "Assets", icon: <ImageIcon size={16} /> },
  { id: "characters", label: "Characters", icon: <User size={16} /> },
  { id: "products", label: "Products", icon: <Box size={16} /> },
  { id: "styles", label: "Styles, Voices & Env", icon: <Palette size={16} /> },
  { id: "scripts", label: "Scripts", icon: <FileText size={16} /> },
  { id: "scenes", label: "Scenes", icon: <Clapperboard size={16} /> },
  { id: "prompts", label: "Prompts", icon: <Sparkles size={16} /> },
  { id: "nodes", label: "Nodes", icon: <Workflow size={16} /> },
  { id: "providers", label: "Providers", icon: <Plug size={16} /> },
];

function useAddToCanvas() {
  const rf = useReactFlow();
  const select = useApp((s) => s.select);
  return (type: string, data?: Record<string, unknown>) => {
    const center = rf.screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    const jitter = () => Math.round((Math.random() - 0.5) * 120);
    const id = useCanvas.getState().addNode(type, { x: center.x - 110 + jitter(), y: center.y - 60 + jitter() }, data);
    select({ kind: "node", id });
  };
}

function dragProps(type: string, data?: Record<string, unknown>) {
  return {
    draggable: true,
    onDragStart: (e: React.DragEvent) => {
      e.dataTransfer.setData("application/amw-node", JSON.stringify({ type, data }));
      e.dataTransfer.effectAllowed = "copy";
    },
  };
}

export function Sidebar() {
  const [tab, setTab] = useState<Tab>("scenes");
  const spaceId = useApp((s) => s.spaceId);
  return (
    <aside className="flex h-full shrink-0 border-r border-zinc-800 bg-zinc-950">
      <nav className="flex w-11 flex-col items-center gap-1 border-r border-zinc-800 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            title={t.label}
            onClick={() => setTab(t.id)}
            className={cx("grid h-9 w-9 place-items-center rounded-md", tab === t.id ? "bg-violet-600/25 text-violet-200" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100")}
          >
            {t.icon}
          </button>
        ))}
      </nav>
      <div className="flex w-64 flex-col">
        <div className="border-b border-zinc-800 px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-zinc-300">{TABS.find((t) => t.id === tab)?.label}</div>
        <div className="flex-1 space-y-2 overflow-y-auto p-2">
          {!spaceId && tab !== "providers" && tab !== "prompts" ? (
            <Empty>Create or open a project and space first.</Empty>
          ) : tab === "assets" ? (
            <AssetsTab />
          ) : tab === "characters" ? (
            <ReferencesTab types={["character"]} />
          ) : tab === "products" ? (
            <ReferencesTab types={["product"]} />
          ) : tab === "styles" ? (
            <ReferencesTab types={["style", "voice", "environment", "image", "video", "audio"]} />
          ) : tab === "scripts" ? (
            <ScriptsTab />
          ) : tab === "scenes" ? (
            <ScenesTab />
          ) : tab === "prompts" ? (
            <PromptsTab />
          ) : tab === "nodes" ? (
            <NodesTab />
          ) : (
            <ProvidersTab />
          )}
        </div>
      </div>
    </aside>
  );
}

function AssetsTab() {
  const { bundle, projectId, spaceId, refreshBundle, toast, select } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const add = useAddToCanvas();
  const upload = async (files: FileList | null) => {
    if (!files?.length || !projectId) return;
    const form = new FormData();
    form.set("spaceId", spaceId ?? "");
    for (const f of Array.from(files)) form.append("file", f, f.name);
    try {
      await post(`/api/projects/${projectId}/assets`, form);
      await refreshBundle();
      toast("success", `Uploaded ${files.length} file(s)`);
    } catch (e) {
      toast("error", errorText(e));
    }
  };
  const assets = bundle?.assets ?? [];
  return (
    <>
      <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" className="hidden" onChange={(e) => void upload(e.target.files).finally(() => (e.target.value = ""))} />
      <Button className="w-full" onClick={() => fileRef.current?.click()}>
        <Upload size={14} /> Upload files
      </Button>
      {!assets.length && <Empty>No assets. Upload reference images, videos or audio.</Empty>}
      <div className="grid grid-cols-2 gap-2">
        {assets.map((a) => {
          const type = a.kind === "video" ? "videoReference" : a.kind === "audio" ? "audioReference" : "imageReference";
          return (
            <div key={a.id} className="group relative overflow-hidden rounded-md border border-zinc-800 bg-zinc-900" {...dragProps(type, { assetId: a.id })} onClick={() => select({ kind: "asset", id: a.id })}>
              {a.kind === "image" ? (
                <img src={fileUrl(a.path)} className="h-20 w-full object-cover" alt={a.filename} />
              ) : a.kind === "video" ? (
                <video src={fileUrl(a.path)} className="h-20 w-full bg-black object-cover" muted preload="metadata" />
              ) : (
                <div className="grid h-20 place-items-center text-zinc-500">{a.kind}</div>
              )}
              <div className="truncate px-1.5 py-1 text-[10px] text-zinc-400" title={`${a.filename} (${a.id})`}>{a.filename}</div>
              <div className="absolute right-1 top-1 hidden gap-1 group-hover:flex">
                <button className="rounded bg-black/70 p-1 text-zinc-200" title="Add to canvas" onClick={(e) => (e.stopPropagation(), add(type, { assetId: a.id }))}>
                  <Plus size={12} />
                </button>
                <button
                  className="rounded bg-black/70 p-1 text-red-300"
                  title="Delete asset"
                  onClick={async (e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete ${a.filename}?`)) return;
                    await del(`/api/assets/${a.id}`);
                    await refreshBundle();
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function ReferencesTab({ types }: { types: ReferenceType[] }) {
  const { bundle, spaceId, refreshBundle, select, selection, toast } = useApp();
  const add = useAddToCanvas();
  const refs = (bundle?.references ?? []).filter((r) => types.includes(r.type));
  const create = async (type: ReferenceType) => {
    try {
      const r = await post<Reference>(`/api/spaces/${spaceId}/references`, { type, name: `New ${type}` });
      await refreshBundle();
      select({ kind: "reference", id: r.id });
    } catch (e) {
      toast("error", errorText(e));
    }
  };
  return (
    <>
      <div className="flex flex-wrap gap-1">
        {types.slice(0, 3).map((t) => (
          <Button key={t} size="sm" onClick={() => void create(t)}>
            <Plus size={12} /> {t}
          </Button>
        ))}
        {types.length > 3 && (
          <select className="h-7 rounded-md border border-zinc-700 bg-zinc-800 px-1 text-xs" value="" onChange={(e) => e.target.value && void create(e.target.value as ReferenceType)}>
            <option value="">+ other…</option>
            {types.slice(3).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
      </div>
      {!refs.length && <Empty>No {types[0]} profiles yet.</Empty>}
      {refs.map((r) => {
        const asset = bundle?.assets.find((a) => a.id === r.assetIds[0]);
        const active = selection?.kind === "reference" && selection.id === r.id;
        return (
          <div
            key={r.id}
            {...dragProps(REFERENCE_NODE_TYPE[r.type], { referenceCode: r.code })}
            onClick={() => select({ kind: "reference", id: r.id })}
            className={cx("flex cursor-pointer gap-2 rounded-md border p-2", active ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 bg-zinc-900 hover:border-zinc-600")}
          >
            {asset?.kind === "image" ? <img src={fileUrl(asset.path)} className="h-12 w-12 rounded object-cover" alt="" /> : <div className="grid h-12 w-12 place-items-center rounded bg-zinc-800 text-zinc-500"><User size={16} /></div>}
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[11px] font-semibold text-violet-300">{r.code}</div>
              <div className="truncate text-zinc-200">{r.name}</div>
              <div className="text-[10px] text-zinc-500">{r.type} · {r.assetIds.length} file(s)</div>
            </div>
            <button className="self-start text-zinc-500 hover:text-zinc-100" title="Add to canvas" onClick={(e) => (e.stopPropagation(), add(REFERENCE_NODE_TYPE[r.type], { referenceCode: r.code }))}>
              <Plus size={14} />
            </button>
          </div>
        );
      })}
    </>
  );
}

function ScriptsTab() {
  const { bundle, select } = useApp();
  const add = useAddToCanvas();
  const ms = bundle?.masterScript;
  return (
    <>
      <div className="cursor-pointer rounded-md border border-zinc-800 bg-zinc-900 p-2 hover:border-zinc-600" onClick={() => select({ kind: "masterScript" })} {...dragProps("masterScript")}>
        <div className="text-[11px] font-bold uppercase text-sky-300">Master Script</div>
        {ms ? (
          <>
            <div className="mt-1 font-semibold text-zinc-100">{ms.title || "(untitled)"}</div>
            <div className="text-zinc-400">{ms.duration}s · {ms.aspectRatio} · v{ms.version}</div>
            <div className="mt-1 line-clamp-4 whitespace-pre-wrap text-[11px] text-zinc-500">{ms.scriptText}</div>
          </>
        ) : (
          <div className="mt-1 text-zinc-400">Not written yet — click to create.</div>
        )}
      </div>
      <Button className="w-full" onClick={() => select({ kind: "masterScript" })}>
        <FileText size={14} /> Open Master Script editor
      </Button>
      <Button className="w-full" variant="ghost" onClick={() => add("masterScript")}>
        <Plus size={14} /> Add Master Script node
      </Button>
      <Button className="w-full" variant="ghost" onClick={() => add("scriptInput")}>
        <Plus size={14} /> Add Script Input node
      </Button>
    </>
  );
}

function ScenesTab() {
  const { bundle, spaceId, refreshBundle, select, selection, toast } = useApp();
  const add = useAddToCanvas();
  const scenes = bundle?.scenes ?? [];
  const nodes = useCanvas((s) => s.nodes);
  const generate = async (mode: "replace" | "append") => {
    if (useCanvas.getState().dirty && !confirm("Unsaved canvas changes will be replaced by the generated board. Continue?")) return;
    try {
      const r = await post<{ scenes: unknown[] }>(`/api/spaces/${spaceId}/storyboard`, { mode });
      await reloadCanvas();
      toast("success", `Storyboard: ${r.scenes.length} scene(s)`);
    } catch (e) {
      toast("error", errorText(e));
    }
  };
  const move = async (i: number, dir: -1 | 1) => {
    const ids = scenes.map((s) => s.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await post(`/api/spaces/${spaceId}/scenes/reorder`, { ids });
    await refreshBundle();
  };
  return (
    <>
      <div className="grid grid-cols-2 gap-1">
        <Button size="sm" onClick={() => void generate("replace")} title="Split the master script into scenes and build the production board">
          <Layers size={12} /> Generate
        </Button>
        <Button
          size="sm"
          onClick={async () => {
            const s = await post<{ id: string }>(`/api/spaces/${spaceId}/scenes`, {});
            await refreshBundle();
            select({ kind: "scene", id: s.id });
          }}
        >
          <Plus size={12} /> Scene
        </Button>
      </div>
      {!scenes.length && <Empty>No scenes. Write the master script, then Generate (Storyboard Generator), or add scenes manually.</Empty>}
      {scenes.map((s, i) => {
        const onCanvas = nodes.some((n) => n.type === "scene" && n.data.sceneId === s.id);
        const active = selection?.kind === "scene" && selection.id === s.id;
        return (
          <div
            key={s.id}
            {...dragProps("scene", { sceneId: s.id })}
            onClick={() => select({ kind: "scene", id: s.id })}
            className={cx("group cursor-pointer rounded-md border p-2", active ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 bg-zinc-900 hover:border-zinc-600")}
          >
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold text-sky-300">SCENE {String(s.sceneNumber).padStart(2, "0")}</span>
              <span className="font-mono text-[10px] text-zinc-500">{s.code}</span>
            </div>
            <div className="truncate font-semibold text-zinc-100">{s.title}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-zinc-400">
              <span>{s.duration}s</span>
              <Badge tone={statusTone(s.imageStatus)}>IMG</Badge>
              <Badge tone={statusTone(s.videoStatus)}>VID</Badge>
              <Badge tone={statusTone(s.voiceStatus)}>VOX</Badge>
              {!onCanvas && <Badge tone="amber">not on canvas</Badge>}
            </div>
            <div className="mt-1 hidden gap-1 group-hover:flex">
              <button className="rounded p-0.5 text-zinc-400 hover:text-zinc-100" title="Move up" onClick={(e) => (e.stopPropagation(), void move(i, -1))}><ArrowUp size={12} /></button>
              <button className="rounded p-0.5 text-zinc-400 hover:text-zinc-100" title="Move down" onClick={(e) => (e.stopPropagation(), void move(i, 1))}><ArrowDown size={12} /></button>
              <button className="rounded p-0.5 text-zinc-400 hover:text-zinc-100" title="Add to canvas" onClick={(e) => (e.stopPropagation(), add("scene", { sceneId: s.id }))}><Plus size={12} /></button>
              <button
                className="rounded p-0.5 text-zinc-400 hover:text-zinc-100"
                title="Duplicate scene"
                onClick={async (e) => {
                  e.stopPropagation();
                  await post(`/api/scenes/${s.id}/duplicate`);
                  await refreshBundle();
                }}
              >
                <Copy size={12} />
              </button>
              <button
                className="rounded p-0.5 text-red-400 hover:text-red-200"
                title="Delete scene"
                onClick={async (e) => {
                  e.stopPropagation();
                  if (!confirm(`Delete ${s.code}? Its canvas node is removed too.`)) return;
                  if (useCanvas.getState().dirty) await saveWorkflow();
                  await del(`/api/scenes/${s.id}`);
                  await reloadCanvas();
                }}
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        );
      })}
    </>
  );
}

function PromptsTab() {
  const { bundle, select, selection, refreshBundle, toast } = useApp();
  const add = useAddToCanvas();
  const [cat, setCat] = useState("");
  const prompts = (bundle?.prompts ?? []).filter((p) => !cat || p.category === cat);
  return (
    <>
      <div className="flex gap-1">
        <select className="h-7 flex-1 rounded-md border border-zinc-700 bg-zinc-800 px-1 text-xs" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {PROMPT_CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <Button
          size="sm"
          onClick={async () => {
            const id = prompt("Template id (e.g. CINEMATIC_V2)");
            if (!id) return;
            try {
              const p = await post<{ id: string }>("/api/prompts", { id, name: id, category: cat || "Cinematic", template: "" });
              await refreshBundle();
              select({ kind: "prompt", id: p.id });
            } catch (e) {
              toast("error", errorText(e));
            }
          }}
        >
          <Plus size={12} /> New
        </Button>
      </div>
      {!bundle && <Empty>Open a space to see the prompt library.</Empty>}
      {prompts.map((p) => (
        <div
          key={p.id}
          {...dragProps("prompt", { templateId: p.id })}
          onClick={() => select({ kind: "prompt", id: p.id })}
          className={cx("cursor-pointer rounded-md border p-2", selection?.kind === "prompt" && selection.id === p.id ? "border-violet-500 bg-violet-500/10" : "border-zinc-800 bg-zinc-900 hover:border-zinc-600")}
        >
          <div className="flex items-center justify-between gap-1">
            <span className="truncate font-mono text-[10px] font-semibold text-violet-300">{p.id}</span>
            <span className="text-[10px] text-zinc-500">v{p.version}</span>
          </div>
          <div className="truncate text-zinc-200">{p.name}</div>
          <div className="flex items-center justify-between text-[10px] text-zinc-500">
            {p.category}
            <button className="text-zinc-400 hover:text-zinc-100" title="Add to canvas" onClick={(e) => (e.stopPropagation(), add("prompt", { templateId: p.id }))}>
              <Plus size={12} />
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

function NodesTab() {
  const add = useAddToCanvas();
  const cats = ["input", "ai", "logic", "output"] as const;
  const labels = { input: "Input", ai: "AI", logic: "Logic", output: "Output" };
  return (
    <>
      <div className="text-[11px] text-zinc-500">Click to add, or drag onto the canvas.</div>
      {cats.map((c) => (
        <div key={c} className="space-y-1">
          <div className="pt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">{labels[c]}</div>
          {NODE_TYPES.filter((d) => d.category === c).map((d) => (
            <button key={d.type} {...dragProps(d.type)} onClick={() => add(d.type)} className="block w-full rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-left hover:border-zinc-600" title={d.description}>
              <div className="text-zinc-100">{d.label}</div>
              <div className="truncate text-[10px] text-zinc-500">{d.description}</div>
            </button>
          ))}
        </div>
      ))}
    </>
  );
}

function ProvidersTab() {
  const { providers, ffmpeg } = useApp();
  const kinds = ["image", "video", "voice", "llm"] as const;
  return (
    <>
      <div className="text-[11px] text-zinc-500">Providers are configured with API keys in the local <code>.env</code> file (restart after editing). Keys are never shown or exported.</div>
      {kinds.map((k) => (
        <div key={k} className="space-y-1">
          <div className="pt-1 text-[10px] font-bold uppercase tracking-wider text-zinc-500">{k === "llm" ? "Assistant (LLM)" : k}</div>
          {providers.filter((p) => p.kind === k).map((p) => (
            <div key={p.id} className="rounded-md border border-zinc-800 bg-zinc-900 p-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-100">{p.label}</span>
                {p.configured ? <Badge tone="green">configured</Badge> : <Badge tone="amber">not configured</Badge>}
              </div>
              <div className="font-mono text-[10px] text-zinc-500">{p.id} · {p.envKey}</div>
              <div className="text-[10px] text-zinc-500">model: {p.defaultModel}</div>
            </div>
          ))}
        </div>
      ))}
      <div className="rounded-md border border-zinc-800 bg-zinc-900 p-2">
        ffmpeg (Final Video): {ffmpeg ? <Badge tone="green">found</Badge> : <Badge tone="amber">not found</Badge>}
      </div>
    </>
  );
}
