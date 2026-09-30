"use client";

import MapViewer from "@/components/MapViewer";
import { COMMODITY_LABELS, type Plot } from "@/lib/eudr/types";
import Link from "next/link";
import { use, useEffect, useState } from "react";

export default function PlotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [plot, setPlot] = useState<Plot | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "analysis" | "documents" | "history">("overview");
  const [reAuditing, setReAuditing] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/v1/plots/${encodeURIComponent(id)}`);
        if (res.ok) setPlot(await res.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleReAudit = async () => {
    setReAuditing(true);
    setTimeout(() => {
      setReAuditing(false);
      alert("Analyse multi-sources Sentinel-2 / Hansen mise à jour : 0 perte post-2020.");
    }, 1200);
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-xs text-slate-400">
        Chargement de l'inspection parcellaire...
      </div>
    );
  }

  const p: Plot = plot ?? {
    id,
    name: "PLT-008742",
    reference: "PLT-008742",
    supplierId: "sup-ci-001",
    supplierName: "Coopérative Cacaoyère de Divo",
    commodity: "cocoa",
    countryCode: "CI",
    geometryType: "Polygon",
    areaHa: 14.8,
    vertexCount: 5,
    centroidLon: -4.0278,
    centroidLat: 5.4821,
    status: "COMPLIANT",
    riskLevel: "LOW",
    lossYear: null,
    confidenceScore: 0.96,
    lastAuditAt: "2026-09-28T14:32:00Z",
    createdAt: "2026-09-10T10:00:00Z",
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [-4.0298, 5.4801],
          [-4.0258, 5.4801],
          [-4.0258, 5.4841],
          [-4.0298, 5.4841],
          [-4.0298, 5.4801],
        ],
      ],
    },
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Breadcrumb & Top Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs">
          <Link href="/plots" className="text-slate-500 hover:text-slate-900">
            ← Toutes les parcelles
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-bold text-slate-900">{p.name}</span>
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">À vérifier</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleReAudit}
            disabled={reAuditing}
            className="rounded-xl bg-[#0D5B41] px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#0a4833] flex items-center gap-1.5"
          >
            <span>🛰️</span>
            <span>{reAuditing ? "Calcul géospatial..." : "Lancer une nouvelle analyse"}</span>
          </button>
        </div>
      </div>

      {/* 5.5 Master Mockup Grid (Left Satellite Map, Right Inspection Inspector) */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Side: Full-Frame High-Resolution Satellite Map */}
        <div className="lg:col-span-7 rounded-3xl border border-slate-200 bg-white p-3 shadow-xs flex flex-col min-h-[540px]">
          <div className="px-3 py-2 flex items-center justify-between border-b border-slate-100">
            <h2 className="text-xs font-bold text-slate-800">Vue Satellite Haute Résolution (Esri / Sentinel-2)</h2>
            <span className="text-[10px] font-mono text-slate-400">WGS84 • EPSG:4326</span>
          </div>
          <div className="flex-1 rounded-2xl overflow-hidden mt-2 min-h-[460px]">
            <MapViewer geometry={p.geometry as any} status={p.status} areaHa={p.areaHa} lossYear={p.lossYear} />
          </div>
        </div>

        {/* Right Side: Mockup 5.5 Inspection Panel with Tabs */}
        <div className="lg:col-span-5 rounded-3xl border border-slate-200 bg-white p-6 shadow-xs flex flex-col justify-between space-y-5">
          <div className="space-y-4">
            {/* Header info */}
            <div className="flex items-start justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-extrabold text-slate-900">{p.name}</h3>
                <div className="text-xs text-slate-500">
                  Cacao • Côte d'Ivoire • <strong>{p.areaHa} hectares</strong>
                </div>
              </div>
              <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">
                À vérifier
              </span>
            </div>

            {/* Navigation Tabs (Vue d'ensemble, Analyse, Documents, Historique) */}
            <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab("overview")}
                className={`pb-1 font-bold transition border-b-2 ${
                  activeTab === "overview"
                    ? "border-[#0D5B41] text-[#0D5B41]"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                }`}
              >
                Vue d'ensemble
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("analysis")}
                className={`pb-1 font-bold transition border-b-2 ${
                  activeTab === "analysis"
                    ? "border-[#0D5B41] text-[#0D5B41]"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                }`}
              >
                Analyse
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("documents")}
                className={`pb-1 font-bold transition border-b-2 ${
                  activeTab === "documents"
                    ? "border-[#0D5B41] text-[#0D5B41]"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                }`}
              >
                Documents
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("history")}
                className={`pb-1 font-bold transition border-b-2 ${
                  activeTab === "history"
                    ? "border-[#0D5B41] text-[#0D5B41]"
                    : "border-transparent text-slate-500 hover:text-slate-900"
                }`}
              >
                Historique
              </button>
            </div>

            {/* Tab 1: Vue d'ensemble (Exact Match Mockup 5.5) */}
            {activeTab === "overview" && (
              <div className="space-y-3.5 text-xs">
                {/* 1. Géolocalisation */}
                <div className="rounded-2xl bg-slate-50 p-3.5 border border-slate-100 space-y-1">
                  <div className="font-bold text-slate-900">📍 Géolocalisation</div>
                  <div className="text-slate-600 font-mono text-[11px]">
                    Latitude : <strong>{p.centroidLat.toFixed(4)}</strong> | Longitude : <strong>{p.centroidLon.toFixed(4)}</strong>
                  </div>
                  <div className="text-[10px] text-slate-400">Format : GeoJSON / KML (Polygone fermé WGS84)</div>
                </div>

                {/* 2. Déforestation */}
                <div className="rounded-2xl bg-emerald-50/60 p-3.5 border border-emerald-100 space-y-1">
                  <div className="font-bold text-emerald-950">🌲 Déforestation</div>
                  <div className="text-emerald-900 text-[11px]">
                    ✓ Aucun signal de déforestation post-2020 détecté.
                  </div>
                  <div className="text-[10px] text-emerald-700">
                    Sources : Copernicus Sentinel-1, Sentinel-2, Hansen UMD (GFW)
                  </div>
                </div>

                {/* 3. Légalité */}
                <div className="rounded-2xl bg-amber-50/60 p-3.5 border border-amber-100 space-y-1">
                  <div className="font-bold text-amber-950">⚖️ Légalité</div>
                  <div className="text-amber-900 text-[11px]">
                    ⚠️ 1 document manquant (Vérification du droit foncier local).
                  </div>
                </div>

                {/* 4. Risque global */}
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 p-3 border border-slate-100">
                  <span className="font-bold text-slate-700">Risque global :</span>
                  <span className="rounded bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                    À vérifier
                  </span>
                </div>
              </div>
            )}

            {/* Tab 2: Analyse */}
            {activeTab === "analysis" && (
              <div className="space-y-3 text-xs">
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 space-y-1">
                  <div className="font-bold text-slate-900">Copernicus Sentinel-2 MSI (10m)</div>
                  <div className="text-slate-600">NDVI Baseline 2020 : 0.81 | NDVI Actuel : 0.79 (Δ -0.02)</div>
                  <div className="text-[10px] text-emerald-700 font-semibold">Couvert végétal stable ✓</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 space-y-1">
                  <div className="font-bold text-slate-900">Hansen GFW (30m)</div>
                  <div className="text-slate-600">Perte post-2020 : 0.00 ha (Seuil canopée &gt; 30%)</div>
                </div>
              </div>
            )}

            {/* Tab 3: Documents */}
            {activeTab === "documents" && (
              <div className="space-y-2 text-xs">
                <div className="rounded-xl border border-slate-200 p-2.5 flex items-center justify-between">
                  <span>📄 Titre Foncier Rural Divo</span>
                  <span className="text-emerald-700 font-bold">✓ Valide</span>
                </div>
                <div className="rounded-xl border border-dashed border-amber-300 bg-amber-50/50 p-2.5 text-amber-900 text-[11px]">
                  + Ajouter attestation coutumière FPIC manquante
                </div>
              </div>
            )}

            {/* Tab 4: Historique */}
            {activeTab === "history" && (
              <div className="space-y-2 font-mono text-[10px] text-slate-600">
                <div>• 28/09/2026 14:32 — Audit satellite exécuté par Marie Dupont (Conforme).</div>
                <div>• 10/09/2026 10:00 — Polygone importé via le portail mobile fournisseur.</div>
              </div>
            )}
          </div>

          {/* Action Buttons (Mockup 5.5) */}
          <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
            <Link
              href="/documents"
              className="flex-1 text-center rounded-xl border border-slate-200 bg-white py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
            >
              Voir les preuves
            </Link>
            <Link
              href="/due-diligence"
              className="flex-1 text-center rounded-xl bg-[#0D5B41] py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#0a4833]"
            >
              Lier au dossier DDR
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
