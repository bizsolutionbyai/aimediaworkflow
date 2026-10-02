// The workflow canvas: zoom, pan, minimap, grid, snap, multi-select, keyboard shortcuts, drag & drop.
import { useCallback, useEffect, useMemo } from "react";
import { Background, BackgroundVariant, Controls, MiniMap, ReactFlow, SelectionMode, useReactFlow, type Node } from "@xyflow/react";
import { NODE_TYPES, getNodeTypeDef } from "@amw/shared";
import { runWorkflow, saveWorkflow } from "../actions";
import { useApp } from "../store/app";
import { useCanvas } from "../store/canvas";
import { WorkflowNode } from "./nodes/WorkflowNode";

const nodeTypes = Object.fromEntries(NODE_TYPES.map((d) => [d.type, WorkflowNode]));
const MINIMAP: Record<string, string> = { input: "#0ea5e9", ai: "#8b5cf6", logic: "#f59e0b", output: "#10b981" };

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
}

export function Canvas() {
  const nodes = useCanvas((s) => s.nodes);
  const edges = useCanvas((s) => s.edges);
  const c = useCanvas.getState();
  const select = useApp((s) => s.select);
  const rf = useReactFlow();
  const viewport = useCanvas((s) => s.viewport);
  const spaceId = useApp((s) => s.spaceId);

  useEffect(() => {
    // Restore the saved viewport (or fit) whenever a space is opened.
    const t = setTimeout(() => {
      const vp = useCanvas.getState().viewport;
      if (vp) rf.setViewport(vp);
      else rf.fitView({ padding: 0.2 });
    }, 50);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === "s") {
        e.preventDefault();
        void saveWorkflow();
        return;
      }
      if (mod && e.key === "Enter") {
        e.preventDefault();
        void runWorkflow();
        return;
      }
      if (isTyping(e)) return;
      const cs = useCanvas.getState();
      if (mod && k === "z" && !e.shiftKey) (e.preventDefault(), cs.undo());
      else if (mod && (k === "y" || (k === "z" && e.shiftKey))) (e.preventDefault(), cs.redo());
      else if (mod && k === "c") cs.copySelected();
      else if (mod && k === "v") (e.preventDefault(), cs.paste());
      else if (mod && k === "d") (e.preventDefault(), cs.duplicateSelected());
      else if (mod && k === "a") (e.preventDefault(), useCanvas.setState({ nodes: cs.nodes.map((n) => ({ ...n, selected: true })) }));
      else if (e.shiftKey && k === "l") cs.layout();
      else if (k === "f" && !mod) rf.fitView({ padding: 0.2, duration: 300 });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rf]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const raw = e.dataTransfer.getData("application/amw-node");
      if (!raw) return;
      const { type, data } = JSON.parse(raw) as { type: string; data?: Record<string, unknown> };
      if (!getNodeTypeDef(type)) return;
      const pos = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const id = useCanvas.getState().addNode(type, { x: pos.x - 110, y: pos.y - 30 }, data);
      select({ kind: "node", id });
    },
    [rf, select],
  );

  const defaultEdgeOptions = useMemo(() => ({ animated: false }), []);

  return (
    <div className="h-full w-full" onDragOver={(e) => (e.preventDefault(), (e.dataTransfer.dropEffect = "copy"))} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={c.onNodesChange}
        onEdgesChange={c.onEdgesChange}
        onConnect={c.onConnect}
        onNodeDragStart={() => useCanvas.getState().commit()}
        onNodeDoubleClick={(_, n: Node) => select({ kind: "node", id: n.id })}
        onNodeClick={(_, n: Node) => select({ kind: "node", id: n.id })}
        onPaneClick={() => select(null)}
        onMoveEnd={(_, vp) => useCanvas.setState({ viewport: vp })}
        defaultViewport={viewport ?? undefined}
        defaultEdgeOptions={defaultEdgeOptions}
        snapToGrid
        snapGrid={[20, 20]}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        panOnDrag={[1, 2]}
        panOnScroll
        zoomOnScroll={false}
        zoomActivationKeyCode={["Control", "Meta"]}
        multiSelectionKeyCode={["Shift", "Control", "Meta"]}
        deleteKeyCode={["Delete", "Backspace"]}
        minZoom={0.1}
        maxZoom={2}
        colorMode="dark"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#3f3f46" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeColor={(n) => MINIMAP[getNodeTypeDef(n.type ?? "")?.category ?? "logic"]} maskColor="rgba(9,9,11,0.7)" />
      </ReactFlow>
    </div>
  );
}
