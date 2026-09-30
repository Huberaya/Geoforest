"use client";

import "leaflet/dist/leaflet.css";
import type { Plot } from "@/lib/eudr/types";
import type { GeoJSON as LeafletGeoJSON, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";

interface MultiPlotMapProps {
  plots: Plot[];
  selectedPlotId?: string | null;
  onSelectPlot?: (plot: Plot) => void;
}

export default function MultiPlotMap({ plots, selectedPlotId, onSelectPlot }: MultiPlotMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<LeafletGeoJSON[]>([]);
  const [ready, setReady] = useState(false);

  // Initialize Map
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [0.0, 15.0],
        zoom: 3,
        zoomControl: true,
        attributionControl: true,
        worldCopyJump: true,
      });

      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Imagerie © Esri, Maxar",
      }).addTo(map);

      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        opacity: 0.9,
      }).addTo(map);

      mapRef.current = map;
      setReady(true);
    })();

    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Render Plots Polygons
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;

    (async () => {
      const L = (await import("leaflet")).default;

      // Clean existing layers
      layersRef.current.forEach((l) => map.removeLayer(l));
      layersRef.current = [];

      const group = L.featureGroup();

      plots.forEach((p) => {
        if (!p.geometry) return;

        const isCompliant = p.status === "COMPLIANT";
        const isSelected = p.id === selectedPlotId;

        const color = isCompliant ? "#16a34a" : p.status === "NON_COMPLIANT" ? "#dc2626" : "#d97706";
        const fillColor = isCompliant ? "#22c55e" : p.status === "NON_COMPLIANT" ? "#ef4444" : "#f59e0b";

        try {
          const geoJsonLayer = L.geoJSON(p.geometry as any, {
            style: {
              color: isSelected ? "#38bdf8" : color,
              weight: isSelected ? 4 : 2,
              opacity: 1,
              fillColor,
              fillOpacity: isSelected ? 0.6 : 0.4,
            },
            onEachFeature: (_, layer) => {
              layer.bindPopup(`
                <div style="font-family: sans-serif; font-size: 12px; min-width: 180px;">
                  <strong style="color: #0f172a; font-size: 13px;">${p.name}</strong><br/>
                  <span style="color: #64748b;">${p.commodity.toUpperCase()} · ${p.countryCode}</span><br/>
                  <div style="margin: 6px 0; padding: 4px 8px; border-radius: 6px; font-weight: bold; font-size: 11px; background: ${
                    isCompliant ? "#dcfce7; color: #166534;" : "#fee2e2; color: #991b1b;"
                  }">
                    ${isCompliant ? "✓ CONFORME EUDR" : `⚠️ DÉFORESTATION (${p.lossYear ?? "post-2020"})`}
                  </div>
                  <div>Surface : <strong>${p.areaHa.toFixed(2)} ha</strong></div>
                  <div>Fournisseur : <em>${p.supplierName ?? "Non lié"}</em></div>
                </div>
              `);

              layer.on("click", () => {
                if (onSelectPlot) onSelectPlot(p);
              });
            },
          });

          geoJsonLayer.addTo(map);
          group.addLayer(geoJsonLayer);
          layersRef.current.push(geoJsonLayer);
        } catch {
          // ignore invalid geometry format in map render
        }
      });

      if (layersRef.current.length > 0) {
        map.fitBounds(group.getBounds(), { padding: [50, 50], maxZoom: 14 });
      }
    })();
  }, [ready, plots, selectedPlotId, onSelectPlot]);

  return (
    <div className="relative h-full w-full min-h-[500px] rounded-2xl overflow-hidden border border-slate-200 shadow-xs">
      <div ref={containerRef} className="h-full w-full min-h-[500px]" />
      {/* Legend Badge */}
      <div className="absolute bottom-4 left-4 z-[400] flex flex-wrap items-center gap-3 rounded-xl bg-slate-900/85 px-4 py-2.5 text-xs text-white backdrop-blur shadow-md">
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-emerald-300/40" />
          <span>Conforme EUDR (0 déforestation)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-rose-500 ring-2 ring-rose-300/40" />
          <span>Non conforme (Perte post-2020)</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-full bg-amber-500 ring-2 ring-amber-300/40" />
          <span>Invalide (&lt; 6 décimales)</span>
        </div>
      </div>
    </div>
  );
}
