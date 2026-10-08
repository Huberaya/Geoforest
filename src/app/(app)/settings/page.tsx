"use client";

import { Badge, Card, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import { ApiError, getSettings, patchSettings } from "@/lib/api";
import type { SettingsResponse } from "@/lib/eudr/types";
import { useEffect, useState } from "react";

/**
 * ⚠️ Les réglages réglementaires affichés ici sont **constatés**, pas
 * configurables. Les présenter comme des interrupteurs laisserait croire à un
 * réglage qui n'aurait aucun effet — ce serait une affirmation fausse.
 */
export default function SettingsPage() {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [form, setForm] = useState({ name: "", eori: "" });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await getSettings();
      setData(s);
      setForm({ name: s.organization.name, eori: s.organization.eori ?? "" });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible de charger les paramètres.");
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
     
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await patchSettings({ name: form.name, eori: form.eori });
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible : rien n'a été modifié.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div>
      <PageHeader title="Paramètres" subtitle="Identité de l'organisation et état constaté de la configuration." />

      {error && (
        <div className="mb-4">
          <ErrorState message={error} />
        </div>
      )}

      {!data ? null : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Metric label="Utilisateurs" value={data.usage.users} />
            <Metric label="Fournisseurs" value={data.usage.suppliers} />
            <Metric label="Parcelles" value={data.usage.plots} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">Organisation</h2>
              <form onSubmit={submit} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">Raison sociale</label>
                  <input
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-700">EORI</label>
                  <input
                    value={form.eori}
                    onChange={(e) => setForm({ ...form, eori: e.target.value.toUpperCase() })}
                    placeholder="FR12345678901"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs uppercase outline-none focus:border-emerald-500"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    disabled={saving}
                    className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
                  >
                    {saving ? "Enregistrement…" : "Enregistrer"}
                  </button>
                  {saved && <span className="text-[11px] text-emerald-700">✓ Enregistré</span>}
                </div>
              </form>
              <p className="mt-3 text-[10px] text-slate-400">
                Identifiant <code className="font-mono">{data.organization.slug}</code> · créée le{" "}
                {new Date(data.organization.createdAt).toLocaleDateString("fr-FR")}
              </p>
            </Card>

            <Card className="p-4">
              <h2 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400">
                Configuration réglementaire — état constaté
              </h2>
              <ul className="space-y-3">
                {[
                  {
                    label: "Analyse satellite",
                    configured: data.eudr_configuration.satellite_analysis.configured,
                    detail: `${data.eudr_configuration.satellite_analysis.provider} · ${data.eudr_configuration.satellite_analysis.dataset}`,
                    consequence: data.eudr_configuration.satellite_analysis.consequence,
                  },
                  {
                    label: "Mode démonstration",
                    configured: !data.eudr_configuration.demo_mode.enabled,
                    detail: data.eudr_configuration.demo_mode.enabled ? "Activé" : "Désactivé",
                    consequence: data.eudr_configuration.demo_mode.consequence ?? "Aucune analyse simulée.",
                  },
                  {
                    label: "Dépôt EUDR-IS",
                    configured: data.eudr_configuration.eudr_is_transmission.available,
                    detail: "Aucun client implémenté",
                    consequence: data.eudr_configuration.eudr_is_transmission.consequence,
                  },
                  {
                    label: "Stockage des documents",
                    configured: data.eudr_configuration.document_storage.available,
                    detail: "Aucun stockage",
                    consequence: data.eudr_configuration.document_storage.consequence,
                  },
                ].map((item) => (
                  <li key={item.label} className="rounded-lg border border-slate-200 p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-slate-800">{item.label}</span>
                      <Badge tone={item.configured ? "green" : "amber"}>
                        {item.configured ? "opérationnel" : "non disponible"}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[10px] text-slate-500">{item.detail}</div>
                    <div className="mt-1 text-[10px] leading-snug text-slate-600">{item.consequence}</div>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[10px] leading-snug text-slate-400">
                Ces états sont lus côté serveur au moment de l&apos;appel. Ils ne sont pas
                modifiables depuis l&apos;interface : ce sont des variables d&apos;environnement de
                l&apos;instance.
              </p>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
