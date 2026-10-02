// Application/domain state: projects, spaces, the loaded space bundle, providers, selection and
// execution status. Canvas editing state lives separately in store/canvas.ts.
import { create } from "zustand";
import type { Job, Project, ProviderDefaults, ProviderInfo, Space, SpaceBundle, WorkflowRun } from "@amw/shared";
import { get, post } from "../api";

export type Selection =
  | { kind: "node"; id: string }
  | { kind: "reference"; id: string }
  | { kind: "scene"; id: string }
  | { kind: "masterScript" }
  | { kind: "prompt"; id: string }
  | { kind: "asset"; id: string };

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

interface AppState {
  projects: Project[];
  spaces: Space[];
  projectId: string | null;
  spaceId: string | null;
  bundle: SpaceBundle | null;
  providers: ProviderInfo[];
  providerDefaults: ProviderDefaults;
  ffmpeg: boolean;
  selection: Selection | null;
  run: { run: WorkflowRun; jobs: Job[] } | null;
  toasts: Toast[];
  panel: "none" | "assistant" | "check" | "export" | "settings" | "runlog" | "projects";
  init(): Promise<void>;
  loadProjects(): Promise<void>;
  selectProject(id: string | null): Promise<void>;
  selectSpace(id: string | null): Promise<void>;
  refreshBundle(): Promise<void>;
  loadProviders(): Promise<void>;
  select(sel: Selection | null): void;
  setPanel(p: AppState["panel"]): void;
  toast(kind: Toast["kind"], text: string): void;
  dismiss(id: number): void;
  watchRun(runId: string): void;
  loadLatestRun(): Promise<void>;
}

const remember = (k: string, v: string | null) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    /* storage may be unavailable */
  }
};
const recall = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};

let toastSeq = 1;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

export const useApp = create<AppState>((set, getState) => ({
  projects: [],
  spaces: [],
  projectId: null,
  spaceId: null,
  bundle: null,
  providers: [],
  providerDefaults: {},
  ffmpeg: false,
  selection: null,
  run: null,
  toasts: [],
  panel: "none",

  async init() {
    await Promise.all([getState().loadProjects(), getState().loadProviders()]);
    const { projects } = getState();
    const pid = recall("amw.projectId");
    const target = projects.find((p) => p.id === pid) ?? projects[0];
    if (target) await getState().selectProject(target.id);
    else set({ panel: "projects" });
  },

  async loadProjects() {
    set({ projects: await get<Project[]>("/api/projects") });
  },

  async loadProviders() {
    const r = await get<{ providers: ProviderInfo[]; defaults: ProviderDefaults; ffmpeg: boolean }>("/api/providers");
    set({ providers: r.providers, providerDefaults: r.defaults ?? {}, ffmpeg: r.ffmpeg });
  },

  async selectProject(id) {
    remember("amw.projectId", id);
    if (!id) return set({ projectId: null, spaces: [], spaceId: null, bundle: null });
    const spaces = await get<Space[]>(`/api/projects/${id}/spaces`);
    set({ projectId: id, spaces });
    const sid = recall("amw.spaceId");
    const target = spaces.find((s) => s.id === sid) ?? spaces[0];
    await getState().selectSpace(target?.id ?? null);
  },

  async selectSpace(id) {
    remember("amw.spaceId", id);
    set({ spaceId: id, bundle: null, selection: null, run: null });
    if (id) {
      await getState().refreshBundle();
      await getState().loadLatestRun();
    }
  },

  async refreshBundle() {
    const id = getState().spaceId;
    if (!id) return;
    const bundle = await get<SpaceBundle>(`/api/spaces/${id}/bundle`);
    if (getState().spaceId === id) set({ bundle });
  },

  select(selection) {
    set({ selection });
  },

  setPanel(panel) {
    set({ panel });
  },

  toast(kind, text) {
    const id = toastSeq++;
    set({ toasts: [...getState().toasts, { id, kind, text }] });
    setTimeout(() => getState().dismiss(id), kind === "error" ? 9000 : 4000);
  },

  dismiss(id) {
    set({ toasts: getState().toasts.filter((t) => t.id !== id) });
  },

  async loadLatestRun() {
    const id = getState().spaceId;
    if (!id) return;
    const runs = await get<WorkflowRun[]>(`/api/spaces/${id}/runs`);
    if (!runs.length) return set({ run: null });
    const detail = await get<{ run: WorkflowRun; jobs: Job[] }>(`/api/runs/${runs[0].id}`);
    set({ run: detail });
    if (detail.run.status === "RUNNING" || detail.run.status === "PENDING") getState().watchRun(detail.run.id);
  },

  watchRun(runId) {
    if (pollTimer) clearTimeout(pollTimer);
    const tick = async () => {
      try {
        const detail = await get<{ run: WorkflowRun; jobs: Job[] }>(`/api/runs/${runId}`);
        set({ run: detail });
        const done = !["RUNNING", "PENDING"].includes(detail.run.status);
        await getState().refreshBundle();
        if (done) {
          pollTimer = null;
          const kind = detail.run.status === "SUCCESS" ? "success" : detail.run.status === "CANCELLED" ? "info" : "error";
          getState().toast(kind, `Run ${detail.run.status.toLowerCase()}${detail.run.error ? `: ${detail.run.error}` : ""}`);
          return;
        }
      } catch {
        /* keep polling */
      }
      pollTimer = setTimeout(tick, 1500);
    };
    pollTimer = setTimeout(tick, 600);
  },
}));

export async function cancelRun(runId: string) {
  await post(`/api/runs/${runId}/cancel`);
}
