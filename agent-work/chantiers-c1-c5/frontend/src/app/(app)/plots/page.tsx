"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type Plot,
  type PlotCreate,
  type PlotList,
  type PlotSource,
  type PlotStatus,
  type Shipment,
  type ShipmentList,
  createPlot,
  deletePlot,
  listPlots,
  listShipments,
  updatePlot,
  validatePlot,
} from "@/lib/api";
import PlotMap from "@/components/maps/PlotMap";
import { ParseError, parsePastedText, parseUploadedFile } from "@/lib/parsers";

type Position = [number, number];
type PlotForm = {
  shipment_id: string;
  name: string;
  internal_ref: string;
  notes: string;
  source: PlotSource;
  geojson: Record<string, unknown> | null;
  declared_area_ha: string;
  harvest_year: string;
  acquired_at: string;
  gps_accuracy_m: string;
};

const EMPTY_FORM: PlotForm = {
  shipment_id: "",
  name: "",
  internal_ref: "",
  notes: "",
  source: "geojson",
  geojson: null,
  declared_area_ha: "",
  harvest_year: "",
  acquired_at: "",
  gps_accuracy_m: "",
};

const STATUS: Record<PlotStatus, { label: string; cls: string }> = {
  draft: { label: "Brouillon", cls: "bg-slate-100 text-slate-700" },
  validating: { label: "Validation", cls: "bg-amber-100 text-amber-800" },
  valid: { label: "Géométrie valide", cls: "bg-emerald-100 text-emerald-800" },
  invalid: { label: "À corriger", cls: "bg-red-100 text-red-800" },
  analyzed: { label: "Analysée", cls: "bg-sky-100 text-sky-800" },
  rejected: { label: "Rejetée", cls: "bg-red-100 text-red-800" },
};

