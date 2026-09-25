"use client";

import { useEffect, useRef, useState } from "react";
import type { FeatureGroup, Map as LeafletMap, LeafletMouseEvent } from "leaflet";
import type { Plot } from "@/lib/api";

type Position = [number, number]; // [longitude, latitude]

interface PlotMapProps {
  plots: Plot[];
  draftGeojson?: Record<string, unknown> | null;
  draftVertices?: Position[];
  drawEnabled?: boolean;
  selectedPlotId?: string | null;
  onAddVertex?: (position: Position) => void;
}

export default function PlotMap({
  plots,
  draftGeojson = null,
  draftVertices = [],
  drawEnabled = false,
  selectedPlotId = null,
  onAddVertex,
}: PlotMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerRef = useRef<FeatureGroup | null>(null);
  const onAddVertexRef = useRef(onAddVertex);
  const drawEnabledRef = useRef(drawEnabled);
  const [ready, setReady] = useState(false);
  const [tileFailed, setTileFailed] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);

  onAddVertexRef.current = onAddVertex;
  drawEnabledRef.current = drawEnabled;

  useEffect(() => {
    let cancelled = false;
    let map: LeafletMap | null = null;
    let tileLayer: import("leaflet").TileLayer | null = null;

    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !containerRef.current) return;
      try {
        map = L.map(containerRef.current, {
          center: [8, 0],
          zoom: 2,
          minZoom: 1,
          maxZoom: 18,
          worldCopyJump: true,
          doubleClickZoom: false,
          zoomControl: true,
        });
        mapRef.current = map;
        tileLayer = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          crossOrigin: true,
        });
        tileLayer.on("tileerror", () => setTileFailed(true));
        tileLayer.addTo(map);
        map.on("click", (event: LeafletMouseEvent) => {
          if (!drawEnabledRef.current || !onAddVertexRef.current) return;
          onAddVertexRef.current([
            Number(event.latlng.lng.toFixed(6)),
            Number(event.latlng.lat.toFixed(6)),
          ]);
        });
        map.whenReady(() => {
          if (!cancelled) setReady(true);
        });
        window.setTimeout(() => map?.invalidateSize(), 80);
      } catch {
        setMapFailed(true);
      }
    }).catch(() => setMapFailed(true));

    return () => {
      cancelled = true;
      setReady(false);
      map?.remove();
      mapRef.current = null;
      tileLayer = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let cancelled = false;
    void import("leaflet").then(({ default: L }) => {
      if (cancelled || !mapRef.current) return;
      map.getContainer().style.cursor = drawEnabled ? "crosshair" : "grab";
      layerRef.current?.remove();
      const layer = L.featureGroup();
      for (const plot of plots) {
        if (!plot.geometry) continue;
        const color = plot.status === "invalid" || plot.status === "rejected"
          ? "#dc2626"
          : plot.id === selectedPlotId
            ? "#2563eb"
            : "#059669";
        try {
          L.geoJSON(plot.geometry as never, {
            style: { color, weight: plot.id === selectedPlotId ? 4 : 2, fillColor: color, fillOpacity: 0.18 },
            pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
              radius: plot.id === selectedPlotId ? 8 : 6,
              color,
              fillColor: color,
              fillOpacity: 0.85,
              weight: 2,
            }),
          }).addTo(layer);
        } catch {
          // Une géométrie invalide peut rester consultable sous forme de ligne/erreur dans la liste.
        }
      }
      if (draftGeojson) {
        try {
          L.geoJSON(draftGeojson as never, {
            style: { color: "#2563eb", weight: 3, dashArray: "6 5", fillColor: "#60a5fa", fillOpacity: 0.16 },
            pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
              radius: 7, color: "#1d4ed8", fillColor: "#60a5fa", fillOpacity: 1, weight: 2,
            }),
          }).addTo(layer);
        } catch {
          // Le serveur renverra les détails de validation après l'envoi.
        }
      }
      if (draftVertices.length > 0) {
        const latlngs = draftVertices.map(([lon, lat]) => L.latLng(lat, lon));
        L.polyline(latlngs, { color: "#2563eb", weight: 3, dashArray: "5 5" }).addTo(layer);
        for (const latlng of latlngs) {
          L.circleMarker(latlng, { radius: 5, color: "white", fillColor: "#2563eb", fillOpacity: 1, weight: 2 }).addTo(layer);
        }
        if (draftVertices.length >= 3 && !draftGeojson) {
          L.polygon(latlngs, { color: "#2563eb", weight: 2, fillColor: "#60a5fa", fillOpacity: 0.12 }).addTo(layer);
        }
      }
      layer.addTo(map);
      layerRef.current = layer;
    });
    return () => {
      cancelled = true;
      layerRef.current?.remove();
      layerRef.current = null;
    };
  }, [plots, draftGeojson, draftVertices, drawEnabled, selectedPlotId, ready]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-[#e8f0ec]">
      <div ref={containerRef} className="h-[360px] w-full sm:h-[440px]" aria-label="Carte des parcelles" />
      {mapFailed && (
        <div className="absolute inset-0 z-[500] flex items-center justify-center bg-slate-50/95 p-6 text-center">
          <div className="max-w-sm rounded-xl border border-amber-200 bg-white p-4 text-sm text-amber-900 shadow-sm">
            La carte interactive n'a pas pu démarrer. Les données de parcelles restent accessibles dans la liste.
          </div>
        </div>
      )}
      {tileFailed && !mapFailed && (
        <div className="pointer-events-none absolute left-3 top-3 z-[400] rounded-lg bg-white/90 px-3 py-1.5 text-[11px] text-slate-600 shadow-sm">
          Fond OpenStreetMap indisponible — les géométries restent visibles si elles sont chargées.
        </div>
      )}
      {drawEnabled && ready && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[400] rounded-lg bg-blue-700 px-3 py-1.5 text-xs font-semibold text-white shadow">
          Cliquez sur la carte pour placer les sommets du polygone
        </div>
      )}
      <div className="pointer-events-none absolute bottom-3 right-3 z-[400] rounded-lg bg-white/90 px-2.5 py-1.5 text-[10px] text-slate-500 shadow-sm">
        Source fond : OpenStreetMap
      </div>
    </div>
  );
}
