// Right-panel editors: Master Script, Reference profiles, Prompt templates, Assets.
import { useEffect, useRef, useState } from "react";
import { Layers, Trash2, Upload, X } from "lucide-react";
import { PROMPT_CATEGORIES, REFERENCE_TYPES, extractVariables, type MasterScript, type PromptTemplate, type Reference, type ReferenceLocks } from "@amw/shared";
import { del, fileUrl, patch, post, put } from "../../api";
import { errorText, reloadCanvas } from "../../actions";
import { useApp } from "../../store/app";
import { useCanvas } from "../../store/canvas";
import { Button, Field, Input, Section, Select, Textarea } from "../ui";
import { Versions } from "./Versions";

type MSForm = Pick<MasterScript, "title" | "objective" | "targetPlatform" | "aspectRatio" | "duration" | "characterId" | "productId" | "styleId" | "voiceId" | "globalInstruction" | "scriptText">;
const MS_KEYS: (keyof MSForm)[] = ["title", "objective", "targetPlatform", "aspectRatio", "duration", "characterId", "productId", "styleId", "voiceId", "globalInstruction", "scriptText"];

export function MasterScriptEditor() {
  const { bundle, refreshBundle, toast } = useApp();
  const ms = bundle?.masterScript;
  const blank: MSForm = { title: "", objective: "", targetPlatform: bundle?.space.targetPlatform ?? "TikTok", aspectRatio: bundle?.space.aspectRatio ?? "9:16", duration: 60, characterId: "", productId: "", styleId: "", voiceId: "", globalInstruction: "", scriptText: "" };
  const [form, setForm] = useState<MSForm>(ms ? (Object.fromEntries(MS_KEYS.map((k) => [k, ms[k]])) as MSForm) : blank);
  const [dirty, setDirty] = useState(!ms);
  useEffect(() => {
    if (ms && !dirty) setForm(Object.fromEntries(MS_KEYS.map((k) => [k, ms[k]])) as MSForm);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms?.version]);
  if (!bundle) return null;
  const set = <K extends keyof MSForm>(k: K, v: MSForm[K]) => (setForm({ ...form, [k]: v }), setDirty(true));
  const refOpts = (type: string) => [{ value: "", label: "None" }, ...bundle.references.filter((r) => r.type === type).map((r) => ({ value: r.code, label: `${r.code} — ${r.name}` }))];
  const save = async () => {
    try {
      await put(`/api/spaces/${bundle.space.id}/master-script`, form);
      setDirty(false);
      await refreshBundle();
      toast("success", "Master script saved");
      return true;
    } catch (e) {
      toast("error", errorText(e));
      return false;
    }
  };
  const storyboard = async (mode: "replace" | "append") => {
    if (dirty && !(await save())) return;
    if (useCanvas.getState().dirty && !confirm("Unsaved canvas changes will be replaced by the generated board. Continue?")) return;
    try {
      const r = await post<{ scenes: unknown[] }>(`/api/spaces/${bundle.space.id}/storyboard`, { mode });
      await reloadCanvas();
      toast("success", `Storyboard generated: ${r.scenes.length} scenes`);
    } catch (e) {
      toast("error", errorText(e));
    }
  };
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-sky-300">Master Script {ms && <span className="text-zinc-500">v{ms.version}</span>}</div>
      <Field label="Title"><Input value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Review dầu xả ABC" /></Field>
      <Field label="Objective"><Textarea rows={2} value={form.objective} onChange={(e) => set("objective", e.target.value)} placeholder="Video TikTok giới thiệu sản phẩm." /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Platform"><Input value={form.targetPlatform} onChange={(e) => set("targetPlatform", e.target.value)} /></Field>
        <Field label="Aspect"><Select value={form.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value)} options={["9:16", "16:9", "1:1", "4:5", "3:4"].map((v) => ({ value: v, label: v }))} /></Field>
        <Field label="Duration (s)"><Input type="number" value={form.duration} onChange={(e) => set("duration", Number(e.target.value))} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Character"><Select value={form.characterId} onChange={(e) => set("characterId", e.target.value)} options={refOpts("character")} /></Field>
        <Field label="Product"><Select value={form.productId} onChange={(e) => set("productId", e.target.value)} options={refOpts("product")} /></Field>
        <Field label="Style"><Select value={form.styleId} onChange={(e) => set("styleId", e.target.value)} options={refOpts("style")} /></Field>
        <Field label="Voice"><Select value={form.voiceId} onChange={(e) => set("voiceId", e.target.value)} options={refOpts("voice")} /></Field>
      </div>
      <Field label="Global instruction"><Textarea rows={2} value={form.globalInstruction} onChange={(e) => set("globalInstruction", e.target.value)} placeholder="Bright, clean, premium look…" /></Field>
      <Field label="Script" hint={'Use "Scene 1: Hook" headings. Optional lines: "Action:", "Dialogue:", "Camera:", "Location:", "Duration: 8s".'}>
        <Textarea rows={14} className="font-mono text-[12px]" value={form.scriptText} onChange={(e) => set("scriptText", e.target.value)} placeholder={"Scene 1:\nHook\nScene 2:\nGiới thiệu sản phẩm\n…"} />
      </Field>
      <div className="sticky bottom-0 -mx-3 flex flex-wrap gap-1 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2">
        <Button variant={dirty ? "primary" : "default"} disabled={!dirty} onClick={() => void save()}>{dirty ? "Save" : "Saved"}</Button>
        <Button onClick={() => void storyboard("replace")} title="Split into scenes (updates scenes in place by number) and build the production board"><Layers size={14} /> Generate storyboard</Button>
        <Button variant="ghost" onClick={() => void storyboard("append")}>Append scenes</Button>
      </div>
      {ms && <Versions type="masterScript" id={ms.id} reloadKey={ms.version} onRestored={async () => (setDirty(false), await refreshBundle())} />}
    </div>
  );
}

