"use client";

import type { ReactNode } from "react";

type Tone = "slate" | "emerald" | "amber" | "red" | "sky" | "violet";

const TONES: Record<Tone, { border: string; bg: string; text: string; value: string; sub: string; icon: string }> = {
  slate: {
    border: "border-slate-200",
    bg: "bg-white",
    text: "text-slate-900",
    value: "text-slate-900",
    sub: "text-slate-500",
    icon: "bg-slate-100 text-slate-500",
  },
  emerald: {
    border: "border-emerald-200",
    bg: "bg-emerald-50/40",
    text: "text-emerald-900",
    value: "text-emerald-700",
    sub: "text-emerald-700/80",
    icon: "bg-emerald-100 text-emerald-700",
  },
  amber: {
    border: "border-amber-200",
    bg: "bg-amber-50/40",
    text: "text-amber-900",
    value: "text-amber-700",
    sub: "text-amber-700/80",
    icon: "bg-amber-100 text-amber-700",
  },
  red: {
    border: "border-red-200",
    bg: "bg-red-50/40",
    text: "text-red-900",
    value: "text-red-700",
    sub: "text-red-700/80",
    icon: "bg-red-100 text-red-700",
  },
  sky: {
    border: "border-sky-200",
    bg: "bg-sky-50/40",
    text: "text-sky-900",
    value: "text-sky-700",
    sub: "text-sky-700/80",
    icon: "bg-sky-100 text-sky-700",
  },
  violet: {
    border: "border-violet-200",
    bg: "bg-violet-50/40",
    text: "text-violet-900",
    value: "text-violet-700",
    sub: "text-violet-700/80",
    icon: "bg-violet-100 text-violet-700",
  },
};

interface KpiCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ReactNode;
  tone?: Tone;
  onClick?: () => void;
  comingSoon?: boolean;
}

export default function KpiCard({
  label,
  value,
  sub,
  icon,
  tone = "slate",
  onClick,
  comingSoon,
}: KpiCardProps) {
  const t = TONES[tone];
  const clickable = !!onClick;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!clickable}
      className={`relative rounded-2xl border ${t.border} ${t.bg} p-4 text-left transition ${
        clickable ? "cursor-pointer hover:shadow-md" : "cursor-default"
      } ${comingSoon ? "opacity-70" : ""}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={`text-[11px] font-semibold uppercase tracking-wide ${t.sub}`}>
          {label}
        </div>
        {icon && <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${t.icon}`}>{icon}</div>}
      </div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${t.value}`}>{value}</div>
      {sub && <div className={`mt-1 text-xs ${t.sub}`}>{sub}</div>}
      {comingSoon && (
        <span className="absolute right-3 top-3 rounded-full bg-slate-200 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          À venir
        </span>
      )}
    </button>
  );
}
