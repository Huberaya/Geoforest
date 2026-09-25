"use client";

import Link from "next/link";
import type { OnboardingStep } from "@/lib/api";

interface Props {
  steps: OnboardingStep[];
  completed: number;
  total: number;
}

export default function OnboardingChecklist({ steps, completed, total }: Props) {
  const pct = total === 0 ? 0 : Math.round((completed / total) * 100);
  return (
    <div className="card">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">🚀 Mise en route</h3>
        <span className="text-xs font-semibold text-emerald-700">
          {completed}/{total}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-emerald-500 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <ul className="mt-4 space-y-2">
        {steps.map((s) => (
          <li key={s.key}>
            <StepRow step={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepRow({ step }: { step: OnboardingStep }) {
  const available = step.available;
  const done = step.done;
  const Row = (children: React.ReactNode) =>
    available ? (
      <Link href={step.href} className="flex items-start gap-3 rounded-lg p-2 hover:bg-slate-50">
        {children}
      </Link>
    ) : (
      <div className="flex cursor-not-allowed items-start gap-3 rounded-lg p-2 opacity-60">
        {children}
      </div>
    );
  return Row(
    <>
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
          done
            ? "bg-emerald-500 text-white"
            : available
              ? "border-2 border-emerald-300 bg-white text-emerald-600"
              : "border-2 border-slate-200 bg-slate-100 text-slate-400"
        }`}
      >
        {done ? "✓" : step.available ? "" : "🔒"}
      </span>
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-medium ${done ? "text-slate-500 line-through" : "text-slate-800"}`}>
          {step.title}
        </div>
        <div className="text-xs text-slate-500">{step.description}</div>
        {!available && step.available_chantier && (
          <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Disponible au chantier {step.available_chantier}
          </div>
        )}
      </div>
    </>,
  );
}
