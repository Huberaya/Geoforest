"use client";

import { useEffect, useMemo, useState } from "react";
import {
  type DeforestationCandidate,
  type DeforestationScreening,
  type DeforestationScreeningHistory,
  listDeforestationCandidates,
  listDeforestationScreenings,
  runDeforestationScreening,
} from "@/lib/api";

function hectares(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 4 }).format(value)} ha`;
}

function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 3 }).format(value)} %`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(value));
}

function screeningLabel(status: DeforestationScreening["status"]): { label: string; className: string } {
  switch (status) {
    case "signal_post_2020":
      return { label: "Signal post-2020 — revue humaine requise", className: "bg-amber-100 text-amber-900 ring-amber-200" };
    case "no_signal_observed":
      return { label: "Aucun signal observé — ne signifie pas conforme", className: "bg-sky-100 text-sky-900 ring-sky-200" };
    case "non_evaluable":
      return { label: "Non évaluable avec cette géométrie", className: "bg-slate-100 text-slate-700 ring-slate-200" };
    case "source_unavailable":
      return { label: "Source indisponible — aucun résultat", className: "bg-rose-100 text-rose-900 ring-rose-200" };
  }
}

function CandidateLabel({ candidate }: { candidate: DeforestationCandidate }) {
  return (
    <>
      <span className="font-semibold">{candidate.internal_ref || candidate.name || "Parcelle sans nom"}</span>
      <span className="text-slate-500"> · {candidate.shipment_reference || "Lot sans référence"}</span>
      <span className="text-slate-500"> · {candidate.geometry_type || "géométrie inconnue"}</span>
      <span className="text-slate-500"> · {hectares(candidate.area_ha)}</span>
    </>
  );
}

