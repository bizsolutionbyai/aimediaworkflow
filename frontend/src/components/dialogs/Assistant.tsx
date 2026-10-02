// AI Assistant panel. Every result is shown as an editable draft; nothing is saved until "Apply".
import { useState } from "react";
import { Bot, Loader2 } from "lucide-react";
import { patch, post, put } from "../../api";
import { errorText, reloadCanvas } from "../../actions";
import { useApp } from "../../store/app";
import { useCanvas } from "../../store/canvas";
import { Badge, Button, Empty, Field, Input, Modal, Section, Select, Textarea, cx } from "../ui";

type Task = "plan" | "master-script" | "split-scenes" | "scene-prompts" | "continuity";
interface MSDraft { title: string; objective: string; targetPlatform: string; aspectRatio: string; duration: number; globalInstruction: string; scriptText: string }
interface SceneDraft { title: string; duration: number; script: string; action: string; dialogue: string; camera: string; shotType: string; cameraMovement: string; location: string; lighting: string; expression: string; imagePrompt: string; videoPrompt: string; voicePrompt: string }

const TASKS: { id: Task; label: string }[] = [
  { id: "plan", label: "Brief → script + scenes + prompts" },
  { id: "master-script", label: "Generate master script" },
  { id: "split-scenes", label: "Split script into scenes" },
  { id: "scene-prompts", label: "Generate / improve prompts" },
  { id: "continuity", label: "Check continuity" },
];

