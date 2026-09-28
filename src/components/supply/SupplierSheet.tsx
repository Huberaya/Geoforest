"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Dialog } from "./controls";
import {
  type Api,
  type Supplier,
  type SupplierDetail,
  type Contact,
  type Collection,
  type Invitation,
  countryName,
  statusLabels,
} from "./types";
export function SupplierSheet({
  supplier,
  api,
  writable,
  reviewable,
  onClose,
  onEdit,
  onChanged,
}: {
  supplier: Supplier;
  api: Api;
  writable: boolean;
  reviewable: boolean;
  onClose: () => void;
  onEdit: (s: Supplier) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<SupplierDetail | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [link, setLink] = useState<Invitation | null>(null),
    [contact, setContact] = useState<Contact | null>(null),
    [epoch, setEpoch] = useState(0);
  const path = "/suppliers/" + supplier.id;
  const load = useCallback(async () => {
    const result = (await api(path)) as SupplierDetail;
    setData(result);
  }, [api, path]);
  useEffect(() => {
    const ctrl = new AbortController();
    api(path, "GET", undefined, ctrl.signal)
      .then((d) => setData(d as SupplierDetail))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => ctrl.abort();
  }, [api, path]);
  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
      onChanged();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveContact(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      name: f.get("name"),
      email: f.get("email"),
      phone: f.get("phone"),
      position: f.get("position"),
      ...(contact ? { version: contact.version } : {}),
    };
    await act(async () => {
      await api(
        path + "/contacts" + (contact ? "/" + contact.id : ""),
        contact ? "PUT" : "POST",
        body,
      );
      setContact(null);
      setEpoch((v) => v + 1);
    }, "Contact enregistré.");
  }
  async function invite() {
    if (
      data?.invitations.some((i) => !i.revoked_at) &&
      !window.confirm(
        "Le nouveau lien révoquera les liens et sessions précédents de ce fournisseur. Continuer ?",
      )
    )
      return;
    await act(async () => {
      const result = (await api(path + "/invitations", "POST", {
        expires_in_hours: 72,
      })) as Invitation;
      setLink(result);
    }, "Lien créé. Aucun email n’a été envoyé.");
  }
  return (
    <Dialog
      title={data?.name || supplier.name}
      onClose={onClose}
      busy={busy}
      wide
    >
      <div className="supplier-sheet">
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
        {!data ? (
          <p>Chargement de la fiche…</p>
        ) : (
          <>
            <div className="sheet-identity">
              <div className="supplier-monogram">
                {data.name.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <strong>{data.reference}</strong>
                <p>
                  {countryName(data.country)} ·{" "}
                  {data.email || "Email à renseigner"}
                </p>
              </div>
              <span className="status neutral">Risque non évalué</span>
            </div>
            <div className="sheet-grid">
              <section>
                <h3>Identité fournisseur</h3>
                <dl className="detail-list">
                  <div>
                    <dt>Adresse</dt>
                    <dd>{data.address || "Non renseignée"}</dd>
                  </div>
                  <div>
                    <dt>Organisation</dt>
                    <dd>
                      {
                        (
                          {
                            company: "Entreprise",
                            cooperative: "Coopérative",
                            individual: "Producteur individuel",
                            unknown: "À préciser",
                          } as Record<string, string>
                        )[data.legal_type]
                      }
                    </dd>
                  </div>
                  <div>
                    <dt>Immatriculation</dt>
                    <dd>{data.registration_id || "Non renseignée"}</dd>
                  </div>
                  <div>
                    <dt>Notes internes</dt>
                    <dd>{data.notes || "Aucune note"}</dd>
                  </div>
                </dl>
                {data.missing_fields && data.missing_fields.length > 0 && (
                  <p className="callout warning">
                    Fiche à compléter :{" "}
                    {data.missing_fields
                      .map(
                        (f) =>
                          (
                            ({
                              country: "pays",
                              email: "email",
                              address: "adresse",
                            }) as Record<string, string>
                          )[f],
                      )
                      .join(", ")}
                    .
                  </p>
                )}
                {writable && !data.archived_at && (
                  <button
                    className="button secondary"
                    onClick={() => onEdit(data)}
                  >
                    Modifier la fiche
                  </button>
                )}
              </section>
              <section>
                <h3>État de la collecte</h3>
                <p>
                  <strong>{data.product_ids.length}</strong> produit(s)
                  associé(s)
                </p>
                <p className="muted">
                  Parcelles et documents : non disponibles dans ce chantier.
                </p>
                <div className="callout">
                  La revue de la collecte initiale n’est ni une validation EUDR
                  ni une déclaration aux autorités.
                </div>
              </section>
            </div>
            <section className="sheet-section">
              <div className="section-heading">
                <h3>Contacts</h3>
                <span className="count-badge">{data.contacts.length}</span>
              </div>
              {data.contacts.length === 0 && (
                <p className="muted">Aucun contact individuel enregistré.</p>
              )}
              {data.contacts.map((c) => (
                <div className="contact-row" key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <p>
                      {c.email || "Sans email"} {c.phone && " · " + c.phone}
                    </p>
                    <small>{c.position}</small>
                  </div>
                  {writable && !data.archived_at && (
                    <div className="row-actions">
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => setContact(c)}
                      >
                        Modifier
                      </button>
                      <button
                        className="text-button danger-text"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              "Retirer ce contact ? Son historique reste dans le journal.",
                            )
                          )
                            void act(
                              () =>
                                api(
                                  path +
                                    "/contacts/" +
                                    c.id +
                                    "?version=" +
                                    c.version,
                                  "DELETE",
                                ),
                              "Contact retiré.",
                            );
                        }}
                      >
                        Retirer
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {writable && !data.archived_at && (
                <form
                  className="contact-form"
                  key={epoch + "-" + (contact?.id || "new")}
                  onSubmit={saveContact}
                >
                  <h4>
                    {contact ? "Modifier un contact" : "Ajouter un contact"}
                  </h4>
                  <div className="form-grid">
                    <label>
                      Nom du contact *
                      <input
                        name="name"
                        defaultValue={contact?.name}
                        required
                        minLength={2}
                        maxLength={200}
                      />
                    </label>
                    <label>
                      Email du contact *
                      <input
                        name="email"
                        required
                        type="email"
                        defaultValue={contact?.email}
                        maxLength={320}
                      />
                    </label>
                    <label>
                      Téléphone
                      <input
                        name="phone"
                        defaultValue={contact?.phone}
                        maxLength={50}
                      />
                    </label>
                    <label>
                      Fonction
                      <input
                        name="position"
                        defaultValue={contact?.position}
                        maxLength={100}
                      />
                    </label>
                  </div>
                  <div className="row-actions">
                    {contact && (
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => setContact(null)}
                      >
                        Annuler
                      </button>
                    )}
                    <button className="button secondary" disabled={busy}>
                      {contact
                        ? "Enregistrer le contact"
                        : "Ajouter le contact"}
                    </button>
                  </div>
                </form>
              )}
            </section>
            {writable && (
              <section className="sheet-section">
                <div className="section-heading">
                  <h3>Portail fournisseur</h3>
                  <span className="status neutral">Transmission manuelle</span>
                </div>
                <p className="muted">
                  Lien secret à usage unique, valable 72 h. Session limitée à 8
                  h. Remettez-le uniquement à votre contact autorisé.
                </p>
                {!data.archived_at && (
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void invite()}
                  >
                    Créer un lien sécurisé
                  </button>
                )}
                {link?.url && (
                  <div className="secret-link">
                    <label>
                      Lien sécurisé — affiché une seule fois
                      <input
                        readOnly
                        value={link.url}
                        onFocus={(e) => e.target.select()}
                      />
                    </label>
                    <div className="row-actions">
                      <button
                        className="button secondary"
                        onClick={() =>
                          void navigator.clipboard
                            .writeText(link.url || "")
                            .then(() =>
                              setNotice(
                                "Lien copié. Transmettez-le par un canal de confiance.",
                              ),
                            )
                            .catch(() =>
                              setNotice(
                                "Sélectionnez et copiez le lien manuellement.",
                              ),
                            )
                        }
                      >
                        Copier le lien
                      </button>
                      <button
                        className="text-button"
                        onClick={() => setLink(null)}
                      >
                        Masquer le lien
                      </button>
                    </div>
                    <p>
                      Expiration :{" "}
                      {new Date(link.expires_at).toLocaleString("fr-FR")}. Aucun
                      email envoyé.
                    </p>
                  </div>
                )}
                {data.invitations.map((i) => (
                  <div className="contact-row" key={i.id}>
                    <div>
                      <strong>
                        {i.revoked_at
                          ? "Révoqué"
                          : new Date(i.expires_at) < new Date()
                            ? "Expiré"
                            : i.used_at
                              ? "Utilisé — session possiblement active"
                              : "En attente d’ouverture"}
                      </strong>
                      <p>
                        Expire le{" "}
                        {new Date(i.expires_at).toLocaleString("fr-FR")}
                      </p>
                    </div>
                    {!i.revoked_at && (
                      <button
                        disabled={busy}
                        className="text-button danger-text"
                        onClick={() =>
                          void act(async () => {
                            await api(path + "/invitations/" + i.id, "DELETE");
                            if (link?.id === i.id) setLink(null);
                          }, "Accès révoqué, y compris la session associée.")
                        }
                      >
                        Révoquer
                      </button>
                    )}
                  </div>
                ))}
              </section>
            )}
            <section className="sheet-section">
              <h3>Propositions du fournisseur</h3>
              <p className="muted">
                Données déclarées, conservées séparément du référentiel
                entreprise. Les 30 collectes les plus récentes sont affichées.
              </p>
              {data.collections.length === 0 && (
                <div className="empty-compact">
                  Aucune collecte. Créez un lien sécurisé pour commencer.
                </div>
              )}
              {data.collections.map((c) => (
                <CollectionCard
                  key={c.id + "-" + c.version}
                  collection={c}
                  reviewable={reviewable && !data.archived_at}
                  busy={busy}
                  review={(decision, note) =>
                    act(
                      () =>
                        api(path + "/collections/" + c.id + "/review", "POST", {
                          version: c.version,
                          decision,
                          note,
                        }),
                      "Revue enregistrée. Le référentiel entreprise n’a pas été modifié.",
                    )
                  }
                />
              ))}
            </section>
          </>
        )}
      </div>
    </Dialog>
  );
}
function CollectionCard({
  collection: c,
  reviewable,
  busy,
  review,
}: {
  collection: Collection;
  reviewable: boolean;
  busy: boolean;
  review: (decision: string, note: string) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  return (
    <article className="collection-card">
      <div className="section-heading">
        <strong>{statusLabels[c.status] || c.status}</strong>
        <span className="caption">Version {c.version}</span>
      </div>
      <p>
        {c.completeness.percent} % des informations de la collecte initiale
        renseignées — <strong>pas un taux de conformité</strong>.
      </p>
      <progress
        value={c.completeness.percent}
        max={100}
        aria-label="Complétude de la collecte initiale"
      />
      <details>
        <summary>Consulter les données déclarées</summary>
        <dl className="detail-list">
          <div>
            <dt>Organisation</dt>
            <dd>{c.payload.company.name || "Non renseignée"}</dd>
          </div>
          <div>
            <dt>Pays</dt>
            <dd>{countryName(c.payload.company.country)}</dd>
          </div>
          <div>
            <dt>Adresse</dt>
            <dd>{c.payload.company.address || "Non renseignée"}</dd>
          </div>
          <div>
            <dt>Contact</dt>
            <dd>
              {c.payload.company.contact_name || "Non renseigné"} ·{" "}
              {c.payload.company.email || "Sans email"}
            </dd>
          </div>
        </dl>
        {c.payload.products.map((p, i) => (
          <div className="declared-product" key={i}>
            <strong>{p.name || "Produit sans nom"}</strong>
            <span>
              {p.commodity || "Matière à préciser"} · {p.quantity || "—"}{" "}
              {p.unit} · {countryName(p.origin_country)}
            </span>
          </div>
        ))}
      </details>
      {c.review_note && (
        <p className="callout">
          <strong>Note de revue :</strong> {c.review_note}
        </p>
      )}
      {c.status === "SUBMITTED" && reviewable && (
        <div className="review-form">
          <label>
            Note de revue *
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              minLength={5}
              maxLength={2000}
              placeholder="Observations et éventuelles corrections à demander"
            />
          </label>
          <div className="row-actions">
            <button
              className="button secondary"
              disabled={busy || note.trim().length < 5}
              onClick={() => void review("CHANGES_REQUESTED", note)}
            >
              Demander des corrections
            </button>
            <button
              className="button primary"
              disabled={busy || note.trim().length < 5}
              onClick={() => void review("REVIEWED", note)}
            >
              Marquer la collecte revue
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