function ScreeningCard({ result }: { result: DeforestationScreening }) {
  const badge = screeningLabel(result.status);
  const hasObservations = result.status === "signal_post_2020" || result.status === "no_signal_observed";
  return (
    <section className="card space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ring-1 ${badge.className}`}>
            {badge.label}
          </div>
          <p className="mt-2 max-w-3xl text-sm text-slate-700">{result.message}</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          <div>Calculé le {formatDate(result.analyzed_at)}</div>
          <div>{result.source} · {result.dataset} {result.dataset_version}</div>
        </div>
      </div>

      {result.error_code && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
          Code de diagnostic : <span className="font-mono">{result.error_code}</span>. Aucun résultat simulé n'a été utilisé.
        </div>
      )}

      {hasObservations ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Perte cartographiée ≤ 2020 · filtre 10 %" value={hectares(result.pre_cutoff_loss_ha_10pct)} />
            <Metric label="Perte cartographiée ≥ 2021 · filtre 10 %" value={hectares(result.post_cutoff_loss_ha_10pct)} />
            <Metric label="Part estimée de la parcelle · filtre 10 %" value={percent(result.post_cutoff_share_pct_10pct)} />
            <Metric label="Première année post-2020 · filtre 10 %" value={result.first_post_cutoff_year_10pct?.toString() || "Aucune retournée"} />
          </div>

          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
            <div className="text-sm font-semibold text-slate-800">Sensibilité du filtre de couvert</div>
            <div className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
              <div>10 % : ≤ 2020 {hectares(result.pre_cutoff_loss_ha_10pct)} · ≥ 2021 {hectares(result.post_cutoff_loss_ha_10pct)}</div>
              <div>30 % : ≤ 2020 {hectares(result.pre_cutoff_loss_ha_30pct)} · ≥ 2021 {hectares(result.post_cutoff_loss_ha_30pct)}</div>
            </div>
            <p className="mt-2 text-xs text-slate-600">Les filtres de couvert sont des paramètres de dépistage; ils ne qualifient pas juridiquement une forêt.</p>
          </div>
        </>
      ) : (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
          Aucune mesure de perte exploitable n'est disponible pour cette tentative; les surfaces ne sont pas évaluées.
        </div>
      )}

      {hasObservations && result.boundary_year_uncertainty && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          Signal cartographié en 2020 et/ou 2021 : l'observation annuelle ne permet pas de déterminer le jour de perte par rapport au 31/12/2020. Vérification humaine nécessaire.
        </div>
      )}

      {hasObservations && result.loss_by_year.length > 0 && (
        <details className="rounded-lg border border-slate-200">
          <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-slate-700">Voir les valeurs annuelles retournées ({result.loss_by_year.length})</summary>
          <div className="max-h-72 overflow-auto border-t border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 text-slate-500">
                <tr><th className="px-3 py-2">Année cartographiée</th><th className="px-3 py-2">Surface · 10 %</th><th className="px-3 py-2">Surface · 30 %</th></tr>
              </thead>
              <tbody>
                {result.loss_by_year.map((row) => (
                  <tr key={row.year} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-medium">{row.year}</td>
                    <td className="px-3 py-2">{hectares(row.area_ha_10pct)}</td>
                    <td className="px-3 py-2">{hectares(row.area_ha_30pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      <div className="border-t border-slate-100 pt-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Limites à garder en tête</div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
          {result.caveats.map((caveat, index) => <li key={`${index}-${caveat}`}>{caveat}</li>)}
        </ul>
        <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
          <span>Résolution : {result.spatial_resolution_m} m</span>
          <span>Période publiée : {result.data_first_year}–{result.data_last_year}</span>
          <span>Date de référence EUDR : 31/12/2020</span>
          <span>Empreinte géométrique : {result.geometry_sha256 ? `${result.geometry_sha256.slice(0, 12)}…` : "non calculée"}</span>
        </div>
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-[11px] leading-snug text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

export default function AnalysisPage() {
  const [candidates, setCandidates] = useState<DeforestationCandidate[]>([]);
  const [totalCandidates, setTotalCandidates] = useState(0);
  const [selectedPlotId, setSelectedPlotId] = useState("");
  const [history, setHistory] = useState<DeforestationScreeningHistory | null>(null);
  const [result, setResult] = useState<DeforestationScreening | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selected = useMemo(
    () => candidates.find((candidate) => candidate.id === selectedPlotId) || null,
    [candidates, selectedPlotId],
  );

  async function loadCandidates() {
    setLoading(true);
    setError(null);
    try {
      const data = await listDeforestationCandidates({ limit: 500, offset: 0 });
      setCandidates(data.items);
      setTotalCandidates(data.total);
      setSelectedPlotId((current) => current || data.items[0]?.id || "");
      if (data.total > data.items.length) {
        setNotice(`Affichage des ${data.items.length} premières parcelles valides sur ${data.total}.`);
      } else {
        setNotice(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les parcelles.");
    } finally {
      setLoading(false);
    }
  }

  async function loadHistory(plotId: string) {
    if (!plotId) {
      setHistory(null);
      setResult(null);
      return;
    }
    setLoadingHistory(true);
    setError(null);
    setResult(null);
    try {
      const data = await listDeforestationScreenings(plotId, { limit: 20, offset: 0 });
      setHistory(data);
      setResult(data.items[0] || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger l'historique.");
      setHistory(null);
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => { void loadCandidates(); }, []);
  useEffect(() => { void loadHistory(selectedPlotId); }, [selectedPlotId]);

  async function handleRun() {
    if (!selected || !selected.can_screen) return;
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      const data = await runDeforestationScreening(selected.id);
      setResult(data);
      await loadHistory(selected.id);
      // Keep the just-completed result in view even if history is empty because of a stale read.
      setResult(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Le dépistage n'a pas pu être lancé.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Dépistage géospatial de perte de couvert</h1>
        <p className="mt-1 max-w-4xl text-sm text-slate-500">
          Un signal satellitaire aide à cibler une revue; il ne certifie ni la conformité ni la non-conformité EUDR.
        </p>
      </div>

      <div role="note" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
        <div className="font-semibold">Avertissement d'interprétation</div>
        <p className="mt-1">La perte de couvert arboré n'est pas nécessairement une déforestation au sens du règlement. Une absence de signal n'est pas un constat de conformité. Toute analyse appelle une revue humaine et ne vaut pas certification juridique.</p>
      </div>

      {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">{error}</div>}
      {notice && <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">{notice}</div>}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0 flex-1">
            <label htmlFor="screening-plot" className="label">Parcelle techniquement valide</label>
            <select
              id="screening-plot"
              className="input"
              value={selectedPlotId}
              onChange={(event) => setSelectedPlotId(event.target.value)}
              disabled={loading || candidates.length === 0}
            >
              <option value="">— Sélectionner une parcelle —</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {[candidate.internal_ref || candidate.name || "Parcelle", candidate.shipment_reference || "Lot", candidate.geometry_type || "géométrie", candidate.area_ha ? `${candidate.area_ha.toFixed(2)} ha` : "surface inconnue"].join(" · ")}
                </option>
              ))}
            </select>
            {selected && (
              <div className="mt-1 text-xs text-slate-500">
                {selected.supplier_name || "Fournisseur inconnu"} · {selected.product_name || "Produit inconnu"} · {selected.geometry_type}
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => void loadCandidates()} disabled={loading || running}>↻ Actualiser</button>
            <button className="btn-primary" onClick={() => void handleRun()} disabled={!selected?.can_screen || running || loadingHistory}>
              {running ? "Interrogation de la source…" : "Lancer le dépistage"}
            </button>
          </div>
        </div>
        {selected && !selected.can_screen && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            {selected.screening_reason || "Cette géométrie ne peut pas être analysée par le dépistage C5."}
          </div>
        )}
        {loading && <p className="text-sm text-slate-500">Chargement des parcelles valides…</p>}
        {!loading && totalCandidates === 0 && (
          <p className="text-sm text-slate-600">Aucune parcelle techniquement valide. Créez ou corrigez une parcelle dans l'écran Parcelles avant le dépistage.</p>
        )}
      </section>

      {loadingHistory && <div className="card text-sm text-slate-500">Chargement de l'historique…</div>}
      {!loadingHistory && result && <ScreeningCard result={result} />}
      {!loadingHistory && selected && history && history.total > 1 && (
        <section className="card">
          <h2 className="text-sm font-semibold text-slate-800">Historique des dépistages · {history.total}</h2>
          <div className="mt-3 divide-y divide-slate-100">
            {history.items.slice(1).map((item) => {
              const badge = screeningLabel(item.status);
              return (
                <div key={item.screening_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
                  <span className={`rounded-full px-2 py-1 font-semibold ${badge.className}`}>{badge.label}</span>
                  <span className="text-slate-500">{formatDate(item.analyzed_at)} · {item.dataset_version}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Historique append-only conservé dans le journal d'audit de l'organisation.</p>
        </section>
      )}

      <section className="card">
        <h2 className="text-sm font-semibold text-slate-800">Méthode et provenance (proposées pour le MVP)</h2>
        <div className="mt-2 grid gap-3 text-xs text-slate-600 md:grid-cols-2">
          <p><strong>Source :</strong> GFW Data API · `umd_tree_cover_loss` · version figée `v1.13` · filtre de dépistage 10 % et sensibilité 30 %.</p>
          <p><strong>Période :</strong> année de perte ≤ 2020 séparée des années ≥ 2021; l'année 2021 est marquée proche de la date butoir du 31/12/2020.</p>
          <p><strong>Support :</strong> polygones uniquement dans ce MVP. Les points restent non évaluables; aucun tampon arbitraire n'est construit.</p>
          <p><strong>Résolution :</strong> raster annuel d'environ 30 m; les coordonnées à six décimales dans le GeoJSON ne donnent pas une précision satellitaire de six décimales.</p>
        </div>
      </section>
    </div>
  );
}
