"use client";

import Link from "next/link";
import type { AlertItem } from "@/lib/api";

const LEVEL_STYLE: Record<AlertItem["level"], { bg: string; text: string; icon: string }> = {
  critical: { bg: "border-red-200 bg-red-50", text: "text-red-800", icon: "⚠️" },
  warning: { bg: "border-amber-200 bg-amber-50", text: "text-amber-800", icon: "🟠" },
  info: { bg: "border-sky-200 bg-sky-50", text: "text-sky-800", icon: "ℹ️" },
  success: { bg: "border-emerald-200 bg-emerald-50", text: "text-emerald-800", icon: "✅" },
};

interface AlertRowProps {
  alert: AlertItem;
  onMarkRead?: (id: string) => void;
  onMarkUnread?: (id: string) => void;
}

function formatAgo(iso: string) {
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const diff = Math.max(0, (Date.now() - timestamp) / 1000);
  if (diff < 60) return "à l'instant";
  if (diff < 3600) return `il y a ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `il y a ${Math.floor(diff / 3600)} h`;
  return `il y a ${Math.floor(diff / 86400)} j`;
}

export default function AlertRow({ alert, onMarkRead, onMarkUnread }: AlertRowProps) {
  const style = LEVEL_STYLE[alert.level];
  return (
    <article className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${style.bg} ${alert.is_read ? "opacity-70" : ""}`}>
      <span className="mt-0.5 text-base leading-none" aria-hidden="true">{style.icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1">
          <h3 className={`text-sm font-semibold ${style.text}`}>
            {alert.link ? <Link href={alert.link} className="hover:underline">{alert.title}</Link> : alert.title}
          </h3>
          <time dateTime={alert.created_at} className="shrink-0 text-[10px] uppercase tracking-wide text-slate-400">
            {formatAgo(alert.created_at)}
          </time>
        </div>
        {alert.message && <p className="mt-0.5 text-xs text-slate-600">{alert.message}</p>}
      </div>
      {!alert.is_read && onMarkRead && (
        <button
          type="button"
          onClick={() => onMarkRead(alert.id)}
          className="shrink-0 rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
          aria-label={`Marquer « ${alert.title} » comme lue`}
        >
          Lu
        </button>
      )}
      {alert.is_read && onMarkUnread && (
        <button
          type="button"
          onClick={() => onMarkUnread(alert.id)}
          className="shrink-0 rounded-md bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"
          aria-label={`Marquer « ${alert.title} » comme non lue`}
        >
          Non lue
        </button>
      )}
    </article>
  );
}
