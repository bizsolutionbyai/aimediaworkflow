import { useApp } from "../store/app";
import { useCanvas } from "../store/canvas";
import { Badge, statusTone } from "./ui";

export function StatusBar() {
  const { run, providers, bundle, ffmpeg, setPanel } = useApp();
  const nodes = useCanvas((s) => s.nodes.length);
  const edges = useCanvas((s) => s.edges.length);
  const dirty = useCanvas((s) => s.dirty);
  const configured = providers.filter((p) => p.configured).length;
  const done = run?.jobs.filter((j) => j.status !== "PENDING" && j.status !== "RUNNING").length ?? 0;
  return (
    <footer className="flex h-7 shrink-0 items-center gap-4 border-t border-zinc-800 bg-zinc-950 px-3 text-[11px] text-zinc-400">
      <span>{bundle ? `${bundle.project.name} / ${bundle.space.name}` : "No space open"}</span>
      <span>{nodes} nodes · {edges} edges</span>
      <span>{bundle?.scenes.length ?? 0} scenes · {bundle?.references.length ?? 0} references · {bundle?.outputs.length ?? 0} outputs</span>
      <span className={dirty ? "text-amber-300" : ""}>{dirty ? "Unsaved changes" : "All changes saved"}</span>
      <div className="flex-1" />
      {run && (
        <button className="flex items-center gap-1.5 hover:text-zinc-200" onClick={() => setPanel("runlog")}>
          Last run <Badge tone={statusTone(run.run.status)}>{run.run.status}</Badge> {done}/{run.jobs.length} jobs
        </button>
      )}
      <button className="hover:text-zinc-200" onClick={() => setPanel("settings")}>
        Providers: {configured ? <span className="text-emerald-300">{configured} configured</span> : <span className="text-amber-300">none configured</span>} · ffmpeg {ffmpeg ? "✓" : "✕"}
      </button>
      <span className="hidden text-zinc-600 lg:inline">Ctrl+S save · Ctrl+Z/Y undo/redo · Ctrl+C/V/D · Del · Shift+L layout · F fit</span>
    </footer>
  );
}
