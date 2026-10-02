// Scene Editor: all scene fields, references, providers, layered prompt preview and generation.
import { useEffect, useMemo, useState } from "react";
import { Film, Image as ImageIcon, Mic, Wand2, Sparkles } from "lucide-react";
import { buildPromptLayers, downstreamIds, edgeId, type PromptTarget, type Scene } from "@amw/shared";
import { patch, post } from "../../api";
import { errorText, runWorkflow, saveWorkflow } from "../../actions";
import { useApp } from "../../store/app";
import { useCanvas } from "../../store/canvas";
import { Badge, Button, Field, Input, Section, Select, Textarea, statusTone } from "../ui";
import { OutputsGallery } from "./OutputsGallery";
import { Versions } from "./Versions";

type Form = Omit<Scene, "id" | "spaceId" | "createdAt" | "updatedAt" | "version" | "masterScriptId" | "imageStatus" | "videoStatus" | "voiceStatus">;

const FIELDS: (keyof Form)[] = ["code", "sceneNumber", "title", "duration", "script", "action", "dialogue", "camera", "shotType", "cameraMovement", "location", "lighting", "expression", "characterId", "productId", "styleId", "voiceId", "imagePrompt", "videoPrompt", "voicePrompt", "continuity", "imageProvider", "videoProvider", "voiceProvider"];

function toForm(s: Scene): Form {
  return Object.fromEntries(FIELDS.map((k) => [k, s[k]])) as Form;
}

