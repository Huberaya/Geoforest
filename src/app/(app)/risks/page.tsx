"use client";

import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import { ApiError, createTask, listTasks, patchTask } from "@/lib/api";
import type { ComplianceTask } from "@/lib/eudr/types";
import { useEffect, useState } from "react";

const SEVERITY_TONES: Record<ComplianceTask["severity"], string> = {
  LOW: "grey",
  MEDIUM: "blue",
  HIGH: "amber",
  CRITICAL: "red",
};
const STATUS_LABELS: Record<ComplianceTask["status"], string> = {
  TO_HANDLE: "À traiter",
  IN_PROGRESS: "En cours",
  RESOLVED: "Résolu",
  VALIDATED: "Validé",
};

export default function RisksPage() {
  const [tasks, setTasks] = useState<ComplianceTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    title: "",
    description: "",
    severity: "MEDIUM" as ComplianceTask["severity"],
    dueDate: "",
    assignee: "",
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await listTasks(status ? { status } : {}));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible de charger les actions.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Différé d'un micro-tâche : l'effet ne déclenche pas de rendu
    // en cascade (règle react-hooks/set-state-in-effect).
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createTask({
        title: form.title,
        description: form.description || undefined,
        severity: form.severity,
        dueDate: form.dueDate || undefined,
        assignee: form.assignee || undefined,
      });
      setForm({ title: "", description: "", severity: form.severity, dueDate: "", assignee: "" });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Création impossible : l'action n'a pas été enregistrée.");
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (task: ComplianceTask, next: ComplianceTask["status"]) => {
    try {
      await patchTask(task.id, { status: next });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Mise à jour impossible.");
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div>
      <PageHeader
        title="Risques & actions"
        subtitle="Actions correctives à mener pour lever les risques identifiés sur les dossiers."
        actions={
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            {showForm ? "Annuler" : "+ Créer une action"}
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Actions" value={tasks.length} />
        <Metric label="Critiques" value={tasks.filter((t) => t.severity === "CRITICAL").length} />
        <Metric label="En cours" value={tasks.filter((t) => t.status === "IN_PROGRESS").length} />
        <Metric
          label="En retard"
          value={tasks.filter((t) => t.dueDate && t.dueDate < today && t.status !== "RESOLVED" && t.status !== "VALIDATED").length}
        />
      </div>

      {showForm && (
        <Card className="mb-4 p-4">
          <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">Intitulé *</label>
              <input
                required
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Sévérité</label>
              <select
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value as ComplianceTask["severity"] })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              >
                <option value="LOW">Faible</option>
                <option value="MEDIUM">Moyenne</option>
                <option value="HIGH">Élevée</option>
                <option value="CRITICAL">Critique</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Échéance</label>
              <input
                type="date"
                value={form.dueDate}
                onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">Responsable</label>
              <input
                value={form.assignee}
                onChange={(e) => setForm({ ...form, assignee: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="mb-1 block text-xs font-semibold text-slate-700">Description</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
              />
            </div>
            <div className="sm:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
              >
                {saving ? "Enregistrement…" : "Créer l'action"}
              </button>
            </div>
          </form>
        </Card>
      )}

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      <Card>
        <div className="border-b border-slate-100 p-3">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
          >
            <option value="">Tous les statuts</option>
            <option value="TO_HANDLE">À traiter</option>
            <option value="IN_PROGRESS">En cours</option>
            <option value="RESOLVED">Résolu</option>
            <option value="VALIDATED">Validé</option>
          </select>
        </div>

        {loading ? (
          <LoadingState />
        ) : tasks.length === 0 ? (
          <EmptyState
            title="Aucune action enregistrée"
            message="Les actions sont créées à la suite d'un risque identifié sur un dossier de diligence raisonnée. Une base sans action n'est pas une anomalie : c'est l'état réel."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge tone={SEVERITY_TONES[t.severity]}>{t.severity}</Badge>
                    <span className="text-xs font-semibold text-slate-800">{t.title}</span>
                  </div>
                  {t.description && <p className="mt-1 text-[11px] leading-relaxed text-slate-500">{t.description}</p>}
                  <div className="mt-1 text-[10px] text-slate-400">
                    {t.ddsReference ? `Dossier ${t.ddsReference} · ` : ""}
                    {t.assignee ? `Responsable ${t.assignee} · ` : ""}
                    {t.dueDate
                      ? `Échéance ${t.dueDate}${t.dueDate < today && t.status !== "RESOLVED" && t.status !== "VALIDATED" ? " — dépassée" : ""}`
                      : "Sans échéance"}
                  </div>
                </div>
                <select
                  value={t.status}
                  onChange={(e) => void changeStatus(t, e.target.value as ComplianceTask["status"])}
                  className="rounded border border-slate-200 px-2 py-1 text-[10px] outline-none focus:border-emerald-500"
                >
                  {(Object.keys(STATUS_LABELS) as ComplianceTask["status"][]).map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
