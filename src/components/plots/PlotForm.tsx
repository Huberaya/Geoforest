"use client";
import { useMemo, useState, type FormEvent } from "react";
import { type Api, type Catalogue } from "../supply/types";
import { Dialog, CountrySelect, Lookup } from "../supply/controls";
import GeoMap from "./GeoMap";
import { AnalysisView } from "./AnalysisView";
import {
  type Geometry,
  type Plot,
  type PlotData,
  type Proposal,
  type Analysis,
} from "./types";
export function PlotForm({
  api,
  catalogue,
  record,
  proposal,
  portal = false,
  onClose,
  onSaved,
}: {
  api: Api;
  catalogue: Catalogue;
  record?: Plot;
  proposal?: Proposal;
  portal?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = record?.payload || proposal?.payload;
  const [data, setData] = useState<Omit<PlotData, "geometry">>(
    initial || {
      reference: "",
      name: "",
      country: "",
      commodity: null,
      declared_area_ha: null,
      capture_method: "MANUAL",
      source_note: "",
      gps_accuracy_m: null,
      captured_at: null,
    },
  );
  const [supplier, setSupplier] = useState<string[]>(
      record ? [record.supplier_id] : [],
    ),
    [raw, setRaw] = useState(
      initial ? JSON.stringify(initial.geometry, null, 2) : "",
    ),
    [analysis, setAnalysis] = useState<Analysis | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [gpsMessage, setGpsMessage] = useState(""),
    [mode, setMode] = useState<"none" | "point" | "polygon">("none"),
    [vertices, setVertices] = useState<number[][]>([]),
    [fit, setFit] = useState(0);
  const [longitude, setLongitude] = useState(
    initial?.geometry.type === "Point"
      ? String((initial.geometry.coordinates as number[])[0])
      : "",
  );
  const [latitude, setLatitude] = useState(
    initial?.geometry.type === "Point"
      ? String((initial.geometry.coordinates as number[])[1])
      : "",
  );
  const [manualDirty, setManualDirty] = useState(false);
  const [geoExpanded, setGeoExpanded] = useState(!initial);
  const geometry = useMemo(() => {
    try {
      const g = JSON.parse(raw);
      return Array.isArray(g.coordinates) &&
        ["Point", "Polygon", "MultiPolygon"].includes(g.type)
        ? (g as Geometry)
        : null;
    } catch {
      return null;
    }
  }, [raw]);
  const drawn = useMemo(
    () =>
      vertices.length > 1
        ? ({ type: "LineString", coordinates: vertices } as Geometry)
        : vertices.length
          ? ({ type: "Point", coordinates: vertices[0] } as Geometry)
          : null,
    [vertices],
  );
  const shapes = useMemo(() => {
    const g = mode === "polygon" ? drawn : geometry;
    return g
      ? [
          {
            id: "draft",
            name: "Saisie en cours — non enregistrée",
            geometry: g,
          },
        ]
      : [];
  }, [geometry, drawn, mode]);
  function change<K extends keyof typeof data>(
    key: K,
    value: (typeof data)[K],
  ) {
    setData((v) => ({ ...v, [key]: value }));
    setAnalysis(null);
    setConfirmed(false);
  }
  function setGeometry(
    g: Geometry,
    method = "DRAW",
    accuracy: number | null = null,
    captured: string | null = null,
  ) {
    setRaw(JSON.stringify(g, null, 2));
    setManualDirty(false);
    if (g.type === "Point") {
      setLongitude(String((g.coordinates as number[])[0]));
      setLatitude(String((g.coordinates as number[])[1]));
    } else {
      setLongitude("");
      setLatitude("");
    }
    setData((d) => ({
      ...d,
      capture_method: method,
      gps_accuracy_m: accuracy,
      captured_at: captured,
    }));
    setAnalysis(null);
    setConfirmed(false);
  }
  function gps() {
    setGpsMessage("");
    if (!navigator.geolocation) {
      setGpsMessage(
        "GPS indisponible : saisissez un point ou importez une géométrie.",
      );
      return;
    }
    setBusy(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeometry(
          {
            type: "Point",
            coordinates: [p.coords.longitude, p.coords.latitude],
          },
          "GPS",
          p.coords.accuracy,
          new Date(p.timestamp).toISOString(),
        );
        setMode("none");
        setFit((v) => v + 1);
        setGpsMessage(
          `Position du navigateur, précision annoncée ± ${Math.round(p.coords.accuracy)} m. Vérifiez que vous êtes bien sur le lieu de production.`,
        );
        setBusy(false);
      },
      (e) => {
        setGpsMessage(
          e.code === 1
            ? "Permission GPS refusée. Vous pouvez utiliser la saisie manuelle ou le dessin."
            : "Position indisponible ou délai dépassé. Aucune position enregistrée.",
        );
        setBusy(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }
  async function validate() {
    setBusy(true);
    setError("");
    setAnalysis(null);
    try {
      if (!geometry)
        throw new Error(
          "Saisissez, dessinez ou importez une géométrie valide.",
        );
      const a = (await api("/plots/check", "POST", {
        geometry,
        declared_area_ha: data.declared_area_ha || null,
        commodity: data.commodity,
        ...(record ? { exclude_plot_id: record.id } : {}),
      })) as Analysis;
      setAnalysis(a);
      setFit((v) => v + 1);
      setFit((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!analysis || !geometry || !confirmed) return;
    setBusy(true);
    setError("");
    try {
      const payload = {
        ...data,
        geometry,
        declared_area_ha: data.declared_area_ha || null,
      };
      if (portal)
        await api(
          "/plot-proposals" + (proposal ? "/" + proposal.id : ""),
          proposal ? "PUT" : "POST",
          { payload, ...(proposal ? { version: proposal.version } : {}) },
        );
      else {
        if (!record && !supplier[0])
          throw new Error("Choisissez le fournisseur de la parcelle.");
        await api(
          "/plots" + (record ? "/" + record.id : ""),
          record ? "PUT" : "POST",
          {
            ...payload,
            acknowledge_warnings: true,
            ...(record
              ? { version: record.version }
              : { supplier_id: supplier[0] }),
          },
        );
      }
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={
        portal
          ? proposal
            ? "Corriger la proposition"
            : "Proposer une parcelle"
          : record
            ? "Modifier la parcelle"
            : "Créer une parcelle"
      }
      onClose={onClose}
      busy={busy}
      wide
    >
      <form className="record-form" onSubmit={save}>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        <fieldset className="geo-fields" disabled={busy}>
          <p className="caption">
            Les coordonnées sont déclaratives. Aucune validation de propriété,
            de pays réel ou de conformité EUDR.
          </p>
          {!portal && !record && (
            <Lookup
              api={api}
              kind="suppliers"
              label="Fournisseur de la parcelle"
              required
              value={supplier}
              onChange={setSupplier}
            />
          )}
          <div className="form-grid">
            <label>
              Référence parcelle *
              <input
                required
                minLength={2}
                maxLength={40}
                value={data.reference}
                onChange={(e) => change("reference", e.target.value)}
              />
            </label>
            <label>
              Nom de la parcelle *
              <input
                required
                minLength={2}
                maxLength={200}
                value={data.name}
                onChange={(e) => change("name", e.target.value)}
              />
            </label>
            <CountrySelect
              name="plot_country"
              label="Pays déclaré"
              catalogue={catalogue}
              required
              value={data.country}
              onChange={(v) => change("country", v)}
            />
            <label>
              Matière déclarée
              <select
                value={data.commodity || ""}
                onChange={(e) => change("commodity", e.target.value || null)}
              >
                <option value="">À préciser</option>
                {catalogue.commodities.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Surface déclarée (ha)
              <input
                inputMode="decimal"
                value={data.declared_area_ha || ""}
                onChange={(e) =>
                  change(
                    "declared_area_ha",
                    e.target.value.replace(",", ".") || null,
                  )
                }
                placeholder="Inconnue si vide"
              />
            </label>
            <label>
              Source / observations
              <input
                maxLength={1000}
                value={data.source_note}
                onChange={(e) => change("source_note", e.target.value)}
              />
            </label>
          </div>
          <div className="row-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setMode("point");
                setVertices([]);
              }}
            >
              Placer un point
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => {
                setMode("polygon");
                setVertices([]);
              }}
            >
              Dessiner un contour
            </button>
            <button type="button" className="button secondary" onClick={gps}>
              Utiliser ma position GPS
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setFit((v) => v + 1)}
            >
              Recentrer
            </button>
          </div>
          {gpsMessage && (
            <p className="callout" role="status">
              {gpsMessage}
            </p>
          )}
          <GeoMap
            shapes={shapes}
            fitKey={String(fit)}
            mode={busy ? "none" : mode}
            onPick={(pair) => {
              if (mode === "point") {
                setGeometry({ type: "Point", coordinates: pair });
                setMode("none");
              } else setVertices((v) => [...v, pair]);
            }}
            editableGeometry={!busy ? geometry : null}
            onGeometryChange={(g) => setGeometry(g)}
          />
          {mode === "polygon" && (
            <div className="row-actions">
              <span>{vertices.length} sommets</span>
              <button
                type="button"
                className="button secondary"
                disabled={vertices.length < 3}
                onClick={() => {
                  setGeometry({
                    type: "Polygon",
                    coordinates: [[...vertices, vertices[0]]],
                  });
                  setMode("none");
                }}
              >
                Terminer le contour
              </button>
              <button
                type="button"
                className="text-button"
                disabled={!vertices.length}
                onClick={() => setVertices((v) => v.slice(0, -1))}
              >
                Annuler le dernier sommet
              </button>
            </div>
          )}
          {mode !== "none" && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMode("none");
                setVertices([]);
              }}
            >
              Quitter le mode dessin
            </button>
          )}
          <div className="form-grid">
            <label>
              Longitude du point
              <input
                inputMode="decimal"
                value={longitude}
                onChange={(e) => {
                  setLongitude(e.target.value);
                  setManualDirty(true);
                  setAnalysis(null);
                  setConfirmed(false);
                }}
                placeholder="−180 à 180"
              />
            </label>
            <label>
              Latitude du point
              <input
                inputMode="decimal"
                value={latitude}
                onChange={(e) => {
                  setLatitude(e.target.value);
                  setManualDirty(true);
                  setAnalysis(null);
                  setConfirmed(false);
                }}
                placeholder="−90 à 90"
              />
            </label>
          </div>
          <button
            type="button"
            className="button secondary"
            disabled={!manualDirty}
            onClick={() => {
              const x = Number(longitude.replace(",", ".")),
                y = Number(latitude.replace(",", "."));
              if (
                !longitude.trim() ||
                !latitude.trim() ||
                !Number.isFinite(x) ||
                !Number.isFinite(y) ||
                Math.abs(x) > 180 ||
                Math.abs(y) > 90
              ) {
                setError("Saisissez une longitude et une latitude valides.");
                return;
              }
              setGeometry({ type: "Point", coordinates: [x, y] }, "MANUAL");
              setMode("none");
              setFit((v) => v + 1);
              setError("");
            }}
          >
            Appliquer les coordonnées du point
          </button>
          <p className="caption">
            Saisir un point remplace le contour en cours. Les poignées
            permettent de déplacer le point ou les sommets du contour extérieur
            (jusqu’à 200). Trous, multipolygones et grandes géométries : édition
            GeoJSON ci-dessous ou nouvel import.
          </p>
          <details
            open={geoExpanded}
            onToggle={(e) => setGeoExpanded(e.currentTarget.open)}
          >
            <summary>Coordonnées GeoJSON — saisie / correction avancée</summary>
            <label>
              Géométrie GeoJSON
              <textarea
                rows={6}
                value={raw}
                maxLength={1048576}
                placeholder={'{"type":"Point","coordinates":[-30,0]}'}
                onChange={(e) => {
                  setRaw(e.target.value);
                  setManualDirty(false);
                  setMode("none");
                  setLongitude("");
                  setLatitude("");
                  try {
                    const g = JSON.parse(e.target.value);
                    if (
                      g?.type === "Point" &&
                      Array.isArray(g.coordinates) &&
                      g.coordinates.length === 2 &&
                      g.coordinates.every(Number.isFinite)
                    ) {
                      setLongitude(String(g.coordinates[0]));
                      setLatitude(String(g.coordinates[1]));
                    }
                  } catch {}

                  setAnalysis(null);
                  setConfirmed(false);
                  setData((d) => ({
                    ...d,
                    capture_method: "MANUAL",
                    gps_accuracy_m: null,
                    captured_at: null,
                  }));
                }}
              />
            </label>
          </details>
          <p className="caption">
            Méthode déclarée : {data.capture_method}
            {data.gps_accuracy_m !== null
              ? ` · précision annoncée ${data.gps_accuracy_m} m`
              : ""}
            . La validation ne répare pas silencieusement les contours.
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={!geometry || mode !== "none" || manualDirty}
            onClick={() => void validate()}
          >
            Vérifier la géométrie
          </button>
          {analysis && <AnalysisView analysis={analysis} />}
          <label className="checkbox-label confirmation">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={!analysis}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              J’ai relu les données et avertissements techniques. Ceci ne
              constitue pas une validation EUDR.
            </span>
          </label>
        </fieldset>
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={onClose}
          >
            Annuler
          </button>
          <button
            className="button primary"
            disabled={busy || !analysis || !confirmed || mode !== "none"}
          >
            {busy
              ? "Enregistrement…"
              : portal
                ? "Enregistrer la proposition"
                : "Enregistrer la parcelle"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
