"use client";
import { useEffect, useState } from "react";
import { type Catalogue } from "../supply/types";
import { type Proposal, usePlotApi } from "./types";
import { PlotForm } from "./PlotForm";
import { ProposalCard } from "./ProposalCard";
export function PortalPlots({
  csrf,
  catalogue,
}: {
  csrf: string;
  catalogue: Catalogue;
}) {
  const api = usePlotApi("/api/portal", csrf),
    [items, setItems] = useState<Proposal[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [revision, setRevision] = useState(0),
    [form, setForm] = useState<{ p?: Proposal } | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const c = new AbortController();
    api("/plot-proposals?page=" + page, "GET", undefined, c.signal)
      .then((r) => {
        const d = r as { items: Proposal[]; total: number };
        setItems(d.items);
        setTotal(d.total);
        setError("");
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!c.signal.aborted) setLoading(false);
      });
    return () => c.abort();
  }, [api, page, revision]);
  function changed() {
    setLoading(true);
    setRevision((v) => v + 1);
    setNotice(
      "Proposition mise à jour. Les parcelles de référence restent gérées par votre client.",
    );
  }
  return (
    <section className="portal-card portal-plots">
      <span className="eyebrow">GÉOLOCALISATION · COLLECTE DISTINCTE</span>
      <h2>Mes parcelles proposées</h2>
      <p className="muted">
        Proposez un point ou un contour, puis transmettez-le pour revue. Cette
        étape reste indépendante de la collecte initiale d’organisation et
        produits ; aucun pourcentage global EUDR n’est calculé.
      </p>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="message success" role="status">
          {notice}
        </div>
      )}
      <div className="row-actions">
        <button className="button primary" onClick={() => setForm({})}>
          Proposer une parcelle
        </button>
        <button
          className="text-button"
          onClick={() => {
            setLoading(true);
            setRevision((v) => v + 1);
          }}
        >
          Actualiser les propositions
        </button>
      </div>
      {loading && <p role="status">Actualisation des propositions…</p>}
      {!loading && items.length === 0 && (
        <p className="empty-compact">Aucune proposition enregistrée.</p>
      )}
      {!loading &&
        items.map((p) => (
          <ProposalCard
            key={p.id + "-" + p.version}
            p={p}
            api={api}
            portal
            onEdit={() => setForm({ p })}
            onChanged={changed}
          />
        ))}
      <div className="table-pagination">
        <span>
          {total} proposition(s) · page {page}
        </span>
        <div className="row-actions">
          <button
            className="text-button"
            disabled={page === 1}
            onClick={() => {
              setLoading(true);
              setPage((v) => v - 1);
            }}
          >
            Précédent
          </button>
          <button
            className="text-button"
            disabled={page * 20 >= total}
            onClick={() => {
              setLoading(true);
              setPage((v) => v + 1);
            }}
          >
            Suivant
          </button>
        </div>
      </div>
      {form && (
        <PlotForm
          api={api}
          catalogue={catalogue}
          portal
          proposal={form.p}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            changed();
          }}
        />
      )}
    </section>
  );
}
