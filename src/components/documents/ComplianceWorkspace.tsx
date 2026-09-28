"use client";
import { useCallback, useEffect, useState } from "react";
import { jsonRequest } from "./DocumentsWorkspace";
type Criterion = {
  code: string;
  state: string;
  explanation: string;
  source_reference: string;
};
type Proof = {
  id: string;
  metadata: { title: string };
  state: string;
  review: { decision: string } | null;
};
type Action = {
  id: string;
  title: string;
  description: string;
  assigned_to: string | null;
  due_date: string;
  state: string;
  version: number;
  resolution_note: string;
  proof_version_id: string | null;
};
type Context = {
  lot: {
    id: string;
    reference: string;
    origin_country: string | null;
    production_start: string | null;
    production_end: string | null;
  };
  documents: Proof[];
  plots: {
    plot_id: string;
    revision: number;
    forest: { id: string; result: { signal_status: string; status: string } }[];
  }[];
  tasks: Action[];
  legality: { id: string; payload: { framework_qualified: boolean } } | null;
  legality_stale: boolean;
};
type RiskRecord = {
  id: string;
  created_at: string;
  stale: boolean;
  result: {
    status: string;
    review: { proposed_residual: string; note: string };
    factors: {
      code: string;
      message: string;
      reference: string | null;
      blocking: boolean;
      resolved_by_human_review: boolean;
    }[];
  };
};
type Dossier = {
  context: Context;
  input_sha256: string;
  legality_input_sha256: string;
  risk_history: RiskRecord[];
  legality_history: {
    id: string;
    created_at: string;
    payload: { note: string; framework_qualified: boolean };
  }[];
};
function Criteria({
  labels,
  values,
  setValues,
  disabled,
}: {
  labels: Record<string, string>;
  values: Criterion[];
  setValues: (v: Criterion[]) => void;
  disabled: boolean;
}) {
  return (
    <div>
      {values.map((c, i) => (
        <details key={c.code} className="panel documentary-workspace">
          <summary>
            {labels[c.code]} —{" "}
            {c.state === "UNKNOWN"
              ? "À examiner"
              : c.state === "CLEAR"
                ? "Examiné sans préoccupation retenue"
                : c.state === "CONCERN"
                  ? "Préoccupation identifiée"
                  : "Non applicable, motivé"}
          </summary>
          <fieldset disabled={disabled} style={{ minWidth: 0 }}>
            <label>
              État — {labels[c.code]}
              <select
                value={c.state}
                onChange={(e) =>
                  setValues(
                    values.map((x, j) =>
                      j === i ? { ...x, state: e.target.value } : x,
                    ),
                  )
                }
              >
                <option value="UNKNOWN">À examiner</option>
                <option value="CLEAR">
                  Examiné, sans préoccupation retenue
                </option>
                <option value="CONCERN">Préoccupation identifiée</option>
                <option value="NOT_APPLICABLE">
                  Non applicable — justification requise
                </option>
              </select>
            </label>
            <label>
              Justification — {labels[c.code]}
              <textarea
                maxLength={1500}
                value={c.explanation}
                onChange={(e) =>
                  setValues(
                    values.map((x, j) =>
                      j === i ? { ...x, explanation: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            <label>
              Source, article, date de consultation — {labels[c.code]}
              <textarea
                maxLength={1000}
                value={c.source_reference}
                onChange={(e) =>
                  setValues(
                    values.map((x, j) =>
                      j === i ? { ...x, source_reference: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
          </fieldset>
        </details>
      ))}
    </div>
  );
}
export function ComplianceWorkspace({
  org,
  csrf,
  reviewer,
}: {
  org: string;
  csrf: string;
  reviewer: boolean;
}) {
  const base = `/api/v1/organizations/${org}`;
  const [catalogue, setCatalogue] = useState<{
    legality: Record<string, string>;
    risk: Record<string, string>;
  } | null>(null);
  const [lots, setLots] = useState<{ id: string; reference: string }[]>([]);
  const [search, setSearch] = useState("");
  const [lot, setLot] = useState("");
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [legal, setLegal] = useState<Criterion[]>([]);
  const [risk, setRisk] = useState<Criterion[]>([]);
  const [proofs, setProofs] = useState<string[]>([]);
  const [qualified, setQualified] = useState(false);
  const [legalNote, setLegalNote] = useState("");
  const [riskNote, setRiskNote] = useState("");
  const [residual, setResidual] = useState("UNDETERMINED");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [assignees, setAssignees] = useState<
    { user_id: string; role: string; display_name: string }[]
  >([]);
  const [task, setTask] = useState<Action | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigned, setAssigned] = useState("");
  const [due, setDue] = useState("");
  const [taskState, setTaskState] = useState("OPEN");
  const [resolution, setResolution] = useState("");
  const [taskProof, setTaskProof] = useState("");
  const load = useCallback(async () => {
    if (lot)
      setDossier(await jsonRequest(`${base}/compliance/lots/${lot}`, csrf));
  }, [base, csrf, lot]);
  useEffect(() => {
    let active = true;
    Promise.all([
      jsonRequest(`${base}/compliance/catalogue`, csrf),
      reviewer
        ? jsonRequest(`${base}/compliance/assignees`, csrf)
        : Promise.resolve([]),
    ])
      .then(([c, a]) => {
        if (active) {
          setCatalogue(c);
          setAssignees(a);
          setLegal(
            Object.keys(c.legality).map((code) => ({
              code,
              state: "UNKNOWN",
              explanation: "",
              source_reference: "",
            })),
          );
          setRisk(
            Object.keys(c.risk).map((code) => ({
              code,
              state: "UNKNOWN",
              explanation: "",
              source_reference: "",
            })),
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, csrf, reviewer]);
  useEffect(() => {
    let active = true;
    jsonRequest(`${base}/lots?limit=100&q=${encodeURIComponent(search)}`, csrf)
      .then((d) => {
        if (active) setLots(d.items);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, csrf, search]);
  useEffect(() => {
    let active = true;
    if (!lot) return;
    jsonRequest(`${base}/compliance/lots/${lot}`, csrf)
      .then((d) => {
        if (active) setDossier(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [base, csrf, lot]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      setNotice(
        "Enregistrement effectué avec vos références et votre identité. Aucun verdict EUDR automatique.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function chooseLot(id: string) {
    setLot(id);
    setDossier(null);
    setProofs([]);
    setQualified(false);
    setTask(null);
    setLegalNote("");
    setRiskNote("");
    setResidual("UNDETERMINED");
    setNotice("");
    setError("");
    if (catalogue) {
      setLegal(
        Object.keys(catalogue.legality).map((code) => ({
          code,
          state: "UNKNOWN",
          explanation: "",
          source_reference: "",
        })),
      );
      setRisk(
        Object.keys(catalogue.risk).map((code) => ({
          code,
          state: "UNKNOWN",
          explanation: "",
          source_reference: "",
        })),
      );
    }
  }
  function edit(t: Action | null) {
    setTask(t);
    setTaskTitle(t?.title || "");
    setDescription(t?.description || "");
    setAssigned(t?.assigned_to || "");
    setDue(t?.due_date || "");
    setTaskState(t?.state || "OPEN");
    setResolution(t?.resolution_note || "");
    setTaskProof(t?.proof_version_id || "");
  }
  const accepted =
    dossier?.context.documents.filter(
      (d) => d.state === "SCAN_PASSED" && d.review?.decision === "ACCEPTED",
    ) || [];
  return (
    <section
      className="panel"
      aria-label="Légalité et risque"
      style={{ minWidth: 0, overflowWrap: "anywhere" }}
    >
      <h2>
        Légalité, risque et actions{" "}
        <span className="badge">Assisté · décision humaine</span>
      </h2>
      <p>
        Examinez le périmètre d’un lot, justifiez les critères applicables et
        conservez les preuves de vos décisions. Le catalogue national n’est pas
        préqualifié : ne déclarez des exigences vérifiées qu’après examen des
        textes pertinents.
      </p>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <label>
        Rechercher un lot
        <input
          value={search}
          maxLength={200}
          disabled={busy}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label>
        Lot à examiner
        <select
          value={lot}
          disabled={busy}
          onChange={(e) => chooseLot(e.target.value)}
        >
          <option value="">Choisir un lot</option>
          {lots.map((l) => (
            <option value={l.id} key={l.id}>
              {l.reference}
            </option>
          ))}
        </select>
      </label>
      <small>100 premiers résultats. Affinez la recherche si nécessaire.</small>
      {dossier && catalogue && (
        <>
          <section className="panel">
            <h3>Périmètre et preuves</h3>
            <p>
              Origine déclarée :{" "}
              {dossier.context.lot.origin_country || "manquante"} · Production :{" "}
              {dossier.context.lot.production_start || "?"} au{" "}
              {dossier.context.lot.production_end || "?"}
            </p>
            <p>
              {dossier.context.plots.length} parcelle(s) liée(s) ·{" "}
              {dossier.context.documents.length} document(s) dans le périmètre.
            </p>
            {dossier.context.plots.map((p) => (
              <details key={p.plot_id}>
                <summary>
                  Parcelle {p.plot_id} — révision {p.revision}
                </summary>
                {p.forest.map((f) => (
                  <p key={f.id}>
                    {f.result.status} · {f.result.signal_status} · preuve {f.id}
                  </p>
                ))}
                {!p.forest.length && (
                  <p>Aucune observation forestière disponible.</p>
                )}
              </details>
            ))}
            <p>
              Les pièces choisies ci-dessous seront référencées par leur version
              et leur empreinte. Une certification n’est pas une dispense
              générale de diligence.
            </p>
            {!accepted.length && (
              <p>
                Aucune pièce acceptée. Utilisez d’abord le coffre et la revue
                documentaire.
              </p>
            )}
            {accepted.map((p) => (
              <label
                key={p.id}
                style={{ display: "flex", gap: 8, alignItems: "start" }}
              >
                <input
                  type="checkbox"
                  style={{ width: "auto" }}
                  disabled={!reviewer || busy}
                  checked={proofs.includes(p.id)}
                  onChange={(e) =>
                    setProofs(
                      e.target.checked
                        ? [...proofs, p.id]
                        : proofs.filter((x) => x !== p.id),
                    )
                  }
                />
                <span>
                  {p.metadata.title} — {p.id}
                </span>
              </label>
            ))}
          </section>
          <details className="panel" open>
            <summary>
              <strong>1. Revue de légalité — article 2(40)</strong>
            </summary>
            <p>
              {dossier.context.legality
                ? dossier.context.legality_stale
                  ? "Évaluation à reprendre : données modifiées."
                  : dossier.context.legality.payload.framework_qualified
                    ? "Cadre déclaré vérifié par le réviseur — pas certification."
                    : "Cadre national non qualifié."
                : "Aucune revue enregistrée."}
            </p>
            <Criteria
              labels={catalogue.legality}
              values={legal}
              setValues={setLegal}
              disabled={!reviewer || busy}
            />
            <label style={{ display: "flex", gap: 8 }}>
              <input
                type="checkbox"
                style={{ width: "auto" }}
                checked={qualified}
                disabled={!reviewer || busy}
                onChange={(e) => setQualified(e.target.checked)}
              />
              <span>
                J’ai vérifié manuellement les textes locaux et l’applicabilité
                de tous les domaines pour le pays et la période du lot.
              </span>
            </label>
            <label>
              Synthèse de légalité
              <textarea
                value={legalNote}
                disabled={!reviewer || busy}
                onChange={(e) => setLegalNote(e.target.value)}
                maxLength={4000}
              />
            </label>
            {reviewer && (
              <button
                className="button secondary"
                disabled={
                  busy ||
                  legalNote.trim().length < 10 ||
                  !dossier.context.lot.origin_country
                }
                onClick={() =>
                  act(() =>
                    jsonRequest(
                      `${base}/compliance/lots/${lot}/legality`,
                      csrf,
                      "POST",
                      {
                        input_sha256: dossier.legality_input_sha256,
                        country: dossier.context.lot.origin_country,
                        production_period:
                          `${dossier.context.lot.production_start || "?"} / ${dossier.context.lot.production_end || "?"}`.replaceAll(
                            " ",
                            "",
                          ),
                        framework_qualified: qualified,
                        criteria: legal,
                        evidence_version_ids: proofs,
                        note: legalNote,
                      },
                    ),
                  )
                }
              >
                Enregistrer la légalité
              </button>
            )}
            <details>
              <summary>
                Historique de légalité ({dossier.legality_history.length}{" "}
                derniers résultats)
              </summary>
              {dossier.legality_history.map((l) => (
                <p key={l.id}>
                  {new Date(l.created_at).toLocaleString("fr-FR")} ·{" "}
                  {l.payload.framework_qualified
                    ? "Cadre vérifié manuellement"
                    : "À qualifier"}{" "}
                  · {l.payload.note}
                </p>
              ))}
            </details>
          </details>
          <details className="panel">
            <summary>
              <strong>2. Évaluation du risque — article 10</strong>
            </summary>
            <p>
              Complétez les 14 critères. Un signal forestier, une lacune
              temporelle ou une validité historique ne sont traités comme
              examinés que si vous motivez le critère correspondant et joignez
              des preuves acceptées. Les observations restent visibles dans le
              résultat.
            </p>
            <Criteria
              labels={catalogue.risk}
              values={risk}
              setValues={setRisk}
              disabled={!reviewer || busy}
            />
            <label>
              Risque résiduel proposé
              <select
                disabled={!reviewer || busy}
                value={residual}
                onChange={(e) => setResidual(e.target.value)}
              >
                <option value="UNDETERMINED">
                  Indéterminé — revue à poursuivre
                </option>
                <option value="NON_NEGLIGIBLE">
                  Non négligeable — mesures requises
                </option>
                <option value="NEGLIGIBLE">
                  Négligeable — uniquement si tous les blocages sont levés
                </option>
              </select>
            </label>
            <label>
              Motivation de l’évaluation
              <textarea
                value={riskNote}
                disabled={!reviewer || busy}
                onChange={(e) => setRiskNote(e.target.value)}
                maxLength={4000}
              />
            </label>
            {reviewer && (
              <button
                className="button secondary"
                disabled={busy || riskNote.trim().length < 10}
                onClick={() =>
                  act(() =>
                    jsonRequest(
                      `${base}/compliance/lots/${lot}/risk`,
                      csrf,
                      "POST",
                      {
                        input_sha256: dossier.input_sha256,
                        criteria: risk,
                        evidence_version_ids: proofs,
                        proposed_residual: residual,
                        note: riskNote,
                      },
                    ),
                  )
                }
              >
                Enregistrer l’évaluation du risque
              </button>
            )}
          </details>
          <h3>Évaluations de risque conservées</h3>
          {!dossier.risk_history.length && (
            <p>Aucune évaluation enregistrée.</p>
          )}
          {dossier.risk_history.map((r) => (
            <article className="panel" key={r.id}>
              <h4>
                {r.result.status === "ACTION_REQUIRED"
                  ? "Actions / informations nécessaires"
                  : "Revue humaine enregistrée"}
                {r.stale ? " — À ACTUALISER" : ""}
              </h4>
              <p>
                {new Date(r.created_at).toLocaleString("fr-FR")} · Risque
                proposé : {r.result.review.proposed_residual}
              </p>
              <p>{r.result.review.note}</p>
              <ul>
                {r.result.factors.map((f, i) => (
                  <li key={i}>
                    {f.resolved_by_human_review
                      ? "Examiné avec preuves"
                      : "À traiter"}{" "}
                    — {f.message}{" "}
                    {f.reference && <small>({f.reference})</small>}
                  </li>
                ))}
              </ul>
              <p className="muted">
                Aucune conformité EUDR certifiée, aucune déclaration officielle.
                Une évolution des preuves ou une revue annuelle échue impose une
                actualisation.
              </p>
            </article>
          ))}
          <h3>Actions correctives et rappels internes</h3>
          <p>
            Les échéances restent visibles ici. Emails : non configurés, aucun
            message envoyé.
          </p>
          {dossier.context.tasks.map((t) => (
            <article key={t.id} className="panel">
              <strong>{t.title}</strong>
              <p>
                {t.state} · échéance {t.due_date}
                {t.state !== "RESOLVED" &&
                t.due_date < new Date().toISOString().slice(0, 10)
                  ? " — EN RETARD"
                  : ""}
              </p>
              <p>{t.description}</p>
              {t.resolution_note && <p>Résolution : {t.resolution_note}</p>}
              {reviewer && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => edit(t)}
                >
                  Modifier cette action
                </button>
              )}
            </article>
          ))}
          {reviewer && (
            <fieldset disabled={busy} style={{ minWidth: 0 }}>
              <legend>
                {task ? "Modifier une action" : "Créer une action corrective"}
              </legend>
              <label>
                Titre de l’action
                <input
                  maxLength={200}
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                />
              </label>
              <label>
                Description de l’action
                <textarea
                  maxLength={4000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </label>
              <label>
                Responsable
                <select
                  value={assigned}
                  onChange={(e) => setAssigned(e.target.value)}
                >
                  <option value="">Choisir un membre habilité</option>
                  {assignees.map((a) => (
                    <option value={a.user_id} key={a.user_id}>
                      {a.display_name} · {a.role}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Échéance
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
              {task && (
                <>
                  <label>
                    État de l’action
                    <select
                      value={taskState}
                      onChange={(e) => setTaskState(e.target.value)}
                    >
                      <option value="OPEN">Ouverte</option>
                      <option value="IN_PROGRESS">En cours</option>
                      <option value="RESOLVED">Résolue avec preuve</option>
                    </select>
                  </label>
                  <label>
                    Justification de résolution
                    <textarea
                      maxLength={4000}
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                    />
                  </label>
                  <label>
                    Preuve de résolution
                    <select
                      value={taskProof}
                      onChange={(e) => setTaskProof(e.target.value)}
                    >
                      <option value="">Choisir une preuve acceptée</option>
                      {accepted.map((p) => (
                        <option value={p.id} key={p.id}>
                          {p.metadata.title}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              )}
              <div className="row-actions">
                <button
                  className="button secondary"
                  disabled={taskTitle.trim().length < 3 || !assigned || !due}
                  onClick={() =>
                    act(async () => {
                      const b = {
                        title: taskTitle,
                        description,
                        assigned_to: assigned,
                        due_date: due,
                      };
                      await jsonRequest(
                        task
                          ? `${base}/compliance/tasks/${task.id}`
                          : `${base}/compliance/lots/${lot}/tasks`,
                        csrf,
                        task ? "PUT" : "POST",
                        task
                          ? {
                              ...b,
                              version: task.version,
                              state: taskState,
                              resolution_note: resolution,
                              proof_version_id: taskProof || null,
                            }
                          : b,
                      );
                      edit(null);
                    })
                  }
                >
                  Enregistrer l’action
                </button>
                {task && (
                  <button
                    className="button secondary"
                    onClick={() => edit(null)}
                  >
                    Nouvelle action
                  </button>
                )}
              </div>
            </fieldset>
          )}
          <button
            className="button secondary"
            disabled={busy}
            onClick={() => act(load)}
          >
            Actualiser le contexte avant de signer
          </button>
        </>
      )}
    </section>
  );
}