export function SceneEditor({ sceneId }: { sceneId: string }) {
  const { bundle, refreshBundle, toast, providers } = useApp();
  const scene = bundle?.scenes.find((s) => s.id === sceneId);
  const [form, setForm] = useState<Form | null>(scene ? toForm(scene) : null);
  const [dirty, setDirty] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<PromptTarget>("image");
  const [busy, setBusy] = useState("");
  const assistantReady = providers.some((p) => p.kind === "llm" && p.configured);

  useEffect(() => {
    if (scene && !dirty) setForm(toForm(scene));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene?.id, scene?.version, scene?.updatedAt]);
  useEffect(() => setDirty(false), [sceneId]);

  const preview = useMemo(() => {
    if (!bundle || !scene || !form) return null;
    return buildPromptLayers({ ...bundle, scene: { ...scene, ...form } }, previewTarget);
  }, [bundle, scene, form, previewTarget]);

  if (!bundle || !scene || !form) return <div className="text-zinc-500">Scene not found.</div>;

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm({ ...form, [k]: v });
    setDirty(true);
  };
  const refOpts = (type: string) => {
    const ms = bundle.masterScript;
    const inherited = type === "character" ? ms?.characterId : type === "product" ? ms?.productId : type === "style" ? ms?.styleId : ms?.voiceId;
    return [
      { value: "", label: inherited ? `Inherit (${inherited})` : "None" },
      ...bundle.references.filter((r) => r.type === type).map((r) => ({ value: r.code, label: `${r.code} — ${r.name}` })),
    ];
  };
  const provOpts = (kind: string) => [{ value: "", label: "(node default)" }, ...providers.filter((p) => p.kind === kind).map((p) => ({ value: p.id, label: `${p.label}${p.configured ? "" : " (not configured)"}` }))];

  const save = async () => {
    try {
      await patch(`/api/scenes/${scene.id}`, form);
      setDirty(false);
      await refreshBundle();
      toast("success", `${scene.code} saved`);
      return true;
    } catch (e) {
      toast("error", errorText(e));
      return false;
    }
  };

  const compose = async () => {
    const r = await post<{ imagePrompt: string; videoPrompt: string; voicePrompt: string }>(`/api/scenes/${scene.id}/draft-prompts`, form);
    setForm({ ...form, imagePrompt: form.imagePrompt || r.imagePrompt, videoPrompt: form.videoPrompt || r.videoPrompt, voicePrompt: form.voicePrompt || r.voicePrompt });
    setDirty(true);
    toast("info", "Filled empty prompts from scene fields — review and Save");
  };

  const aiPrompts = async (improve: boolean) => {
    if (dirty && !(await save())) return;
    setBusy(improve ? "improve" : "write");
    try {
      const r = await post<Record<string, string>>("/api/assistant/scene-prompts", { spaceId: bundle.space.id, sceneId: scene.id, targets: ["image", "video", "voice"], improve });
      setForm({ ...form, ...r });
      setDirty(true);
      toast("info", "AI prompts drafted — review, edit and Save");
    } catch (e) {
      toast("error", errorText(e));
    } finally {
      setBusy("");
    }
  };

  /** Finds (or creates) Scene → Image → Video on the canvas, then runs the requested generator. */
  const generate = async (kind: "imageGenerator" | "videoGenerator" | "voiceGenerator") => {
    if (dirty && !(await save())) return;
    const c = useCanvas.getState();
    let sceneNode = c.nodes.find((n) => n.type === "scene" && n.data.sceneId === scene.id);
    if (!sceneNode) {
      const id = c.addNode("scene", { x: 0, y: 0 }, { sceneId: scene.id });
      sceneNode = useCanvas.getState().nodes.find((n) => n.id === id)!;
    }
    const doc = useCanvas.getState().toDoc("", "");
    const find = (from: string, type: string) => downstreamIds(doc, from).map((id) => doc.nodes.find((n) => n.id === id)!).find((n) => n.type === type);
    let img = find(sceneNode.id, "imageGenerator");
    let targetId: string;
    const mk = (type: string, from: string, dy: number) => {
      const st = useCanvas.getState();
      const base = st.nodes.find((n) => n.id === from)!.position;
      const id = st.addNode(type, { x: base.x, y: base.y + dy }, { aspectRatio: bundle.masterScript?.aspectRatio || bundle.space.aspectRatio, ...(type === "videoGenerator" ? { duration: form.duration || 8 } : {}) });
      useCanvas.setState({ edges: [...useCanvas.getState().edges, { id: edgeId(from, id), source: from, target: id }] });
      return id;
    };
    if (kind === "voiceGenerator") {
      targetId = find(sceneNode.id, "voiceGenerator")?.id ?? mk("voiceGenerator", sceneNode.id, 220);
    } else {
      const imgId = img?.id ?? mk("imageGenerator", sceneNode.id, 220);
      if (kind === "imageGenerator") targetId = imgId;
      else {
        const d2 = useCanvas.getState().toDoc("", "");
        const vid = downstreamIds(d2, imgId).map((id) => d2.nodes.find((n) => n.id === id)!).find((n) => n.type === "videoGenerator");
        targetId = vid?.id ?? mk("videoGenerator", imgId, 240);
      }
    }
    if (useCanvas.getState().dirty) await saveWorkflow("Saved before generate");
    await runWorkflow([targetId]);
  };

  const outputs = bundle.outputs.filter((o) => o.sceneId === scene.id);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-sky-300">Scene {String(form.sceneNumber).padStart(2, "0")}</div>
          <div className="font-mono text-[11px] text-zinc-500">{scene.code} · v{scene.version}</div>
        </div>
        <div className="flex gap-1">
          <Badge tone={statusTone(scene.imageStatus)}>IMG {scene.imageStatus}</Badge>
          <Badge tone={statusTone(scene.videoStatus)}>VID {scene.videoStatus}</Badge>
        </div>
      </div>
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <Field label="Title"><Input value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
        <Field label="Duration (s)"><Input type="number" min={0} value={form.duration} onChange={(e) => set("duration", Number(e.target.value))} /></Field>
      </div>
      <Field label="Location"><Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Bathroom" /></Field>
      <Field label="Script"><Textarea value={form.script} onChange={(e) => set("script", e.target.value)} /></Field>
      <Field label="Action"><Textarea value={form.action} onChange={(e) => set("action", e.target.value)} placeholder="Cô gái cầm sản phẩm…" /></Field>
      <Field label="Dialogue"><Textarea value={form.dialogue} onChange={(e) => set("dialogue", e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Camera"><Input value={form.camera} onChange={(e) => set("camera", e.target.value)} placeholder="Medium shot" /></Field>
        <Field label="Shot type"><Input value={form.shotType} onChange={(e) => set("shotType", e.target.value)} /></Field>
        <Field label="Camera movement"><Input value={form.cameraMovement} onChange={(e) => set("cameraMovement", e.target.value)} placeholder="Slow push in" /></Field>
        <Field label="Lighting"><Input value={form.lighting} onChange={(e) => set("lighting", e.target.value)} /></Field>
      </div>
      <Field label="Expression"><Input value={form.expression} onChange={(e) => set("expression", e.target.value)} placeholder="Tươi tắn, tự nhiên" /></Field>

      <Section
        title="Prompts"
        right={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => void compose()} title="Fill empty prompts from the scene fields (no AI)">
              <Wand2 size={12} /> Compose
            </Button>
            <Button size="sm" variant="ghost" disabled={!assistantReady || !!busy} onClick={() => void aiPrompts(!!(form.imagePrompt || form.videoPrompt))} title={assistantReady ? "Write/improve with the AI assistant" : "Assistant provider not configured"}>
              <Sparkles size={12} /> {busy ? "…" : form.imagePrompt || form.videoPrompt ? "AI improve" : "AI write"}
            </Button>
          </div>
        }
      >
        <Field label="Image prompt" hint="Supports {{character}}, {{product}}, {{location}}, {{action}}, {{camera}} …"><Textarea rows={4} value={form.imagePrompt} onChange={(e) => set("imagePrompt", e.target.value)} /></Field>
        <Field label="Video prompt"><Textarea rows={4} value={form.videoPrompt} onChange={(e) => set("videoPrompt", e.target.value)} /></Field>
        <Field label="Voice prompt (delivery / tone)"><Textarea rows={2} value={form.voicePrompt} onChange={(e) => set("voicePrompt", e.target.value)} /></Field>
        <Field label="Continuity notes"><Textarea rows={2} value={form.continuity} onChange={(e) => set("continuity", e.target.value)} /></Field>
      </Section>

      <Section title="Reference">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Character"><Select value={form.characterId} onChange={(e) => set("characterId", e.target.value)} options={refOpts("character")} /></Field>
          <Field label="Product"><Select value={form.productId} onChange={(e) => set("productId", e.target.value)} options={refOpts("product")} /></Field>
          <Field label="Style"><Select value={form.styleId} onChange={(e) => set("styleId", e.target.value)} options={refOpts("style")} /></Field>
          <Field label="Voice"><Select value={form.voiceId} onChange={(e) => set("voiceId", e.target.value)} options={refOpts("voice")} /></Field>
        </div>
      </Section>

      <Section title="Providers">
        <div className="grid grid-cols-1 gap-2">
          <Field label="Image provider"><Select value={form.imageProvider} onChange={(e) => set("imageProvider", e.target.value)} options={provOpts("image")} /></Field>
          <Field label="Video provider"><Select value={form.videoProvider} onChange={(e) => set("videoProvider", e.target.value)} options={provOpts("video")} /></Field>
          <Field label="Voice provider"><Select value={form.voiceProvider} onChange={(e) => set("voiceProvider", e.target.value)} options={provOpts("voice")} /></Field>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-3 flex flex-wrap gap-1 border-t border-zinc-800 bg-zinc-950/95 px-3 py-2">
        <Button variant={dirty ? "primary" : "default"} onClick={() => void save()} disabled={!dirty}>
          {dirty ? "Save scene" : "Saved"}
        </Button>
        <Button onClick={() => void generate("imageGenerator")}><ImageIcon size={14} /> Generate image</Button>
        <Button onClick={() => void generate("videoGenerator")}><Film size={14} /> Generate video</Button>
        <Button variant="ghost" onClick={() => void generate("voiceGenerator")}><Mic size={14} /> Voice</Button>
      </div>

      {preview && (
        <Section
          title="Final prompt (layers)"
          right={<Select className="!h-7 !w-24 !py-0 text-xs" value={previewTarget} onChange={(e) => setPreviewTarget(e.target.value as PromptTarget)} options={[{ value: "image", label: "image" }, { value: "video", label: "video" }, { value: "voice", label: "voice" }]} />}
        >
          {preview.warnings.map((w) => (
            <div key={w} className="text-[11px] text-amber-300">⚠ {w}</div>
          ))}
          {preview.layers.filter((l) => l.text).map((l) => (
            <div key={l.key} className="rounded border border-zinc-800 p-1.5">
              <div className="text-[10px] font-bold uppercase text-zinc-500">{l.label}</div>
              <div className="whitespace-pre-wrap text-[12px] text-zinc-300">{l.text}</div>
            </div>
          ))}
          {preview.speechText && <div className="text-[11px] text-zinc-400">Spoken text: “{preview.speechText}”</div>}
        </Section>
      )}

      <Section title="Outputs">
        <OutputsGallery outputs={outputs} />
      </Section>
      <Versions type="scene" id={scene.id} reloadKey={scene.version} onRestored={async () => (setDirty(false), await refreshBundle())} />
    </div>
  );
}
