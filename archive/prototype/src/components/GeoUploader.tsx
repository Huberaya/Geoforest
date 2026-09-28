"use client";

import { COMMODITIES, type Commodity, type GeoJsonInput, type ParcelAuditRequest } from "@/lib/eudr/types";
import { ParseError, parsePastedText, parseUploadedFile, type ParsedUpload } from "@/lib/parsers";
import { useCallback, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";

interface GeoUploaderProps {
  onGeometryLoaded: (geojson: GeoJsonInput | null) => void;
  onSubmit: (payload: ParcelAuditRequest) => Promise<void>;
  loading: boolean;
}

interface DemoSample {
  id: string;
  label: string;
  hint: string;
  commodity: Commodity;
  geojson: GeoJsonInput;
}

const DEMO_SAMPLES: DemoSample[] = [
  {
    id: "compliant",
    label: "Café — Yirgacheffe (ET)",
    hint: "≈ 1,5 ha, aucune perte détectée",
    commodity: "coffee",
    geojson: {
      type: "Feature",
      properties: { name: "Parcelle café Yirgacheffe" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [38.201234, 6.161234],
            [38.202334, 6.161234],
            [38.202334, 6.162334],
            [38.201234, 6.162334],
            [38.201234, 6.161234],
          ],
        ],
      },
    },
  },
  {
    id: "non-compliant",
    label: "Cacao — Pará (BR)",
    hint: "≈ 1,5 ha, perte de couvert 2022",
    commodity: "cocoa",
    geojson: {
      type: "Feature",
      properties: { name: "Parcelle cacao Pará" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [-52.501234, -5.501234],
            [-52.500134, -5.501234],
            [-52.500134, -5.500134],
            [-52.501234, -5.500134],
            [-52.501234, -5.501234],
          ],
        ],
      },
    },
  },
  {
    id: "large",
    label: "Palme — Riau (ID), > 4 ha",
    hint: "≈ 12 ha, polygone requis, perte 2021",
    commodity: "palm_oil",
    geojson: {
      type: "Feature",
      properties: { name: "Bloc palmier Riau" },
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [101.451234, 0.501234],
            [101.454334, 0.501234],
            [101.454334, 0.504734],
            [101.451234, 0.504734],
            [101.451234, 0.501234],
          ],
        ],
      },
    },
  },
  {
    id: "invalid",
    label: "Polygone auto-intersectant",
    hint: "Erreur de format attendue",
    commodity: "coffee",
    geojson: {
      type: "Polygon",
      coordinates: [
        [
          [38.201234, 6.161234],
          [38.202334, 6.162334],
          [38.202334, 6.161234],
          [38.201234, 6.162334],
          [38.201234, 6.161234],
        ],
      ],
    },
  },
];

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100 disabled:bg-slate-50";
const labelClass = "mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500";

