"use client";
import { useCallback, useEffect, useRef, useState } from "react";

type Option = {
  id: string;
  name?: string;
  reference?: string;
  current_revision?: number;
};
type Version = {
  id: string;
  document_id: string;
  supplier_id: string;
  version: number;
  state: string;
  received_size: number;
  expected_size: number;
  sha256: string | null;
  mime: string | null;
  created_at: string;
  plot_id: string | null;
  plot_revision: number | null;
  lot_id: string | null;
  metadata: {
    title: string;
    kind: string;
    issuer: string;
    original_name: string;
    valid_from: string | null;
    valid_until: string | null;
    expected_sha256: string;
  };
  review?: { decision: string; note: string } | null;
};
const states: Record<string, string> = {
  UPLOADING: "Dépôt à terminer",
  SCANNING: "Contrôle en cours",
  SCAN_PASSED: "Contrôles techniques réussis — revue nécessaire",
  SCAN_REJECTED: "Quarantaine — détection ou limite de contrôle",
  SCAN_UNAVAILABLE: "Quarantaine — contrôle indisponible",
  FORMAT_REJECTED: "Quarantaine — format ou intégrité refusé",
};
export async function jsonRequest(
  path: string,
  csrf: string,
  method = "GET",
  body?: unknown,
) {
  const r = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error(
      typeof d.detail === "string"
        ? d.detail
        : "Opération refusée. Vérifiez les champs et votre accès.",
    );
  }
  return r.json();
}
export function DocumentsWorkspace({
  org,
  csrf,
  writable,
  reviewer = false,
  portal = false,
}: {
  org?: string;
  csrf: string;
  writable: boolean;
  reviewer?: boolean;
  portal?: boolean;
}) {
  const base = portal ? "/api/portal" : `/api/v1/organizations/${org}`;
  const [supplier, setSupplier] = useState("");
  const [suppliers, setSuppliers] = useState<Option[]>([]);
  const [search, setSearch] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [enabled, setEnabled] = useState(false);
  const [lots, setLots] = useState<Option[]>([]);
  const [plots, setPlots] = useState<Option[]>([]);
  const [lot, setLot] = useState("");
  const [plot, setPlot] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [issuer, setIssuer] = useState("");
  const [kind, setKind] = useState("OTHER");
  const [from, setFrom] = useState("");
  const [until, setUntil] = useState("");
  const [target, setTarget] = useState<Version | null>(null);
  const [reviewTarget, setReviewTarget] = useState("");
  const [decision, setDecision] = useState("ACCEPTED");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState(0);
  const pending = useRef<{ id: string; hash: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const load = useCallback(async () => {
    const d = await jsonRequest(
      `${base}/documents?page=${page}${supplier ? `&supplier_id=${supplier}` : ""}`,
      csrf,
    );
    if (alive.current) {
      setVersions(d.items);
      setTotal(d.total);
      setEnabled(d.enabled);
    }
  }, [base, csrf, page, supplier]);
  useEffect(() => {
    let active = true;
    load().catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [load]);
  useEffect(() => {
    if (portal) return;
    const controller = new AbortController();
    fetch(`${base}/suppliers?limit=100&q=${encodeURIComponent(search)}`, {
      signal: controller.signal,
    })
      .then((r) =>
        r.ok
          ? r.json()
          : Promise.reject(new Error("Fournisseurs indisponibles")),
      )
      .then((d) => setSuppliers(d.items))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => controller.abort();
  }, [base, portal, search]);
  useEffect(() => {
    if (portal || !supplier) return;
    let active = true;
    Promise.all([
      jsonRequest(`${base}/lots?limit=100&supplier_id=${supplier}`, csrf),
      jsonRequest(`${base}/plots?limit=50&supplier_id=${supplier}`, csrf),
    ])
      .then(([l, p]) => {
        if (active) {
          setLots(
            l.items.filter(
              (x: { supplier_id: string }) => x.supplier_id === supplier,
            ),
          );
          setPlots(p.items);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, csrf, supplier, portal]);
  async function upload() {
    if (!file || (!portal && !supplier) || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (file.size < 1 || file.size > 20 * 1024 * 1024)
        throw new Error("Fichier attendu : 1 octet à 20 Mio.");
      const ext = file.name.split(".").pop()?.toLowerCase();
      const mime =
        ext === "pdf"
          ? "application/pdf"
          : ext === "png"
            ? "image/png"
            : ["jpg", "jpeg"].includes(ext || "")
              ? "image/jpeg"
              : "";
      if (!mime)
        throw new Error("Seuls PDF simples, JPEG et PNG sont acceptés.");
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (pending.current && pending.current.hash !== hash)
        throw new Error(
          "Pour reprendre, choisissez exactement le même fichier ou commencez un nouveau dépôt.",
        );
      const metadata = {
        request_id: pending.current?.id || crypto.randomUUID(),
        expected_sha256: hash,
        supplier_id: portal ? null : supplier,
        document_id: target?.document_id || null,
        plot_id: target ? target.plot_id : plot || null,
        plot_revision: target
          ? target.plot_revision
          : plot
            ? plots.find((p) => p.id === plot)?.current_revision
            : null,
        lot_id: target ? target.lot_id : lot || null,
        title,
        issuer,
        kind,
        valid_from: from || null,
        valid_until: until || null,
        original_name: file.name,
        claimed_mime: mime,
        size: file.size,
      };
      pending.current = { id: metadata.request_id, hash };
      const v = await jsonRequest(
        `${base}/documents/uploads`,
        csrf,
        "POST",
        metadata,
      );
      for (let offset = v.received_size; offset < file.size; offset += 64000) {
        const sendChunk = () =>
          fetch(`${base}/documents/uploads/${v.id}/chunks?offset=${offset}`, {
            method: "PUT",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-CSRF-Token": csrf,
            },
            body: file.slice(offset, offset + 64000),
          });
        let r = await sendChunk();
        for (let retry = 0; r.status === 429 && retry < 2; retry++) {
          if (alive.current)
            setNotice(
              "Limite de requêtes atteinte : reprise automatique du transfert dans une minute.",
            );
          await new Promise((resolve) => setTimeout(resolve, 61000));
          if (!alive.current) return;
          r = await sendChunk();
        }
        if (!r.ok) {
          const d = await r.json();
          throw new Error(d.detail || "Dépôt interrompu");
        }
        if (alive.current)
          setProgress(
            Math.round((Math.min(offset + 64000, file.size) * 100) / file.size),
          );
      }
      const result = await jsonRequest(
        `${base}/documents/uploads/${v.id}/finish`,
        csrf,
        "POST",
      );
      if (alive.current) {
        setNotice(states[result.state] || result.state);
        pending.current = null;
        setTarget(null);
        await load();
      }
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  async function retry(v: Version) {
    setBusy(true);
    setError("");
    try {
      await jsonRequest(
        `${base}/documents/uploads/${v.id}/finish`,
        csrf,
        "POST",
      );
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(v: Version) {
    setError("");
    try {
      const r = await fetch(`${base}/documents/versions/${v.id}/download`);
      if (!r.ok) {
        const d = await r.json();
        throw new Error(d.detail);
      }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `document-${v.id}.${{ "image/png": "png", "image/jpeg": "jpg", "application/pdf": "pdf" }[v.mime || ""] || "bin"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function saveReview() {
    setBusy(true);
    setError("");
    try {
      await jsonRequest(
        `${base}/documents/versions/${reviewTarget}/reviews`,
        csrf,
        "POST",
        { decision, note },
      );
      setReviewTarget("");
      setNote("");
      await load();
      setNotice(
        "Revue documentée. Cela ne certifie pas l’authenticité ou la légalité.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    pending.current = null;
    setTarget(null);
    setFile(null);
    setTitle("");
    setProgress(0);
    setNotice("");
    setLot("");
    setPlot("");
  }
  return (
    <section
      aria-label="Coffre documentaire"
      className="panel documentary-workspace"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h2>
        Coffre documentaire <span className="badge">Privé · versionné</span>
      </h2>
      <p>
        Déposez vos justificatifs, conservez les versions et documentez leur
        revue. Un contrôle technique réussi n’est ni une preuve d’authenticité
        ni une certification EUDR.
      </p>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="message">
          {notice}
        </p>
      )}
      {!portal && (
        <div className="form-grid">
          <label>
            Rechercher un fournisseur
            <input
              maxLength={200}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Fournisseur du document
            <select
              value={supplier}
              disabled={busy}
              onChange={(e) => {
                setSupplier(e.target.value);
                setPage(1);
                reset();
              }}
            >
              <option value="">
                Tous les fournisseurs — choisir pour déposer
              </option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.reference} · {s.name}
                </option>
              ))}
            </select>
          </label>
          <small>
            100 résultats au maximum : affinez la recherche si nécessaire.
          </small>
        </div>
      )}
      {!enabled && (
        <p>Le dépôt est désactivé. L’historique reste consultable.</p>
      )}
      {writable && enabled && (
        <fieldset disabled={busy} style={{ minWidth: 0 }}>
          <legend>
            {target
              ? `Nouvelle version de « ${target.metadata.title} »`
              : "Déposer un justificatif"}
          </legend>
          <div className="form-grid">
            <label>
              Titre du justificatif
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={160}
                required
              />
            </label>
            <label>
              Catégorie
              <select value={kind} onChange={(e) => setKind(e.target.value)}>
                {[
                  ["OTHER", "Autre preuve"],
                  ["LAND_RIGHTS", "Droits fonciers"],
                  ["ENVIRONMENT", "Environnement"],
                  ["FORESTRY", "Règles forestières"],
                  ["RIGHTS", "Droits des personnes"],
                  ["TAX_TRADE", "Fiscalité / commerce"],
                  ["CERTIFICATE", "Certificat complémentaire"],
                ].map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Émetteur
              <input
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                maxLength={200}
              />
            </label>
            <label>
              Valide à partir du
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Valide jusqu’au
              <input
                type="date"
                value={until}
                onChange={(e) => setUntil(e.target.value)}
              />
            </label>
            {!portal && !target && (
              <>
                <label>
                  Lot concerné — facultatif
                  <select value={lot} onChange={(e) => setLot(e.target.value)}>
                    <option value="">Preuve fournisseur générale</option>
                    {lots.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.reference}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Parcelle concernée — facultatif
                  <select
                    value={plot}
                    onChange={(e) => setPlot(e.target.value)}
                  >
                    <option value="">Sans rattachement parcellaire</option>
                    {plots.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.reference} · révision {p.current_revision}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <label>
              Fichier PDF, JPEG ou PNG
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                onChange={(e) => {
                  setFile(e.target.files?.[0] || null);
                  if (!title) setTitle(e.target.files?.[0]?.name || "");
                }}
              />
            </label>
          </div>
          <p className="muted">
            20 Mio maximum. PDF chiffrés, actifs, formulaires ou pièces jointes
            refusés. Images fixes, 20 millions de pixels maximum. Aucun envoi à
            un scanner cloud. OCR non activé.
          </p>
          <div className="row-actions">
            <button
              className="button secondary"
              type="button"
              onClick={upload}
              disabled={
                !file || title.trim().length < 3 || (!portal && !supplier)
              }
            >
              Déposer et contrôler
            </button>
            <button className="button secondary" type="button" onClick={reset}>
              Nouveau dépôt
            </button>
          </div>
        </fieldset>
      )}
      {busy && (
        <p role="status">
          Traitement en cours · transfert {progress} % · le contrôle peut
          prendre environ 80 secondes. En cas d’interruption, reprenez avec le
          même fichier et les mêmes informations.
        </p>
      )}
      <h3>Versions conservées ({total})</h3>
      {!total && <p>Aucun justificatif enregistré.</p>}
      {versions.map((v) => (
        <article className="panel" key={v.id}>
          <h4>
            {v.metadata.title} · v{v.version}
          </h4>
          <p>{states[v.state] || v.state}</p>
          <p className="muted">
            {v.metadata.issuer || "Émetteur non renseigné"} ·{" "}
            {Math.ceil(v.expected_size / 1024)} Kio ·{" "}
            {new Date(v.created_at).toLocaleString("fr-FR")}
          </p>
          {v.metadata.valid_until && (
            <p>
              Validité déclarée : jusqu’au {v.metadata.valid_until}
              {v.metadata.valid_until < new Date().toISOString().slice(0, 10)
                ? " — expirée aujourd’hui, valeur historique à examiner"
                : ""}
            </p>
          )}
          {v.review && (
            <p>
              Revue : {v.review.decision} — {v.review.note}
            </p>
          )}
          <details>
            <summary>Traçabilité</summary>
            <p>Version : {v.id}</p>
            <p>Document : {v.document_id}</p>
            <p>SHA-256 : {v.sha256 || "En attente"}</p>
            <p>
              Lot : {v.lot_id || "général"} · Parcelle :{" "}
              {v.plot_id || "non liée"}{" "}
              {v.plot_revision ? ` / révision ${v.plot_revision}` : ""}
            </p>
          </details>
          <div className="row-actions">
            {v.state === "SCAN_PASSED" && (
              <button
                className="button secondary"
                type="button"
                onClick={() => download(v)}
              >
                Télécharger le justificatif
              </button>
            )}
            {writable && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => {
                  pending.current = null;
                  setTarget(v);
                  setSupplier(v.supplier_id);
                  setTitle(v.metadata.title);
                  setKind(v.metadata.kind);
                  setIssuer(v.metadata.issuer);
                  setFrom(v.metadata.valid_from || "");
                  setUntil(v.metadata.valid_until || "");
                  setFile(null);
                }}
              >
                Ajouter une version
              </button>
            )}
            {writable && ["SCANNING", "SCAN_UNAVAILABLE"].includes(v.state) && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => retry(v)}
              >
                Réessayer le contrôle
              </button>
            )}
            {reviewer && v.state === "SCAN_PASSED" && (
              <button
                className="button secondary"
                type="button"
                onClick={() => {
                  setReviewTarget(v.id);
                  setNote("");
                }}
              >
                Revoir cette version
              </button>
            )}
          </div>
          {reviewTarget === v.id && (
            <fieldset disabled={busy}>
              <legend>Revue humaine de la pièce</legend>
              <label>
                Décision documentaire
                <select
                  value={decision}
                  onChange={(e) => setDecision(e.target.value)}
                >
                  <option value="ACCEPTED">
                    Acceptée comme preuve — pas certification
                  </option>
                  <option value="NEEDS_INFORMATION">
                    Informations complémentaires
                  </option>
                  <option value="REJECTED">Refusée</option>
                </select>
              </label>
              <label>
                Justification de la revue (visible au fournisseur)
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={4000}
                />
              </label>
              <button
                className="button secondary"
                type="button"
                disabled={note.trim().length < 10}
                onClick={saveReview}
              >
                Enregistrer la revue
              </button>
            </fieldset>
          )}
        </article>
      ))}
      {total > 20 && (
        <div className="row-actions">
          <button
            className="button secondary"
            disabled={page === 1 || busy}
            onClick={() => setPage(page - 1)}
          >
            Précédent
          </button>
          <span>
            Page {page} / {Math.ceil(total / 20)}
          </span>
          <button
            className="button secondary"
            disabled={page * 20 >= total || busy}
            onClick={() => setPage(page + 1)}
          >
            Suivant
          </button>
        </div>
      )}
    </section>
  );
}