export function AssistantPanel() {
  const { bundle, providers, setPanel, toast, refreshBundle } = useApp();
  const [task, setTask] = useState<Task>("plan");
  const [brief, setBrief] = useState("Create a 60 second TikTok product review.");
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState<MSDraft | null>(null);
  const [scenes, setScenes] = useState<SceneDraft[] | null>(null);
  const [sceneId, setSceneId] = useState(bundle?.scenes[0]?.id ?? "");
  const [improve, setImprove] = useState(false);
  const [prompts, setPrompts] = useState<Record<string, string> | null>(null);
  const [issues, setIssues] = useState<{ referenceChecks: { level: string; message: string }[]; issues: { severity: string; sceneId: string; message: string }[] } | null>(null);
  const llms = providers.filter((p) => p.kind === "llm");
  const configured = llms.some((p) => p.configured);
  if (!bundle) return null;
  const spaceId = bundle.space.id;

  const go = async () => {
    setBusy(true);
    setMs(null);
    setScenes(null);
    setPrompts(null);
    setIssues(null);
    try {
      const body = { spaceId, provider, brief, sceneId, improve, targets: ["image", "video", "voice"] };
      const r = await post<any>(`/api/assistant/${task}`, body);
      if (task === "plan") (setMs(r.masterScript), setScenes(r.scenes));
      else if (task === "master-script") setMs(r);
      else if (task === "split-scenes") setScenes(r.scenes);
      else if (task === "scene-prompts") setPrompts(r);
      else setIssues(r);
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const applyMs = async () => {
    if (!ms) return;
    const cur = bundle.masterScript;
    await put(`/api/spaces/${spaceId}/master-script`, { ...ms, characterId: cur?.characterId ?? "", productId: cur?.productId ?? "", styleId: cur?.styleId ?? "", voiceId: cur?.voiceId ?? "" });
  };
  const applyScenes = async (mode: "replace" | "append") => {
    if (!scenes) return;
    if (useCanvas.getState().dirty && !confirm("Unsaved canvas changes will be replaced by the generated board. Continue?")) return;
    await post(`/api/spaces/${spaceId}/storyboard`, { scenes, mode });
    await reloadCanvas();
  };
  const apply = async (mode: "replace" | "append" = "replace") => {
    try {
      if (ms) await applyMs();
      if (scenes) await applyScenes(mode);
      if (prompts) await patch(`/api/scenes/${sceneId}`, prompts);
      await refreshBundle();
      toast("success", "Applied — everything stays editable and versioned");
    } catch (e) {
      toast("error", errorText(e));
    }
  };

  const setScene = (i: number, k: keyof SceneDraft, v: string | number) => setScenes(scenes!.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  return (
    <Modal title="AI Assistant" onClose={() => setPanel("none")} width="max-w-4xl">
      {!configured && (
        <div className="mb-3 rounded border border-amber-500/40 bg-amber-500/10 p-2 text-amber-200">
          Provider not configured. Set <code>ANTHROPIC_API_KEY</code> or <code>OPENAI_API_KEY</code> in <code>.env</code> and restart. You can still write scripts and prompts manually; the Storyboard Generator and “Compose” prompt drafts work without AI.
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-1">
        {TASKS.map((t) => (
          <button key={t.id} onClick={() => setTask(t.id)} className={cx("rounded-md px-2.5 py-1 text-[12px]", task === t.id ? "bg-violet-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700")}>
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[1fr_200px] gap-2">
        {(task === "plan" || task === "master-script") && <Field label="Brief"><Textarea rows={2} value={brief} onChange={(e) => setBrief(e.target.value)} /></Field>}
        {task === "scene-prompts" && (
          <div className="grid grid-cols-[1fr_auto] items-end gap-2">
            <Field label="Scene"><Select value={sceneId} onChange={(e) => setSceneId(e.target.value)} options={bundle.scenes.map((s) => ({ value: s.id, label: `${s.code} — ${s.title}` }))} /></Field>
            <label className="flex items-center gap-1 pb-2 text-zinc-300"><input type="checkbox" checked={improve} onChange={(e) => setImprove(e.target.checked)} /> improve existing</label>
          </div>
        )}
        {(task === "split-scenes" || task === "continuity") && <div className="text-zinc-400">{task === "split-scenes" ? "Uses the saved master script." : "Reviews references, master script and all scenes."}</div>}
        <Field label="Model provider">
          <Select value={provider} onChange={(e) => setProvider(e.target.value)} options={[{ value: "", label: "(default)" }, ...llms.map((p) => ({ value: p.id, label: `${p.label}${p.configured ? "" : " — not configured"}` }))]} />
        </Field>
      </div>
      <Button variant="primary" className="mt-2" disabled={busy || !configured || (task === "scene-prompts" && !sceneId)} onClick={() => void go()}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />} Run
      </Button>

      {ms && (
        <Section title="Master script draft">
          <div className="grid grid-cols-[1fr_100px] gap-2">
            <Field label="Title"><Input value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} /></Field>
            <Field label="Duration"><Input type="number" value={ms.duration} onChange={(e) => setMs({ ...ms, duration: Number(e.target.value) })} /></Field>
          </div>
          <Field label="Objective"><Textarea rows={2} value={ms.objective} onChange={(e) => setMs({ ...ms, objective: e.target.value })} /></Field>
          <Field label="Global instruction"><Textarea rows={2} value={ms.globalInstruction} onChange={(e) => setMs({ ...ms, globalInstruction: e.target.value })} /></Field>
          <Field label="Script"><Textarea rows={10} className="font-mono text-[12px]" value={ms.scriptText} onChange={(e) => setMs({ ...ms, scriptText: e.target.value })} /></Field>
        </Section>
      )}
      {scenes && (
        <Section title={`Scene drafts (${scenes.length})`}>
          {scenes.map((s, i) => (
            <div key={i} className="space-y-1 rounded border border-zinc-800 p-2">
              <div className="grid grid-cols-[40px_1fr_80px] items-center gap-2">
                <span className="font-bold text-sky-300">{String(i + 1).padStart(2, "0")}</span>
                <Input value={s.title} onChange={(e) => setScene(i, "title", e.target.value)} />
                <Input type="number" value={s.duration} onChange={(e) => setScene(i, "duration", Number(e.target.value))} />
              </div>
              <div className="grid grid-cols-2 gap-1">
                <Textarea rows={2} value={s.action} placeholder="Action" onChange={(e) => setScene(i, "action", e.target.value)} />
                <Textarea rows={2} value={s.dialogue} placeholder="Dialogue" onChange={(e) => setScene(i, "dialogue", e.target.value)} />
                <Textarea rows={2} value={s.imagePrompt} placeholder="Image prompt" onChange={(e) => setScene(i, "imagePrompt", e.target.value)} />
                <Textarea rows={2} value={s.videoPrompt} placeholder="Video prompt" onChange={(e) => setScene(i, "videoPrompt", e.target.value)} />
              </div>
            </div>
          ))}
        </Section>
      )}
      {prompts && (
        <Section title="Prompt drafts">
          {Object.entries(prompts).map(([k, v]) => (
            <Field key={k} label={k}><Textarea rows={4} value={v} onChange={(e) => setPrompts({ ...prompts, [k]: e.target.value })} /></Field>
          ))}
        </Section>
      )}
      {issues && (
        <Section title="Continuity report">
          {!issues.issues.length && !issues.referenceChecks.length && <Empty>No issues found.</Empty>}
          {issues.referenceChecks.map((i, k) => <div key={`r${k}`} className={i.level === "error" ? "text-red-300" : "text-amber-300"}>{i.level === "error" ? "✕" : "⚠"} {i.message}</div>)}
          {issues.issues.map((i, k) => (
            <div key={k} className="flex gap-2">
              <Badge tone={i.severity === "error" ? "red" : i.severity === "warning" ? "amber" : "zinc"}>{i.severity}</Badge>
              <span className="font-mono text-zinc-500">{i.sceneId}</span>
              <span>{i.message}</span>
            </div>
          ))}
        </Section>
      )}
      {(ms || scenes || prompts) && (
        <div className="mt-3 flex gap-2">
          <Button variant="primary" onClick={() => void apply("replace")}>Apply{scenes ? " (replace scenes)" : ""}</Button>
          {scenes && <Button onClick={() => void apply("append")}>Apply (append scenes)</Button>}
        </div>
      )}
    </Modal>
  );
}
