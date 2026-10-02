// One compact card component for every node type. Long text is never edited inside the node;
// "Open" shows the full editor in the right panel.
import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { AlertTriangle, AudioLines, Box, Clapperboard, FileText, Film, GitMerge, Image as ImageIcon, Layers, Mic, Sparkles, User, Workflow } from "lucide-react";
import { getNodeTypeDef, resolveNodeProvider, resolveSceneRefs, type Output } from "@amw/shared";
import { fileUrl } from "../../api";
import { useApp } from "../../store/app";
import { useCanvas } from "../../store/canvas";
import { Badge, cx, statusTone } from "../ui";

const CAT_STYLE: Record<string, string> = {
  input: "border-sky-500/50",
  ai: "border-violet-500/60",
  logic: "border-amber-500/50",
  output: "border-emerald-500/50",
};
const CAT_HEAD: Record<string, string> = {
  input: "bg-sky-500/10 text-sky-300",
  ai: "bg-violet-500/10 text-violet-300",
  logic: "bg-amber-500/10 text-amber-300",
  output: "bg-emerald-500/10 text-emerald-300",
};

function icon(type: string) {
  if (type === "scene") return <Clapperboard size={13} />;
  if (type === "characterReference") return <User size={13} />;
  if (type === "productReference") return <Box size={13} />;
  if (type.startsWith("image")) return <ImageIcon size={13} />;
  if (type.startsWith("video") || type === "finalVideo" || type === "lipSync") return <Film size={13} />;
  if (type.startsWith("voice") || type.startsWith("audio")) return <Mic size={13} />;
  if (type === "masterScript" || type === "scriptInput" || type === "scriptGenerator") return <FileText size={13} />;
  if (type === "merge") return <GitMerge size={13} />;
  if (type === "storyboardGenerator") return <Layers size={13} />;
  if (type === "prompt" || type === "promptGenerator") return <Sparkles size={13} />;
  return <Workflow size={13} />;
}

function Preview({ output }: { output: Output }) {
  if (output.kind === "image") return <img src={fileUrl(output.path)} className="mt-1.5 h-24 w-full rounded object-cover" alt="" />;
  if (output.kind === "video") return <video src={fileUrl(output.path)} className="mt-1.5 h-24 w-full rounded bg-black object-cover" muted preload="metadata" />;
  return (
    <div className="mt-1.5 flex items-center gap-1 rounded bg-zinc-800 px-2 py-1 text-zinc-300">
      <AudioLines size={12} /> audio
    </div>
  );
}

const mark = (s: string) => (s === "SUCCESS" ? "✓" : s === "FAILED" ? "✕" : s === "RUNNING" ? "…" : s === "PENDING" ? "◷" : "○");

