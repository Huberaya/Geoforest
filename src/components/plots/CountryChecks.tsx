"use client";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../supply/types";
type Result = {
  status: string;
  declared_country: string;
  checked_at: string;
  method_version: string;
  postgis_version: string | null;
  review_distance_m: number;
  distance_to_reference_boundary_m: number | null;
  geometry_sha256: string;
  reason?: string;
  limitations: string[];
  source: null | {
    provider: string;
    boundary_id: string;
    represented_year: string;
    built_on: string;
    downloaded_on: string;
    sha256: string;
    upstream_commit: string;
    attribution: string;
    collection_license: string;
    primary_license: string;
    source_url: string;
    license_url: string;
    worldview?: string;
    scale?: string;
    map_units?: string[];
  };
};
type Check = {
  id: string;
  revision: number;
  created_at: string;
  result: Result;
};
const labels: Record<string, string> = {
  NOT_COVERED: "Pays non couvert",
  SOURCE_UNAVAILABLE: "Source indisponible",
  BOUNDARY_REVIEW_REQUIRED: "Limite géographique : revue nécessaire",
  INSIDE_REFERENCE_INDICATIVE: "Dans le référentiel — indicatif",
  OUTSIDE_REFERENCE_INDICATIVE: "Hors du référentiel — indicatif",
  PARTIAL_REFERENCE_INTERSECTION: "Intersection partielle — à revoir",
};
export function CountryChecks({
  api,
  plot,
  revision,
  writable,
}: {
  api: Api;
  plot: string;
  revision: number;
  writable: boolean;
}) {
  const [items, setItems] = useState<Check[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [generation, setGeneration] = useState(0),
    [margin, setMargin] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loaded, setLoaded] = useState(false);
  const [catalogue, setCatalogue] = useState<{
    coverage: string;
    covered_count: number;
    excluded: { country: string; reason: string }[];
  } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    api("/geospatial/sources", "GET", undefined, c.signal)
      .then((r) =>
        setCatalogue(
          r as {
            coverage: string;
            covered_count: number;
            excluded: { country: string; reason: string }[];
          },
        ),
      )
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [api]);
  const request = useRef<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    api(
      `/plots/${plot}/country-checks?revision=${revision}&page=${page}`,
      "GET",
      undefined,
      c.signal,
    )
      .then((r) => {
        const d = r as { items: Check[]; total: number };
        setItems(d.items);
        setTotal(d.total);
        setLoaded(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [api, plot, revision, page, generation]);
  async function run() {
    const distance = Number(margin);
    if (
      !margin.trim() ||
      !Number.isInteger(distance) ||
      distance < 0 ||
      distance > 50000
    ) {
      setError("Saisissez une marge entière de 0 à 50 000 mètres.");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    request.current ??= crypto.randomUUID();
    try {
      await api(`/plots/${plot}/country-checks`, "POST", {
        revision,
        review_distance_m: distance,
        request_id: request.current,
      });
      request.current = null;
      setPage(1);
      setGeneration((v) => v + 1);
      setNotice(
        "Comparaison enregistrée pour cette révision. Le pays déclaré reste inchangé.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="collection-card" aria-label="Cohérence pays indicative">
      <h3>Cohérence pays — comparaison indicative</h3>
      <p>
        Référentiel mondial indicatif Natural Earth, échelle 1:10 millions,
        conventions territoriales de facto. Aucun pays réel ni conformité EUDR
        n’est vérifié.
      </p>
      <p>
        {catalogue
          ? catalogue.coverage === "UNAVAILABLE"
            ? "Catalogue indisponible. Aucun résultat favorable ne peut en être déduit."
            : `${catalogue.covered_count} codes ISO (pays et territoires) admis. Non couverts : ${catalogue.excluded.map((e) => e.country).join(", ")}.`
          : "Chargement de la couverture…"}
      </p>
      <p className="caption">
        Exceptions : AQ (Antarctique), région polaire non prise en charge ; EG
        (Égypte), géométrie source invalide ; UM (îles mineures éloignées des
        États-Unis), rattachement ISO non établi. Les unités disputées sans code
        ISO non ambigu ne sont pas réaffectées automatiquement.
      </p>
      <p className="caption">
        Historique de la révision {revision}. Une nouvelle révision ne reprend
        pas automatiquement les anciens résultats.
      </p>
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="message success" role="status">
          {notice}
        </p>
      )}
      {writable && (
        <fieldset disabled={busy}>
          <label>
            Marge de revue près des limites (m)
            <input
              type="number"
              min="0"
              max="50000"
              step="1"
              value={margin}
              onChange={(e) => {
                setMargin(e.target.value);
                request.current = null;
              }}
            />
          </label>
          <p className="caption">
            Paramètre technique choisi explicitement, pas une précision de la
            source ni un seuil réglementaire. 0 examine uniquement les contacts
            et intersections exacts.
          </p>
          <button
            type="button"
            className="button secondary"
            disabled={busy || !margin.trim()}
            onClick={() => void run()}
          >
            {busy
              ? "Comparaison en cours…"
              : "Comparer le pays de cette révision"}
          </button>
        </fieldset>
      )}
      {!loaded && !error && <p>Chargement de l’historique…</p>}
      {loaded && total === 0 && (
        <p>Aucune comparaison enregistrée pour cette révision.</p>
      )}
      {items.map((c) => (
        <article
          key={c.id}
          className="collection-card"
          style={{ overflowWrap: "anywhere" }}
        >
          <strong>{labels[c.result.status] || "Résultat à examiner"}</strong>
          <p>
            {new Date(c.created_at).toLocaleString("fr-FR")} · pays déclaré{" "}
            {c.result.declared_country} · marge {c.result.review_distance_m} m
          </p>
          <p>Revue humaine nécessaire · pays non vérifié · risque non évalué</p>
          {c.result.distance_to_reference_boundary_m !== null && (
            <p>
              Distance calculée à la limite du référentiel :{" "}
              {Math.round(
                c.result.distance_to_reference_boundary_m,
              ).toLocaleString("fr-FR")}{" "}
              m. Ce n’est pas une précision de mesure.
            </p>
          )}
          {c.result.source ? (
            <>
              <p>
                <a
                  href={c.result.source.source_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.result.source.provider}
                </a>{" "}
                · {c.result.source.boundary_id} · année représentée{" "}
                {c.result.source.represented_year}
              </p>
              <p className="caption">
                {c.result.source.attribution} ·{" "}
                <a
                  href={c.result.source.license_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {c.result.source.collection_license}
                </a>{" "}
                · source primaire : {c.result.source.primary_license}
              </p>
            </>
          ) : (
            <p>
              Aucun référentiel utilisé lors de ce contrôle. Aucune conclusion
              géographique.
            </p>
          )}
          <details>
            <summary>Provenance et limites du contrôle</summary>
            <p>
              Méthode : {c.result.method_version} · PostGIS{" "}
              {c.result.postgis_version || "non utilisé pour la comparaison"}
            </p>
            <p>Empreinte géométrique : {c.result.geometry_sha256}</p>
            {c.result.source && (
              <>
                <p>Source SHA-256 : {c.result.source.sha256}</p>
                <p>
                  {c.result.source.scale} · {c.result.source.worldview}
                </p>
                {c.result.source.map_units && (
                  <p>
                    Unités cartographiques :{" "}
                    {c.result.source.map_units.join(", ")}
                  </p>
                )}
                <p>Commit amont : {c.result.source.upstream_commit}</p>
                <p>
                  Construction : {c.result.source.built_on} · téléchargement :{" "}
                  {c.result.source.downloaded_on}
                </p>
              </>
            )}
            {c.result.reason && <p>Diagnostic : {c.result.reason}</p>}
            <ul>
              {c.result.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </article>
      ))}
      <div className="row-actions">
        <span>
          {total} contrôle(s) · page {page}
        </span>
        <button
          type="button"
          className="text-button"
          disabled={page === 1 || busy}
          onClick={() => setPage((v) => v - 1)}
        >
          Contrôles précédents
        </button>
        <button
          type="button"
          className="text-button"
          disabled={page * 20 >= total || busy}
          onClick={() => setPage((v) => v + 1)}
        >
          Contrôles suivants
        </button>
      </div>
    </section>
  );
}
