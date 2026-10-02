// Generated outputs with "use as input" selection (batch generation → pick the preferred one).
import { Check, Trash2 } from "lucide-react";
import type { Output } from "@amw/shared";
import { del, fileUrl, post } from "../../api";
import { useApp } from "../../store/app";
import { Empty, cx } from "../ui";

export function OutputsGallery({ outputs }: { outputs: Output[] }) {
  const refreshBundle = useApp((s) => s.refreshBundle);
  if (!outputs.length) return <Empty>No outputs yet.</Empty>;
  const sorted = [...outputs].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.index - b.index);
  return (
    <div className="grid grid-cols-2 gap-2">
      {sorted.map((o) => (
        <div key={o.id} className={cx("group relative overflow-hidden rounded-md border bg-zinc-900", o.selected ? "border-emerald-500" : "border-zinc-800")}>
          {o.kind === "image" ? (
            <a href={fileUrl(o.path)} target="_blank" rel="noreferrer">
              <img src={fileUrl(o.path)} className="h-28 w-full object-cover" alt="" />
            </a>
          ) : o.kind === "video" ? (
            <video src={fileUrl(o.path)} className="h-28 w-full bg-black object-contain" controls preload="metadata" />
          ) : (
            <audio src={fileUrl(o.path)} className="w-full" controls preload="none" />
          )}
          <div className="flex items-center justify-between px-1.5 py-1 text-[10px] text-zinc-400">
            <span className="truncate" title={`${o.id} · ${o.provider} ${o.model}`}>
              {o.kind} #{o.index + 1} · {o.provider}
            </span>
            {o.selected ? (
              <span className="flex items-center gap-0.5 text-emerald-300">
                <Check size={10} /> input
              </span>
            ) : (
              <button
                className="text-violet-300 hover:text-violet-100"
                title="Use this output as the input for downstream nodes"
                onClick={async () => {
                  await post(`/api/outputs/${o.id}/select`);
                  await refreshBundle();
                }}
              >
                select
              </button>
            )}
          </div>
          <button
            className="absolute right-1 top-1 hidden rounded bg-black/70 p-1 text-red-300 group-hover:block"
            title="Delete output"
            onClick={async () => {
              if (!confirm("Delete this output file?")) return;
              await del(`/api/outputs/${o.id}`);
              await refreshBundle();
            }}
          >
            <Trash2 size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