function WorkflowNodeImpl({ id, type, data, selected }: NodeProps) {
  const def = getNodeTypeDef(type);
  const bundle = useApp((s) => s.bundle);
  const providers = useApp((s) => s.providers);
  const defaults = useApp((s) => s.providerDefaults);
  const job = useApp((s) => s.run?.jobs.find((j) => j.nodeId === id));
  const select = useApp((s) => s.select);
  const d = data as Record<string, unknown>;
  const category = def?.category ?? "logic";
  // Provider shown on generator nodes: explicit node setting, else the upstream scene's provider.
  const pid = useCanvas((s) =>
    def?.providerKind && bundle
      ? resolveNodeProvider(
          { version: "1.0", projectId: "", spaceId: "", nodes: s.nodes.map((n) => ({ id: n.id, type: n.type ?? "", position: n.position, data: n.data as Record<string, unknown> })), edges: s.edges },
          { id, type, position: { x: 0, y: 0 }, data: d },
          bundle.scenes,
          defaults,
        )
      : "",
  );

  const outputs = (bundle?.outputs ?? []).filter((o) => o.nodeId === id);
  const preview = outputs.find((o) => o.selected) ?? outputs[0];
  let body: React.ReactNode = <div className="text-zinc-500">{def?.description}</div>;

  if (type === "scene") {
    const scene = bundle?.scenes.find((s) => s.id === d.sceneId);
    if (!scene) body = <div className="flex items-center gap-1 text-red-300"><AlertTriangle size={12} /> Scene missing</div>;
    else {
      const refs = resolveSceneRefs(scene, bundle!.masterScript);
      body = (
        <div className="space-y-0.5">
          <div className="text-[13px] font-semibold text-zinc-100">{scene.title || "(untitled)"}</div>
          <div className="text-zinc-400">{scene.duration ? `${scene.duration} sec` : <span className="text-amber-300">no duration</span>}</div>
          <div className="text-zinc-400">Character: <span className="text-zinc-200">{refs.character || "–"}</span></div>
          <div className="text-zinc-400">Product: <span className="text-zinc-200">{refs.product || "–"}</span></div>
          <div className="flex gap-3 pt-0.5 text-zinc-300">
            <span>Image {mark(scene.imageStatus)}</span>
            <span>Video {mark(scene.videoStatus)}</span>
            <span>Voice {mark(scene.voiceStatus)}</span>
          </div>
        </div>
      );
    }
  } else if (["characterReference", "productReference", "styleReference", "voiceReference", "imageReference", "videoReference", "audioReference"].includes(type)) {
    const ref = bundle?.references.find((r) => r.code === d.referenceCode);
    const asset = bundle?.assets.find((a) => a.id === (d.assetId || ref?.assetIds[0]));
    body = (
      <div>
        <div className="font-semibold text-zinc-100">{ref ? ref.code : d.assetId ? String(d.assetId) : <span className="text-amber-300">not set</span>}</div>
        {ref && <div className="truncate text-zinc-400">{ref.name}</div>}
        {asset?.kind === "image" && <img src={fileUrl(asset.path)} className="mt-1.5 h-20 w-full rounded object-cover" alt="" />}
        {ref && <div className="mt-1 text-zinc-500">{ref.assetIds.length} file(s)</div>}
      </div>
    );
  } else if (type === "masterScript") {
    const ms = bundle?.masterScript;
    body = ms ? (
      <div>
        <div className="font-semibold text-zinc-100">{ms.title || "(untitled)"}</div>
        <div className="text-zinc-400">{ms.duration}s · {ms.aspectRatio} · {ms.targetPlatform}</div>
        <div className="text-zinc-400">{ms.characterId || "–"} · {ms.productId || "–"}</div>
      </div>
    ) : (
      <div className="text-amber-300">No master script yet</div>
    );
  } else if (type === "storyboardGenerator") {
    body = <div className="text-zinc-300">{bundle?.scenes.length ?? 0} scenes</div>;
  } else if (def?.providerKind && def.providerKind !== "llm") {
    const p = providers.find((x) => x.id === pid);
    body = (
      <div className="space-y-0.5">
        {p?.configured ? (
          <div className="text-zinc-200">{p.label}</div>
        ) : (
          <div className="flex items-center gap-1 text-amber-300"><AlertTriangle size={12} /> {p ? `${p.label}: not configured` : "Provider not configured"}</div>
        )}
        <div className="text-zinc-400">
          {[d.aspectRatio, d.count && `×${d.count}`, d.duration && `${d.duration}s`].filter(Boolean).join(" · ")}
        </div>
        {preview && <Preview output={preview} />}
        {outputs.length > 1 && <div className="text-zinc-500">{outputs.length} outputs</div>}
      </div>
    );
  } else if (type === "prompt") {
    const tpl = bundle?.prompts.find((p) => p.id === d.templateId);
    body = <div className="line-clamp-3 text-zinc-300">{tpl ? tpl.id : String(d.text || "Empty prompt")}</div>;
  } else if (type === "batch") body = <div className="text-zinc-300">count = {String(d.count)}</div>;
  else if (type === "delay") body = <div className="text-zinc-300">{String(d.seconds)}s</div>;
  else if (["merge", "imageOutput", "videoOutput", "audioOutput", "finalVideo"].includes(type)) {
    body = (
      <div>
        <div className="text-zinc-400">{def?.description}</div>
        {preview && <Preview output={preview} />}
      </div>
    );
  }

  return (
    <div className={cx("w-[220px] rounded-lg border bg-zinc-900/95 shadow-lg", CAT_STYLE[category], selected && "ring-2 ring-violet-400")}>
      {def && def.inputs.length > 0 && <Handle type="target" position={Position.Top} />}
      <div className={cx("flex items-center justify-between gap-2 rounded-t-lg px-2.5 py-1.5", CAT_HEAD[category])}>
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide">
          {icon(type)}
          <span className="truncate">{type === "scene" ? `Scene ${String(bundle?.scenes.find((s) => s.id === d.sceneId)?.sceneNumber ?? "?").padStart(2, "0")}` : def?.label ?? type}</span>
        </div>
        {job && <Badge tone={statusTone(job.status)}>{job.status}</Badge>}
      </div>
      <div className="px-2.5 py-2">{body}</div>
      <div className="flex items-center justify-between border-t border-zinc-800 px-2.5 py-1">
        <span className="truncate font-mono text-[10px] text-zinc-500">{id}</span>
        <button className="nodrag rounded px-1.5 text-[11px] font-semibold text-violet-300 hover:bg-violet-500/20" onClick={() => select({ kind: "node", id })}>
          Open
        </button>
      </div>
      {def && def.outputs.length > 0 && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

export const WorkflowNode = memo(WorkflowNodeImpl);
