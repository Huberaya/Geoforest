import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Gabarit commun des écrans du parcours (P0-08).
 *
 * Deux règles portées par ce composant :
 * - un écran en erreur **dit** l'erreur, il n'affiche pas une liste vide ;
 * - un écran sans donnée affiche un **état vide explicite**, jamais des
 *   valeurs d'illustration (P0-09).
 */

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>
  );
}

export function EmptyState({
  title,
  message,
  cta,
}: {
  title: string;
  message: string;
  cta?: { href: string; label: string };
}) {
  return (
    <div className="px-5 py-14 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl text-slate-400">
        ∅
      </div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-500">{message}</p>
      {cta && (
        <Link
          href={cta.href}
          className="mt-4 inline-block rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
        >
          {cta.label}
        </Link>
      )}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-800">
      ✕ {message}
    </div>
  );
}

export function LoadingState({ label = "Chargement…" }: { label?: string }) {
  return <div className="px-5 py-10 text-center text-xs text-slate-400">{label}</div>;
}

/** Indicateur dont la valeur ne peut pas être calculée — jamais un zéro trompeur. */
export function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number | null;
  hint?: string;
}) {
  const unavailable = value === null;
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-bold ${unavailable ? "text-slate-300" : "text-slate-900"}`}>
        {unavailable ? "—" : value}
      </div>
      {hint && <div className="mt-0.5 text-[10px] leading-snug text-slate-400">{hint}</div>}
    </div>
  );
}

const BADGE_STYLES: Record<string, string> = {
  neutral: "bg-slate-100 text-slate-700 ring-slate-200",
  green: "bg-emerald-100 text-emerald-800 ring-emerald-200",
  red: "bg-red-100 text-red-800 ring-red-200",
  amber: "bg-amber-100 text-amber-900 ring-amber-200",
  blue: "bg-sky-100 text-sky-800 ring-sky-200",
  grey: "bg-slate-100 text-slate-500 ring-slate-200",
};

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof BADGE_STYLES | string }) {
  const cls = BADGE_STYLES[tone] ?? BADGE_STYLES.neutral;
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${cls}`}>
      {children}
    </span>
  );
}
