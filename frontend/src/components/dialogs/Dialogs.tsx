// Modal dialogs: projects/spaces, consistency check, Markdown export/import, settings, run log.
import { useEffect, useRef, useState } from "react";
import { FolderOpen, RefreshCw, Trash2 } from "lucide-react";
import type { CheckItem, Project } from "@amw/shared";
import { del, get, patch, post } from "../../api";
import { checkWorkflow, errorText, lastCheck, reloadCanvas } from "../../actions";
import { cancelRun, useApp } from "../../store/app";
import { useCanvas } from "../../store/canvas";
import { Badge, Button, Empty, Field, Input, Modal, Section, Select, statusTone } from "../ui";

export function ProjectsDialog() {
  const { projects, spaces, projectId, loadProjects, selectProject, selectSpace, setPanel, toast } = useApp();
  const [pName, setPName] = useState("");
  const [pDesc, setPDesc] = useState("");
  const [sName, setSName] = useState("");
  const [platform, setPlatform] = useState("TikTok");
  const [aspect, setAspect] = useState("9:16");
  const close = () => setPanel("none");
  const createProject = async () => {
    try {
      const p = await post<Project>("/api/projects", { name: pName, description: pDesc });
      setPName("");
      setPDesc("");
      await loadProjects();
      await selectProject(p.id);
      toast("success", `Project "${p.name}" created — now create a space`);
    } catch (e) {
      toast("error", errorText(e));
    }
  };
  const createSpace = async () => {
    if (!projectId) return;
    try {
      const s = await post<{ id: string }>(`/api/projects/${projectId}/spaces`, { name: sName, targetPlatform: platform, aspectRatio: aspect });
      setSName("");
      await selectProject(projectId);
      await selectSpace(s.id);
      await reloadCanvas();
      close();
    } catch (e) {
      toast("error", errorText(e));
    }
  };
  return (
    <Modal title="Projects & Spaces" onClose={close}>
      <div className="grid grid-cols-2 gap-6">
        <div className="space-y-3">
          <h3 className="font-semibold">1. Project</h3>
          <Field label="Name"><Input value={pName} onChange={(e) => setPName(e.target.value)} placeholder="Dầu xả ABC" /></Field>
          <Field label="Description"><Input value={pDesc} onChange={(e) => setPDesc(e.target.value)} /></Field>
          <Button variant="primary" disabled={!pName.trim()} onClick={() => void createProject()}>Create project</Button>
          <Section title="Existing projects">
            {!projects.length && <Empty>No projects yet.</Empty>}
            {projects.map((p) => (
              <div key={p.id} className={`flex items-center justify-between rounded border px-2 py-1 ${p.id === projectId ? "border-violet-500" : "border-zinc-800"}`}>
                <button className="flex-1 text-left" onClick={() => void selectProject(p.id)}>{p.name}</button>
                <button
                  className="text-zinc-500 hover:text-red-300"
                  title="Delete project"
                  onClick={async () => {
                    if (!confirm(`Delete project "${p.name}" and all its spaces? Files in data/ are kept.`)) return;
                    await del(`/api/projects/${p.id}`);
                    await loadProjects();
                    if (p.id === projectId) await selectProject(null);
                  }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </Section>
        </div>
        <div className="space-y-3">
          <h3 className="font-semibold">2. Space <span className="text-xs font-normal text-zinc-500">(one video or video set)</span></h3>
          {!projectId ? (
            <Empty>Create or select a project first.</Empty>
          ) : (
            <>
              <Field label="Name"><Input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Review dầu xả ABC - TikTok 60s" /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Platform"><Input value={platform} onChange={(e) => setPlatform(e.target.value)} /></Field>
                <Field label="Aspect"><Select value={aspect} onChange={(e) => setAspect(e.target.value)} options={["9:16", "16:9", "1:1", "4:5"].map((v) => ({ value: v, label: v }))} /></Field>
              </div>
              <Button variant="primary" disabled={!sName.trim()} onClick={() => void createSpace()}>Create space</Button>
              <Section title="Spaces in this project">
                {!spaces.length && <Empty>No spaces yet.</Empty>}
                {spaces.map((s) => (
                  <button key={s.id} className="block w-full rounded border border-zinc-800 px-2 py-1 text-left hover:border-zinc-600" onClick={() => (void selectSpace(s.id).then(reloadCanvas), close())}>
                    {s.name} <span className="text-zinc-500">· {s.targetPlatform} {s.aspectRatio}</span>
                  </button>
                ))}
              </Section>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

const ICON = { ok: "✓", warning: "⚠", error: "✕" } as const;
const COLOR = { ok: "text-emerald-300", warning: "text-amber-300", error: "text-red-300" } as const;

export function CheckDialog() {
  const { setPanel, select } = useApp();
  const [report, setReport] = useState<{ items: CheckItem[]; errors: number; warnings: number; blocking?: { message: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      setReport(await checkWorkflow());
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    // Opened after a blocked run: show the blocking errors first, then re-check (saved state).
    if (lastCheck?.blocking) setReport(lastCheck);
    else void run();
  }, []);
  return (
    <Modal title="Workflow check" onClose={() => setPanel("none")}>
      <div className="mb-3 flex items-center justify-between">
        <div className="text-zinc-400">
          {report ? `${report.errors} error(s), ${report.warnings} warning(s)` : "Checking…"} {useCanvas.getState().dirty && <span className="text-amber-300">· canvas has unsaved changes (checks use the saved workflow)</span>}
        </div>
        <Button size="sm" onClick={() => void run()} disabled={busy}><RefreshCw size={12} /> Re-check</Button>
      </div>
      {report?.blocking && (
        <div className="mb-3 rounded border border-red-500/40 bg-red-500/10 p-2">
          <div className="font-semibold text-red-300">Run blocked by:</div>
          {report.blocking.map((b, i) => <div key={i} className="text-red-200">✕ {b.message}</div>)}
        </div>
      )}
      <div className="space-y-0.5 font-mono text-[12px]">
        <div className="font-bold">WORKFLOW CHECK</div>
        {report?.items.map((i, k) => (
          <button
            key={k}
            className={`block w-full text-left hover:bg-zinc-800 ${COLOR[i.level]}`}
            onClick={() => {
              if (i.nodeId) {
                useCanvas.getState().selectOnly(i.nodeId);
                select({ kind: "node", id: i.nodeId });
                setPanel("none");
              } else if (i.sceneId) {
                select({ kind: "scene", id: i.sceneId });
                setPanel("none");
              }
            }}
          >
            {ICON[i.level]} {i.level === "ok" ? i.subject : i.message}
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function ExportDialog() {
  const { spaceId, setPanel, toast, loadProjects, selectProject, selectSpace, refreshBundle } = useApp();
  const [result, setResult] = useState<{ folder: string; dir: string; absoluteDir: string; files: string[]; mediaCount?: number } | null>(null);
  const [exportsList, setExportsList] = useState<{ folder: string; modifiedAt: string }[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [removeMissing, setRemoveMissing] = useState(false);
  const [includeMedia, setIncludeMedia] = useState(true);
  const [busy, setBusy] = useState(false);
  const dirRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    void get<typeof exportsList>("/api/exports").then(setExportsList);
    dirRef.current?.setAttribute("webkitdirectory", "");
  }, [result]);

  const afterImport = async (s: any) => {
    setSummary(s);
    await loadProjects();
    if (s.spaceId !== spaceId) {
      await selectProject(s.projectId);
      await selectSpace(s.spaceId);
    }
    await reloadCanvas();
    await refreshBundle();
    toast("success", `Imported: ${s.created.length} created, ${s.updated.length} updated`);
  };
  const importFolder = async (folder: string) => {
    if (useCanvas.getState().dirty && !confirm("Unsaved canvas changes will be replaced by the imported workflow. Continue?")) return;
    setBusy(true);
    try {
      await afterImport(await post("/api/import/folder", { folder, removeMissingScenes: removeMissing }));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const importPicked = async (list: FileList | null) => {
    if (!list?.length) return;
    const files: Record<string, string> = {};
    const media: Record<string, string> = {};
    for (const f of Array.from(list)) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
      if (f.name.toLowerCase().endsWith(".md")) files[rel] = await f.text();
      else {
        // ".../media/assets/prj_x/file.jpg" → "assets/prj_x/file.jpg" (path relative to data/)
        const m = rel.match(/(?:^|\/)media\/(.+)$/);
        if (m) media[m[1]] = await toBase64(f);
      }
    }
    setBusy(true);
    try {
      await afterImport(await post("/api/import", { files, media, removeMissingScenes: removeMissing }));
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Markdown export / import" onClose={() => setPanel("none")}>
      <div className="space-y-4">
        <Section title="Export markdown">
          <p className="text-zinc-400">Writes PROJECT.md, MASTER-SCRIPT.md, STORYBOARD.md, WORKFLOW.md, PROMPTS.md, ASSETS.md and scenes/SCENE-XX.md. API keys are never written. Save the canvas first to include the latest workflow.</p>
          <label className="flex items-center gap-2 text-zinc-300">
            <input type="checkbox" checked={includeMedia} onChange={(e) => setIncludeMedia(e.target.checked)} /> Include media files (reference images, outputs) in <code>media/</code> so the folder is self-contained
          </label>
          <Button
            variant="primary"
            disabled={!spaceId || busy}
            onClick={async () => {
              try {
                setResult(await post(`/api/spaces/${spaceId}/export`, { includeMedia }));
              } catch (e) {
                toast("error", errorText(e));
              }
            }}
          >
            Export current space
          </Button>
          {result && (
            <div className="rounded border border-emerald-500/40 bg-emerald-500/5 p-2">
              <div className="text-emerald-300">Exported to <code>{result.absoluteDir}</code>{result.mediaCount ? ` (+${result.mediaCount} media files)` : ""}</div>
              <ul className="mt-1 grid grid-cols-2 font-mono text-[11px] text-zinc-400">{result.files.map((f) => <li key={f}>{f}</li>)}</ul>
            </div>
          )}
        </Section>
        <Section title="Import markdown project">
          <p className="text-zinc-400">Reads PROJECT.md, MASTER-SCRIPT.md, WORKFLOW.md, PROMPTS.md, ASSETS.md and scenes/*.md and updates the matching project/space by ID (or creates them).</p>
          <label className="flex items-center gap-2 text-zinc-300">
            <input type="checkbox" checked={removeMissing} onChange={(e) => setRemoveMissing(e.target.checked)} /> Delete scenes that have no scene file
          </label>
          <input ref={dirRef} type="file" multiple className="hidden" onChange={(e) => void importPicked(e.target.files).finally(() => (e.target.value = ""))} />
          <Button disabled={busy} onClick={() => dirRef.current?.click()}><FolderOpen size={14} /> Choose folder…</Button>
          {exportsList.length > 0 && (
            <div className="space-y-1">
              <div className="text-[11px] text-zinc-500">Or re-import a folder from the exports directory:</div>
              {exportsList.map((x) => (
                <div key={x.folder} className="flex items-center justify-between rounded border border-zinc-800 px-2 py-1">
                  <span className="font-mono text-[12px]">{x.folder}</span>
                  <span className="flex items-center gap-2 text-[11px] text-zinc-500">
                    {new Date(x.modifiedAt).toLocaleString()}
                    <Button size="sm" disabled={busy} onClick={() => void importFolder(x.folder)}>Import</Button>
                  </span>
                </div>
              ))}
            </div>
          )}
          {summary && (
            <div className="rounded border border-zinc-700 p-2 text-[12px]">
              <div>Created: {summary.created.join(", ") || "–"}</div>
              <div>Updated: {summary.updated.join(", ") || "–"}</div>
              <div className="text-zinc-500">Unchanged: {summary.unchanged.length} item(s)</div>
              {summary.removed.length > 0 && <div>Removed: {summary.removed.join(", ")}</div>}
              {summary.warnings.map((w: string) => <div key={w} className="text-amber-300">⚠ {w}</div>)}
            </div>
          )}
        </Section>
      </div>
    </Modal>
  );
}

function toBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export function SettingsDialog() {
  const { providers, ffmpeg, setPanel, loadProviders, bundle, refreshBundle, toast } = useApp();
  const [globalPrompt, setGlobalPrompt] = useState(String(bundle?.project.settings.globalPrompt ?? ""));
  const [negative, setNegative] = useState(String(bundle?.project.settings.negativePrompt ?? ""));
  return (
    <Modal title="Settings" onClose={() => setPanel("none")}>
      <div className="space-y-4">
        {bundle && (
          <Section title={`Project prompt settings — ${bundle.project.name}`}>
            <Field label="Global prompt (GLOBAL layer)"><Input value={globalPrompt} onChange={(e) => setGlobalPrompt(e.target.value)} placeholder="Premium, clean, natural skin tones" /></Field>
            <Field label="Negative prompt"><Input value={negative} onChange={(e) => setNegative(e.target.value)} placeholder="blurry, extra fingers, warped text" /></Field>
            <Button
              size="sm"
              onClick={async () => {
                await patch(`/api/projects/${bundle.project.id}`, { settings: { ...bundle.project.settings, globalPrompt, negativePrompt: negative } });
                await refreshBundle();
                toast("success", "Project settings saved");
              }}
            >
              Save project settings
            </Button>
          </Section>
        )}
        <Section title="Providers" right={<Button size="sm" variant="ghost" onClick={() => void loadProviders()}><RefreshCw size={12} /> Refresh</Button>}>
          <p className="text-zinc-400">
            API keys live only in the <code>.env</code> file next to <code>start.bat</code> (copy <code>.env.example</code>). Restart the app after editing. Keys are never displayed, stored in the database or exported.
          </p>
          <table className="w-full text-left text-[12px]">
            <thead className="text-zinc-500"><tr><th>Provider</th><th>Kind</th><th>Env var</th><th>Status</th></tr></thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p.id} className="border-t border-zinc-800">
                  <td className="py-1">{p.label} <span className="font-mono text-[10px] text-zinc-500">{p.id}</span></td>
                  <td>{p.kind}</td>
                  <td className="font-mono text-[11px]">{p.envKey}</td>
                  <td>{p.configured ? <Badge tone="green">configured</Badge> : <Badge tone="amber">not configured</Badge>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>ffmpeg for Final Video: {ffmpeg ? <Badge tone="green">found</Badge> : <Badge tone="amber">not found — install ffmpeg or set FFMPEG_PATH</Badge>}</div>
        </Section>
      </div>
    </Modal>
  );
}

export function RunLogDialog() {
  const { run, setPanel, select } = useApp();
  if (!run) return null;
  const active = run.run.status === "RUNNING" || run.run.status === "PENDING";
  return (
    <Modal title={`Run ${run.run.id}`} onClose={() => setPanel("none")} width="max-w-3xl">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(run.run.status)}>{run.run.status}</Badge>
          <span className="text-zinc-500">{new Date(run.run.createdAt).toLocaleString()}</span>
        </div>
        {active && <Button variant="danger" size="sm" onClick={() => void cancelRun(run.run.id)}>Cancel run</Button>}
      </div>
      {run.run.error && <div className="mb-2 whitespace-pre-wrap text-red-300">{run.run.error}</div>}
      <div className="space-y-1">
        {run.jobs.map((j, i) => (
          <details key={j.id} className="rounded border border-zinc-800 p-2" open={j.status === "FAILED"}>
            <summary className="flex cursor-pointer items-center gap-2">
              <span className="w-5 text-zinc-500">{i + 1}.</span>
              <button className="font-mono text-violet-300 hover:underline" onClick={(e) => (e.preventDefault(), useCanvas.getState().selectOnly(j.nodeId), select({ kind: "node", id: j.nodeId }), setPanel("none"))}>{j.nodeId}</button>
              <span className="text-zinc-500">{j.nodeType}</span>
              <span className="flex-1" />
              {j.attempts > 1 && <span className="text-[11px] text-zinc-500">attempts {j.attempts}</span>}
              <Badge tone={statusTone(j.status)}>{j.status}</Badge>
            </summary>
            {j.error && <div className="mt-1 text-red-300">{j.error}</div>}
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap text-[11px] text-zinc-400">{j.logs.join("\n") || "(no logs)"}</pre>
          </details>
        ))}
      </div>
    </Modal>
  );
}
