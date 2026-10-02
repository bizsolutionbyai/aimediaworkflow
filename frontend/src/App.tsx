import { useEffect } from "react";
import { useApp } from "./store/app";
import { useCanvas } from "./store/canvas";
import { Canvas } from "./components/Canvas";
import { StatusBar } from "./components/StatusBar";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/sidebar/Sidebar";
import { RightPanel } from "./components/panels/RightPanel";
import { AssistantPanel } from "./components/dialogs/Assistant";
import { CheckDialog, ExportDialog, ProjectsDialog, RunLogDialog, SettingsDialog } from "./components/dialogs/Dialogs";
import { cx } from "./components/ui";

export default function App() {
  const { init, spaceId, bundle, panel, toasts, dismiss } = useApp();
  const loadedFor = useApp((s) => s.bundle?.space.id);

  useEffect(() => {
    void init().catch((e) => useApp.getState().toast("error", `Cannot reach the backend: ${e.message}`));
  }, [init]);

  // Load the canvas from the server whenever a different space is opened.
  useEffect(() => {
    if (bundle && loadedFor === spaceId) useCanvas.getState().load(bundle.workflow);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedFor]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (useCanvas.getState().dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1">
          {spaceId ? (
            <Canvas />
          ) : (
            <div className="grid h-full place-items-center text-zinc-500">
              <div className="text-center">
                <div className="text-lg text-zinc-300">No space open</div>
                <button className="mt-2 rounded-md bg-violet-600 px-3 py-1.5 text-white" onClick={() => useApp.getState().setPanel("projects")}>
                  Create a project & space
                </button>
              </div>
            </div>
          )}
        </main>
        {spaceId && <RightPanel />}
      </div>
      <StatusBar />
      {panel === "projects" && <ProjectsDialog />}
      {panel === "check" && <CheckDialog />}
      {panel === "export" && <ExportDialog />}
      {panel === "settings" && <SettingsDialog />}
      {panel === "runlog" && <RunLogDialog />}
      {panel === "assistant" && <AssistantPanel />}
      <div className="pointer-events-none fixed bottom-10 right-[396px] z-[60] flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => dismiss(t.id)}
            className={cx(
              "pointer-events-auto cursor-pointer rounded-md border px-3 py-2 text-[13px] shadow-xl",
              t.kind === "error" && "border-red-500/50 bg-red-950 text-red-100",
              t.kind === "success" && "border-emerald-500/50 bg-emerald-950 text-emerald-100",
              t.kind === "info" && "border-zinc-700 bg-zinc-900 text-zinc-100",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
