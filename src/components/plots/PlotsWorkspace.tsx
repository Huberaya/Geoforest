"use client";
import { useEffect, useMemo, useState } from "react";
import { type Catalogue, countryName } from "../supply/types";
import { Dialog } from "../supply/controls";
import {
  type Plot,
  type Proposal,
  type PlotData,
  type Analysis,
  usePlotApi,
} from "./types";
import { PlotForm } from "./PlotForm";
import { PlotImport } from "./PlotImport";
import { ForestAnalyses } from "./ForestAnalyses";
import { CountryChecks } from "./CountryChecks";
import { AnalysisView } from "./AnalysisView";
import { ProposalCard } from "./ProposalCard";
import GeoMap from "./GeoMap";
export function PlotsWorkspace({
  org,
  csrf,
  role,
  writable,
}: {
  org: string;
  csrf: string;
  role: string;
  writable: boolean;
}) {
  const api = usePlotApi("/api/v1/organizations/" + org, csrf),
    [tab, setTab] = useState<"plots" | "proposals">("plots"),
    [q, setQ] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [archived, setArchived] = useState(false),
    [items, setItems] = useState<Plot[]>([]),
    [proposals, setProposals] = useState<Proposal[]>([]),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loading, setLoading] = useState(true),
    [catalogue, setCatalogue] = useState<Catalogue>({
      countries: [],
      commodities: [],
      units: [],
    }),
    [form, setForm] = useState<{ plot?: Plot } | null>(null),
    [importing, setImporting] = useState(false),
    [selected, setSelected] = useState<Plot | null>(null),
    [history, setHistory] = useState<{
      revision: number;
      payload: PlotData;
      analysis: Analysis;
      created_at: string;
      source_kind: string;
      source_id: string | null;
    } | null>(null),
    [bounds, setBounds] = useState<number[] | null>(null),
    [bbox, setBbox] = useState("");
  useEffect(() => {
    const c = new AbortController();
    fetch("/api/v1/catalogue", { signal: c.signal, cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error("Catalogue indisponible.");
        setCatalogue(await r.json());
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, []);
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      setError("");
      api(
        tab === "plots"
          ? "/plots?page=" +
              page +
              "&q=" +
              encodeURIComponent(q) +
              "&include_archived=" +
              archived +
              (bbox ? "&bbox=" + bbox : "")
          : "/plot-proposals?page=" + page,
        "GET",
        undefined,
        c.signal,
      )
        .then((r) => {
          const d = r as { items: Plot[] & Proposal[]; total: number };
          if (tab === "plots") setItems(d.items);
          else setProposals(d.items);
          setTotal(d.total);
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setLoading(false);
        });
    }, 200);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [api, tab, q, page, archived, bbox, revision]);
  const shapes = useMemo(
    () =>
      items.map((p) => ({
        id: p.id,
        name: p.payload.name + " · " + p.reference,
        geometry: p.payload.geometry,
      })),
    [items],
  );
  function changed() {
    setRevision((v) => v + 1);
  }
  function saved() {
    setForm(null);
    setImporting(false);
    setSelected(null);
    setNotice(
      "Parcelles enregistrées. Les contrôles techniques ne valent pas conformité EUDR.",
    );
    changed();
  }
  async function open(id: string) {
    setError("");
    try {
      setHistory(null);
      setSelected((await api("/plots/" + id)) as Plot);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function archive(p: Plot) {
    if (
      !window.confirm(
        "Archiver cette parcelle ? Les versions déjà rattachées aux lots resteront conservées.",
      )
    )
      return;
    try {
      await api("/plots/" + p.id + "/archive", "POST", { version: p.version });
      setSelected(null);
      setNotice(
        "Parcelle archivée ; historique et provenance des lots conservés.",
      );
      changed();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  return (
    <>
      <header className="page-heading">
        <div>
          <span className="eyebrow">GÉOLOCALISATION & PROVENANCE</span>
          <h1>Parcelles</h1>
          <p>Des contours documentés, des versions traçables.</p>
        </div>
        {writable && (
          <div className="row-actions">
            <button
              className="button secondary"
              disabled={!catalogue.countries.length}
              onClick={() => setImporting(true)}
            >
              Importer GeoJSON / KML
            </button>
            <button
              className="button primary"
              disabled={!catalogue.countries.length}
              onClick={() => setForm({})}
            >
              + Créer une parcelle
            </button>
          </div>
        )}
      </header>
      <div className="scope-strip">
        <span className="scope-icon">i</span>
        <p>
          <strong>Carte privée, sans fond externe.</strong> Aucune requête à un
          service de tuiles. Les géométries et pays sont déclarés ; propriété,
          risque et déforestation ne sont pas évalués.
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
          <button className="text-button" onClick={() => setNotice("")}>
            ×
          </button>
        </div>
      )}
      <div
        className="geo-tabs"
        role="tablist"
        aria-label="Parcelles et propositions"
      >
        <button
          role="tab"
          aria-selected={tab === "plots"}
          className={tab === "plots" ? "active" : ""}
          onClick={() => {
            setTab("plots");
            setPage(1);
          }}
        >
          Référentiel parcellaire
        </button>
        <button
          role="tab"
          aria-selected={tab === "proposals"}
          className={tab === "proposals" ? "active" : ""}
          onClick={() => {
            setTab("proposals");
            setPage(1);
          }}
        >
          Propositions fournisseurs
        </button>
      </div>
      {tab === "plots" ? (
        <>
          <section className="panel geo-panel">
            <div className="supply-toolbar">
              <label className="geo-search">
                Rechercher une parcelle
                <input
                  type="search"
                  placeholder="Nom ou référence…"
                  maxLength={200}
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={archived}
                  onChange={(e) => {
                    setArchived(e.target.checked);
                    setPage(1);
                  }}
                />
                Inclure les archives
              </label>
              <span className="caption">
                {total} résultat(s) · {items.length} affiché(s) sur la carte
              </span>
            </div>
            <GeoMap
              shapes={shapes}
              fitKey={items
                .map((p) => p.id + ":" + p.current_revision)
                .join(",")}
              onSelect={(id) => void open(id)}
              onBoundsChange={setBounds}
            />
            <div className="geo-filter-actions">
              <button
                className="button secondary small"
                disabled={!bounds}
                onClick={() => {
                  if (bounds) {
                    setBbox(bounds.join(","));
                    setPage(1);
                  }
                }}
              >
                Filtrer sur la zone visible
              </button>
              {bbox && (
                <button
                  className="text-button"
                  onClick={() => {
                    setBbox("");
                    setPage(1);
                  }}
                >
                  Retirer le filtre géographique
                </button>
              )}
              <span className="caption">
                Carte limitée à la page courante ; utilisez recherche, emprise
                et pagination.
              </span>
            </div>
          </section>
          <section className="panel supply-panel">
            <div className="table-scroll">
              <table className="supply-table">
                <thead>
                  <tr>
                    <th>Parcelle</th>
                    <th>Fournisseur</th>
                    <th>Pays déclaré</th>
                    <th>Géométrie / surface</th>
                    <th>État</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={6}>Chargement…</td>
                    </tr>
                  ) : items.length === 0 ? (
                    <tr>
                      <td colSpan={6}>
                        <div className="empty-supply">
                          <h3>Aucune parcelle à afficher</h3>
                          <p>
                            Créez une fiche ou importez un fichier géographique.
                            Aucun contour fictif n’est créé automatiquement.
                          </p>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    items.map((p) => (
                      <tr key={p.id}>
                        <td>
                          <button
                            className="name-button"
                            onClick={() => void open(p.id)}
                          >
                            {p.payload.name}
                          </button>
                          <small>
                            {p.reference} · révision {p.current_revision}
                          </small>
                        </td>
                        <td>{p.supplier_name}</td>
                        <td>{countryName(p.payload.country)}</td>
                        <td>
                          {p.payload.geometry.type}
                          <small>
                            {p.analysis.calculated_area_ha === null
                              ? "Surface non calculable"
                              : p.analysis.calculated_area_ha.toLocaleString(
                                  "fr-FR",
                                  { maximumFractionDigits: 4 },
                                ) + " ha calculés"}
                          </small>
                        </td>
                        <td>
                          <span className="status neutral">
                            {p.archived_at ? "Archivée" : "Risque non évalué"}
                          </span>
                          <small>
                            {p.analysis.warnings.length +
                              p.analysis.spatial_relations.length}{" "}
                            avertissement(s) à l’enregistrement
                          </small>
                        </td>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => void open(p.id)}
                          >
                            Ouvrir
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <>
          <p className="callout">
            L’adoption est réservée aux responsables de conformité et
            administrateurs. Elle crée une nouvelle parcelle, sans valider sa
            conformité et sans écraser les données existantes.
          </p>
          {loading ? (
            <p>Chargement…</p>
          ) : proposals.length === 0 ? (
            <div className="empty-compact">
              Aucune proposition fournisseur. Le fournisseur peut en créer dans
              son portail sécurisé.
            </div>
          ) : (
            proposals.map((p) => (
              <ProposalCard
                key={p.id + "-" + p.version}
                p={p}
                api={api}
                reviewable={
                  writable && ["Admin", "Compliance Manager"].includes(role)
                }
                onChanged={changed}
              />
            ))
          )}
        </>
      )}
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
      {form && (
        <PlotForm
          api={api}
          catalogue={catalogue}
          record={form.plot}
          onClose={() => setForm(null)}
          onSaved={saved}
        />
      )}
      {importing && (
        <PlotImport
          api={api}
          catalogue={catalogue}
          onClose={() => setImporting(false)}
          onSaved={saved}
        />
      )}
      {selected && (
        <Dialog
          title={selected.payload.name}
          onClose={() => setSelected(null)}
          wide
        >
          <div className="record-form">
            <div className="section-heading">
              <strong>
                {selected.reference} · {selected.supplier_name}
              </strong>
              <span className="status neutral">
                {selected.archived_at ? "Archivée" : "Risque non évalué"}
              </span>
            </div>
            <label>
              Révision consultée
              <select
                value={history?.revision || selected.current_revision}
                onChange={(e) => {
                  const rev = Number(e.target.value);
                  if (rev === selected.current_revision) {
                    setHistory(null);
                    return;
                  }
                  void api("/plots/" + selected.id + "/revisions/" + rev)
                    .then((r) => setHistory(r as typeof history))
                    .catch((e) => setError(e.message));
                }}
              >
                {selected.revisions?.map((r) => (
                  <option key={r.revision} value={r.revision}>
                    Révision {r.revision} ·{" "}
                    {new Date(r.created_at).toLocaleString("fr-FR")} ·{" "}
                    {r.source_kind}
                  </option>
                ))}
              </select>
            </label>
            <GeoMap
              shapes={[
                {
                  id: selected.id,
                  name: selected.payload.name,
                  geometry: (history?.payload || selected.payload).geometry,
                },
              ]}
              fitKey={
                selected.id +
                "-" +
                (history?.revision || selected.current_revision)
              }
            />
            <AnalysisView analysis={history?.analysis || selected.analysis} />
            <CountryChecks
              key={
                selected.id +
                ":" +
                (history?.revision || selected.current_revision)
              }
              api={api}
              plot={selected.id}
              revision={history?.revision || selected.current_revision}
              writable={writable}
            />
            <ForestAnalyses
              key={
                "forest:" +
                selected.id +
                ":" +
                (history?.revision || selected.current_revision)
              }
              api={api}
              plot={selected.id}
              revision={history?.revision || selected.current_revision}
              writable={writable}
            />
            <p className="caption">
              Contrôles enregistrés à cette révision, pas une surveillance
              continue. Source : {(history || selected).source_kind}. Précision
              GPS annoncée :{" "}
              {(history?.payload || selected.payload).gps_accuracy_m ??
                "non renseignée"}{" "}
              m.
            </p>
            {(history || selected).source_kind === "IMPORT" &&
              (history || selected).source_id &&
              writable && (
                <a
                  className="text-button"
                  href={
                    "/api/v1/organizations/" +
                    org +
                    "/plot-imports/" +
                    (history || selected).source_id +
                    "/source"
                  }
                >
                  Télécharger le fichier source privé
                </a>
              )}
            <details>
              <summary>Coordonnées et provenance enregistrées</summary>
              <pre className="geo-json">
                {JSON.stringify(history?.payload || selected.payload, null, 2)}
              </pre>
            </details>
            {writable && !selected.archived_at && (
              <div className="row-actions">
                <button
                  className="button primary"
                  onClick={() => {
                    setForm({ plot: selected });
                    setSelected(null);
                  }}
                >
                  Modifier la parcelle
                </button>
                <button
                  className="button secondary"
                  onClick={() => void archive(selected)}
                >
                  Archiver la parcelle
                </button>
              </div>
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}
