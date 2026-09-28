"use client";
import { useCallback, useEffect, useState } from "react";
import {
  type Api,
  type Catalogue,
  type Supplier,
  type Product,
  type Lot,
  errorText,
  countryName,
  statusLabels,
} from "./types";
import { RecordForm, type Kind, type SupplyRecord } from "./RecordForm";
import { SupplierSheet } from "./SupplierSheet";
import { LotPlotLinks } from "../plots/LotPlotLinks";
import { CsvImport } from "./CsvImport";
const labels = {
  suppliers: {
    title: "Fournisseurs",
    sub: "Une relation de confiance commence par des données claires.",
    singular: "un fournisseur",
  },
  products: {
    title: "Produits",
    sub: "Organisez vos produits et leurs matières déclarées.",
    singular: "un produit",
  },
  lots: {
    title: "Lots",
    sub: "Reliez chaque flux à son fournisseur et à son produit.",
    singular: "un lot",
  },
};
export function SupplyWorkspace({
  kind,
  org,
  role,
  csrf,
  writable,
}: {
  kind: Kind;
  org: string;
  role: string;
  csrf: string;
  writable: boolean;
}) {
  const [linkedLot, setLinkedLot] = useState<Lot | null>(null);
  const [items, setItems] = useState<SupplyRecord[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [archive, setArchive] = useState(false);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [revision, setRevision] = useState(0);
  const [catalogue, setCatalogue] = useState<Catalogue>({
    countries: [],
    commodities: [],
    units: ["KG", "T", "M3", "PCS"],
  });
  const [summary, setSummary] = useState<{
    suppliers: number;
    products: number;
    lots: number;
    collections_to_review: number;
  } | null>(null);
  const [form, setForm] = useState<{ record?: SupplyRecord } | null>(null),
    [detail, setDetail] = useState<Supplier | null>(null),
    [csv, setCsv] = useState(false);
  const api: Api = useCallback(
    async (path, method = "GET", body, signal) => {
      const res = await fetch("/api/v1/organizations/" + org + path, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
        cache: "no-store",
      });
      if (!res.ok) {
        let data;
        try {
          data = await res.json();
        } catch {}
        throw new Error(
          res.status === 401
            ? "Session expirée : reconnectez-vous."
            : errorText(data?.detail),
        );
      }
      return res.status === 204 ? undefined : res.json();
    },
    [org, csrf],
  );
  const changed = useCallback(() => setRevision((v) => v + 1), []);
  useEffect(() => {
    const ctrl = new AbortController();
    fetch("/api/v1/catalogue", { signal: ctrl.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok)
          throw new Error("Catalogue indisponible. Rechargez la page.");
        setCatalogue(await r.json());
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ctrl.abort();
  }, []);
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      setError("");
      Promise.all([
        api(
          "/" +
            kind +
            "?page=" +
            page +
            "&limit=20&q=" +
            encodeURIComponent(q) +
            "&include_archived=" +
            archive,
          "GET",
          undefined,
          ctrl.signal,
        ),
        api("/supply-summary", "GET", undefined, ctrl.signal),
      ])
        .then(([list, stats]) => {
          const d = list as { items: SupplyRecord[]; total: number };
          setItems(d.items);
          setTotal(d.total);
          setSummary(stats as typeof summary);
        })
        .catch((e) => {
          if (e.name !== "AbortError") {
            setError(e.message);
            setItems([]);
            setSummary(null);
          }
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [api, kind, page, q, archive, revision]);
  function saved() {
    setForm(null);
    setCsv(false);
    setNotice(
      "Enregistrement effectué. Les données restent à qualifier réglementairement.",
    );
    changed();
  }
  async function archiveRecord(record: SupplyRecord) {
    if (
      !window.confirm(
        "Archiver cette fiche ? Elle restera dans l’historique. Pour un fournisseur, tous ses accès au portail seront révoqués.",
      )
    )
      return;
    try {
      await api("/" + kind + "/" + record.id + "/archive", "POST", {
        version: record.version,
      });
      setNotice("Fiche archivée.");
      changed();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const title = labels[kind];
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">CHAÎNE D’APPROVISIONNEMENT</span>
          <h1>{title.title}</h1>
          <p>{title.sub}</p>
        </div>
        {writable && (
          <div className="row-actions">
            {kind === "suppliers" && (
              <button className="button secondary" onClick={() => setCsv(true)}>
                Importer CSV
              </button>
            )}
            <button
              className="button primary"
              disabled={!catalogue.commodities.length}
              onClick={() => setForm({})}
            >
              + Ajouter {title.singular}
            </button>
          </div>
        )}
      </header>
      <div className="supply-metrics">
        <div>
          <span>Fournisseurs actifs</span>
          <strong>{summary?.suppliers ?? "—"}</strong>
          <small>Dans votre périmètre</small>
        </div>
        <div>
          <span>Produits référencés</span>
          <strong>{summary?.products ?? "—"}</strong>
          <small>Matières déclaratives</small>
        </div>
        <div>
          <span>Lots actifs</span>
          <strong>{summary?.lots ?? "—"}</strong>
          <small>Sans verdict automatique</small>
        </div>
        <div className="highlight">
          <span>Collectes à revoir</span>
          <strong>{summary?.collections_to_review ?? "—"}</strong>
          <small>Revue humaine attendue</small>
        </div>
      </div>
      <div className="scope-strip">
        <span className="scope-icon">i</span>
        <p>
          <strong>Collecte initiale, pas certification.</strong> Le risque EUDR
          n’est pas encore évalué. Les parcelles disposent de leur module ;
          documents et diligence restent à venir.
        </p>
        <span className="status neutral">Manuel / assisté</span>
      </div>
      {error && (
        <div className="message error" role="alert">
          {error}
          <button className="text-button" onClick={changed}>
            Réessayer
          </button>
        </div>
      )}
      {notice && (
        <div className="message success" role="status">
          {notice}
          <button
            className="text-button"
            aria-label="Masquer la notification"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      <section className="panel supply-panel">
        <div className="supply-toolbar">
          <div className="search-field">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label={"Rechercher dans " + title.title.toLowerCase()}
              type="search"
              placeholder={
                kind === "lots"
                  ? "Rechercher une référence de lot…"
                  : "Rechercher un nom ou une référence…"
              }
              value={q}
              maxLength={200}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
            />
          </div>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={archive}
              onChange={(e) => {
                setArchive(e.target.checked);
                setPage(1);
              }}
            />{" "}
            Inclure les archives
          </label>
          <span className="caption">{total} résultat(s)</span>
        </div>
        <div className="table-scroll" aria-busy={loading}>
          <table className="supply-table">
            <thead>
              <tr>
                {kind === "suppliers" ? (
                  <>
                    <th>Fournisseur</th>
                    <th>Pays</th>
                    <th>Collecte initiale</th>
                    <th>Lots</th>
                    <th>Risque EUDR</th>
                  </>
                ) : kind === "products" ? (
                  <>
                    <th>Produit</th>
                    <th>Matières déclarées</th>
                    <th>Code SH / NC</th>
                    <th>Fournisseurs</th>
                    <th>Qualification</th>
                  </>
                ) : (
                  <>
                    <th>Lot</th>
                    <th>Fournisseur / produit</th>
                    <th>Quantité</th>
                    <th>Production</th>
                    <th>Informations</th>
                  </>
                )}
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className="table-message">
                    Chargement…
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="empty-supply">
                      <div aria-hidden="true">
                        {kind === "suppliers"
                          ? "↗"
                          : kind === "products"
                            ? "◇"
                            : "▦"}
                      </div>
                      <h3>
                        {q
                          ? "Aucun résultat"
                          : "Votre référentiel commence ici"}
                      </h3>
                      <p>
                        {q
                          ? "Essayez une autre recherche."
                          : `Ajoutez ${title.singular} pour structurer votre chaîne d’approvisionnement.`}
                      </p>
                      {writable && !q && (
                        <button
                          className="button secondary"
                          onClick={() => setForm({})}
                        >
                          Ajouter {title.singular}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((record) => (
                  <tr
                    key={record.id}
                    className={record.archived_at ? "archived-row" : ""}
                  >
                    {kind === "suppliers" ? (
                      <SupplierCells
                        s={record as Supplier}
                        onOpen={() => setDetail(record as Supplier)}
                      />
                    ) : kind === "products" ? (
                      <ProductCells
                        p={record as Product}
                        catalogue={catalogue}
                      />
                    ) : (
                      <LotCells l={record as Lot} />
                    )}
                    <td>
                      <div className="row-actions">
                        {kind === "lots" && (
                          <button
                            className="text-button"
                            onClick={() => setLinkedLot(record as Lot)}
                          >
                            Parcelles
                          </button>
                        )}

                        {kind === "suppliers" && (
                          <button
                            className="text-button"
                            onClick={() => setDetail(record as Supplier)}
                          >
                            Ouvrir
                          </button>
                        )}
                        {writable && !record.archived_at && (
                          <>
                            <button
                              className="text-button"
                              aria-label={"Modifier " + record.reference}
                              onClick={() => setForm({ record })}
                            >
                              Modifier
                            </button>
                            <button
                              className="text-button subtle"
                              aria-label={"Archiver " + record.reference}
                              onClick={() => void archiveRecord(record)}
                            >
                              Archiver
                            </button>
                          </>
                        )}
                      </div>
                      {record.archived_at && (
                        <span className="status neutral">Archivé</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="table-pagination">
          <span>
            Page {page} sur {Math.max(1, Math.ceil(total / 20))}
          </span>
          <div className="row-actions">
            <button
              className="button secondary small"
              disabled={loading || page === 1}
              onClick={() => setPage((v) => v - 1)}
            >
              Précédent
            </button>
            <button
              className="button secondary small"
              disabled={loading || page * 20 >= total}
              onClick={() => setPage((v) => v + 1)}
            >
              Suivant
            </button>
          </div>
        </div>
      </section>
      {linkedLot && (
        <LotPlotLinks
          lot={linkedLot}
          api={api}
          writable={writable}
          onClose={() => setLinkedLot(null)}
          onSaved={() => {
            setLinkedLot(null);
            changed();
            setNotice("Provenance parcellaire du lot enregistrée.");
          }}
        />
      )}
      {form && (
        <RecordForm
          key={form.record?.id || "new"}
          kind={kind}
          record={form.record}
          catalogue={catalogue}
          api={api}
          onClose={() => setForm(null)}
          onSaved={saved}
        />
      )}
      {detail && (
        <SupplierSheet
          supplier={detail}
          api={api}
          writable={writable}
          reviewable={
            ["Admin", "Compliance Manager"].includes(role) && writable
          }
          onClose={() => setDetail(null)}
          onEdit={(s) => {
            setDetail(null);
            setForm({ record: s });
          }}
          onChanged={changed}
        />
      )}{" "}
      {csv && (
        <CsvImport api={api} onClose={() => setCsv(false)} onSaved={saved} />
      )}
    </>
  );
}
function SupplierCells({ s, onOpen }: { s: Supplier; onOpen: () => void }) {
  return (
    <>
      <td>
        <div className="supplier-cell">
          <span className="supplier-monogram small">
            {s.name.slice(0, 2).toUpperCase()}
          </span>
          <div>
            <button className="name-button" onClick={onOpen}>
              {s.name}
            </button>
            <small>{s.reference}</small>
          </div>
        </div>
      </td>
      <td>{countryName(s.country)}</td>
      <td>
        <span
          className={
            "status " +
            (s.collection_status === "SUBMITTED" ? "warning" : "neutral")
          }
        >
          {s.collection_status
            ? statusLabels[s.collection_status]
            : "Non démarrée"}
        </span>
        {!!s.missing_fields?.length && (
          <small className="missing-note">Fiche à compléter</small>
        )}
      </td>
      <td>{s.lot_count ?? 0}</td>
      <td>
        <span className="status neutral">Non évalué</span>
      </td>
    </>
  );
}
function ProductCells({ p, catalogue }: { p: Product; catalogue: Catalogue }) {
  return (
    <>
      <td>
        <strong>{p.name}</strong>
        <small>{p.reference}</small>
      </td>
      <td>
        {p.commodities
          .map(
            (c) => catalogue.commodities.find((x) => x.code === c)?.label || c,
          )
          .join(", ")}
      </td>
      <td>
        <code>{p.hs_code || "À renseigner"}</code>
      </td>
      <td>{p.supplier_ids.length}</td>
      <td>
        <span className="status neutral">À qualifier</span>
      </td>
    </>
  );
}
function LotCells({ l }: { l: Lot }) {
  return (
    <>
      <td>
        <strong>{l.reference}</strong>
      </td>
      <td>
        {l.supplier_name}
        <small>{l.product_name}</small>
      </td>
      <td className="numeric">
        {l.quantity.includes(".")
          ? l.quantity.replace(/0+$/, "").replace(/\.$/, "")
          : l.quantity}{" "}
        {l.unit}
      </td>
      <td>
        {countryName(l.origin_country)}
        <small>
          {l.production_start || "Dates à préciser"}
          {l.production_end ? " → " + l.production_end : ""}
        </small>
      </td>
      <td>
        <span
          className={
            "status " + (l.missing_fields?.length ? "warning" : "neutral")
          }
        >
          {l.missing_fields?.length ? "À compléter" : "Risque non évalué"}
        </span>
      </td>
    </>
  );
}
