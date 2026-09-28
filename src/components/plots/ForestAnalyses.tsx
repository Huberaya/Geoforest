"use client";
import { useEffect, useRef, useState } from "react";
import type { Api } from "../supply/types";

type Observation = {
  id: string;
  revision: number;
  created_at: string;
  result: {
    status: string;
    signal_status: string;
    spatial_coverage: string;
    method_version: string;
    geometry_sha256: string;
    planned_windows?: number;
    completed_windows?: number;
    post_2020_signal_pixels?: number;
    boundary_signal_pixels?: number;
    errors: string[];
    limitations: string[];
  };
};
const status: Record<string, string> = {
  OBSERVED: "Observation calculée — revue nécessaire",
  PARTIAL: "Observation partielle — revue nécessaire",
  SOURCE_UNAVAILABLE: "Source indisponible",
  NOT_COVERED: "Hors couverture de la source",
  BUDGET_EXCEEDED: "Limite technique dépassée — aucune conclusion",
};
const signals: Record<string, string> = {
  SIGNAL_OBSERVED: "Signal de perte de couvert après 2020",
  NO_SIGNAL_IN_SELECTED_LAND_PIXELS:
    "Aucun signal dans les pixels terrestres sélectionnés",
  NOT_ASSESSABLE: "Données insuffisantes pour une conclusion négative",
};
export function ForestAnalyses({
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
  const [items, setItems] = useState<Observation[]>([]);
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const requestId = useRef<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const c = new AbortController();
    Promise.all([
      api("/forest/sources", "GET", undefined, c.signal),
      api(
        `/plots/${plot}/forest-analyses?revision=${revision}&page=${page}`,
        "GET",
        undefined,
        c.signal,
      ),
    ])
      .then(([source, history]) => {
        setEnabled((source as { enabled: boolean }).enabled);
        const h = history as { items: Observation[]; total: number };
        setItems(h.items);
        setTotal(h.total);
        setLoaded(true);
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [api, plot, revision, page, refresh]);
  async function run() {
    if (!consent || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    requestId.current ??= crypto.randomUUID();
    try {
      await api(`/plots/${plot}/forest-analyses`, "POST", {
        revision,
        request_id: requestId.current,
        allow_public_tile_requests: true,
      });
      if (!alive.current) return;
      requestId.current = null;
      setPage(1);
      setRefresh((x) => x + 1);
      setNotice("Observation enregistrée. Une revue humaine reste nécessaire.");
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function download(item: Observation) {
    setError("");
    try {
      const data = await api(
        `/plots/${plot}/forest-analyses/${item.id}`,
        "GET",
      );
      if (!alive.current) return;
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `observation-forestiere-${item.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    }
  }
  return (
    <section
      className="panel"
      aria-label="Observations forestières"
      aria-busy={busy}
      style={{ overflowWrap: "anywhere" }}
    >
      <h3>
        Observations forestières{" "}
        <span className="badge">Automatique · indicatif</span>
      </h3>
      <p>
        Hansen GFC v1.13 · données jusqu’en 2025 · pixels de l’ordre de 30 m. Ni
        conversion agricole démontrée, ni état forestier 2020, ni conformité
        EUDR. La période 2026 n’est pas couverte. Un point n’observe pas toute
        une parcelle.
      </p>
      <p className="muted">
        Le second connecteur JRC TMF n’est pas encore qualifié ni activé.
      </p>
      {loaded && !enabled && (
        <p>
          Le service d’analyse forestière n’est pas activé sur ce serveur.
          L’historique reste consultable.
        </p>
      )}
      {writable && enabled && (
        <>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              disabled={busy}
              style={{ width: "auto", marginTop: 4 }}
            />
            <span>
              J’autorise la lecture des tuiles publiques. Aucun polygone ou nom
              de fournisseur n’est transmis ; les tuiles et blocs demandés
              peuvent révéler une zone approximative au fournisseur de données.
            </span>
          </label>
          <button
            type="button"
            disabled={!consent || busy || !loaded}
            onClick={run}
          >
            {busy ? "Analyse en cours…" : "Analyser les signaux forestiers"}
          </button>
          {busy && (
            <p role="status">
              Traitement limité en ressources ; cela peut prendre jusqu’à
              environ 100 secondes. En cas de problème réseau, réessayez :
              l’identifiant de requête est conservé.
            </p>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <h4>Historique — révision {revision}</h4>
      {!loaded ? (
        <p>Chargement…</p>
      ) : !total ? (
        <p>Aucune observation enregistrée pour cette révision.</p>
      ) : (
        <p>
          {total} observation(s), sans recalcul automatique des anciennes
          révisions.
        </p>
      )}
      {items.map((item) => (
        <article key={item.id} className="panel">
          <strong>{status[item.result.status] ?? item.result.status}</strong>
          <p>
            {signals[item.result.signal_status] ?? item.result.signal_status}
          </p>
          <p>
            {new Date(item.created_at).toLocaleString("fr-FR")} · Révision{" "}
            {item.revision}
          </p>
          {item.result.spatial_coverage === "POINT_SAMPLE_ONLY" && (
            <p>
              Échantillon ponctuel uniquement, sans surface parcellaire déduite.
            </p>
          )}
          {item.result.post_2020_signal_pixels !== undefined && (
            <p>
              {item.result.post_2020_signal_pixels} pixel(s) avec signal ;{" "}
              {item.result.boundary_signal_pixels ?? 0} sur des pixels de bord
              ou ponctuels. Le signal peut se situer dans la partie du pixel
              extérieure à la parcelle.
            </p>
          )}
          <p>
            Source: Hansen/UMD/Google/USGS/NASA ·{" "}
            <a
              href="https://glad.earthengine.app/view/global-forest-change"
              target="_blank"
              rel="noopener noreferrer"
            >
              GFC
            </a>{" "}
            ·{" "}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noopener noreferrer"
            >
              CC BY 4.0
            </a>
            . Extraits et intersections sans rééchantillonnage.
          </p>
          <details>
            <summary>Méthode et limites</summary>
            <p>
              {item.result.method_version} · Empreinte géométrique :{" "}
              {item.result.geometry_sha256}
            </p>
            <p>
              {item.result.completed_windows ?? 0}/
              {item.result.planned_windows ?? 0} fenêtre(s) traitée(s).
            </p>
            <ul>
              {item.result.limitations.map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            {item.result.errors.length > 0 && (
              <p>Motifs techniques : {item.result.errors.join(", ")}</p>
            )}
          </details>
          <button type="button" onClick={() => download(item)}>
            Télécharger les preuves JSON
          </button>
        </article>
      ))}
      {total > 20 && (
        <div className="row-actions">
          <button
            type="button"
            disabled={page === 1 || busy}
            onClick={() => setPage((x) => x - 1)}
          >
            Précédent
          </button>
          <span>
            Page {page} / {Math.ceil(total / 20)}
          </span>
          <button
            type="button"
            disabled={page * 20 >= total || busy}
            onClick={() => setPage((x) => x + 1)}
          >
            Suivant
          </button>
        </div>
      )}
    </section>
  );
}
