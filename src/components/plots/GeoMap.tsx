"use client";
import { useEffect, useRef, useState } from "react";
import type * as Leaflet from "leaflet";
import type { GeoJsonObject } from "geojson";
import { type Geometry } from "./types";
type Shape = { id: string; name: string; geometry: Geometry };
function fitGeometries(L: typeof Leaflet, m: Leaflet.Map, shapes: Shape[]) {
  const bounds = L.latLngBounds([]);
  for (const s of shapes) {
    try {
      bounds.extend(L.geoJSON(s.geometry as GeoJsonObject).getBounds());
    } catch {}
  }
  if (bounds.isValid())
    m.fitBounds(bounds, { padding: [35, 35], maxZoom: 17, animate: false });
}

export default function GeoMap({
  shapes,
  fitKey = "",
  mode = "none",
  onPick,
  onSelect,
  onGeometryChange,
  editableGeometry,
  onBoundsChange,
}: {
  shapes: Shape[];
  fitKey?: string;
  mode?: "none" | "point" | "polygon";
  onPick?: (pair: number[]) => void;
  onSelect?: (id: string) => void;
  onGeometryChange?: (geometry: Geometry) => void;
  editableGeometry?: Geometry | null;
  onBoundsChange?: (bbox: number[]) => void;
}) {
  const node = useRef<HTMLDivElement>(null),
    map = useRef<Leaflet.Map | null>(null),
    lib = useRef<typeof Leaflet | null>(null),
    layer = useRef<Leaflet.LayerGroup | null>(null);
  const handlers = useRef({
    onPick,
    onSelect,
    onGeometryChange,
    mode,
    onBoundsChange,
  });
  const currentShapes = useRef(shapes);
  const [ready, setReady] = useState(false),
    [position, setPosition] = useState("WGS84 · longitude, latitude");
  useEffect(() => {
    handlers.current = {
      onPick,
      onSelect,
      onGeometryChange,
      mode,
      onBoundsChange,
    };
  }, [onPick, onSelect, onGeometryChange, mode, onBoundsChange]);
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | undefined;
    void import("leaflet").then((L) => {
      if (disposed || !node.current) return;
      lib.current = L;
      const m = L.map(node.current, {
        attributionControl: false,
        preferCanvas: true,
        zoomControl: true,
        minZoom: 1,
        maxZoom: 21,
      }).setView([0, 0], 2);
      map.current = m;
      m.on("moveend", () => {
        const b = m.getBounds();
        const w = Math.max(-180, b.getWest()),
          e = Math.min(180, b.getEast()),
          s = Math.max(-90, b.getSouth()),
          n = Math.min(90, b.getNorth());
        if (w < e && s < n) handlers.current.onBoundsChange?.([w, s, e, n]);
      });
      layer.current = L.layerGroup().addTo(m);
      m.on("click", (e: Leaflet.LeafletMouseEvent) => {
        const lon = ((((e.latlng.lng + 180) % 360) + 360) % 360) - 180;
        setPosition(`${lon.toFixed(6)}, ${e.latlng.lat.toFixed(6)}`);
        if (handlers.current.mode !== "none")
          handlers.current.onPick?.([lon, e.latlng.lat]);
      });
      let wasVisible = false;
      observer = new ResizeObserver(() => {
        m.invalidateSize();
        const visible =
          !!node.current?.clientWidth && !!node.current?.clientHeight;
        if (visible && !wasVisible) fitGeometries(L, m, currentShapes.current);
        wasVisible = visible;
      });
      observer.observe(node.current);
      setReady(true);
    });
    return () => {
      disposed = true;
      observer?.disconnect();
      map.current?.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);
  useEffect(() => {
    const L = lib.current,
      m = map.current,
      group = layer.current;
    if (!L || !m || !group || !ready) return;
    group.clearLayers();
    for (const shape of shapes) {
      try {
        const geo = L.geoJSON(shape.geometry as GeoJsonObject, {
          style: {
            color: "#29744e",
            weight: 2,
            fillColor: "#83a762",
            fillOpacity: 0.2,
          },
          pointToLayer: (_, latlng) =>
            L.circleMarker(latlng, {
              radius: 7,
              color: "#176449",
              fillOpacity: 0.7,
            }),
        });
        const label = document.createElement("span");
        label.textContent = shape.name;
        geo.bindTooltip(label);
        geo.on("click", () => {
          if (handlers.current.mode === "none")
            handlers.current.onSelect?.(shape.id);
        });
        group.addLayer(geo);
      } catch {
        /* Invalid draft JSON never replaces the last saved backend geometry. */
      }
    }
    if (editableGeometry && onGeometryChange && mode === "none") {
      const g = editableGeometry;
      let pairs: number[][] = [];
      if (g.type === "Point" && Array.isArray(g.coordinates))
        pairs = [g.coordinates as number[]];
      if (
        g.type === "Polygon" &&
        Array.isArray(g.coordinates) &&
        Array.isArray(g.coordinates[0])
      )
        pairs = (g.coordinates as number[][][])[0]?.slice(0, -1) || [];
      if (pairs.length <= 200)
        for (const [idx, pair] of pairs.entries()) {
          if (
            !Array.isArray(pair) ||
            pair.length !== 2 ||
            !pair.every(Number.isFinite)
          )
            continue;
          const marker = L.marker([pair[1], pair[0]], {
            draggable: true,
            icon: L.divIcon({
              className: "geo-handle",
              iconSize: [14, 14],
              iconAnchor: [7, 7],
            }),
            keyboard: true,
            title: `Sommet ${idx + 1} — déplaçable`,
          });
          marker.on("dragend", () => {
            const ll = marker.getLatLng(),
              next = JSON.parse(JSON.stringify(g)) as Geometry;
            const value = [
              ((((ll.lng + 180) % 360) + 360) % 360) - 180,
              ll.lat,
            ];
            if (next.type === "Point") next.coordinates = value;
            else {
              const rings = next.coordinates as number[][][];
              rings[0][idx] = value;
              if (idx === 0) rings[0][rings[0].length - 1] = value;
            }
            handlers.current.onGeometryChange?.(next);
          });
          group.addLayer(marker);
        }
    }
  }, [shapes, ready, editableGeometry, onGeometryChange, mode]);
  useEffect(() => {
    currentShapes.current = shapes;
  }, [shapes]);
  useEffect(() => {
    const L = lib.current,
      m = map.current;
    if (!L || !m || !ready) return;
    fitGeometries(L, m, currentShapes.current);
  }, [ready, fitKey]);
  return (
    <div className="geo-map-shell">
      <div
        ref={node}
        className="geo-map"
        role="region"
        aria-label="Carte privée des géométries"
      />
      <div className="geo-map-caption">
        <span>{position}</span>
        <strong>Aucun fond externe · aucune requête de tuiles</strong>
      </div>
      <p className="caption">
        {mode === "polygon"
          ? "Cliquez sur la carte pour ajouter les sommets, puis terminez le contour."
          : mode === "point"
            ? "Cliquez pour placer un point."
            : "Déplacez et zoomez la carte. Les surfaces affichées ne prouvent pas la localisation réelle."}
      </p>
    </div>
  );
}
