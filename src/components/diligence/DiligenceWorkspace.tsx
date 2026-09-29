"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { jsonRequest } from "@/components/documents/DocumentsWorkspace";

type Preparation = {
  operator_name: string;
  operator_address: string;
  eori: string;
  regime: string;
  regime_reference: string;
  trade_flow: string;
  product_scope_confirmed: boolean;
  product_scope_reference: string;
  supply_chain_complete_confirmed: boolean;
  supply_chain_note: string;
};
type LotInput = {
  lot_id: string;
  scientific_names: string[];
  scientific_names_complete_confirmed: boolean;
  geolocation_complete_confirmed: boolean;
  additional_unit_reviewed: boolean;
  additional_unit_note: string;
  declared_net_mass_kg: string | null;
};
type Declaration = { preparation: Preparation; lots: LotInput[] };
type Summary = {
  id: string;
  current_revision: number;
  title: string;
  state: string;
  created_at: string;
};
type Issue = { code: string; message?: string; lot_id?: string };
type Detail = {
  dossier_id: string;
  revision: number;
  current_revision: number;
  is_current_revision: boolean;
  title: string;
  state: string;
  version: number;
  created_at: string;
  created_by: string;
  snapshot_sha256: string;
  source_matches: boolean;
  declaration: Declaration;
  checks_now: { status: string; issues: Issue[] };
  decisions: {
    id: string;
    new_state: string;
    note: string;
    created_at: string;
    actor_id: string;
  }[];
  snapshot: {
    facts: {
      id: string;
      reference: string;
      product_name: string;
      supplier_name: string;
      quantity: string;
      unit: string;
      plot_revision_count: number;
    }[];
  };
};
type Lot = {
  id: string;
  reference: string;
  product_name?: string;
  supplier_name?: string;
  quantity: string;
  unit: string;
};
const states: Record<string, string> = {
  DRAFT: "Brouillon figé",
  IN_REVIEW: "En revue",
  CHANGES_REQUESTED: "Corrections demandées",
  INTERNALLY_VALIDATED: "Validé en interne",
  INTERNALLY_WITHDRAWN: "Retiré en interne",
};
const emptyPreparation = (): Preparation => ({
  operator_name: "",
  operator_address: "",
  eori: "",
  regime: "UNQUALIFIED",
  regime_reference: "",
  trade_flow: "UNQUALIFIED",
  product_scope_confirmed: false,
  product_scope_reference: "",
  supply_chain_complete_confirmed: false,
  supply_chain_note: "",
});
const emptyLot = (id: string): LotInput => ({
  lot_id: id,
  scientific_names: [],
  scientific_names_complete_confirmed: false,
  geolocation_complete_confirmed: false,
  additional_unit_reviewed: false,
  additional_unit_note: "",
  declared_net_mass_kg: null,
});
const errors: Record<string, string> = {
  STALE_SNAPSHOT:
    "Les sources ont changé : préparez une nouvelle révision avant de signer.",
  VALIDATION_BLOCKED:
    "La validation est bloquée : examinez les contrôles et votre confirmation.",
  PDF_UNSUPPORTED_CHARACTER:
    "La police du PDF ne couvre pas certains caractères. Le JSON et le CSV conservent ces caractères ; aucun remplacement silencieux n’a été effectué.",
  PDF_TEXT_BUDGET:
    "Dossier trop détaillé pour la synthèse PDF bornée. Utilisez le JSON ou réduisez le périmètre.",
  PDF_PAGE_BUDGET:
    "La synthèse dépasse 60 pages. Utilisez le JSON ou réduisez le périmètre.",
  PDF_TIMEOUT:
    "Le PDF a dépassé sa limite de calcul. Le JSON reste disponible.",
  PDF_GENERATION_FAILED:
    "Le PDF n’a pas pu être généré. Aucun fichier partiel n’a été téléchargé.",
};

