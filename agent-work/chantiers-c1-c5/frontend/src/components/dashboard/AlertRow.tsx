"use client";

import Link from "next/link";
import type { AlertItem } from "@/lib/api";

const LEVEL_STYLE: Record<AlertItem["level"], { dot: string; bg: string; text: string; icon: string }> = {
  critical: { dot: "bg-red-500", bg: "border-red-200 bg-red-50", text: "text-red-800", icon: "⚠️" },
  warning: { dot: "bg-amber-500", bg: "border-amber-200 bg-amber-50", text: "text-amber-800", icon: "🟠" },
  info: { dot: "bg-sky-500", bg: "border-sky-200 bg-sky-50", text: "text-sky-800", icon: "ℹ️" },
  success: { dot: "bg-emerald-500", bg: "border-emerald-200 bg-emerald-50", text: "text-emerald-800", icon: "✅" },
};

interface AlertRowProps {
  alert: AlertItem;
  onMarkRead?: (id: string) => void;
}

function formatAgo(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return `il y a ${Math.floor(diff / 86400)} j`;
}

export default function AlertRow({ alert, onMarkRead }: AlertRowProps) {
  const style = LEVEL_STYLE[alert.level];
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    alert.link
      ? ({ children: <Link href={alert.link} className="block">{children}</Link> } as any)
      : ({ children }: any) => <div>{children}</div>;

  return (
    <div className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${style.bg} ${alert.is_read ? "opacity-60" : ""}`}>
      <span className="mt-0.5 text-base leading-none" aria-hidden>{style.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <div className={`text-sm font-semibold ${style.text}`}>{alert.title}</div>
          <div className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
            {formatAgo(alert.created_at)}
          </div>
        </div>
        {alert.message && <div className="mt-0.5 text-xs text-slate-600">{alert.message}</div>}
      </div>
      {!alert.is_read && onMarkRead && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onMarkRead(alert.id);
          }}
          className="shrink-0 rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
          aria-label="Marquer comme lu"
        >
          Lu
        </button>
      )}
    </div>
  );
}