const LOCKS: Record<string, (keyof ReferenceLocks)[]> = {
  character: ["faceLock", "hairLock", "outfitLock", "identityLock"],
  product: ["logoLock", "shapeLock", "colorLock", "labelLock", "packagingLock"],
};

export function ReferenceEditor({ id }: { id: string }) {
  const { bundle, refreshBundle, toast, projectId, select } = useApp();
  const ref = bundle?.references.find((r) => r.id === id);
  const [form, setForm] = useState<Reference | null>(ref ?? null);
  const [dirty, setDirty] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref && !dirty) setForm(ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref?.id, ref?.version]);
  useEffect(() => setDirty(false), [id]);
  if (!bundle || !ref || !form) return <div className="text-zinc-500">Reference not found.</div>;
  const set = (patchObj: Partial<Reference>) => (setForm({ ...form, ...patchObj }), setDirty(true));
  const save = async () => {
    try {
      await patch(`/api/references/${ref.id}`, { code: form.code, type: form.type, name: form.name, description: form.description, prompt: form.prompt, settings: form.settings, assetIds: form.assetIds });
      setDirty(false);
      await refreshBundle();
      toast("success", `${form.code} saved`);
    } catch (e) {
      toast("error", errorText(e));
    }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length || !projectId) return;
    const fd = new FormData();
    fd.set("spaceId", bundle.space.id);
    fd.set("referenceId", ref.id);
    for (const f of Array.from(files)) fd.append("file", f, f.name);
    try {
      await post(`/api/projects/${projectId}/assets`, fd);
      setDirty(false);
      await refreshBundle();
    } catch (e) {
      toast("error", errorText(e));
    }
  };
  const assets = form.assetIds.map((aid) => ({ aid, asset: bundle.assets.find((a) => a.id === aid) }));
  const unattached = bundle.assets.filter((a) => !form.assetIds.includes(a.id) && a.kind === "image");
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-sky-300">{form.type} profile <span className="text-zinc-500">v{ref.version}</span></div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="ID (stable)"><Input className="font-mono" value={form.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} /></Field>
        <Field label="Type"><Select value={form.type} onChange={(e) => set({ type: e.target.value as Reference["type"] })} options={REFERENCE_TYPES.map((t) => ({ value: t, label: t }))} /></Field>
      </div>
      <Field label="Name"><Input value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Description"><Textarea rows={2} value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Field label="Prompt descriptor" hint="Injected into the CHARACTER / PRODUCT / STYLE prompt layer.">
        <Textarea rows={3} value={form.prompt} onChange={(e) => set({ prompt: e.target.value })} />
      </Field>
      {LOCKS[form.type] && (
        <Section title="Locks">
          <div className="grid grid-cols-2 gap-1">
            {LOCKS[form.type].map((k) => (
              <label key={k} className="flex items-center gap-2 text-zinc-300">
                <input type="checkbox" checked={!!form.settings[k]} onChange={(e) => set({ settings: { ...form.settings, [k]: e.target.checked } })} /> {k}
              </label>
            ))}
          </div>
        </Section>
      )}
      {form.type === "voice" && (
        <Section title="Voice settings">
          <Field label="Voice name / id" hint="OpenAI: alloy, nova, coral… · ElevenLabs: voice id"><Input value={String(form.settings.voiceName ?? "")} onChange={(e) => set({ settings: { ...form.settings, voiceName: e.target.value } })} /></Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Language"><Input value={String(form.settings.language ?? "")} onChange={(e) => set({ settings: { ...form.settings, language: e.target.value } })} /></Field>
            <Field label="Tone"><Input value={String(form.settings.tone ?? "")} onChange={(e) => set({ settings: { ...form.settings, tone: e.target.value } })} /></Field>
          </div>
        </Section>
      )}
      <Section title="Reference files" right={<Button size="sm" onClick={() => fileRef.current?.click()}><Upload size={12} /> Upload</Button>}>
        <input ref={fileRef} type="file" multiple accept="image/*,video/*,audio/*" className="hidden" onChange={(e) => void upload(e.target.files).finally(() => (e.target.value = ""))} />
        <div className="grid grid-cols-3 gap-1.5">
          {assets.map(({ aid, asset }) => (
            <div key={aid} className="group relative overflow-hidden rounded border border-zinc-800" title={asset ? `${asset.filename} (${aid})` : `${aid} (missing)`}>
              {asset?.kind === "image" ? <img src={fileUrl(asset.path)} className="h-20 w-full object-cover" alt="" /> : <div className="grid h-20 place-items-center text-[10px] text-red-300">{asset ? asset.filename : "missing"}</div>}
              <button className="absolute right-0.5 top-0.5 hidden rounded bg-black/70 p-0.5 group-hover:block" title="Detach" onClick={() => set({ assetIds: form.assetIds.filter((x) => x !== aid) })}>
                <X size={10} />
              </button>
            </div>
          ))}
        </div>
        {unattached.length > 0 && (
          <Select value="" onChange={(e) => e.target.value && set({ assetIds: [...form.assetIds, e.target.value] })} options={[{ value: "", label: "+ attach existing asset…" }, ...unattached.map((a) => ({ value: a.id, label: a.filename }))]} />
        )}
      </Section>
      <div className="sticky bottom-0 -mx-3 flex gap-1 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2">
        <Button variant={dirty ? "primary" : "default"} disabled={!dirty} onClick={() => void save()}>{dirty ? "Save" : "Saved"}</Button>
        <Button
          variant="danger"
          onClick={async () => {
            if (!confirm(`Delete ${ref.code}? Scenes referencing it will be flagged by the checker.`)) return;
            await del(`/api/references/${ref.id}`);
            select(null);
            await refreshBundle();
          }}
        >
          <Trash2 size={14} /> Delete
        </Button>
      </div>
      <Versions type="reference" id={ref.id} reloadKey={ref.version} onRestored={async () => (setDirty(false), await refreshBundle())} />
    </div>
  );
}