export default function GeoUploader({ onGeometryLoaded, onSubmit, loading }: GeoUploaderProps) {
  const [dragging, setDragging] = useState(false);
  const [parsed, setParsed] = useState<ParsedUpload | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [operatorName, setOperatorName] = useState("Café Import SAS");
  const [eori, setEori] = useState("FR12345678901234");
  const [commodity, setCommodity] = useState<Commodity>("coffee");
  const [harvestDate, setHarvestDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 2);
    return d.toISOString().slice(0, 10);
  });
  const [declaredArea, setDeclaredArea] = useState("");
  const [parcelRef, setParcelRef] = useState("");

  const applyParsed = useCallback(
    (result: ParsedUpload, name: string) => {
      setParsed(result);
      setFileName(name);
      setParseError(null);
      onGeometryLoaded(result.geojson);
    },
    [onGeometryLoaded],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      try {
        applyParsed(await parseUploadedFile(file), file.name);
      } catch (err) {
        setParsed(null);
        setFileName(file.name);
        setParseError(err instanceof ParseError ? err.message : "Lecture du fichier impossible");
        onGeometryLoaded(null);
      }
    },
    [applyParsed, onGeometryLoaded],
  );

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  };

  const onPasteApply = () => {
    try {
      applyParsed(parsePastedText(pasteText), "coordonnées collées");
      setShowPaste(false);
    } catch (err) {
      setParseError(err instanceof ParseError ? err.message : "Texte non reconnu");
    }
  };

  const loadDemo = (sample: DemoSample) => {
    setCommodity(sample.commodity);
    applyParsed({ geojson: sample.geojson, format: "GeoJSON", featureCount: 1 }, `démo — ${sample.label}`);
  };

  const reset = () => {
    setParsed(null);
    setFileName(null);
    setParseError(null);
    setPasteText("");
    onGeometryLoaded(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!parsed) return;
    const declared = declaredArea.trim() === "" ? null : Number(declaredArea.replace(",", "."));
    await onSubmit({
      geojson: parsed.geojson,
      commodity,
      harvest_date: harvestDate,
      operator: { name: operatorName.trim(), eori: eori.trim(), country: eori.trim().slice(0, 2).toUpperCase() },
      declared_area_ha: declared,
      parcel_reference: parcelRef.trim() || null,
    });
  };

  const isPointUpload = (() => {
    if (!parsed) return false;
    const g = parsed.geojson;
    const type = g.type === "Feature" ? (g.geometry as { type?: string } | null)?.type : g.type === "FeatureCollection" ? ((g.features as Array<{ geometry?: { type?: string } }>)[0]?.geometry?.type ?? "") : g.type;
    return type === "Point" || type === "MultiPoint";
  })();

  return (
    <form onSubmit={submit} className="flex h-full flex-col gap-5">
      {/* Zone drag & drop */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        className={`group relative flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
          dragging ? "border-emerald-500 bg-emerald-50" : parsed ? "border-emerald-300 bg-emerald-50/40" : "border-slate-300 bg-slate-50 hover:border-emerald-400 hover:bg-emerald-50/50"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".geojson,.json,.kml,.csv,.txt,application/geo+json,application/json,application/vnd.google-earth.kml+xml,text/csv"
          className="hidden"
          onChange={(e: ChangeEvent<HTMLInputElement>) => void handleFiles(e.target.files)}
        />
        <div className={`mb-3 flex h-12 w-12 items-center justify-center rounded-full ${parsed ? "bg-emerald-600 text-white" : "bg-white text-emerald-600 shadow-sm ring-1 ring-slate-200"}`}>
          {parsed ? (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 16V4m0 0l-4 4m4-4l4 4M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" />
            </svg>
          )}
        </div>
        {parsed ? (
          <>
            <p className="text-sm font-semibold text-emerald-800">{fileName}</p>
            <p className="mt-1 text-xs text-emerald-700">
              {parsed.format} · {parsed.featureCount} entité{parsed.featureCount > 1 ? "s" : ""} chargée{parsed.featureCount > 1 ? "s" : ""}
            </p>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                reset();
              }}
              className="mt-3 text-xs font-medium text-slate-500 underline-offset-2 hover:text-red-600 hover:underline"
            >
              Retirer le fichier
            </button>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-800">Glissez-déposez la parcelle ici</p>
            <p className="mt-1 text-xs text-slate-500">GeoJSON, KML ou CSV de coordonnées GPS (lat, lon) · WGS84</p>
            <p className="mt-2 text-[11px] text-slate-400">ou cliquez pour parcourir</p>
          </>
        )}
      </div>

      {parseError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          <span className="font-semibold">Fichier rejeté :</span> {parseError}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button type="button" onClick={() => setShowPaste((v) => !v)} className="rounded-md border border-slate-200 bg-white px-2.5 py-1 font-medium text-slate-600 hover:border-emerald-400 hover:text-emerald-700">
          {showPaste ? "Fermer" : "Coller des coordonnées"}
        </button>
        <span className="text-slate-400">Démo :</span>
        {DEMO_SAMPLES.map((s) => (
          <button
            key={s.id}
            type="button"
            title={s.hint}
            onClick={() => loadDemo(s)}
            className={`rounded-md px-2.5 py-1 font-medium ring-1 ring-inset transition ${
              s.id === "invalid" ? "bg-amber-50 text-amber-800 ring-amber-200 hover:bg-amber-100" : s.id === "compliant" ? "bg-emerald-50 text-emerald-800 ring-emerald-200 hover:bg-emerald-100" : "bg-red-50 text-red-800 ring-red-200 hover:bg-red-100"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {showPaste && (
        <div className="space-y-2">
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            rows={5}
            placeholder={'{"type":"Polygon","coordinates":[[[lon,lat],...]]}\nou CSV :\nlat,lon\n6.161234,38.201234\n...'}
            className={`${inputClass} font-mono text-xs`}
          />
          <button type="button" onClick={onPasteApply} className="rounded-md bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700">
            Charger le texte
          </button>
        </div>
      )}

      {/* Formulaire dossier */}
      <div className="grid grid-cols-1 gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass} htmlFor="operator">Opérateur</label>
          <input id="operator" required minLength={2} value={operatorName} onChange={(e) => setOperatorName(e.target.value)} className={inputClass} placeholder="Raison sociale" />
        </div>
        <div>
          <label className={labelClass} htmlFor="eori">N° EORI</label>
          <input id="eori" required pattern="[A-Za-z]{2}[A-Za-z0-9 ]{1,15}" title="Code pays (2 lettres) + 1 à 15 caractères alphanumériques" value={eori} onChange={(e) => setEori(e.target.value.toUpperCase())} className={`${inputClass} font-mono uppercase`} placeholder="FR12345678901234" />
        </div>
        <div>
          <label className={labelClass} htmlFor="commodity">Matière première</label>
          <select id="commodity" value={commodity} onChange={(e) => setCommodity(e.target.value as Commodity)} className={inputClass}>
            {COMMODITIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label} — SH {c.hsCode}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="harvest">Date de récolte</label>
          <input id="harvest" type="date" required max={new Date().toISOString().slice(0, 10)} value={harvestDate} onChange={(e) => setHarvestDate(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="parcelRef">Réf. parcelle (optionnel)</label>
          <input id="parcelRef" value={parcelRef} onChange={(e) => setParcelRef(e.target.value)} className={inputClass} placeholder="LOT-2024-001" />
        </div>
        {isPointUpload && (
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="declared">Surface déclarée (ha) — requis pour un point</label>
            <input id="declared" type="number" step="0.01" min="0" value={declaredArea} onChange={(e) => setDeclaredArea(e.target.value)} className={inputClass} placeholder="ex : 2.5 (un point n'est accepté que < 4 ha)" />
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={!parsed || loading}
        className="mt-auto inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {loading ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Audit GIS + satellite en cours…
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Lancer l&apos;audit EUDR
          </>
        )}
      </button>
    </form>
  );
}