function formatHa(value: number | null | undefined): string {
  return value == null ? "—" : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 }).format(value)} ha`;
}

function formForPlot(plot: Plot): PlotForm {
  return {
    shipment_id: plot.shipment_id,
    name: plot.name || "",
    internal_ref: plot.internal_ref || "",
    notes: plot.notes || "",
    source: plot.source,
    geojson: plot.geometry,
    declared_area_ha: plot.declared_area_ha == null ? "" : String(plot.declared_area_ha),
    harvest_year: plot.harvest_year == null ? "" : String(plot.harvest_year),
    acquired_at: plot.acquired_at || "",
    gps_accuracy_m: plot.gps_accuracy_m == null ? "" : String(plot.gps_accuracy_m),
  };
}

function PlotStat({ label, value, tone = "slate" }: { label: string; value: string | number; tone?: "slate" | "emerald" | "amber" | "red" | "blue" }) {
  const tones = {
    slate: "border-slate-200 bg-white text-slate-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
  };
  return (
    <div className={`rounded-xl border p-3 ${tones[tone]}`}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-bold">{value}</div>
    </div>
  );
}

function shipmentLabel(shipment: Shipment): string {
  return `${shipment.reference} · ${shipment.supplier_name || "Fournisseur"} · ${shipment.product_name || "Produit"}`;
}

export default function PlotsPage() {
  const [data, setData] = useState<PlotList | null>(null);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingPlot, setEditingPlot] = useState<Plot | null>(null);
  const [form, setForm] = useState<PlotForm>(EMPTY_FORM);
  const [drawEnabled, setDrawEnabled] = useState(false);
  const [drawVertices, setDrawVertices] = useState<Position[]>([]);
  const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
  const [filterStatus, setFilterStatus] = useState<PlotStatus | "all">("all");
  const [pasteText, setPasteText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [busyPlotId, setBusyPlotId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [plotList, shipmentList]: [PlotList, ShipmentList] = await Promise.all([
        listPlots({ limit: 500 }),
        listShipments({ limit: 500 }),
      ]);
      setData(plotList);
      setShipments(shipmentList.items);
      setSelectedPlotId((current) => current && plotList.items.some((p) => p.id === current) ? current : null);
      setForm((current) => current.shipment_id || shipmentList.items.length === 0
        ? current
        : { ...current, shipment_id: shipmentList.items[0].id });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les parcelles.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const onAddVertex = useCallback((position: Position) => {
    setDrawVertices((vertices) => [...vertices, position]);
  }, []);

  const filteredPlots = useMemo(() => {
    const plots = data?.items || [];
    return filterStatus === "all" ? plots : plots.filter((plot) => plot.status === filterStatus);
  }, [data, filterStatus]);

  const mapPlots = useMemo(() => {
    if (!data) return [];
    if (!selectedPlotId) return data.items;
    const selected = data.items.find((plot) => plot.id === selectedPlotId);
    return selected ? [selected] : data.items;
  }, [data, selectedPlotId]);

  function startCreate() {
    setEditingPlot(null);
    setForm({ ...EMPTY_FORM, shipment_id: shipments[0]?.id || "" });
    setDrawVertices([]);
    setDrawEnabled(false);
    setPasteText("");
    setError(null);
    setNotice(null);
    setShowForm(true);
  }

  function startEdit(plot: Plot) {
    setEditingPlot(plot);
    setForm(formForPlot(plot));
    setSelectedPlotId(plot.id);
    setDrawVertices([]);
    setDrawEnabled(false);
    setPasteText("");
    setError(null);
    setNotice(null);
    setShowForm(true);
  }

  function cancelForm() {
    setShowForm(false);
    setEditingPlot(null);
    setForm({ ...EMPTY_FORM, shipment_id: shipments[0]?.id || "" });
    setDrawVertices([]);
    setDrawEnabled(false);
    setPasteText("");
    setError(null);
  }

  function captureGpsPosition() {
    setError(null);
    setNotice("Demande de position GPS en cours… Autorisez la localisation du navigateur.");
    if (!navigator.geolocation) {
      setError("La géolocalisation n'est pas disponible dans ce navigateur.");
      setNotice(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const longitude = Number(position.coords.longitude.toFixed(6));
        const latitude = Number(position.coords.latitude.toFixed(6));
        const geojson = {
          type: "Feature",
          properties: { min_decimals: 6, capture_method: "browser_geolocation" },
          geometry: { type: "Point", coordinates: [longitude, latitude] },
        };
        setForm((current) => ({
          ...current,
          source: "gps",
          geojson,
          name: current.name || "Point GPS",
          acquired_at: new Date(position.timestamp).toISOString(),
          gps_accuracy_m: String(Number(position.coords.accuracy.toFixed(1))),
        }));
        setDrawVertices([]);
        setDrawEnabled(false);
        setNotice(`Position enregistrée au format 6 décimales. Précision rapportée par le navigateur : ${Math.round(position.coords.accuracy)} m; ce chiffre ne constitue pas une certification topographique.`);
      },
      (geoError) => {
        const reasons: Record<number, string> = {
          1: "Permission de géolocalisation refusée.",
          2: "Position GPS indisponible.",
          3: "Délai dépassé pendant la capture GPS.",
        };
        setError(reasons[geoError.code] || "La position GPS n'a pas pu être capturée.");
        setNotice(null);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 },
    );
  }

  async function handleFile(file: File) {
    setError(null);
    setNotice(null);
    try {
      const parsed = await parseUploadedFile(file);
      const source: PlotSource = parsed.format === "KML" ? "kml" : parsed.format === "CSV" ? "csv" : "geojson";
      setForm((current) => ({
        ...current,
        geojson: parsed.geojson,
        source,
        name: current.name || file.name.replace(/\.[^.]+$/, ""),
        acquired_at: "",
        gps_accuracy_m: "",
      }));
      setDrawVertices([]);
      setDrawEnabled(false);
      setNotice(`${parsed.format} chargé : ${parsed.featureCount} géométrie(s) détectée(s). Vérifiez le rendu et les erreurs avant d'utiliser la donnée.`);
    } catch (err) {
      setError(err instanceof ParseError ? err.message : err instanceof Error ? err.message : "Fichier illisible.");
    }
  }

  function importPastedText() {
    setError(null);
    setNotice(null);
    try {
      const parsed = parsePastedText(pasteText);
      setForm((current) => ({
        ...current,
        geojson: parsed.geojson,
        source: parsed.format === "KML" ? "kml" : parsed.format === "CSV" ? "csv" : "geojson",
        acquired_at: "",
        gps_accuracy_m: "",
      }));
      setDrawVertices([]);
      setDrawEnabled(false);
      setNotice(`${parsed.format} interprété : ${parsed.featureCount} géométrie(s).`);
    } catch (err) {
      setError(err instanceof ParseError ? err.message : err instanceof Error ? err.message : "Contenu illisible.");
    }
  }

  function finishDrawing() {
    if (drawVertices.length < 3) {
      setError("Un polygone doit comporter au moins trois sommets.");
      return;
    }
    const rounded = drawVertices.map(([lon, lat]) => [Number(lon.toFixed(6)), Number(lat.toFixed(6))]);
    const first = rounded[0];
    const last = rounded[rounded.length - 1];
    if (!last || first[0] !== last[0] || first[1] !== last[1]) rounded.push([...first]);
    const feature = {
      type: "Feature",
      properties: { min_decimals: 6 },
      geometry: { type: "Polygon", coordinates: [rounded] },
    };
    setForm((current) => ({ ...current, geojson: feature, source: "manual", acquired_at: "", gps_accuracy_m: "" }));
    setDrawVertices([]);
    setDrawEnabled(false);
    setError(null);
    setNotice("Polygone dessiné. Les coordonnées sont arrondies à six décimales; la validation technique se fera à l'enregistrement.");
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!form.shipment_id && !editingPlot) {
      setError("Sélectionnez un lot pour rattacher la parcelle.");
      return;
    }
    if (!form.geojson) {
      setError("Importez un fichier GeoJSON/KML/CSV ou dessinez un polygone sur la carte.");
      return;
    }
    const declared = form.declared_area_ha.trim() ? Number(form.declared_area_ha.replace(",", ".")) : null;
    const harvestYear = form.harvest_year.trim() ? Number(form.harvest_year) : null;
    const gpsAccuracy = form.gps_accuracy_m.trim() ? Number(form.gps_accuracy_m.replace(",", ".")) : null;
    if (declared !== null && (!Number.isFinite(declared) || declared <= 0)) {
      setError("La surface déclarée doit être un nombre supérieur à zéro.");
      return;
    }
    if (harvestYear !== null && (!Number.isInteger(harvestYear) || harvestYear < 2000 || harvestYear > 2100)) {
      setError("L'année de récolte doit être comprise entre 2000 et 2100.");
      return;
    }
    if (gpsAccuracy !== null && (!Number.isFinite(gpsAccuracy) || gpsAccuracy <= 0)) {
      setError("La précision GPS rapportée doit être un nombre positif.");
      return;
    }

    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      let saved: Plot;
      if (editingPlot) {
        saved = await updatePlot(editingPlot.id, {
          name: form.name || null,
          internal_ref: form.internal_ref || null,
          notes: form.notes || null,
          source: form.source,
          geojson: form.geojson,
          declared_area_ha: declared,
          harvest_year: harvestYear,
          acquired_at: form.acquired_at || null,
          gps_accuracy_m: gpsAccuracy,
        });
      } else {
        const payload: PlotCreate = {
          shipment_id: form.shipment_id,
          name: form.name || null,
          internal_ref: form.internal_ref || null,
          notes: form.notes || null,
          source: form.source,
          geojson: form.geojson,
          declared_area_ha: declared,
          harvest_year: harvestYear,
          acquired_at: form.acquired_at || null,
          gps_accuracy_m: gpsAccuracy,
        };
        saved = await createPlot(payload);
      }
      setSelectedPlotId(saved.id);
      setShowForm(false);
      setEditingPlot(null);
      setForm({ ...EMPTY_FORM, shipment_id: shipments[0]?.id || "" });
      setDrawVertices([]);
      setDrawEnabled(false);
      setNotice(saved.status === "valid"
        ? "Parcelle enregistrée. La géométrie est techniquement valide; cela ne vaut pas analyse de déforestation ni certification juridique."
        : "Parcelle enregistrée avec des erreurs géométriques. Consultez les détails et corrigez la géométrie.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleValidate(plot: Plot) {
    setBusyPlotId(plot.id);
    setError(null);
    setNotice(null);
    try {
      const result = await validatePlot(plot.id);
      await load();
      setSelectedPlotId(plot.id);
      setNotice(result.valid
        ? "Validation géométrique technique réussie. Aucune analyse de déforestation n'a été effectuée."
        : `Géométrie à corriger : ${result.errors[0]?.message || "voir les détails"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Validation impossible.");
    } finally {
      setBusyPlotId(null);
    }
  }

  async function handleDelete(plot: Plot) {
    if (!window.confirm(`Supprimer la parcelle « ${plot.name || plot.internal_ref || plot.id} » ? L'action sera inscrite au journal d'audit.`)) return;
    setBusyPlotId(plot.id);
    setError(null);
    setNotice(null);
    try {
      await deletePlot(plot.id);
      if (selectedPlotId === plot.id) setSelectedPlotId(null);
      setNotice("Parcelle supprimée. L'événement est conservé dans le journal d'audit.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Suppression impossible.");
    } finally {
      setBusyPlotId(null);
    }
  }

  const hasShipments = shipments.length > 0;
  const validCount = data?.by_status.valid || 0;
  const pointsNeedingAction = data?.invalid_count || 0;
  const selectedPlot = data?.items.find((plot) => plot.id === selectedPlotId) || null;
  const selectedShipment = shipments.find((shipment) => shipment.id === form.shipment_id) || null;
  const cattleMode = selectedShipment?.commodity === "cattle";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🗺️</span>
            <h1 className="text-2xl font-bold text-slate-900">Parcelles & géolocalisation</h1>
          </div>
          <p className="mt-1 max-w-3xl text-sm text-slate-500">
            Importez ou dessinez les géométries des parcelles de production et rattachez-les à un lot. La vérification porte sur la structure, la précision et la surface — elle ne constitue pas une analyse de déforestation ni une certification EUDR.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => void load()} className="btn-secondary" disabled={loading}>↻ Actualiser</button>
          <button onClick={startCreate} className="btn-primary" disabled={!hasShipments} title={!hasShipments ? "Créez d'abord un lot" : undefined}>+ Ajouter une parcelle</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <PlotStat label="Parcelles / dossiers géométriques" value={data?.total ?? "—"} />
        <PlotStat label="Géométrie valide" value={validCount} tone="emerald" />
        <PlotStat label="À corriger" value={pointsNeedingAction} tone={pointsNeedingAction ? "red" : "slate"} />
        <PlotStat label="Surface techniquement valide" value={formatHa(data?.total_area_ha)} tone="blue" />
      </div>

      {!hasShipments && !loading && (
        <div className="card border-amber-200 bg-amber-50">
          <h2 className="font-semibold text-amber-900">Un lot est nécessaire</h2>
          <p className="mt-1 text-sm text-amber-800">Créez d'abord un fournisseur, un produit EUDR puis un lot. La parcelle sera rattachée au lot correspondant.</p>
          <a href="/shipments" className="mt-3 inline-flex text-sm font-semibold text-amber-900 underline">Ouvrir les lots →</a>
        </div>
      )}

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}
      {notice && <div role="status" className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{notice}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} className="card space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">{editingPlot ? `Modifier ${cattleMode ? "l'établissement" : "la parcelle"}` : cattleMode ? "Nouvel établissement d'élevage" : "Nouvelle parcelle"}</h2>
              <p className="text-xs text-slate-500">Import GeoJSON, KML, CSV, ou dessin de polygone. Maximum 10 Mo et 100 000 positions.</p>
            </div>
            <button type="button" className="btn-secondary px-3 py-1.5" onClick={cancelForm}>× Fermer</button>
          </div>

          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {!editingPlot && (
              <div className="lg:col-span-2">
                <label className="label">Lot associé *</label>
                <select className="input" required value={form.shipment_id} onChange={(e) => setForm({ ...form, shipment_id: e.target.value })}>
                  <option value="">Sélectionner un lot…</option>
                  {shipments.map((shipment) => <option key={shipment.id} value={shipment.id}>{shipmentLabel(shipment)}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="label">{cattleMode ? "Nom de l'établissement" : "Nom de la parcelle"}</label>
              <input className="input" maxLength={200} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ex. Parcelle Nord" />
            </div>
            <div>
              <label className="label">Référence interne</label>
              <input className="input" maxLength={100} value={form.internal_ref} onChange={(e) => setForm({ ...form, internal_ref: e.target.value })} placeholder="Ex. FARM-001" />
            </div>
            <div>
              <label className="label">Surface déclarée (ha, optionnelle)</label>
              <input className="input" inputMode="decimal" value={form.declared_area_ha} onChange={(e) => setForm({ ...form, declared_area_ha: e.target.value })} placeholder="Surface si connue" />
              <p className="mt-1 text-[11px] text-slate-500">{cattleMode ? "Pour les bovins, la géolocalisation porte sur les établissements; cette surface n'impose pas de polygone." : "Pour les autres commodités, une surface connue aide à appliquer le seuil strictement supérieur à 4 ha."}</p>
            </div>
            <div>
              <label className="label">Année de récolte</label>
              <input className="input" inputMode="numeric" value={form.harvest_year} onChange={(e) => setForm({ ...form, harvest_year: e.target.value })} placeholder="Optionnel" />
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.75fr)]">
            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-slate-800">Importer ou dessiner</h3>
                  <p className="text-xs text-slate-500">Formats acceptés : .geojson, .json, .kml et .csv</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary px-3 py-2 text-xs" onClick={captureGpsPosition}>📍 Capturer GPS</button>
                  <label className="btn-secondary cursor-pointer px-3 py-2 text-xs">
                  Choisir un fichier
                  <input
                    className="sr-only"
                    type="file"
                    accept=".geojson,.json,.kml,.csv,.txt,application/geo+json,application/json,application/vnd.google-earth.kml+xml,text/csv"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void handleFile(file);
                      event.currentTarget.value = "";
                    }}
                  />
                  </label>
                </div>
              </div>
              {form.source === "gps" && form.gps_accuracy_m && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                  Capture GPS effectuée {form.acquired_at ? `le ${new Date(form.acquired_at).toLocaleString("fr-FR")}` : ""} · précision rapportée : {form.gps_accuracy_m} m. La précision de format des coordonnées ne garantit pas leur exactitude terrain.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={drawEnabled ? "btn-primary" : "btn-secondary"} onClick={() => {
                  setDrawEnabled((enabled) => !enabled);
                  setForm((current) => ({ ...current, geojson: null }));
                  setDrawVertices([]);
                  setError(null);
                }}>
                  {drawEnabled ? "✓ Mode dessin activé" : "✏️ Dessiner un polygone"}
                </button>
                {drawEnabled && (
                  <>
                    <button type="button" className="btn-secondary" onClick={() => setDrawVertices((vertices) => vertices.slice(0, -1))} disabled={drawVertices.length === 0}>↶ Annuler sommet</button>
                    <button type="button" className="btn-secondary" onClick={() => setDrawVertices([])} disabled={drawVertices.length === 0}>Effacer</button>
                    <button type="button" className="btn-primary" onClick={finishDrawing} disabled={drawVertices.length < 3}>Terminer ({drawVertices.length})</button>
                  </>
                )}
              </div>
              <div className="overflow-hidden rounded-xl">
                <PlotMap
                  plots={mapPlots}
                  draftGeojson={form.geojson}
                  draftVertices={drawVertices}
                  drawEnabled={drawEnabled}
                  selectedPlotId={selectedPlotId}
                  onAddVertex={onAddVertex}
                />
              </div>
              <p className="text-[11px] text-slate-500">Carte OpenStreetMap avec attribution. Le fond cartographique peut être indisponible hors connexion; la validation des données est effectuée côté serveur.</p>
            </section>

            <section className="space-y-3">
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-800">GeoJSON / KML / CSV collé</h3>
                  <button type="button" className="text-xs font-semibold text-emerald-700 hover:underline" onClick={() => setPasteText("")}>Effacer</button>
                </div>
                <textarea className="input mt-2 min-h-[160px] font-mono text-xs" value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'Collez un GeoJSON, KML ou CSV…\n\nCSV : latitude,longitude,parcel_id'} />
                <button type="button" className="btn-secondary mt-2 w-full" onClick={importPastedText} disabled={!pasteText.trim()}>Interpréter le contenu</button>
              </div>
              <div className="rounded-xl border border-slate-200 p-3 text-sm">
                <div className="font-semibold text-slate-800">À vérifier avant envoi</div>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-slate-600">
                  <li>Coordonnées en WGS84 / EPSG:4326 et ordre longitude, latitude.</li>
                  <li>Anneaux de polygone fermés, sans auto-intersection.</li>
                  <li>Précision déclarée d'au moins six décimales.</li>
                  <li>Pour les géométries en points, renseigner la surface connue si possible.</li>
                </ul>
                <div className="mt-3 rounded-lg bg-amber-50 p-2 text-xs text-amber-900">
                  Le polygone est requis pour les parcelles strictement supérieures à 4 ha utilisées par des commodités autres que les bovins (règlement, art. 2(28)); pour les bovins, la géolocalisation porte sur les établissements. Cette validation technique ne préjuge pas de la conformité juridique globale.
                </div>
                <p className="mt-2 text-[11px] text-slate-500">
                  Le règlement 2025/2650 prévoit aussi, pour certains micro ou petits opérateurs primaires admissibles, le remplacement de la géolocalisation par une adresse postale. Ce parcours par adresse n'est pas géré dans cette page : vérifiez le régime applicable avant d'utiliser ce module.
                </p>
              </div>
            </section>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input min-h-[70px]" maxLength={5000} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Contexte, méthode de collecte, remarques…" />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-3">
            <button type="button" className="btn-secondary" onClick={cancelForm}>Annuler</button>
            <button type="submit" className="btn-primary" disabled={submitting || !form.geojson}>{submitting ? "Validation…" : editingPlot ? "Enregistrer les modifications" : "Enregistrer la parcelle"}</button>
          </div>
        </form>
      )}

      <section className="card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Parcelles enregistrées</h2>
            <p className="text-xs text-slate-500">Les changements sont consignés dans le journal d'audit avec l'utilisateur, l'horodatage, l'IP et les états précédent/nouveau.</p>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <span className="text-slate-500">Filtrer</span>
            <select className="input w-auto min-w-[160px]" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as PlotStatus | "all")}>
              <option value="all">Tous les statuts</option>
              {Object.entries(STATUS).map(([status, meta]) => <option key={status} value={status}>{meta.label}</option>)}
            </select>
          </label>
        </div>

        {loading && <div className="py-8 text-center text-sm text-slate-500">Chargement des parcelles…</div>}
        {!loading && filteredPlots.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center">
            <div className="text-3xl">🌱</div>
            <h3 className="mt-2 font-semibold text-slate-800">Aucune parcelle dans cette vue</h3>
            <p className="mt-1 text-sm text-slate-500">Importez un GeoJSON/KML, collez des coordonnées, ou dessinez un polygone pour commencer.</p>
            {hasShipments && <button className="btn-primary mt-4" onClick={startCreate}>+ Ajouter une parcelle</button>}
          </div>
        )}

        <div className="space-y-2">
          {filteredPlots.map((plot) => {
            const status = STATUS[plot.status];
            const isSelected = plot.id === selectedPlotId;
            return (
              <article key={plot.id} className={`rounded-xl border p-3 transition ${isSelected ? "border-blue-300 bg-blue-50/40" : "border-slate-200 bg-white"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button className="min-w-0 flex-1 text-left" onClick={() => setSelectedPlotId(isSelected ? null : plot.id)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-semibold text-slate-900">{plot.name || plot.internal_ref || "Parcelle sans nom"}</span>
                      {plot.internal_ref && plot.name && <span className="text-xs text-slate-400">{plot.internal_ref}</span>}
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${status.cls}`}>{status.label}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {plot.shipment_reference || "Lot"} · {plot.supplier_name || "Fournisseur"} · {plot.product_name || "Produit"}
                    </div>
                  </button>
                  <div className="flex shrink-0 gap-1.5">
                    <button className="btn-secondary px-2.5 py-1.5 text-xs" onClick={() => startEdit(plot)}>Modifier</button>
                    <button className="btn-secondary px-2.5 py-1.5 text-xs" disabled={busyPlotId === plot.id} onClick={() => void handleValidate(plot)}>{busyPlotId === plot.id ? "…" : "Revalider"}</button>
                    <button className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50" disabled={busyPlotId === plot.id} onClick={() => void handleDelete(plot)}>Supprimer</button>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-5">
                  <div><span className="text-slate-400">Type</span><div className="font-medium text-slate-700">{plot.geometry_type || "—"}</div></div>
                  <div><span className="text-slate-400">Surface géométrique</span><div className="font-medium text-slate-700">{formatHa(plot.area_ha)}</div></div>
                  <div><span className="text-slate-400">Surface déclarée</span><div className="font-medium text-slate-700">{formatHa(plot.declared_area_ha)}</div></div>
                  <div><span className="text-slate-400">Précision observée</span><div className={`font-medium ${plot.precision_ok ? "text-emerald-700" : "text-red-700"}`}>{plot.min_decimals_found ?? "—"} décimales {plot.precision_ok ? "✓" : "—"}</div></div>
                  <div><span className="text-slate-400">Source / sommets</span><div className="font-medium text-slate-700">{plot.source} · {plot.vertex_count ?? "—"}</div></div>
                </div>
                {plot.gps_accuracy_m != null && <div className="mt-2 text-[11px] text-slate-500">Précision GPS rapportée au moment de la capture : {plot.gps_accuracy_m} m{plot.acquired_at ? ` · ${new Date(plot.acquired_at).toLocaleString("fr-FR")}` : ""} (non assimilable à la précision topographique certifiée).</div>}
                {plot.validation_errors.length > 0 && (
                  <div className="mt-3 rounded-lg border border-red-100 bg-red-50 p-2.5 text-xs text-red-800">
                    <div className="font-semibold">Erreurs à corriger</div>
                    <ul className="mt-1 list-disc space-y-1 pl-5">{plot.validation_errors.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
                  </div>
                )}
                {plot.validation_warnings.length > 0 && (
                  <div className="mt-2 rounded-lg border border-amber-100 bg-amber-50 p-2.5 text-xs text-amber-900">
                    <div className="font-semibold">Avertissements</div>
                    <ul className="mt-1 list-disc space-y-1 pl-5">{plot.validation_warnings.map((issue, index) => <li key={`${issue.code}-${index}`}>{issue.message}</li>)}</ul>
                  </div>
                )}
                {plot.status === "valid" && (
                  <p className="mt-2 text-[11px] text-emerald-800">Validation géométrique réussie uniquement. L'analyse de déforestation/légalité n'est pas incluse dans ce chantier.</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {selectedPlot && !selectedPlot.geometry && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">La géométrie invalide a été conservée sans normalisation. Utilisez « Modifier » pour la remplacer par un fichier ou un tracé corrigé.</div>
      )}
    </div>
  );
}