export function PromptEditor({ id }: { id: string }) {
  const { bundle, refreshBundle, toast, select } = useApp();
  const tpl = bundle?.prompts.find((p) => p.id === id);
  const [form, setForm] = useState<PromptTemplate | null>(tpl ?? null);
  const [dirty, setDirty] = useState(false);
  const [sceneId, setSceneId] = useState("");
  const [rendered, setRendered] = useState<{ text: string; missing: string[] } | null>(null);
  useEffect(() => {
    if (tpl && !dirty) setForm(tpl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl?.id, tpl?.version]);
  useEffect(() => (setDirty(false), setRendered(null)), [id]);
  if (!bundle || !tpl || !form) return <div className="text-zinc-500">Template not found.</div>;
  const set = (p: Partial<PromptTemplate>) => (setForm({ ...form, ...p }), setDirty(true));
  return (
    <div className="space-y-3">
      <div className="text-[11px] font-bold uppercase tracking-wider text-sky-300">Prompt template <span className="text-zinc-500">v{tpl.version}</span></div>
      <div className="font-mono text-violet-300">{tpl.id}</div>
      <Field label="Name"><Input value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
      <Field label="Category"><Select value={form.category} onChange={(e) => set({ category: e.target.value })} options={[...new Set([...PROMPT_CATEGORIES, form.category])].map((c) => ({ value: c, label: c }))} /></Field>
      <Field label="Description"><Input value={form.description} onChange={(e) => set({ description: e.target.value })} /></Field>
      <Field label="Template" hint={`Variables: ${extractVariables(form.template).map((v) => `{{${v}}}`).join(", ") || "none"}`}>
        <Textarea rows={8} className="font-mono text-[12px]" value={form.template} onChange={(e) => set({ template: e.target.value })} />
      </Field>
      <Section title="Test render">
        <Select value={sceneId} onChange={(e) => setSceneId(e.target.value)} options={[{ value: "", label: "Pick a scene…" }, ...bundle.scenes.map((s) => ({ value: s.id, label: `${s.code} — ${s.title}` }))]} />
        <Button size="sm" disabled={!sceneId} onClick={async () => setRendered(await post(`/api/prompts/${tpl.id}/render`, { sceneId }))}>Render (saved version)</Button>
        {rendered && (
          <div className="rounded border border-zinc-800 p-2">
            <div className="whitespace-pre-wrap text-zinc-200">{rendered.text}</div>
            {rendered.missing.length > 0 && <div className="mt-1 text-[11px] text-amber-300">Empty variables: {rendered.missing.join(", ")}</div>}
          </div>
        )}
      </Section>
      <div className="sticky bottom-0 -mx-3 flex gap-1 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2">
        <Button
          variant={dirty ? "primary" : "default"}
          disabled={!dirty}
          onClick={async () => {
            try {
              await patch(`/api/prompts/${tpl.id}`, { name: form.name, category: form.category, description: form.description, template: form.template });
              setDirty(false);
              await refreshBundle();
              toast("success", `${tpl.id} saved as v${tpl.version + 1}`);
            } catch (e) {
              toast("error", errorText(e));
            }
          }}
        >
          {dirty ? "Save new version" : "Saved"}
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            if (!confirm(`Delete template ${tpl.id}?`)) return;
            await del(`/api/prompts/${tpl.id}`);
            select(null);
            await refreshBundle();
          }}
        >
          <Trash2 size={14} />
        </Button>
      </div>
      <Versions type="prompt" id={tpl.id} reloadKey={tpl.version} onRestored={async () => (setDirty(false), await refreshBundle())} />
    </div>
  );
}

export function AssetInfo({ id }: { id: string }) {
  const bundle = useApp((s) => s.bundle);
  const a = bundle?.assets.find((x) => x.id === id);
  if (!a) return <div className="text-zinc-500">Asset not found.</div>;
  const usedBy = bundle!.references.filter((r) => r.assetIds.includes(a.id)).map((r) => r.code);
  return (
    <div className="space-y-2">
      <div className="text-[11px] font-bold uppercase tracking-wider text-sky-300">Asset</div>
      {a.kind === "image" && <img src={fileUrl(a.path)} className="w-full rounded" alt="" />}
      {a.kind === "video" && <video src={fileUrl(a.path)} className="w-full rounded" controls />}
      {a.kind === "audio" && <audio src={fileUrl(a.path)} className="w-full" controls />}
      <div className="font-mono text-[11px] text-violet-300">{a.id}</div>
      <div className="text-zinc-300">{a.filename}</div>
      <div className="text-[11px] text-zinc-500">data/{a.path} · {(a.size / 1024).toFixed(1)} KB · {a.mimeType}</div>
      <div className="text-[11px] text-zinc-400">Used by: {usedBy.join(", ") || "–"}</div>
    </div>
  );
}
