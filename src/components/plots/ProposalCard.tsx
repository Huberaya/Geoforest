"use client";
import { useState } from "react";
import { type Api } from "../supply/types";
import { type Proposal, type Analysis, proposalLabels } from "./types";
import { AnalysisView } from "./AnalysisView";
import GeoMap from "./GeoMap";
export function ProposalCard({
  p,
  api,
  reviewable = false,
  portal = false,
  onEdit,
  onChanged,
}: {
  p: Proposal;
  api: Api;
  reviewable?: boolean;
  portal?: boolean;
  onEdit?: () => void;
  onChanged: () => void;
}) {
  const [note, setNote] = useState(""),
    [reference, setReference] = useState(p.payload.reference),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [analysis, setAnalysis] = useState<Analysis | null>(null),
    [history, setHistory] = useState<
      | {
          version: number;
          payload: Proposal["payload"];
          submitted_at: string;
        }[]
      | null
    >(null);
  async function review(decision: string) {
    setBusy(true);
    setError("");
    try {
      await api("/plot-proposals/" + p.id + "/review", "POST", {
        version: p.version,
        decision,
        note,
        adopted_reference: reference || null,
        confirmed,
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    setError("");
    try {
      await api("/plot-proposals/" + p.id + "/submit", "POST", {
        version: p.version,
        confirmed: true,
      });
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="collection-card">
      <div className="section-heading">
        <div>
          <strong>{p.payload.name}</strong>
          <p>
            {p.payload.reference} · {p.supplier_name || "Votre proposition"} · v
            {p.version}
          </p>
        </div>
        <span className="status neutral">{proposalLabels[p.status]}</span>
      </div>
      {error && (
        <div className="message error" role="alert">
          {error}
        </div>
      )}
      <details>
        <summary>Voir la géométrie et les contrôles</summary>
        <GeoMap
          shapes={[
            { id: p.id, name: p.payload.name, geometry: p.payload.geometry },
          ]}
          fitKey={p.id}
        />
        <AnalysisView analysis={analysis || p.analysis} />
        {!portal && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              void api("/plots/check", "POST", {
                geometry: p.payload.geometry,
                declared_area_ha: p.payload.declared_area_ha,
                commodity: p.payload.commodity,
              })
                .then((a) => setAnalysis(a as Analysis))
                .catch((e) => setError(e.message))
                .finally(() => setBusy(false));
            }}
          >
            Vérifier les relations avec le référentiel
          </button>
        )}
        <p className="caption">
          Pays déclaré : {p.payload.country}. Source :{" "}
          {p.payload.capture_method}. {p.payload.source_note}
        </p>
      </details>
      {p.review_note && (
        <p className="callout">
          <strong>Note de revue :</strong> {p.review_note}
        </p>
      )}
      {portal && ["DRAFT", "CHANGES_REQUESTED"].includes(p.status) && (
        <>
          <button className="button secondary" disabled={busy} onClick={onEdit}>
            Modifier la proposition
          </button>
          <label className="checkbox-label confirmation geo-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              J’ai relu la géométrie et ses avertissements. Je transmets cette
              proposition, sans déclaration réglementaire.
            </span>
          </label>
          <button
            className="button primary"
            disabled={busy || !confirmed}
            onClick={() => void submit()}
          >
            Transmettre la parcelle
          </button>
        </>
      )}
      {!portal && p.status === "SUBMITTED" && reviewable && (
        <div className="review-form">
          <label>
            Note de revue parcellaire *
            <textarea
              minLength={5}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <label>
            Référence à adopter
            <input
              maxLength={40}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </label>
          <label className="checkbox-label confirmation geo-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            <span>
              J’ai relu les données et contrôles. L’adoption crée une nouvelle
              parcelle, sans écraser une fiche existante ni conclure à sa
              conformité.
            </span>
          </label>
          <div className="row-actions">
            <button
              className="button secondary"
              disabled={busy || note.trim().length < 5}
              onClick={() => void review("CHANGES_REQUESTED")}
            >
              Demander une correction parcellaire
            </button>
            <button
              className="button primary"
              disabled={busy || note.trim().length < 5 || !confirmed}
              onClick={() => void review("ACCEPTED")}
            >
              Adopter la parcelle
            </button>
          </div>
        </div>
      )}
      {!portal && (
        <details
          onToggle={(e) => {
            if (e.currentTarget.open && !history)
              void api("/plot-proposals/" + p.id + "/revisions")
                .then((h) => setHistory(h as typeof history))
                .catch((e) => setError(e.message));
          }}
        >
          <summary>Historique des soumissions</summary>
          {history?.map((h) => (
            <details key={h.version}>
              <summary>
                Version {h.version} ·{" "}
                {new Date(h.submitted_at).toLocaleString("fr-FR")}
              </summary>
              <pre className="geo-json">
                {JSON.stringify(h.payload, null, 2)}
              </pre>
            </details>
          ))}
          {history?.length === 0 && <p>Aucune soumission.</p>}
        </details>
      )}
    </article>
  );
}
