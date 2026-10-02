// Right panel: shows the editor for the current selection (node, scene, reference, prompt, asset).
import { Copy, Play, Trash2 } from "lucide-react";
import { REFERENCE_NODE_TYPE, buildPromptLayers, findUpstreamScene, getNodeTypeDef, resolveNodeProvider } from "@amw/shared";
import { useEffect, useState } from "react";
import { get } from "../../api";
import { reloadCanvas, runWorkflow } from "../../actions";
import { useApp } from "../../store/app";
import { useCanvas } from "../../store/canvas";
import { Badge, Button, Empty, Field, Input, Section, Select, Textarea, statusTone } from "../ui";
import { AssetInfo, MasterScriptEditor, PromptEditor, ReferenceEditor } from "./Editors";
import { OutputsGallery } from "./OutputsGallery";
import { SceneEditor } from "./SceneEditor";
import { Versions } from "./Versions";

export function RightPanel() {
  const selection = useApp((s) => s.selection);
  const bundle = useApp((s) => s.bundle);
  let content: React.ReactNode;
  if (!bundle) content = <Empty>No space open.</Empty>;
  else if (!selection) content = <CanvasInfo />;
  else if (selection.kind === "node") content = <NodeEditor id={selection.id} />;
  else if (selection.kind === "scene") content = <SceneEditor sceneId={selection.id} />;
  else if (selection.kind === "reference") content = <ReferenceEditor id={selection.id} />;
  else if (selection.kind === "masterScript") content = <MasterScriptEditor />;
  else if (selection.kind === "prompt") content = <PromptEditor id={selection.id} />;
  else content = <AssetInfo id={selection.id} />;
  return <aside className="h-full w-[380px] shrink-0 overflow-y-auto border-l border-zinc-800 bg-zinc-950 px-3 py-3">{content}</aside>;
}

