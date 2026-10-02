// Version history: list, save a new version, restore, compare with current.
import { useEffect, useState } from "react";
import { History } from "lucide-react";
import type { EntityVersion, FieldChange, VersionedEntity } from "@amw/shared";
import { get, post } from "../../api";
import { errorText } from "../../actions";
import { useApp } from "../../store/app";
import { Button, Section } from "../ui";

const fmt = (v: unknown) => (v === null || v === undefined ? "∅" : typeof v === "string" ? v : JSON.stringify(v));

export function Versions({ type, id, onRestored, reloadKey }: { type: VersionedEntity; id: string; onRestored?: () => void | Promise<void>; reloadKey?: unknown }) {
  const toast = useApp((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [list, setList] = useState<EntityVersion[]>([]);
  const [cmp, setCmp] = useState<{ id: string; from: string; to: string; changes: FieldChange[] } | null>(null);
  const load = async () => setList(await get<EntityVersion[]>(`/api/versions/${type}/${id}`));
  useEffect(() => {
    if (open) void load();
    setCmp(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, type, id, reloadKey]);

  return (
    <Section
      title="Versions"
      right={
        <button className="flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-100" onClick={() => setOpen(!open)}>
          <History size={12} /> {open ? "hide" : "show"}
        </button>
      }
    >
      {open && (
        <div className="space-y-1">
          <Button
            size="sm"
            onClick={async () => {
              const note = prompt("Version note", "Manual snapshot");
              if (note === null) return;
              setList(await post(`/api/versions/${type}/${id}`, { note }));
              await onRestored?.();
            }}
          >
            Save as new version
          </Button>
          {list.map((v) => (
            <div key={v.id} className="rounded border border-zinc-800 p-1.5">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-zinc-200">v{v.version}</span>
                <span className="text-[10px] text-zinc-500">{new Date(v.createdAt).toLocaleString()}</span>
              </div>
              <div className="text-[11px] text-zinc-400">{v.note}</div>
              <div className="mt-1 flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    const r = await get<{ from: string; to: string; changes: FieldChange[] }>(`/api/version/${v.id}/compare?with=current`);
                    setCmp({ id: v.id, ...r });
                  }}
                >
                  Compare
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    if (!confirm(`Restore v${v.version}? Current content is kept in history.`)) return;
                    try {
                      await post(`/api/version/${v.id}/restore`);
                      await load();
                      await onRestored?.();
                      toast("success", `Restored v${v.version}`);
                    } catch (e) {
                      toast("error", errorText(e));
                    }
                  }}
                >
                  Restore
                </Button>
              </div>
              {cmp?.id === v.id && (
                <div className="mt-1 space-y-1 rounded bg-zinc-950 p-1.5 text-[11px]">
                  <div className="text-zinc-400">{cmp.from} → {cmp.to}: {cmp.changes.length ? `${cmp.changes.length} change(s)` : "no differences"}</div>
                  {cmp.changes.slice(0, 30).map((c) => (
                    <div key={c.field}>
                      <div className="font-semibold text-zinc-300">{c.field}</div>
                      <div className="whitespace-pre-wrap text-red-300/80 line-through">{fmt(c.before).slice(0, 400)}</div>
                      <div className="whitespace-pre-wrap text-emerald-300/90">{fmt(c.after).slice(0, 400)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}
