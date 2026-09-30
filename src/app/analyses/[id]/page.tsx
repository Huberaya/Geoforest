"use client";

import SatelliteComparisonViewer from "@/components/SatelliteComparisonViewer";
import { COMMODITY_LABELS, type SatelliteAnalysis } from "@/lib/eudr/types";
import Link from "next/link";
import { use, useEffect, useState } from "react";

export default function AnalysisDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [analysis, setAnalysis] = useState<SatelliteAnalysis | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/v1/analyses/${encodeURIComponent(id)}`);
        if (res.ok) setAnalysis(await res.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-xs text-slate-400">
        Chargement du dossier d'analyse géospatiale...
      </div>
    );
  }

  const a = analysis ?? {
    analysis_id: id,
    created_at: "2026-09-28T14:32:00Z",
    plot_name: "Parcelle Cacao Divo Est #01",
    commodity: "cocoa" as const,
    status: "COMPLIANT" as const,
    risk_level: "LOW" as const,
    compliant: true,
    confidence_score: 0.96,
    eudr_cutoff_date: "2020-12-31",
    area_ha: 14.5,
    centroid: [-5.359734, 5.842734] as [number, number],
    country_code: "CI",
    country_name: "Côte d'Ivoire",
    country_risk: "STANDARD" as const,
    layers: {
      hansen: {
        source: "Hansen / UMD Tree Cover Loss (Global Forest Watch)",
        resolution_m: 30,
        canopy_threshold_pct: 30,
        loss_year: null,
        loss_area_ha: 0.0,
        loss_detected_post_2020: false,
        tree_cover_2000_pct: 78.5,
      },
      sentinel2: {
        source: "Copernicus Sentinel-2 MSI Optical",
        resolution_m: 10,
        baseline_ndvi_2020: 0.81,
        current_ndvi: 0.79,
        delta_ndvi: -0.02,
        vegetation_loss_detected: false,
        cloud_cover_pct: 1.8,
        observation_period: "2020-2026",
      },
      esa_worldcover: {
        source: "ESA WorldCover 10m",
        resolution_m: 10,
        tree_cover_pct: 74.0,
        cropland_pct: 22.0,
        shrubland_pct: 4.0,
        other_pct: 0.0,
        dominant_land_cover: "Tree cover / Agroforestry",
      },
      buffer_encroachment: {
        buffer_distance_m: 50,
        encroachment_detected: false,
        buffer_loss_area_ha: 0.0,
        buffer_alerts_count: 0,
        buffer_risk_level: "LOW" as const,
      },
    },
    summary:
      "CONFORME EUDR : Aucune perte de couvert arboré post-2020 détectée par Hansen GFW ni Sentinel-2 sur la parcelle (14.50 ha).",
    methodology:
      "Croisement multi-capteurs : Hansen GFW (30m), Sentinel-2 MSI (10m, indices NDVI), ESA WorldCover 10m et zone tampon 50m.",
    legal_disclaimer:
      "GeoForest Trace est un outil d'aide à la décision et de diligence raisonnée EUDR. Ne constitue pas un certificat juridique.",
  };

  const isCompliant = a.status === "COMPLIANT";
  const isWarning = a.status === "WARNING";

  return (
    <div className="space-y-6">
      {/* Breadcrumb & Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs">
          <Link href="/analyses" className="text-slate-500 hover:text-slate-900">
            ← Toutes les analyses
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-semibold text-slate-800">{a.plot_name}</span>
          <span className="text-[10px] font-mono text-slate-400">({a.analysis_id})</span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => alert("Génération du rapport d'expertise géospatiale PDF...")}
            className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-xs flex items-center gap-1.5"
          >
            <span>📄</span>
            <span>Rapport PDF</span>
          </button>
          <Link
            href="/due-diligence"
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
          >
            + Lier au dossier DDR
          </Link>
        </div>
      </div>

      {/* Main Grid: Multi-spectral Satellite Viewer + Technical Dossier */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column : Interactive Satellite Viewer */}
        <div className="lg:col-span-7 space-y-4">
          <SatelliteComparisonViewer
            layers={a.layers}
            plotName={a.plot_name}
            isCompliant={isCompliant}
            centroid={a.centroid}
          />

          {/* Sourced Citations & Regulatory References */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Références Réglementaires & Transparence Méthodologique
            </h4>
            <div className="text-xs space-y-2 text-slate-600">
              <p>
                <strong className="text-slate-900">Règlement (UE) 2023/1115 (EUDR) :</strong>
              </p>
              <ul className="list-disc pl-4 space-y-1 text-[11px] leading-relaxed">
                <li>
                  <strong>Article 2(13) :</strong> « Zéro déforestation » signifie que les matières premières ou produits
                  ont été récoltés sur des terres qui n'ont pas fait l'objet d'un déboisement après le 31 décembre 2020.
                </li>
                <li>
                  <strong>Article 3 :</strong> Interdiction de mise sur le marché européen de produits non conformes ou liés
                  à la déforestation.
                </li>
                <li>
                  <strong>Article 9 :</strong> Exigence de géolocalisation polygone obligatoire pour toute parcelle &gt; 4 ha
                  avec précision d'au moins 6 décimales.
                </li>
              </ul>
            </div>
            <div className="rounded-xl bg-amber-50 p-3 text-[11px] text-amber-900 border border-amber-200/60 leading-relaxed">
              <strong>Avertissement légal :</strong> {a.legal_disclaimer}
            </div>
          </div>
        </div>

        {/* Right Column : Multi-Layer Evidence Breakdown */}
        <div className="lg:col-span-5 space-y-4">
          {/* Global Verdict Banner */}
          <div
            className={`rounded-2xl border p-5 shadow-xs space-y-2 ${
              isCompliant
                ? "bg-emerald-50/70 border-emerald-200 text-emerald-950"
                : isWarning
                ? "bg-amber-50/70 border-amber-200 text-amber-950"
                : "bg-rose-50/70 border-rose-200 text-rose-950"
            }`}
          >
            <div className="flex items-center justify-between">
              <span
                className={`rounded-full px-3 py-0.5 text-xs font-bold ${
                  isCompliant
                    ? "bg-emerald-600 text-white"
                    : isWarning
                    ? "bg-amber-600 text-white"
                    : "bg-rose-600 text-white"
                }`}
              >
                {isCompliant
                  ? "✓ CONFORME EUDR"
                  : isWarning
                  ? "⚠️ VIGILANCE ZONE TAMPON"
                  : "✕ DÉFORESTATION AVÉRÉE"}
              </span>
              <span className="text-xs font-semibold">Score confiance : {Math.round(a.confidence_score * 100)}%</span>
            </div>
            <h3 className="font-bold text-base pt-1">{a.plot_name}</h3>
            <p className="text-xs leading-relaxed opacity-90">{a.summary}</p>
          </div>

          {/* Layer 1: Hansen UMD GFW */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-800">1. Hansen / UMD Tree Cover Loss</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">30 mètres</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <div className="text-[10px] text-slate-400">Année de perte</div>
                <div className="font-bold text-slate-900">
                  {a.layers.hansen.loss_year ? `${a.layers.hansen.loss_year}` : "Aucune perte (N/A)"}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <div className="text-[10px] text-slate-400">Surface impactée</div>
                <div className="font-bold text-slate-900">{a.layers.hansen.loss_area_ha.toFixed(2)} ha</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <div className="text-[10px] text-slate-400">Seuil de canopée</div>
                <div className="font-bold text-slate-900">&gt; {a.layers.hansen.canopy_threshold_pct}%</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <div className="text-[10px] text-slate-400">Couvert arboré 2000</div>
                <div className="font-bold text-slate-900">{a.layers.hansen.tree_cover_2000_pct}%</div>
              </div>
            </div>
          </div>

          {/* Layer 2: Copernicus Sentinel-2 MSI */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-800">2. Copernicus Sentinel-2 MSI (Optique)</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">10 mètres</span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <div className="text-[10px] text-slate-400">NDVI Référence 2020</div>
                <div className="font-mono font-bold text-slate-900">{a.layers.sentinel2.baseline_ndvi_2020}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <div className="text-[10px] text-slate-400">NDVI Actuel (2026)</div>
                <div className="font-mono font-bold text-slate-900">{a.layers.sentinel2.current_ndvi}</div>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <div className="text-[10px] text-slate-400">Différentiel Δ NDVI</div>
                <div
                  className={`font-mono font-bold ${
                    a.layers.sentinel2.delta_ndvi < -0.1 ? "text-rose-600" : "text-emerald-700"
                  }`}
                >
                  {a.layers.sentinel2.delta_ndvi}
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100">
                <div className="text-[10px] text-slate-400">Couverture nuageuse</div>
                <div className="font-bold text-slate-900">{a.layers.sentinel2.cloud_cover_pct}%</div>
              </div>
            </div>
          </div>

          {/* Layer 3: ESA WorldCover & Buffer */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <span className="text-xs font-bold text-slate-800">3. ESA WorldCover & Buffer Tampon</span>
              <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">10m / 50m</span>
            </div>
            <div className="text-xs space-y-2 text-slate-700">
              <div className="flex justify-between border-b border-slate-100 pb-1.5">
                <span className="text-slate-500">Classe dominante :</span>
                <span className="font-semibold text-slate-900">{a.layers.esa_worldcover.dominant_land_cover}</span>
              </div>
              <div className="flex justify-between border-b border-slate-100 pb-1.5">
                <span className="text-slate-500">Arbres / Cultures :</span>
                <span className="font-semibold text-slate-900">
                  {a.layers.esa_worldcover.tree_cover_pct}% / {a.layers.esa_worldcover.cropland_pct}%
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Front de déforestation buffer :</span>
                <span
                  className={`font-semibold ${
                    a.layers.buffer_encroachment.encroachment_detected ? "text-amber-600" : "text-emerald-700"
                  }`}
                >
                  {a.layers.buffer_encroachment.encroachment_detected ? "Alertes détectées" : "Aucun front limitrophe"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