function CanvasInfo() {
  const bundle = useApp((s) => s.bundle)!;
  const nodes = useCanvas((s) => s.nodes);
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  useEffect(() => {
    void get<{ id: string | null }>(`/api/spaces/${bundle.space.id}/workflow`).then((r) => setWorkflowId(r.id));
  }, [bundle.space.id]);
  const counts = new Map<string, number>();
  for (const n of nodes) {
    const c = getNodeTypeDef(n.type ?? "")?.category ?? "?";
    counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return (
    <div className="space-y-3">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-sky-300">Space</div>
        <div className="text-base font-semibold">{bundle.space.name}</div>
        <div className="text-zinc-400">{bundle.space.targetPlatform} · {bundle.space.aspectRatio}</div>
      </div>
      <div className="grid grid-cols-4 gap-1 text-center text-[11px]">
        {["input", "ai", "logic", "output"].map((c) => (
          <div key={c} className="rounded border border-zinc-800 p-1.5">
            <div className="text-lg font-semibold">{counts.get(c) ?? 0}</div>
            <div className="text-zinc-500">{c}</div>
          </div>
        ))}
      </div>
      <div className="space-y-1 text-[12px] text-zinc-400">
        <p>Select a node and click <b>Open</b> to edit it. Drag from a node's bottom handle to another node's top handle to connect (data dependency).</p>
        <p>Typical board: References → Master Script → Storyboard → Scenes → Image → Video → Merge → Final Video. Use <b>Scenes → Generate</b> to build it automatically.</p>
      </div>
      {workflowId && <Versions type="workflow" id={workflowId} onRestored={reloadCanvas} />}
    </div>
  );
}

function NodeEditor({ id }: { id: string }) {
  const node = useCanvas((s) => s.nodes.find((n) => n.id === id));
  const { bundle, providers, providerDefaults, run } = useApp();
  const update = useCanvas((s) => s.updateNodeData);
  if (!node || !bundle) return <Empty>Node not found (deleted?).</Empty>;
  const def = getNodeTypeDef(node.type ?? "");
  const d = node.data as Record<string, unknown>;
  const set = (k: string, v: unknown) => update(id, { [k]: v });
  const job = run?.jobs.find((j) => j.nodeId === id);
  const outputs = bundle.outputs.filter((o) => o.nodeId === id);
  const doc = useCanvas.getState().toDoc("", "");
  const upstreamScene = findUpstreamScene(doc, id);
  const scene = upstreamScene && bundle.scenes.find((s) => s.id === upstreamScene.data.sceneId);

  const header = (
    <div className="mb-3 flex items-start justify-between">
      <div>
        <div className="text-[11px] font-bold uppercase tracking-wider text-sky-300">{def?.label ?? node.type}</div>
        <div className="font-mono text-[11px] text-zinc-500">{id}</div>
      </div>
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" title="Duplicate (Ctrl+D)" onClick={() => (useCanvas.getState().selectOnly(id), useCanvas.getState().duplicateSelected())}>
          <Copy size={12} />
        </Button>
        <Button size="sm" variant="ghost" title="Delete (Del)" onClick={() => (useCanvas.getState().selectOnly(id), useCanvas.getState().removeSelected(), useApp.getState().select(null))}>
          <Trash2 size={12} />
        </Button>
      </div>
    </div>
  );

  // Scene node: embed the full Scene Editor.
  if (node.type === "scene") {
    return (
      <div>
        {header}
        <Field label="Scene">
          <Select value={String(d.sceneId ?? "")} onChange={(e) => set("sceneId", e.target.value)} options={[{ value: "", label: "Select scene…" }, ...bundle.scenes.map((s) => ({ value: s.id, label: `${s.code} — ${s.title}` }))]} />
        </Field>
        <div className="mt-3">{d.sceneId ? <SceneEditor sceneId={String(d.sceneId)} /> : <Empty>Pick a scene.</Empty>}</div>
      </div>
    );
  }
  if (node.type === "masterScript") return <div>{header}<MasterScriptEditor /></div>;

  const refTypes = Object.entries(REFERENCE_NODE_TYPE).filter(([, t]) => t === node.type).map(([r]) => r);
  const kind = def?.providerKind;
  const providerOptions = kind ? [{ value: "", label: "(scene / app default)" }, ...providers.filter((p) => p.kind === kind).map((p) => ({ value: p.id, label: `${p.label}${p.configured ? "" : " — not configured"}` }))] : [];
  const resolved = kind ? resolveNodeProvider(doc, { id, type: node.type!, position: node.position, data: d }, bundle.scenes, providerDefaults) : "";
  const resolvedInfo = providers.find((p) => p.id === resolved);
  const promptTarget = node.type === "videoGenerator" ? "video" : node.type === "voiceGenerator" ? "voice" : "image";
  const autoPrompt = scene ? buildPromptLayers({ ...bundle, scene }, promptTarget, { aspectRatio: String(d.aspectRatio ?? ""), duration: Number(d.duration) || undefined }).final : "";

  return (
    <div className="space-y-3">
      {header}
      {job && (
        <div className="rounded border border-zinc-800 p-2 text-[11px]">
          <div className="flex items-center justify-between">
            <span>Last run</span>
            <Badge tone={statusTone(job.status)}>{job.status}</Badge>
          </div>
          {job.error && <div className="mt-1 whitespace-pre-wrap text-red-300">{job.error}</div>}
          {job.logs.length > 0 && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap text-[10px] text-zinc-500">{job.logs.slice(-8).join("\n")}</pre>}
        </div>
      )}

      {refTypes.length > 0 && (
        <Field label="Reference">
          <Select
            value={String(d.referenceCode ?? "")}
            onChange={(e) => set("referenceCode", e.target.value)}
            options={[{ value: "", label: "None" }, ...bundle.references.filter((r) => refTypes.includes(r.type)).map((r) => ({ value: r.code, label: `${r.code} — ${r.name}` }))]}
          />
        </Field>
      )}
      {["imageReference", "videoReference", "audioReference"].includes(node.type!) && (
        <Field label="Asset">
          <Select
            value={String(d.assetId ?? "")}
            onChange={(e) => set("assetId", e.target.value)}
            options={[{ value: "", label: "None" }, ...bundle.assets.filter((a) => node.type!.startsWith(a.kind)).map((a) => ({ value: a.id, label: `${a.filename} (${a.id})` }))]}
          />
        </Field>
      )}
      {node.type === "scriptInput" && <Field label="Text"><Textarea rows={8} value={String(d.text ?? "")} onChange={(e) => set("text", e.target.value)} /></Field>}
      {node.type === "prompt" && (
        <>
          <Field label="Template">
            <Select value={String(d.templateId ?? "")} onChange={(e) => set("templateId", e.target.value)} options={[{ value: "", label: "Inline text" }, ...bundle.prompts.map((p) => ({ value: p.id, label: `${p.id} — ${p.name}` }))]} />
          </Field>
          <Field label="Inline text (overrides template)" hint="Rendered with the upstream scene's variables and appended to downstream generator prompts.">
            <Textarea rows={5} value={String(d.text ?? "")} onChange={(e) => set("text", e.target.value)} placeholder={bundle.prompts.find((p) => p.id === d.templateId)?.template} />
          </Field>
        </>
      )}
      {node.type === "promptGenerator" && <Field label="Target"><Select value={String(d.target ?? "image")} onChange={(e) => set("target", e.target.value)} options={["image", "video", "voice"].map((v) => ({ value: v, label: v }))} /></Field>}
      {node.type === "batch" && <Field label="Count for downstream generators"><Input type="number" min={1} max={10} value={Number(d.count ?? 4)} onChange={(e) => set("count", Number(e.target.value))} /></Field>}
      {node.type === "delay" && <Field label="Seconds"><Input type="number" min={0} value={Number(d.seconds ?? 1)} onChange={(e) => set("seconds", Number(e.target.value))} /></Field>}
      {node.type === "loop" && <Field label="Iterations" hint="Each downstream generator calls its provider this many times (variations)."><Input type="number" min={1} max={20} value={Number(d.iterations ?? 2)} onChange={(e) => set("iterations", Number(e.target.value))} /></Field>}
      {node.type === "condition" && (
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Field label="Check" hint="If false, downstream nodes are skipped.">
            <Select
              value={String(d.check ?? "hasOutputs")}
              onChange={(e) => set("check", e.target.value)}
              options={[
                { value: "hasOutputs", label: "Upstream has outputs" },
                { value: "noOutputs", label: "Upstream has no outputs" },
                { value: "minOutputs", label: "At least N outputs" },
                { value: "hasKind", label: "Has output of kind" },
                { value: "sceneHasDialogue", label: "Scene has dialogue" },
                { value: "sceneDurationAtLeast", label: "Scene duration ≥ N s" },
              ]}
            />
          </Field>
          <Field label="Value"><Input value={String(d.value ?? "")} onChange={(e) => set("value", e.target.value)} placeholder={d.check === "hasKind" ? "image" : "N"} /></Field>
        </div>
      )}
      {node.type === "finalVideo" && (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-zinc-300"><input type="checkbox" checked={d.includeAudio !== false} onChange={(e) => set("includeAudio", e.target.checked)} /> Add each scene's voice-over</label>
          <Field label="Voice vs. clip audio"><Select value={String(d.audioMode ?? "replace")} onChange={(e) => set("audioMode", e.target.value)} options={[{ value: "replace", label: "Replace clip audio with voice" }, { value: "mix", label: "Mix voice with clip audio" }]} /></Field>
          <label className="flex items-center gap-2 text-zinc-300"><input type="checkbox" checked={d.subtitles !== false} onChange={(e) => set("subtitles", e.target.checked)} /> Write .srt subtitles from dialogue</label>
          <label className="flex items-center gap-2 text-zinc-300"><input type="checkbox" checked={!!d.burnSubtitles} onChange={(e) => set("burnSubtitles", e.target.checked)} /> Burn subtitles into the video (needs ffmpeg with libass)</label>
          <Button variant="primary" className="w-full" onClick={() => void runWorkflow([id])}><Play size={14} /> Build final video</Button>
        </div>
      )}
      {node.type === "scriptGenerator" && (
        <>
          <Field label="Brief"><Textarea rows={4} value={String(d.brief ?? "")} onChange={(e) => set("brief", e.target.value)} placeholder="Create a 60 second TikTok product review." /></Field>
          <Field label="LLM provider"><Select value={String(d.provider ?? "")} onChange={(e) => set("provider", e.target.value)} options={[{ value: "", label: "(default)" }, ...providers.filter((p) => p.kind === "llm").map((p) => ({ value: p.id, label: `${p.label}${p.configured ? "" : " — not configured"}` }))]} /></Field>
          <div className="text-[11px] text-zinc-500">Running this node writes a new, versioned master script.</div>
        </>
      )}

      {kind && kind !== "llm" && (
        <>
          <Field label="Provider" hint={resolvedInfo ? (resolvedInfo.configured ? `Using ${resolvedInfo.label}` : `${resolvedInfo.label}: provider not configured (set ${resolvedInfo.envKey} in .env)`) : "Provider not configured"}>
            <Select value={String(d.provider ?? "")} onChange={(e) => set("provider", e.target.value)} options={providerOptions} />
          </Field>
          {(
            <Field label="Model" hint={resolvedInfo ? `Default: ${resolvedInfo.defaultModel}` : undefined}>
              <Input value={String(d.model ?? "")} onChange={(e) => set("model", e.target.value)} placeholder={resolvedInfo?.defaultModel} list={`models-${id}`} />
              <datalist id={`models-${id}`}>{resolvedInfo?.models.map((m) => <option key={m} value={m} />)}</datalist>
            </Field>
          )}
          {(node.type === "imageGenerator" || node.type === "imageEditor" || node.type === "videoGenerator") && (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Aspect ratio"><Select value={String(d.aspectRatio ?? "9:16")} onChange={(e) => set("aspectRatio", e.target.value)} options={["9:16", "16:9", "1:1", "4:5", "3:4"].map((v) => ({ value: v, label: v }))} /></Field>
              {node.type === "videoGenerator" ? (
                <Field label="Duration (s)"><Input type="number" min={1} value={Number(d.duration ?? 8)} onChange={(e) => set("duration", Number(e.target.value))} /></Field>
              ) : (
                <Field label="Count"><Input type="number" min={1} max={10} value={Number(d.count ?? 1)} onChange={(e) => set("count", Number(e.target.value))} /></Field>
              )}
            </div>
          )}
          {node.type === "imageGenerator" && (
            <label className="flex items-center gap-2 text-zinc-300">
              <input type="checkbox" checked={d.useReferenceImages !== false} onChange={(e) => set("useReferenceImages", e.target.checked)} /> Send character/product reference images
            </label>
          )}
          {node.type === "voiceGenerator" && <Field label="Voice" hint="Overrides the voice profile's voice name."><Input value={String(d.voice ?? "")} onChange={(e) => set("voice", e.target.value)} /></Field>}
          {node.type !== "lipSync" && (
            <Field label={node.type === "voiceGenerator" ? "Instructions override" : "Prompt override"} hint={scene ? `Empty = auto-generated from ${scene.code} (layers below).` : "No upstream scene: set a prompt here or connect a Prompt node."}>
              <Textarea rows={4} value={String(d.promptOverride ?? "")} onChange={(e) => set("promptOverride", e.target.value)} placeholder="Auto generated" />
            </Field>
          )}
          {autoPrompt && !d.promptOverride && (
            <details className="rounded border border-zinc-800 p-2 text-[11px]">
              <summary className="cursor-pointer text-zinc-400">Auto-generated prompt</summary>
              <div className="mt-1 whitespace-pre-wrap text-zinc-300">{autoPrompt}</div>
              <Button size="sm" variant="ghost" className="mt-1" onClick={() => set("promptOverride", autoPrompt)}>Edit prompt</Button>
            </details>
          )}
          <Button variant="primary" className="w-full" onClick={() => void runWorkflow([id])}>
            <Play size={14} /> Generate
          </Button>
          <div className="text-[11px] text-zinc-500">Runs this node and its upstream dependencies. Upstream generators that already have outputs are reused.</div>
        </>
      )}

      {(outputs.length > 0 || (def?.outputs.some((o) => ["image", "video", "audio"].includes(o)) ?? false)) && (
        <Section title={`Outputs (${outputs.length})`}>
          <OutputsGallery outputs={outputs} />
        </Section>
      )}
    </div>
  );
}
