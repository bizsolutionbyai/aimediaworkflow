import { Bot, CheckCircle2, Download, FolderOpen, LayoutGrid, Play, Plus, Redo2, Save, Settings, Undo2 } from "lucide-react";
import { useState } from "react";
import { runWorkflow, saveWorkflow } from "../actions";
import { useApp } from "../store/app";
import { useCanvas } from "../store/canvas";
import { Button, Select } from "./ui";

export function TopBar() {
  const { projects, spaces, projectId, spaceId, selectProject, selectSpace, setPanel } = useApp();
  const dirty = useCanvas((s) => s.dirty);
  const canUndo = useCanvas((s) => s.past.length > 0);
  const canRedo = useCanvas((s) => s.future.length > 0);
  const [runAll, setRunAll] = useState(false);

  const guard = (fn: () => void) => () => {
    if (useCanvas.getState().dirty && !confirm("You have unsaved canvas changes. Discard them?")) return;
    fn();
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3">
      <div className="mr-2 flex items-center gap-2 font-semibold text-zinc-100">
        <div className="grid h-6 w-6 place-items-center rounded bg-violet-600 text-[11px] font-black">AM</div>
        <span className="hidden xl:inline">AI Media Workflow</span>
      </div>
      <Select
        className="!w-44"
        value={projectId ?? ""}
        onChange={(e) => guard(() => void selectProject(e.target.value || null))()}
        options={[{ value: "", label: "Select project…" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
        title="Project"
      />
      <Select
        className="!w-48"
        value={spaceId ?? ""}
        disabled={!projectId}
        onChange={(e) => guard(() => void selectSpace(e.target.value || null))()}
        options={[{ value: "", label: spaces.length ? "Select space…" : "No spaces" }, ...spaces.map((s) => ({ value: s.id, label: s.name }))]}
        title="Space"
      />
      <Button size="sm" variant="ghost" onClick={() => setPanel("projects")} title="Projects & spaces">
        <Plus size={14} /> New
      </Button>
      <div className="mx-1 h-6 w-px bg-zinc-800" />
      <Button size="sm" variant="ghost" disabled={!canUndo} onClick={() => useCanvas.getState().undo()} title="Undo (Ctrl+Z)">
        <Undo2 size={14} />
      </Button>
      <Button size="sm" variant="ghost" disabled={!canRedo} onClick={() => useCanvas.getState().redo()} title="Redo (Ctrl+Shift+Z / Ctrl+Y)">
        <Redo2 size={14} />
      </Button>
      <Button size="sm" variant="ghost" disabled={!spaceId} onClick={() => useCanvas.getState().layout()} title="Auto-layout (Shift+L)">
        <LayoutGrid size={14} /> Layout
      </Button>
      <div className="flex-1" />
      <Button size="sm" disabled={!spaceId} onClick={() => void saveWorkflow()} title="Save (Ctrl+S)" className={dirty ? "!border-amber-500/60 !text-amber-200" : ""}>
        <Save size={14} /> {dirty ? "Save*" : "Saved"}
      </Button>
      <Button size="sm" disabled={!spaceId} onClick={() => setPanel("check")} title="Consistency check">
        <CheckCircle2 size={14} /> Check
      </Button>
      <div className="flex items-center">
        <Button size="sm" variant="primary" disabled={!spaceId} className="rounded-r-none" onClick={() => void runWorkflow(undefined, runAll ? "all" : "missing")} title="Run workflow (Ctrl+Enter)">
          <Play size={14} /> Run{runAll ? " all" : ""}
        </Button>
        <label className="flex h-7 items-center gap-1 rounded-r-md border border-l-0 border-violet-700 bg-violet-900/40 px-2 text-[11px] text-violet-200" title="Regenerate nodes that already have outputs">
          <input type="checkbox" checked={runAll} onChange={(e) => setRunAll(e.target.checked)} /> force
        </label>
      </div>
      <Button size="sm" disabled={!spaceId} onClick={() => setPanel("export")} title="Export / import Markdown">
        <Download size={14} /> Export MD
      </Button>
      <Button size="sm" onClick={() => setPanel("export")} title="Import Markdown project">
        <FolderOpen size={14} /> Import
      </Button>
      <Button size="sm" disabled={!spaceId} onClick={() => setPanel("assistant")} title="AI Assistant">
        <Bot size={14} /> Assistant
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setPanel("settings")} title="Settings & providers">
        <Settings size={14} />
      </Button>
    </header>
  );
}
