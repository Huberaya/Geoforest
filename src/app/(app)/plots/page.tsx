"use client";

import { Badge, Card, EmptyState, ErrorState, LoadingState, Metric, PageHeader } from "@/components/PageShell";
import RiskBadge from "@/components/RiskBadge";
import { ApiError, createPlot, deletePlot, listPlots } from "@/lib/api";
import { COMMODITIES, COMMODITY_LABELS, type Commodity, type Plot } from "@/lib/eudr/types";
import Link from "next/link";
import { useEffect, useState } from "react";

const EXAMPLE =
  '{"type":"Polygon","coordinates":[[[-5.500000,5.300000],[-5.490000,5.300000],' +
  "[-5.490000,5.310000],[-5.500000,5.310000],[-5.500000,5.300000]]]}";

export default function PlotsPage() {
  const [plots, setPlots] = useState<Plot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: "",
    reference: "",
    commodity: "cocoa" as Commodity,
    countryCode: "CI",
    geometryText: "",
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setPlots(await listPlots(q ? { q } : {}));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Impossible de charger les parcelles.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await createPlot({
        name: form.name,
        reference: form.reference || undefined,
        commodity: form.commodity,
        countryCode: form.countryCode,
        // Le texte saisi est transmis tel quel : le serveur en mesure la
        // précision réelle. Le re-sérialiser détruirait les décimales.
        geometry_text: form.geometryText,
      });
      setForm({ name: "", reference: "", commodity: form.commodity, countryCode: form.countryCode, geometryText: "" });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enregistrement impossible : la parcelle n'a pas été créée.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (plot: Plot) => {
    if (!confirm(`Supprimer la parcelle « ${plot.name} » ? Cette action est définitive.`)) return;
    try {
      await deletePlot(plot.id);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Suppression impossible.");
    }
  };

  const totalArea = plots.reduce((s, p) => s + p.areaHa, 0);
  const audited = plots.filter((p) => p.lastAuditAt).length;

  return (
    <div>
      <PageHeader
        title="Parcelles"
        subtitle="Géolocalisation des parcelles de production, avec leur surface calculée."
        actions={
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
          >
            {showForm ? "Annuler" : "+ Ajouter une parcelle"}
          </button>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Parcelles" value={plots.length} />
        <Metric label="Surface totale" value={plots.length ? `${totalArea.toFixed(2)} ha` : null} />
        <Metric label="Déjà analysées" value={audited} hint="Audit enregistré" />
        <Metric
          label="Analyses probantes"
          value={plots.length ? plots.filter((p) => p.confidenceScore !== null).length : null}
          hint="P0-04 : sans données GFW, aucune"
        />
      </div>

      {showForm && (
        <Card className="mb-4 p-4">
          <form onSubmit={submit} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Nom de la parcelle *</label>
                <input
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Référence</label>
                <input
                  value={form.reference}
                  onChange={(e) => setForm({ ...form, reference: e.target.value })}
                  placeholder="ex. PLT-001"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Matière première *</label>
                <select
                  value={form.commodity}
                  onChange={(e) => setForm({ ...form, commodity: e.target.value as Commodity })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
                >
                  {COMMODITIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-700">Pays (ISO 2) *</label>
                <input
                  required
                  maxLength={2}
                  value={form.countryCode}
                  onChange={(e) => setForm({ ...form, countryCode: e.target.value.toUpperCase() })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs uppercase outline-none focus:border-emerald-500"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-700">
                Géométrie GeoJSON * — 6 décimales attendues par le SI EUDR
              </label>
              <textarea
                required
                rows={4}
                value={form.geometryText}
                onChange={(e) => setForm({ ...form, geometryText: e.target.value })}
                placeholder={EXAMPLE}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-[11px] outline-none focus:border-emerald-500"
              />
              <p className="mt-1 text-[10px] leading-snug text-slate-400">
                Au-delà de 4 ha, un polygone est exigé par l&apos;article 9(1)(d) du règlement 2023/1115.
              </p>
            </div>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-60"
            >
              {saving ? "Enregistrement…" : "Enregistrer la parcelle"}
            </button>
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
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher une parcelle…"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:border-emerald-500"
          />
        </div>

        {loading ? (
          <LoadingState />
        ) : plots.length === 0 ? (
          <EmptyState
            title="Aucune parcelle enregistrée"
            message="Sans parcelle géolocalisée, aucun dossier de diligence raisonnée ne peut être constitué. Importez ou saisissez une géométrie GeoJSON pour commencer."
            cta={undefined}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2">Parcelle</th>
                  <th className="px-4 py-2">Matière</th>
                  <th className="px-4 py-2">Pays</th>
                  <th className="px-4 py-2">Géométrie</th>
                  <th className="px-4 py-2">Surface</th>
                  <th className="px-4 py-2">Risque</th>
                  <th className="px-4 py-2">Analyse</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plots.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <Link href={`/plots/${p.id}`} className="font-semibold text-slate-800 hover:text-emerald-700">
                        {p.name}
                      </Link>
                      <div className="text-[10px] text-slate-400">
                        {p.reference ?? "sans référence"}
                        {p.supplierName ? ` · ${p.supplierName}` : ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-slate-600">{COMMODITY_LABELS[p.commodity] ?? p.commodity}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.countryCode}</td>
                    <td className="px-4 py-2.5 text-slate-600">{p.geometryType}</td>
                    <td className="px-4 py-2.5 font-mono text-slate-700">{p.areaHa.toFixed(2)} ha</td>
                    <td className="px-4 py-2.5">
                      <RiskBadge level={p.riskLevel} />
                    </td>
                    <td className="px-4 py-2.5">
                      {p.lastAuditAt ? (
                        <Badge tone={p.status === "NON_COMPLIANT" ? "red" : p.status === "COMPLIANT" ? "green" : "grey"}>
                          {p.status}
                        </Badge>
                      ) : (
                        <Badge tone="grey">non analysée</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void remove(p)}
                        className="rounded px-2 py-1 text-[10px] font-semibold text-slate-400 hover:bg-red-50 hover:text-red-700"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
