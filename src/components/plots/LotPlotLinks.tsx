"use client";
import { useEffect, useState } from "react";
import { type Api, type Lot } from "../supply/types";
import { Dialog } from "../supply/controls";
import { type Plot, type PlotData } from "./types";
export function LotPlotLinks({
  lot,
  api,
  writable,
  onClose,
  onSaved,
}: {
  lot: Lot;
  api: Api;
  writable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [version, setVersion] = useState(lot.version),
    [links, setLinks] = useState<
      {
        plot_id: string;
        revision: number;
        reference: string;
        payload?: PlotData;
        current_revision?: number;
        archived_at?: string | null;
      }[]
    >([]),
    [items, setItems] = useState<Plot[]>([]),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    api("/lots/" + lot.id + "/plots", "GET", undefined, ctrl.signal)
      .then((r) => {
        const d = r as { lot: { version: number }; items: typeof links };
        setVersion(d.lot.version);
        setLinks(d.items);
        setLoaded(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ctrl.abort();
  }, [api, lot.id]);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api(
        "/plots?supplier_id=" +
          lot.supplier_id +
          "&q=" +
          encodeURIComponent(q) +
          "&page=" +
          page,
        "GET",
        undefined,
        ctrl.signal,
      )
        .then((r) => {
          const d = r as { items: Plot[]; total: number };
          setItems(d.items);
          setTotal(d.total);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [api, lot.supplier_id, q, page]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      await api("/lots/" + lot.id + "/plots", "PUT", {
        version,
        plots: links.map((l) => ({ plot_id: l.plot_id, revision: l.revision })),
      });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog
      title={"Parcelles du lot " + lot.reference}
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="record-form">
        <p>
          Chaque lien retient une version précise. Modifier une parcelle ne
          modifie jamais silencieusement la provenance de ce lot.
        </p>
        {error && (
          <div className="message error" role="alert">
            {error}
          </div>
        )}
        <h3>Versions retenues</h3>
        {links.length === 0 && (
          <p className="muted">
            Aucune parcelle rattachée. Ce lot n’a pas de provenance parcellaire
            renseignée.
          </p>
        )}
        {links.map((l) => (
          <div className="contact-row" key={l.plot_id}>
            <div>
              <strong>
                {l.reference} · révision {l.revision}
              </strong>
              {l.current_revision && l.current_revision !== l.revision && (
                <p className="missing-note">
                  Une révision plus récente existe. Le lien reste sur l’ancienne
                  version.
                </p>
              )}
              {l.archived_at && <p>Parcelle archivée — historique conservé.</p>}
            </div>
            {writable && !lot.archived_at && (
              <button
                className="text-button danger-text"
                disabled={busy}
                onClick={() =>
                  setLinks((v) => v.filter((x) => x.plot_id !== l.plot_id))
                }
              >
                Retirer le lien
              </button>
            )}
          </div>
        ))}
        {writable && !lot.archived_at && (
          <>
            <label>
              Rechercher une parcelle de ce fournisseur
              <input
                type="search"
                maxLength={200}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            {items.map((p) => (
              <div className="contact-row" key={p.id}>
                <div>
                  <strong>
                    {p.reference} · {p.payload.name}
                  </strong>
                  <p>Révision courante {p.current_revision}</p>
                </div>
                <button
                  className="button secondary"
                  disabled={
                    !loaded ||
                    busy ||
                    links.some(
                      (x) =>
                        x.plot_id === p.id && x.revision === p.current_revision,
                    )
                  }
                  onClick={() =>
                    setLinks((v) => [
                      ...v.filter((x) => x.plot_id !== p.id),
                      {
                        plot_id: p.id,
                        revision: p.current_revision,
                        reference: p.reference,
                        current_revision: p.current_revision,
                      },
                    ])
                  }
                >
                  {links.some((x) => x.plot_id === p.id)
                    ? "Retenir la révision courante"
                    : "Rattacher"}
                </button>
              </div>
            ))}
            <div className="table-pagination">
              <span>
                {total} parcelles disponibles · page {page}
              </span>
              <div className="row-actions">
                <button
                  className="text-button"
                  disabled={page === 1}
                  onClick={() => setPage((v) => v - 1)}
                >
                  Précédent
                </button>
                <button
                  className="text-button"
                  disabled={page * 20 >= total}
                  onClick={() => setPage((v) => v + 1)}
                >
                  Suivant
                </button>
              </div>
            </div>
            <button
              className="button primary"
              disabled={!loaded || busy || links.length > 100}
              onClick={() => void save()}
            >
              Enregistrer les liens du lot
            </button>
          </>
        )}
      </div>
    </Dialog>
  );
}
