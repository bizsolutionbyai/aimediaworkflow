// Small UI primitives shared across panels.
import { X } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

type Variant = "default" | "primary" | "danger" | "ghost";

export function Button({ variant = "default", size = "md", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "h-7 px-2 text-xs" : "h-8 px-3 text-[13px]",
        variant === "primary" && "bg-violet-600 text-white hover:bg-violet-500",
        variant === "danger" && "bg-red-600/20 text-red-300 hover:bg-red-600/30",
        variant === "ghost" && "text-zinc-300 hover:bg-zinc-800",
        variant === "default" && "border border-zinc-700 bg-zinc-800/80 text-zinc-100 hover:bg-zinc-700",
        className,
      )}
    />
  );
}

const fieldCls = "w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[13px] text-zinc-100 placeholder:text-zinc-500 focus:border-violet-500 focus:outline-none";

export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(fieldCls, p.className)} />;
}

export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} {...p} className={cx(fieldCls, "resize-y leading-relaxed", p.className)} />;
}

export function Select({ options, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[] }) {
  return (
    <select {...p} className={cx(fieldCls, "pr-6", p.className)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="space-y-2 border-t border-zinc-800 pt-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-zinc-300">{title}</h3>
        {right}
      </div>
      {children}
    </div>
  );
}

export function Badge({ tone = "zinc", children }: { tone?: "zinc" | "green" | "red" | "amber" | "violet" | "blue"; children: ReactNode }) {
  const tones = {
    zinc: "bg-zinc-800 text-zinc-300",
    green: "bg-emerald-500/15 text-emerald-300",
    red: "bg-red-500/15 text-red-300",
    amber: "bg-amber-500/15 text-amber-300",
    violet: "bg-violet-500/15 text-violet-300",
    blue: "bg-sky-500/15 text-sky-300",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold", tones[tone])}>{children}</span>;
}

export function statusTone(s: string | undefined): "zinc" | "green" | "red" | "amber" | "blue" {
  if (s === "SUCCESS") return "green";
  if (s === "FAILED") return "red";
  if (s === "RUNNING") return "blue";
  if (s === "PENDING") return "amber";
  return "zinc";
}

export function Modal({ title, onClose, children, width = "max-w-2xl" }: { title: string; onClose: () => void; children: ReactNode; width?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-6 pt-16" onMouseDown={onClose}>
      <div className={cx("w-full rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl", width)} onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button className="text-zinc-400 hover:text-zinc-100" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-md border border-dashed border-zinc-700 p-3 text-center text-xs text-zinc-500">{children}</div>;
}
