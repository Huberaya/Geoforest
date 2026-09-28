"use client";
import { useState } from "react";
import { Dialog } from "./controls";
import { type Api, type Supplier } from "./types";
type Preview = {
  items: Supplier[];
  checksum: string;
  existing_references: string[];
  already_imported: boolean;
  can_import: boolean;
};
export function CsvImport({
  api,
  onClose,
  onSaved,
}: {
  api: Api;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [raw, setRaw] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function inspect() {
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      setPreview(
        (await api("/suppliers/import-preview", "POST", {
          csv_text: raw,
        })) as Preview,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    setError("");
    try {
      await api("/suppliers/import", "POST", { csv_text: raw });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title="Importer des fournisseurs"
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="record-form">
        <p>
          CSV UTF-8, séparateur virgule, 100 lignes maximum. L’import est
          atomique : une ligne invalide annule tout le fichier. Les références
          existantes ne sont jamais écrasées.
        </p>
        <p className="caption">
          En-têtes : <code>reference,name,country,email,address</code>.
          Référence et nom obligatoires ; pays au format ISO à deux lettres.
        </p>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        <label>
          Charger un fichier CSV
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 48000) {
                setError("Fichier trop volumineux : 48 Ko maximum.");
                return;
              }
              void file
                .text()
                .then((t) => {
                  setRaw(t);
                  setPreview(null);
                  setError("");
                })
                .catch(() => setError("Impossible de lire ce fichier."));
            }}
          />
        </label>
        <label>
          Contenu CSV
          <textarea
            rows={7}
            value={raw}
            disabled={busy}
            maxLength={48000}
            onChange={(e) => {
              setRaw(e.target.value);
              setPreview(null);
            }}
            placeholder={
              "reference,name,country,email,address\nDEMO-001,Coopérative fictive,CI,contact@example.invalid,Adresse fictive"
            }
          />
        </label>
        <button
          className="button secondary"
          onClick={() => void inspect()}
          disabled={busy || !raw.trim()}
        >
          Vérifier le fichier
        </button>
        {preview && (
          <>
            <div className={"callout " + (preview.can_import ? "" : "warning")}>
              {preview.already_imported
                ? "Ce fichier a déjà été importé. Aucun doublon ne sera créé."
                : preview.can_import
                  ? `${preview.items.length} fournisseur(s) prêt(s) à importer.`
                  : "Références déjà utilisées : " +
                    preview.existing_references.join(", ")}
            </div>
            <div className="table-scroll">
              <table className="supply-table">
                <thead>
                  <tr>
                    <th>Référence</th>
                    <th>Nom</th>
                    <th>Pays</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.items.map((s) => (
                    <tr key={s.reference}>
                      <td>{s.reference}</td>
                      <td>{s.name}</td>
                      <td>{s.country || "À compléter"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={onClose}
              >
                Annuler
              </button>
              <button
                className="button primary"
                onClick={() => void apply()}
                disabled={busy || !preview.can_import}
              >
                {busy ? "Import en cours…" : "Confirmer l’import"}
              </button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
