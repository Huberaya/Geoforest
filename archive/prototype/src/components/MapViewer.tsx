"use client";

import "leaflet/dist/leaflet.css";
import type { AuditStatus, SupportedGeometry } from "@/lib/eudr/types";
import type { GeoJSON as LeafletGeoJSON, Map as LeafletMap } from "leaflet";
import { useEffect, useRef, useState } from "react";

export type MapStatus = AuditStatus | "PENDING";

interface MapViewerProps {
  geometry: SupportedGeometry | Record<string, unknown> | null;
  status: MapStatus;
  areaHa?: number | null;
  lossYear?: number | null;
}

const COLORS: Record<MapStatus, { stroke: string; fill: string; label: string }> = {
  COMPLIANT: { stroke: "#16a34a", fill: "#22c55e", label: "Conforme EUDR" },
  NON_COMPLIANT: { stroke: "#dc2626", fill: "#ef4444", label: "Déforestation post-2020" },
  INVALID_GEOMETRY: { stroke: "#d97706", fill: "#f59e0b", label: "Géométrie invalide" },
  PENDING: { stroke: "#0f766e", fill: "#14b8a6", label: "En attente d'audit" },
};

export default function MapViewer({ geometry, status, areaHa, lossYear }: MapViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<LeafletGeoJSON | null>(null);
  const [ready, setReady] = useState(false);

  // Initialisation unique de la carte
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        center: [5.0, 10.0],
        zoom: 3,
        zoomControl: true,
        attributionControl: true,
        worldCopyJump: true,
      });

      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Imagerie © Esri, Maxar, Earthstar Geographics",
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

  // Mise à jour du tracé
  useEffect(() => {
    if (!ready || !mapRef.current) return;
    const map = mapRef.current;
    (async () => {
      const L = (await import("leaflet")).default;
      if (layerRef.current) {
        layerRef.current.remove();
        layerRef.current = null;
      }
      if (!geometry) return;

      const palette = COLORS[status];
      try {
        const layer = L.geoJSON(geometry as GeoJSON.GeoJsonObject, {
          style: () => ({ color: palette.stroke, weight: 3, fillColor: palette.fill, fillOpacity: 0.35 }),
          pointToLayer: (_feature, latlng) =>
            L.circleMarker(latlng, { radius: 9, color: palette.stroke, weight: 3, fillColor: palette.fill, fillOpacity: 0.7 }),
        });
        const tooltip = [
          `<strong>${palette.label}</strong>`,
          areaHa !== null && areaHa !== undefined && areaHa > 0 ? `${areaHa.toFixed(2)} ha` : "",
          lossYear ? `Perte détectée : ${lossYear}` : "",
        ]
          .filter(Boolean)
          .join("<br/>");
        layer.bindTooltip(tooltip, { sticky: true });
        layer.addTo(map);
        layerRef.current = layer;

        const bounds = layer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
        }
      } catch (err) {
        console.error("Impossible d'afficher la géométrie", err);
      }
    })();
  }, [geometry, status, areaHa, lossYear, ready]);

  const palette = COLORS[status];

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-900">
      <div ref={containerRef} className="h-full w-full" />
      <div className="pointer-events-none absolute left-3 top-3 z-[1000] flex flex-col gap-2">
        <div className="rounded-lg bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow backdrop-blur">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: palette.fill, outline: `2px solid ${palette.stroke}` }} />
            {geometry ? palette.label : "Déposez une parcelle pour l'afficher"}
          </div>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-lg bg-white/95 px-3 py-2 text-[11px] text-slate-600 shadow backdrop-blur">
        <div className="mb-1 font-semibold uppercase tracking-wide text-slate-500">Légende</div>
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-green-500" /> Conforme (aucune perte post-2020)</div>
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-red-500" /> Déforestation après le 31/12/2020</div>
        <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm bg-amber-500" /> Géométrie rejetée</div>
      </div>
    </div>
  );
}
