"use client";
import { useState } from "react";
import { type Api, type Catalogue } from "../supply/types";
import { Dialog, CountrySelect, Lookup } from "../supply/controls";
import { type PlotData, type Analysis } from "./types";
import GeoMap from "./GeoMap";
import { AnalysisView } from "./AnalysisView";
type Preview = {
  checksum: string;
  items: {
    source_index: number;
    payload: PlotData;
    analysis: Analysis;
    parser_warnings: string[];
    ignored_properties: string[];
  }[];
  conflicting_references: string[];
  already_imported: boolean;
  batch_intersections: { first: number; second: number; kind: string }[];
  batch_intersections_truncated: boolean;
};
export function PlotImport({
  api,
  catalogue,
  onClose,
  onSaved,
}: {
  api: Api;
  catalogue: Catalogue;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [supplier, setSupplier] = useState<string[]>([]),
    [country, setCountry] = useState(""),
    [commodity, setCommodity] = useState(""),
    [prefix, setPrefix] = useState("PARC"),
    [format, setFormat] = useState("geojson"),
    [raw, setRaw] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  function reset() {
    setPreview(null);
    setConfirmed(false);
    setError("");
  }
  const body = {
    supplier_id: supplier[0],
    country,
    commodity: commodity || null,
    reference_prefix: prefix,
    file_format: format,
    source_text: raw,
  };
  async function inspect() {
    setBusy(true);
    reset();
    try {
      if (!supplier[0] || !country)
        throw new Error("Choisissez le fournisseur et le pays par défaut.");
      setPreview((await api("/plots/import-preview", "POST", body)) as Preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      await api("/plots/import", "POST", {
        ...body,
        confirmed: true,
        preview_checksum: preview.checksum,
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Importer des parcelles" onClose={onClose} busy={busy} wide>
      <div className="record-form">
        <p>
          GeoJSON ou KML UTF-8 · 1 Mio, 100 éléments et 10 000 positions
          maximum. Aucun SHP/KMZ ni ressource réseau. Une erreur annule tout
          l’import.
        </p>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        <fieldset className="geo-fields" disabled={busy}>
          <Lookup
            api={api}
            kind="suppliers"
            label="Fournisseur de l’import"
            value={supplier}
            onChange={(v) => {
              setSupplier(v);
              reset();
            }}
            required
          />
          <div className="form-grid">
            <CountrySelect
              name="import_country"
              label="Pays par défaut"
              required
              catalogue={catalogue}
              value={country}
              onChange={(v) => {
                setCountry(v);
                reset();
              }}
            />
            <label>
              Préfixe des références
              <input
                maxLength={25}
                value={prefix}
                onChange={(e) => {
                  setPrefix(e.target.value);
                  reset();
                }}
              />
            </label>
            <label>
              Matière déclarée
              <select
                value={commodity}
                onChange={(e) => {
                  setCommodity(e.target.value);
                  reset();
                }}
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
              Format
              <select
                value={format}
                onChange={(e) => {
                  setFormat(e.target.value);
                  reset();
                }}
              >
                <option value="geojson">GeoJSON</option>
                <option value="kml">KML</option>
              </select>
            </label>
          </div>
          <p className="caption">
            Références générées : préfixe-001, etc. Le pays du fichier prime sur
            le pays par défaut, sans vérification spatiale. Le fichier original
            reste conservé en privé.
          </p>
          <label>
            Fichier géographique
            <input
              type="file"
              accept=".geojson,.json,.kml"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                reset();
                if (file.size > 1048576) {
                  setError("Fichier trop grand : 1 Mio maximum.");
                  return;
                }
                setFormat(
                  file.name.toLowerCase().endsWith(".kml") ? "kml" : "geojson",
                );
                setBusy(true);
                void file
                  .text()
                  .then(setRaw)
                  .catch(() => setError("Lecture du fichier impossible."))
                  .finally(() => setBusy(false));
              }}
            />
          </label>
          <label>
            Contenu du fichier
            <textarea
              rows={6}
              value={raw}
              maxLength={1048576}
              onChange={(e) => {
                setRaw(e.target.value);
                reset();
              }}
            />
          </label>
          <button
            type="button"
            className="button secondary"
            disabled={!raw.trim()}
            onClick={() => void inspect()}
          >
            Prévisualiser l’import
          </button>
        </fieldset>
        {preview && (
          <>
            <GeoMap
              shapes={preview.items.map((i) => ({
                id: String(i.source_index),
                name: i.payload.name,
                geometry: i.payload.geometry,
              }))}
              fitKey={preview.checksum}
            />
            <p>
              <strong>{preview.items.length} parcelle(s)</strong> dans cet
              aperçu. Rien n’est enregistré avant confirmation.
            </p>
            {preview.already_imported && (
              <div className="callout">
                Fichier et paramètres déjà importés : aucun doublon ne sera
                créé.
              </div>
            )}
            {preview.conflicting_references.length > 0 &&
              !preview.already_imported && (
                <div className="callout warning">
                  Références existantes :{" "}
                  {preview.conflicting_references.join(", ")}. Changez le
                  préfixe, aucune fiche ne sera écrasée.
                </div>
              )}
            {preview.batch_intersections.length > 0 && (
              <div className="callout warning">
                {preview.batch_intersections.length}
                {preview.batch_intersections_truncated
                  ? " ou davantage"
                  : ""}{" "}
                intersection(s) / doublon(s) entre éléments du fichier. À
                vérifier ; aucune conclusion de fraude.
              </div>
            )}
            <div className="geo-import-items">
              {preview.items.map((i) => (
                <details key={i.source_index}>
                  <summary>
                    {i.payload.reference} · {i.payload.name} ·{" "}
                    {i.payload.country} ·{" "}
                    {i.analysis.warnings.length +
                      i.analysis.spatial_relations.length}{" "}
                    avertissement(s)
                  </summary>
                  <AnalysisView analysis={i.analysis} />
                  {i.parser_warnings.length > 0 && (
                    <p className="callout warning">
                      Altitude KML non utilisée dans la géométrie 2D. Le fichier
                      source sera conservé.
                    </p>
                  )}
                  {i.ignored_properties.length > 0 && (
                    <p className="caption">
                      Propriétés non utilisées :{" "}
                      {i.ignored_properties.join(", ")}
                    </p>
                  )}
                </details>
              ))}
            </div>
            <label className="checkbox-label confirmation">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                disabled={busy}
              />
              <span>
                J’ai vérifié l’aperçu et les avertissements. Je confirme cet
                import de données déclaratives.
              </span>
            </label>
            <button
              className="button primary"
              disabled={
                busy ||
                !confirmed ||
                (!preview.already_imported &&
                  preview.conflicting_references.length > 0)
              }
              onClick={() => void apply()}
            >
              Confirmer l’import des parcelles
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
