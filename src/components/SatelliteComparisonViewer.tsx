"use client";

import { type GeospatialLayers } from "@/lib/eudr/types";
import { useState } from "react";

interface Props {
  layers: GeospatialLayers;
  plotName: string;
  isCompliant: boolean;
  centroid: [number, number];
}

export default function SatelliteComparisonViewer({ layers, plotName, isCompliant, centroid }: Props) {
  const [viewMode, setViewMode] = useState<"slider" | "split" | "spectral">("slider");
  const [sliderPos, setSliderPos] = useState(50);
  const [activeLayer, setActiveLayer] = useState<"all" | "hansen" | "ndvi" | "esa" | "buffer">("all");

  const [lon, lat] = centroid;

  return (
    <div className="flex flex-col rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-xs">
      {/* Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-800">Visualiseur Multi-Spectral EUDR</span>
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
            Cutoff 31/12/2020
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-2xs">
            <button
              type="button"
              onClick={() => setViewMode("slider")}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                viewMode === "slider" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Curseur Temporel
            </button>
            <button
              type="button"
              onClick={() => setViewMode("split")}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                viewMode === "split" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Côte à Côte
            </button>
            <button
              type="button"
              onClick={() => setViewMode("spectral")}
              className={`rounded-md px-2.5 py-1 font-semibold transition ${
                viewMode === "spectral" ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Spectre NDVI
            </button>
          </div>
        </div>
      </div>

      {/* Layer selector bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2 text-xs bg-white">
        <span className="text-slate-400 font-semibold text-[11px]">Calques actifs :</span>
        <button
          type="button"
          onClick={() => setActiveLayer("all")}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
            activeLayer === "all" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
          }`}
        >
          Tous les capteurs
        </button>
        <button
          type="button"
          onClick={() => setActiveLayer("hansen")}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
            activeLayer === "hansen" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
          }`}
        >
          Hansen GFW (30m)
        </button>
        <button
          type="button"
          onClick={() => setActiveLayer("ndvi")}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
            activeLayer === "ndvi" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
          }`}
        >
          Sentinel-2 NDVI (10m)
        </button>
        <button
          type="button"
          onClick={() => setActiveLayer("esa")}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
            activeLayer === "esa" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
          }`}
        >
          ESA WorldCover 10m
        </button>
        <button
          type="button"
          onClick={() => setActiveLayer("buffer")}
          className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
            activeLayer === "buffer" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-50 text-slate-600 hover:bg-slate-100"
          }`}
        >
          Buffer {layers.buffer_encroachment.buffer_distance_m}m
        </button>
      </div>

      {/* Satellite Imagery View Canvas */}
      <div className="relative min-h-[420px] bg-slate-900 text-white flex flex-col items-center justify-center overflow-hidden">
        {/* Background Satellite Visual Simulation */}
        <div
          className="absolute inset-0 bg-cover bg-center transition-all duration-300"
          style={{
            backgroundImage: isCompliant
              ? "radial-gradient(circle at 50% 50%, #1e3a1e 0%, #0f1f10 100%)"
              : "radial-gradient(circle at 50% 50%, #3a1e1e 0%, #1f0f0f 100%)",
          }}
        >
          {/* Geometrical Overlay SVG */}
          <svg className="w-full h-full opacity-80" viewBox="0 0 800 500" preserveAspectRatio="none">
            {/* Grid Coordinates lines */}
            <defs>
              <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
                <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#grid)" />

            {/* Buffer zone polygon */}
            {(activeLayer === "all" || activeLayer === "buffer") && (
              <polygon
                points="220,100 580,100 620,400 180,400"
                fill="none"
                stroke={layers.buffer_encroachment.encroachment_detected ? "#f59e0b" : "#38bdf8"}
                strokeWidth="2"
                strokeDasharray="6,4"
              />
            )}

            {/* Main Parcel Polygon */}
            <polygon
              points="250,130 550,130 580,370 220,370"
              fill={isCompliant ? "rgba(16, 185, 129, 0.25)" : "rgba(239, 68, 68, 0.35)"}
              stroke={isCompliant ? "#10b981" : "#ef4444"}
              strokeWidth="3"
            />

            {/* Deforestation Hotspots if non-compliant */}
            {!isCompliant && (activeLayer === "all" || activeLayer === "hansen") && (
              <g>
                <circle cx="360" cy="220" r="45" fill="rgba(239,68,68,0.7)" />
                <circle cx="460" cy="280" r="35" fill="rgba(239,68,68,0.7)" />
                <text x="360" y="225" fill="#ffffff" fontSize="12" fontWeight="bold" textAnchor="middle">
                  Perte {layers.hansen.loss_year}
                </text>
              </g>
            )}

            {/* Centroid Mark */}
            <circle cx="390" cy="250" r="5" fill="#f59e0b" />
            <text x="390" y="275" fill="#cbd5e1" fontSize="11" textAnchor="middle">
              {lat.toFixed(4)}°N, {lon.toFixed(4)}°E
            </text>
          </svg>
        </div>

        {/* View mode overlays */}
        {viewMode === "slider" && (
          <div className="absolute inset-x-0 bottom-4 px-6 z-10 flex items-center gap-4 bg-slate-900/80 backdrop-blur-sm py-2 mx-6 rounded-xl border border-slate-700">
            <span className="text-xs font-semibold text-emerald-400">Baseline 2020</span>
            <input
              type="range"
              min="0"
              max="100"
              value={sliderPos}
              onChange={(e) => setSliderPos(Number(e.target.value))}
              aria-label="Curseur temporel de comparaison satellite"
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <span className="text-xs font-semibold text-sky-400">Actuel 2026</span>
          </div>
        )}

        {/* Floating Tag */}
        <div className="absolute top-4 left-4 bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-xl px-3 py-2 text-xs space-y-1">
          <div className="font-bold text-slate-100">{plotName}</div>
          <div className="text-[11px] text-slate-400">
            NDVI actuel : <span className="font-mono text-emerald-400">{layers.sentinel2.current_ndvi}</span> (Δ {layers.sentinel2.delta_ndvi})
          </div>
        </div>

        <div className="absolute top-4 right-4 bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-xl px-3 py-2 text-xs text-right">
          <div className="text-[11px] text-slate-400">Couverture Arborée 2000</div>
          <div className="font-bold text-slate-100">{layers.hansen.tree_cover_2000_pct}%</div>
        </div>
      </div>

      {/* Multi-source metrics summary footer */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-4 bg-slate-50 border-t border-slate-200 text-xs">
        <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
          <div className="text-[10px] text-slate-500 font-semibold">1. Hansen GFW (30m)</div>
          <div className="mt-1 font-bold text-slate-900">
            {layers.hansen.loss_detected_post_2020 ? (
              <span className="text-rose-600">Perte en {layers.hansen.loss_year}</span>
            ) : (
              <span className="text-emerald-700">0 perte post-2020</span>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
          <div className="text-[10px] text-slate-500 font-semibold">2. Sentinel-2 NDVI (10m)</div>
          <div className="mt-1 font-bold text-slate-900">
            {layers.sentinel2.vegetation_loss_detected ? (
              <span className="text-rose-600">Baisse {layers.sentinel2.delta_ndvi}</span>
            ) : (
              <span className="text-emerald-700">Stable ({layers.sentinel2.current_ndvi})</span>
            )}
          </div>
        </div>

        <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
          <div className="text-[10px] text-slate-500 font-semibold">3. ESA WorldCover</div>
          <div className="mt-1 font-bold text-slate-900 truncate">
            {layers.esa_worldcover.dominant_land_cover}
          </div>
        </div>

        <div className="rounded-xl bg-white p-3 border border-slate-200 shadow-2xs">
          <div className="text-[10px] text-slate-500 font-semibold">4. Buffer Encroachment</div>
          <div className="mt-1 font-bold text-slate-900">
            {layers.buffer_encroachment.encroachment_detected ? (
              <span className="text-amber-600">Alertes limitrophes ({layers.buffer_encroachment.buffer_alerts_count})</span>
            ) : (
              <span className="text-emerald-700">Zone périphérique saine</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
