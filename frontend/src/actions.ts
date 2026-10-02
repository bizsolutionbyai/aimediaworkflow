// Cross-component actions that touch both the app store and the canvas store.
import type { CheckReport, WorkflowDoc, WorkflowRun } from "@amw/shared";
import { ApiError, get, post, put } from "./api";
import { useApp } from "./store/app";
import { useCanvas } from "./store/canvas";

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function saveWorkflow(note = "Saved"): Promise<boolean> {
  const { projectId, spaceId, toast } = useApp.getState();
  if (!projectId || !spaceId) return false;
  const c = useCanvas.getState();
  try {
    await put(`/api/spaces/${spaceId}/workflow`, { workflow: c.toDoc(projectId, spaceId, c.viewport ?? undefined), note });
    useCanvas.getState().markSaved();
    await useApp.getState().refreshBundle();
    return true;
  } catch (e) {
    toast("error", `Save failed: ${errorText(e)}`);
    return false;
  }
}

/** Reloads the canvas from the server (after storyboard generation, import, restore). */
export async function reloadCanvas() {
  const { spaceId } = useApp.getState();
  if (!spaceId) return;
  const r = await get<{ workflow: WorkflowDoc }>(`/api/spaces/${spaceId}/workflow`);
  useCanvas.getState().load(r.workflow);
  await useApp.getState().refreshBundle();
}

export async function checkWorkflow(): Promise<CheckReport & { text: string }> {
  const { spaceId } = useApp.getState();
  return post(`/api/spaces/${spaceId}/check`);
}

export let lastCheck: (CheckReport & { text: string; blocking?: { message: string; nodeId?: string }[] }) | null = null;

export async function runWorkflow(targets?: string[], mode: "missing" | "all" = "missing") {
  const app = useApp.getState();
  if (!app.spaceId) return;
  if (useCanvas.getState().dirty && !(await saveWorkflow("Saved before run"))) return;
  try {
    const r = await post<{ run: WorkflowRun }>(`/api/spaces/${app.spaceId}/run`, { targets, mode });
    app.toast("info", targets?.length ? `Generating ${targets.join(", ")}…` : "Workflow started");
    app.watchRun(r.run.id);
    await app.loadLatestRun();
  } catch (e) {
    if (e instanceof ApiError && e.status === 422) {
      lastCheck = { ...e.data.report, text: "", blocking: e.data.blocking };
      app.setPanel("check");
      app.toast("error", "Workflow check failed — fix the errors before running");
    } else app.toast("error", errorText(e));
  }
}