export function DiligenceWorkspace({
  org,
  csrf,
  role,
}: {
  org: string;
  csrf: string;
  role: string;
}) {
  const base = `/api/v1/organizations/${org}`;
  const writable = ["Admin", "Compliance Manager", "Procurement"].includes(
      role,
    ),
    reviewer = ["Admin", "Compliance Manager"].includes(role);
  const [items, setItems] = useState<Summary[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<Detail | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState(false),
    [target, setTarget] = useState<{ id: string; revision: number } | null>(
      null,
    ),
    [title, setTitle] = useState("");
  const [preparation, setPreparation] = useState<Preparation>(emptyPreparation),
    [lotInputs, setLotInputs] = useState<LotInput[]>([]),
    [lotOptions, setLotOptions] = useState<Lot[]>([]),
    [lotSearch, setLotSearch] = useState("");
  const [note, setNote] = useState(""),
    [ack, setAck] = useState(false),
    [revisionInput, setRevisionInput] = useState("1");
  const alive = useRef(true),
    selectionSerial = useRef(0),
    intent = useRef<{ key: string; id: string } | null>(null);
  useEffect(() => {
    alive.current = true;
    const serial = selectionSerial;
    return () => {
      alive.current = false;
      serial.current++;
    };
  }, []);
  function message(e: unknown) {
    const s = e instanceof Error ? e.message : "Opération impossible";
    return errors[s] || s;
  }
  const reload = useCallback(async () => {
    const data = await jsonRequest(`${base}/diligence?page=${page}`, csrf);
    if (alive.current) {
      setItems(data.items);
      setTotal(data.total);
      setEnabled(true);
    }
  }, [base, csrf, page]);
  useEffect(() => {
    let active = true;
    jsonRequest(`${base}/diligence?page=${page}`, csrf)
      .then((data) => {
        if (active) {
          setItems(data.items);
          setTotal(data.total);
          setEnabled(true);
        }
      })
      .catch((e) => {
        if (active) {
          setEnabled(false);
          setError(message(e));
        }
      });
    return () => {
      active = false;
    };
  }, [base, csrf, page]);
  useEffect(() => {
    if (!editing) return;
    let active = true;
    const timer = setTimeout(() => {
      jsonRequest(
        `${base}/lots?limit=100&q=${encodeURIComponent(lotSearch)}`,
        csrf,
      )
        .then((d) => {
          if (active) setLotOptions(d.items);
        })
        .catch((e) => {
          if (active) setError(message(e));
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [base, csrf, editing, lotSearch]);
  async function open(id: string, revision: number) {
    const serial = ++selectionSerial.current;
    setNote("");
    setAck(false);
    const d: Detail = await jsonRequest(
      `${base}/diligence/${id}/revisions/${revision}`,
      csrf,
    );
    if (alive.current && serial === selectionSerial.current) {
      setSelected(d);
      setRevisionInput(String(d.revision));
    }
  }
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  }
  function edit(d: Detail | null) {
    setEditing(true);
    setTarget(d ? { id: d.dossier_id, revision: d.current_revision } : null);
    setTitle(d?.title || "");
    setPreparation(
      d ? structuredClone(d.declaration.preparation) : emptyPreparation(),
    );
    setLotInputs(d ? structuredClone(d.declaration.lots) : []);
    setLotSearch("");
    setError("");
    setNotice("");
    intent.current = null;
  }
  function p<K extends keyof Preparation>(key: K, value: Preparation[K]) {
    setPreparation((old) => ({ ...old, [key]: value }));
  }
  function l<K extends keyof LotInput>(id: string, key: K, value: LotInput[K]) {
    setLotInputs((old) =>
      old.map((x) => (x.lot_id === id ? { ...x, [key]: value } : x)),
    );
  }
  function requestId(body: unknown) {
    const key = JSON.stringify(body);
    if (intent.current?.key !== key)
      intent.current = { key, id: crypto.randomUUID() };
    return intent.current.id;
  }
  async function save() {
    const b = {
      title,
      declaration: {
        preparation,
        lots: lotInputs.map((x) => ({
          ...x,
          scientific_names: x.scientific_names
            .map((v) => v.trim())
            .filter(Boolean),
        })),
      },
      dossier_id: target?.id || null,
      expected_revision: target?.revision || 0,
    };
    const d = await jsonRequest(`${base}/diligence/revisions`, csrf, "POST", {
      ...b,
      request_id: requestId(b),
    });
    if (!alive.current) return;
    intent.current = null;
    setEditing(false);
    await reload();
    await open(d.dossier_id, d.revision);
    setNotice("Révision figée avec vos sources. Aucun envoi aux autorités.");
  }
  async function decide(action: string) {
    if (!selected) return;
    const b = { version: selected.version, action, note, acknowledged: ack };
    await jsonRequest(
      `${base}/diligence/${selected.dossier_id}/revisions/${selected.revision}/decisions`,
      csrf,
      "POST",
      {
        ...b,
        request_id: requestId({
          dossier: selected.dossier_id,
          revision: selected.revision,
          ...b,
        }),
      },
    );
    if (!alive.current) return;
    intent.current = null;
    await open(selected.dossier_id, selected.revision);
    await reload();
    setNotice(
      "Décision interne enregistrée. Aucun statut officiel n’a été créé ou modifié.",
    );
  }
  async function download(kind: "pdf" | "csv" | "json") {
    if (!selected) return;
    const r = await fetch(
      `${base}/diligence/${selected.dossier_id}/revisions/${selected.revision}/export.${kind}`,
    );
    if (!r.ok) {
      const e = await r.json();
      throw Error(typeof e.detail === "string" ? e.detail : "Export refusé");
    }
    const bytes = await r.arrayBuffer();
    const expected = r.headers.get("X-Content-SHA256");
    const digest = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    )
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    if (!expected || digest !== expected)
      throw Error("Intégrité du téléchargement non vérifiée");
    if (!alive.current) return;
    const url = URL.createObjectURL(
      new Blob([bytes], {
        type:
          kind === "pdf"
            ? "application/pdf"
            : kind === "csv"
              ? "text/csv;charset=utf-8"
              : "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `diligence-${selected.dossier_id}-r${selected.revision}.${kind}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    setNotice(
      "Export privé téléchargé, empreinte vérifiée. Ce fichier n’est pas une déclaration officielle.",
    );
  }
  const ready =
    selected?.is_current_revision &&
    selected.source_matches &&
    selected.checks_now.status === "READY_FOR_INTERNAL_REVIEW";
  return (
    <section
      className="diligence-workspace documentary-workspace"
      aria-label="Dossiers de diligence"
    >
      <div className="diligence-heading">
        <div>
          <span className="eyebrow">DILIGENCE RAISONNÉE · ASSISTÉ</span>
          <h1>Dossiers & validation interne</h1>
          <p className="muted">
            Rassemblez les preuves, examinez les blocages et conservez vos
            décisions.
          </p>
        </div>
        {writable && (
          <button
            className="button primary"
            disabled={busy || !enabled}
            onClick={() => edit(null)}
          >
            Nouveau dossier
          </button>
        )}
      </div>
      <div className="diligence-disclaimer">
        <strong>Préparer n’est pas déclarer.</strong> Aucun dépôt TRACES n’est
        effectué. La validation interne ne certifie pas la conformité ; les
        références et régimes restent à vérifier humainement.
      </div>
      {error && (
        <p role="alert" className="message error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="message success">
          {notice}
        </p>
      )}
      {busy && (
        <p role="status">
          Traitement en cours… Les preuves et permissions sont revérifiées.
        </p>
      )}
      {editing && writable && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            void act(save);
          }}
        >
          <h2>
            {target ? "Préparer une nouvelle révision" : "Préparer un dossier"}
          </h2>
          <p className="muted">
            Les sources seront relues sur le serveur. Une révision créée est
            figée ; une correction prépare une nouvelle révision, sans écraser
            l’ancienne.
          </p>
          <fieldset disabled={busy}>
            <legend>1. Identité et régime</legend>
            <div className="form-grid">
              <label>
                Titre du dossier
                <input
                  required
                  minLength={3}
                  maxLength={160}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Nom légal de l’opérateur
                <input
                  maxLength={200}
                  value={preparation.operator_name}
                  onChange={(e) => p("operator_name", e.target.value)}
                />
              </label>
              <label>
                Adresse de l’opérateur
                <textarea
                  maxLength={1000}
                  value={preparation.operator_address}
                  onChange={(e) => p("operator_address", e.target.value)}
                />
              </label>
              <label>
                EORI déclaré
                <input
                  maxLength={32}
                  value={preparation.eori}
                  onChange={(e) => p("eori", e.target.value.toUpperCase())}
                />
                <small>
                  Import/export : à vérifier ; aucune recherche officielle
                  automatique.
                </small>
              </label>
              <label>
                Régime de l’acteur
                <select
                  value={preparation.regime}
                  onChange={(e) => p("regime", e.target.value)}
                >
                  <option value="UNQUALIFIED">À qualifier</option>
                  <option value="ORDINARY_OPERATOR">
                    Opérateur — régime ordinaire
                  </option>
                  <option value="MICRO_SMALL_PRIMARY">
                    Micro/petit opérateur primaire
                  </option>
                  <option value="DOWNSTREAM_OPERATOR">Opérateur aval</option>
                  <option value="TRADER">Commerçant</option>
                </select>
              </label>
              <label>
                Opération commerciale
                <select
                  value={preparation.trade_flow}
                  onChange={(e) => p("trade_flow", e.target.value)}
                >
                  <option value="UNQUALIFIED">À qualifier</option>
                  <option value="DOMESTIC">Mise sur le marché intérieur</option>
                  <option value="IMPORT">Importation</option>
                  <option value="EXPORT">Exportation</option>
                </select>
              </label>
            </div>
            <label>
              Justification et sources du régime
              <textarea
                maxLength={2000}
                value={preparation.regime_reference}
                onChange={(e) => p("regime_reference", e.target.value)}
              />
            </label>
            {preparation.regime !== "ORDINARY_OPERATOR" && (
              <p className="message warning">
                Ce parcours ne qualifie que le régime ordinaire de l’opérateur.
                Les autres régimes peuvent être documentés en brouillon : cela
                ne signifie pas qu’une déclaration ordinaire leur est imposée.
              </p>
            )}
            <label className="diligence-check">
              <input
                type="checkbox"
                checked={preparation.product_scope_confirmed}
                onChange={(e) => p("product_scope_confirmed", e.target.checked)}
              />
              J’ai vérifié le champ produit dans les textes à jour.
            </label>
            <label>
              Référence de vérification du champ produit
              <textarea
                maxLength={2000}
                value={preparation.product_scope_reference}
                onChange={(e) => p("product_scope_reference", e.target.value)}
              />
            </label>
            <label className="diligence-check">
              <input
                type="checkbox"
                checked={preparation.supply_chain_complete_confirmed}
                onChange={(e) =>
                  p("supply_chain_complete_confirmed", e.target.checked)
                }
              />
              J’ai vérifié le périmètre complet de la chaîne.
            </label>
            <label>
              Justification de complétude de la chaîne
              <textarea
                maxLength={4000}
                value={preparation.supply_chain_note}
                onChange={(e) => p("supply_chain_note", e.target.value)}
              />
            </label>
          </fieldset>
          <fieldset disabled={busy}>
            <legend>
              2. Lots et confirmations humaines ({lotInputs.length}/20)
            </legend>
            <label>
              Rechercher un lot
              <input
                maxLength={200}
                value={lotSearch}
                onChange={(e) => setLotSearch(e.target.value)}
              />
            </label>
            <small>
              100 premiers résultats ; affinez la recherche. Le dossier est
              limité à 20 lots.
            </small>
            <div className="diligence-lot-picker">
              {lotOptions.map((o) => (
                <label className="diligence-check" key={o.id}>
                  <input
                    type="checkbox"
                    checked={lotInputs.some((l) => l.lot_id === o.id)}
                    disabled={
                      !lotInputs.some((l) => l.lot_id === o.id) &&
                      lotInputs.length >= 20
                    }
                    onChange={(e) =>
                      setLotInputs((old) =>
                        e.target.checked
                          ? [...old, emptyLot(o.id)]
                          : old.filter((x) => x.lot_id !== o.id),
                      )
                    }
                  />
                  {o.reference} · {o.product_name || "Produit"} · {o.quantity}{" "}
                  {o.unit}
                </label>
              ))}
            </div>
            {lotInputs.map((x) => (
              <details className="diligence-lot-settings" key={x.lot_id}>
                <summary>
                  Confirmer le lot{" "}
                  {lotOptions.find((o) => o.id === x.lot_id)?.reference ||
                    selected?.snapshot.facts.find((o) => o.id === x.lot_id)
                      ?.reference ||
                    x.lot_id}
                </summary>
                <label className="diligence-check">
                  <input
                    type="checkbox"
                    checked={x.geolocation_complete_confirmed}
                    onChange={(e) =>
                      l(
                        x.lot_id,
                        "geolocation_complete_confirmed",
                        e.target.checked,
                      )
                    }
                  />
                  Toutes les parcelles ou tous les établissements pertinents
                  sont liés.
                </label>
                <label className="diligence-check">
                  <input
                    type="checkbox"
                    checked={x.additional_unit_reviewed}
                    onChange={(e) =>
                      l(x.lot_id, "additional_unit_reviewed", e.target.checked)
                    }
                  />
                  J’ai examiné les unités et unités supplémentaires applicables.
                </label>
                <label>
                  Justification des unités
                  <textarea
                    maxLength={2000}
                    value={x.additional_unit_note}
                    onChange={(e) =>
                      l(x.lot_id, "additional_unit_note", e.target.value)
                    }
                  />
                </label>
                <label>
                  Masse nette mesurée en kg — si nécessaire
                  <input
                    inputMode="decimal"
                    maxLength={24}
                    value={x.declared_net_mass_kg || ""}
                    onChange={(e) =>
                      l(
                        x.lot_id,
                        "declared_net_mass_kg",
                        e.target.value.replace(",", ".") || null,
                      )
                    }
                  />
                  <small>
                    Aucune densité ou masse par pièce inventée. La conversion
                    tonnes → kg est exacte.
                  </small>
                </label>
                <label>
                  Noms scientifiques du bois — un par ligne
                  <textarea
                    maxLength={6000}
                    value={x.scientific_names.join("\n")}
                    onChange={(e) =>
                      l(
                        x.lot_id,
                        "scientific_names",
                        e.target.value.split("\n"),
                      )
                    }
                  />
                </label>
                <label className="diligence-check">
                  <input
                    type="checkbox"
                    checked={x.scientific_names_complete_confirmed}
                    onChange={(e) =>
                      l(
                        x.lot_id,
                        "scientific_names_complete_confirmed",
                        e.target.checked,
                      )
                    }
                  />
                  Pour le bois, tous les noms scientifiques complets ont été
                  vérifiés.
                </label>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    setLotInputs((old) =>
                      old.filter((v) => v.lot_id !== x.lot_id),
                    )
                  }
                >
                  Retirer ce lot du nouveau dossier
                </button>
              </details>
            ))}
          </fieldset>
          <div className="row-actions">
            <button
              className="button primary"
              disabled={busy || !lotInputs.length || !enabled}
            >
              Figer cette révision
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setEditing(false)}
            >
              Annuler la préparation
            </button>
          </div>
        </form>
      )}
      <div className="diligence-layout">
        <section className="panel">
          <h2>
            Vos dossiers <span className="badge">{total}</span>
          </h2>
          {!items.length && enabled && <p>Aucun dossier enregistré.</p>}
          <div className="diligence-list">
            {items.map((d) => (
              <button
                key={d.id}
                className={`diligence-card ${selected?.dossier_id === d.id ? "selected" : ""}`}
                disabled={busy}
                onClick={() => void act(() => open(d.id, d.current_revision))}
              >
                <strong>{d.title}</strong>
                <span>
                  {states[d.state] || d.state} · révision {d.current_revision}
                </span>
                <small>
                  {new Date(d.created_at).toLocaleDateString("fr-FR")}
                </small>
              </button>
            ))}
          </div>
          {total > 20 && (
            <div className="row-actions">
              <button
                className="button secondary"
                disabled={busy || page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Précédent
              </button>
              <span>Page {page}</span>
              <button
                className="button secondary"
                disabled={busy || page * 20 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Suivant
              </button>
            </div>
          )}
        </section>
        <section className="panel" aria-label="Révision du dossier">
          {!selected ? (
            <>
              <h2>Une décision documentée</h2>
              <p>
                Sélectionnez un dossier pour examiner ses sources, ses blocages
                et l’historique de ses décisions.
              </p>
              <ol className="diligence-steps">
                <li>Préparer le périmètre et figer les sources</li>
                <li>Examiner et traiter les blocages</li>
                <li>Valider en interne avec une justification</li>
                <li>Exporter — aucune soumission automatique</li>
              </ol>
            </>
          ) : (
            <>
              <span className="eyebrow">
                RÉVISION {selected.revision} / {selected.current_revision}
              </span>
              <h2>{selected.title}</h2>
              <p>
                <span className="badge">
                  {states[selected.state] || selected.state}
                </span>
              </p>
              {(!selected.is_current_revision || !selected.source_matches) && (
                <p className="message warning">
                  {!selected.is_current_revision
                    ? "Révision historique : une révision plus récente existe. "
                    : ""}
                  {!selected.source_matches
                    ? "Les sources ont changé ou ne sont plus disponibles. "
                    : ""}
                  Cette révision ne peut pas être signée comme validation
                  courante.
                </p>
              )}
              <div className="row-actions">
                <label>
                  Révision à consulter
                  <input
                    type="number"
                    min={1}
                    max={selected.current_revision}
                    value={revisionInput}
                    onChange={(e) => setRevisionInput(e.target.value)}
                  />
                </label>
                <button
                  className="button secondary"
                  disabled={
                    busy ||
                    !Number.isInteger(Number(revisionInput)) ||
                    Number(revisionInput) < 1 ||
                    Number(revisionInput) > selected.current_revision
                  }
                  onClick={() =>
                    void act(() =>
                      open(selected.dossier_id, Number(revisionInput)),
                    )
                  }
                >
                  Consulter la révision
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(() => open(selected.dossier_id, selected.revision))
                  }
                >
                  Actualiser les contrôles
                </button>
              </div>
              <h3>Contrôles actuels</h3>
              <p>
                {ready
                  ? "Aucun blocage détecté par ces contrôles internes. Revue humaine nécessaire."
                  : "Revue ou corrections nécessaires avant validation."}
              </p>
              <ul className="diligence-issues">
                {selected.checks_now.issues.map((i, n) => (
                  <li key={`${i.code}-${n}`}>
                    <strong>{i.code}</strong>
                    <span>{i.message || "Source à réexaminer"}</span>
                    {i.lot_id && (
                      <small>
                        Lot :{" "}
                        {selected.snapshot.facts.find((f) => f.id === i.lot_id)
                          ?.reference || i.lot_id}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
              <h3>Périmètre figé</h3>
              {selected.snapshot.facts.map((f) => (
                <p key={f.id}>
                  <strong>{f.reference}</strong> · {f.product_name} ·{" "}
                  {f.quantity} {f.unit}
                  <br />
                  <span className="muted">
                    {f.supplier_name} · {f.plot_revision_count} révision(s)
                    parcellaire(s)
                  </span>
                </p>
              ))}
              <details>
                <summary>Empreinte et identifiants</summary>
                <p>Dossier : {selected.dossier_id}</p>
                <p>SHA-256 : {selected.snapshot_sha256}</p>
                <p>
                  Préparé le{" "}
                  {new Date(selected.created_at).toLocaleString("fr-FR")} ·
                  auteur {selected.created_by}
                </p>
              </details>
              {writable && selected.is_current_revision && (
                <div className="row-actions">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => edit(selected)}
                  >
                    Préparer une nouvelle révision
                  </button>
                </div>
              )}
              {writable &&
                selected.is_current_revision &&
                ["DRAFT", "IN_REVIEW", "INTERNALLY_VALIDATED"].includes(
                  selected.state,
                ) && (
                  <fieldset disabled={busy}>
                    <legend>Décision interne</legend>
                    <label>
                      Justification de la décision
                      <textarea
                        maxLength={4000}
                        minLength={10}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                      />
                    </label>
                    {reviewer && selected.state === "IN_REVIEW" && (
                      <label className="diligence-check">
                        <input
                          type="checkbox"
                          checked={ack}
                          onChange={(e) => setAck(e.target.checked)}
                        />
                        J’ai examiné ce dossier et ses preuves. Je confirme
                        cette décision interne, sans déclaration aux autorités.
                      </label>
                    )}
                    <div className="row-actions">
                      {selected.state === "DRAFT" && (
                        <button
                          className="button primary"
                          disabled={
                            note.trim().length < 10 || !selected.source_matches
                          }
                          onClick={() =>
                            void act(() => decide("SUBMIT_FOR_REVIEW"))
                          }
                        >
                          Soumettre à la revue interne
                        </button>
                      )}
                      {reviewer && selected.state === "IN_REVIEW" && (
                        <>
                          <button
                            className="button primary"
                            disabled={note.trim().length < 10 || !ack || !ready}
                            onClick={() =>
                              void act(() => decide("VALIDATE_INTERNALLY"))
                            }
                          >
                            Valider en interne
                          </button>
                          <button
                            className="button secondary"
                            disabled={note.trim().length < 10}
                            onClick={() =>
                              void act(() => decide("REQUEST_CHANGES"))
                            }
                          >
                            Demander des corrections
                          </button>
                        </>
                      )}
                      {reviewer &&
                        ["IN_REVIEW", "INTERNALLY_VALIDATED"].includes(
                          selected.state,
                        ) && (
                          <button
                            className="button secondary"
                            disabled={note.trim().length < 10}
                            onClick={() =>
                              void act(() => decide("WITHDRAW_INTERNALLY"))
                            }
                          >
                            Retirer en interne
                          </button>
                        )}
                    </div>
                  </fieldset>
                )}
              <h3>Historique des décisions</h3>
              {!selected.decisions.length ? (
                <p className="muted">Aucune décision sur cette révision.</p>
              ) : (
                selected.decisions.map((d) => (
                  <article className="diligence-decision" key={d.id}>
                    <strong>{states[d.new_state] || d.new_state}</strong>
                    <p>{d.note}</p>
                    <small>
                      {new Date(d.created_at).toLocaleString("fr-FR")} · auteur{" "}
                      {d.actor_id}
                    </small>
                  </article>
                ))
              )}
              <h3>Exports privés</h3>
              <p className="muted">
                PDF : synthèse lisible · JSON : sources structurées et
                géométries · CSV : index des lots. Ni pièces binaires ni blocs
                raster embarqués. Aucun format d’import TRACES revendiqué.
              </p>
              <div className="row-actions">
                {(["pdf", "json", "csv"] as const).map((kind) => (
                  <button
                    className="button secondary"
                    key={kind}
                    disabled={busy}
                    onClick={() => void act(() => download(kind))}
                  >
                    Télécharger {kind.toUpperCase()}
                  </button>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}
