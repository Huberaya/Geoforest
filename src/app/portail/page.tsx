"use client";
import Link from "next/link";
import { PortalPlots } from "@/components/plots/PortalPlots";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Payload,
  type Collection,
  type CompanyDraft,
  type DeclaredProduct,
  type Catalogue,
  errorText,
  statusLabels,
} from "@/components/supply/types";
import { CountrySelect } from "@/components/supply/controls";
type PortalMe = {
  supplier_name: string;
  organization_name: string;
  csrf_token: string;
  expires_at: string;
  collections: Collection[];
  commodities: Catalogue["commodities"];
  countries: string[];
};
const emptyCompany: CompanyDraft = {
  name: "",
  country: null,
  address: "",
  email: "",
  contact_name: "",
  phone: "",
  legal_type: "unknown",
};
function normalize(c: Collection): Payload {
  return {
    company: { ...emptyCompany, ...c.payload.company },
    products: c.payload.products.map((p) => ({
      ...p,
      quantity: p.quantity === null ? null : String(p.quantity),
    })),
  };
}
export default function Portal() {
  const token = useRef(""),
    initialized = useRef(false);
  const [hasToken, setHasToken] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [me, setMe] = useState<PortalMe | null>(null),
    [collection, setCollection] = useState<Collection | null>(null),
    [payload, setPayload] = useState<Payload>({
      company: emptyCompany,
      products: [],
    }),
    [dirty, setDirty] = useState(false),
    [step, setStep] = useState(0),
    [confirmed, setConfirmed] = useState(false);
  const api = useCallback(
    async (path: string, method = "GET", body?: unknown, csrf = "") => {
      const res = await fetch("/api/portal" + path, {
        method,
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
      if (!res.ok) {
        let data;
        try {
          data = await res.json();
        } catch {}
        throw new Error(errorText(data?.detail));
      }
      return res.status === 204 ? null : res.json();
    },
    [],
  );
  const load = useCallback(async () => {
    const data = (await api("/me")) as PortalMe;
    setMe(data);
    const c = data.collections[0] || null;
    setCollection(c);
    if (c) setPayload(normalize(c));
    setDirty(false);
  }, [api]);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const hash = new URLSearchParams(window.location.hash.slice(1));
    token.current = hash.get("invite") || "";
    window.history.replaceState(null, "", window.location.pathname);
    async function init() {
      if (token.current) {
        setHasToken(true);
        setLoading(false);
        return;
      }
      try {
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void init();
  }, [load]);
  useEffect(() => {
    function warn(e: BeforeUnloadEvent) {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function open() {
    setBusy(true);
    setError("");
    try {
      await api("/exchange", "POST", { token: token.current });
      token.current = "";
      setHasToken(false);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!collection || !me) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const cleaned = {
        ...payload,
        products: payload.products.map((p) => ({
          ...p,
          quantity: p.quantity ? String(p.quantity).replace(",", ".") : null,
        })),
      };
      const c = (await api(
        "/collections/" + collection.id,
        "PUT",
        { version: collection.version, payload: cleaned },
        me.csrf_token,
      )) as Collection;
      setCollection(c);
      setPayload(normalize(c));
      setDirty(false);
      setNotice("Brouillon enregistré. Vous pouvez continuer.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!collection || !me) return;
    setBusy(true);
    setError("");
    try {
      const c = (await api(
        "/collections/" + collection.id + "/submit",
        "POST",
        { version: collection.version, confirmed },
        me.csrf_token,
      )) as Collection;
      setCollection(c);
      setNotice("Informations transmises à votre client pour revue humaine.");
      setConfirmed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function logout() {
    if (
      dirty &&
      !window.confirm(
        "Des modifications ne sont pas enregistrées. Fermer quand même cet accès ?",
      )
    )
      return;
    setBusy(true);
    try {
      await api("/logout", "POST", undefined, me?.csrf_token);
      setMe(null);
      setCollection(null);
      setPayload({ company: emptyCompany, products: [] });
      setDirty(false);
      setNotice("Accès fermé. Demandez un nouveau lien pour revenir.");
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function company<K extends keyof CompanyDraft>(
    key: K,
    value: CompanyDraft[K],
  ) {
    setPayload((p) => ({ ...p, company: { ...p.company, [key]: value } }));
    setDirty(true);
    setNotice("");
    setConfirmed(false);
  }
  function product(
    index: number,
    key: keyof DeclaredProduct,
    value: string | null,
  ) {
    setPayload((p) => ({
      ...p,
      products: p.products.map((v, i) =>
        i === index ? { ...v, [key]: value } : v,
      ),
    }));
    setDirty(true);
    setNotice("");
    setConfirmed(false);
  }
  const editable =
    collection && ["DRAFT", "CHANGES_REQUESTED"].includes(collection.status);
  const catalogue: Catalogue = {
    countries: me?.countries.map((code) => ({ code, name: code })) || [],
    commodities: me?.commodities || [],
    units: ["KG", "T", "M3", "PCS"],
  };
  return (
    <div className="portal-page">
      <header className="portal-header">
        <Link href="/" className="brand">
          <span className="portal-mark" aria-hidden="true">
            ↟
          </span>
          <span>
            GeoForest <strong>Trace</strong>
            <small>PORTAIL FOURNISSEUR</small>
          </span>
        </Link>
        <span className="status neutral">Accès privé</span>
      </header>
      <main className="portal-main">
        {loading ? (
          <section className="portal-card">
            <p>Vérification de votre accès…</p>
          </section>
        ) : !me ? (
          <section className="portal-card portal-intro">
            <span className="eyebrow">UNE COLLECTE SIMPLE ET SÉCURISÉE</span>
            <h1>Partageons les bonnes informations.</h1>
            <p>
              Votre client vous invite à renseigner votre organisation et vos
              produits. Aucun compte à créer.
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
            {hasToken ? (
              <>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void open()}
                >
                  {busy ? "Ouverture…" : "Ouvrir mon espace sécurisé"}
                </button>
                <p className="caption">
                  Le lien est à usage unique. Ouvrez-le uniquement si vous êtes
                  le destinataire autorisé. Ne le partagez pas.
                </p>
              </>
            ) : (
              <div className="callout">
                Pour ouvrir cet espace, utilisez le lien sécurisé transmis par
                votre client. Un lien utilisé, expiré ou révoqué doit être
                remplacé.
              </div>
            )}
            <p className="caption">
              La collecte initiale ne vaut pas déclaration EUDR ni certification
              de conformité.
            </p>
          </section>
        ) : (
          <>
            <div className="portal-welcome">
              <span className="eyebrow">POUR {me.organization_name}</span>
              <h1>Bonjour, {me.supplier_name}.</h1>
              <p>
                Renseignez votre activité à votre rythme. Vos informations
                seront relues par votre client.
              </p>
              <div className="portal-meta">
                <span>
                  Accès valable jusqu’au{" "}
                  {new Date(me.expires_at).toLocaleString("fr-FR")}
                </span>
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => void logout()}
                >
                  Fermer mon accès
                </button>
              </div>
            </div>
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
            {collection ? (
              <>
                <section className="portal-progress">
                  <div>
                    <strong>{collection.completeness.percent} %</strong>
                    <span> de la collecte initiale enregistrée</span>
                    <span className="status neutral">
                      {statusLabels[collection.status]}
                    </span>
                  </div>
                  <progress
                    value={collection.completeness.percent}
                    max={100}
                    aria-label="Complétude de la collecte initiale"
                  />
                  <small>
                    Ce pourcentage n’est pas un taux de conformité EUDR.
                    {dirty ? " Modifications non enregistrées." : ""}
                  </small>
                </section>
                <nav
                  className="portal-steps"
                  aria-label="Étapes de la collecte"
                >
                  {[
                    "Mon organisation",
                    "Mes produits",
                    "Vérification & envoi",
                  ].map((name, i) => (
                    <button
                      key={name}
                      className={step === i ? "active" : ""}
                      aria-current={step === i ? "step" : undefined}
                      onClick={() => setStep(i)}
                    >
                      <span>{i + 1}</span>
                      {name}
                    </button>
                  ))}
                </nav>
                {collection.status === "CHANGES_REQUESTED" && (
                  <div className="callout warning">
                    <strong>Votre client demande des corrections.</strong>
                    <p>{collection.review_note}</p>
                  </div>
                )}
                {!editable && (
                  <div className="callout">
                    <strong>
                      {collection.status === "REVIEWED"
                        ? "Collecte relue par votre client."
                        : "Collecte transmise, en attente de revue."}
                    </strong>
                    <p>
                      {collection.review_note ||
                        "Cette version est figée. Votre client peut demander des corrections."}{" "}
                      Aucune déclaration aux autorités n’a été effectuée.
                    </p>
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void load().catch((e) => setError(e.message))
                      }
                    >
                      Actualiser le statut
                    </button>
                  </div>
                )}
                <section className="portal-card">
                  <fieldset
                    disabled={!editable || busy}
                    className="portal-fields"
                  >
                    {step === 0 && (
                      <>
                        <span className="eyebrow">ÉTAPE 1 SUR 3</span>
                        <h2>Votre organisation</h2>
                        <p className="muted">
                          * Informations nécessaires avant l’envoi. Vous pouvez
                          enregistrer un brouillon incomplet.
                        </p>
                        <label>
                          Nom de l’organisation *
                          <input
                            value={payload.company.name}
                            maxLength={200}
                            onChange={(e) => company("name", e.target.value)}
                          />
                        </label>
                        <CountrySelect
                          name="country"
                          label="Pays"
                          catalogue={catalogue}
                          value={payload.company.country || ""}
                          onChange={(v) => company("country", v || null)}
                        />
                        <label>
                          Adresse *
                          <textarea
                            rows={3}
                            maxLength={1000}
                            value={payload.company.address}
                            onChange={(e) => company("address", e.target.value)}
                          />
                        </label>
                        <label>
                          Nom du contact *
                          <input
                            maxLength={200}
                            value={payload.company.contact_name}
                            onChange={(e) =>
                              company("contact_name", e.target.value)
                            }
                          />
                        </label>
                        <label>
                          Email de contact *
                          <input
                            type="email"
                            maxLength={320}
                            value={payload.company.email}
                            onChange={(e) => company("email", e.target.value)}
                          />
                        </label>
                        <label>
                          Téléphone
                          <input
                            type="tel"
                            maxLength={50}
                            value={payload.company.phone}
                            onChange={(e) => company("phone", e.target.value)}
                          />
                        </label>
                        <label>
                          Type d’organisation
                          <select
                            value={payload.company.legal_type}
                            onChange={(e) =>
                              company("legal_type", e.target.value)
                            }
                          >
                            <option value="unknown">À préciser</option>
                            <option value="cooperative">Coopérative</option>
                            <option value="company">Entreprise</option>
                            <option value="individual">
                              Producteur individuel
                            </option>
                          </select>
                        </label>
                      </>
                    )}
                    {step === 1 && (
                      <>
                        <span className="eyebrow">ÉTAPE 2 SUR 3</span>
                        <h2>Vos produits</h2>
                        <p className="muted">
                          Ajoutez au moins un produit. Les quantités sont
                          déclaratives et ne constituent pas des lots validés.
                        </p>
                        {payload.products.map((p, i) => (
                          <article className="portal-product" key={i}>
                            <div className="section-heading">
                              <h3>Produit {i + 1}</h3>
                              <button
                                className="text-button danger-text"
                                onClick={() => {
                                  setPayload((v) => ({
                                    ...v,
                                    products: v.products.filter(
                                      (_, idx) => idx !== i,
                                    ),
                                  }));
                                  setDirty(true);
                                  setConfirmed(false);
                                }}
                              >
                                Retirer
                              </button>
                            </div>
                            <label>
                              Nom du produit *
                              <input
                                maxLength={200}
                                value={p.name}
                                onChange={(e) =>
                                  product(i, "name", e.target.value)
                                }
                              />
                            </label>
                            <label>
                              Matière déclarée *
                              <select
                                value={p.commodity || ""}
                                onChange={(e) =>
                                  product(
                                    i,
                                    "commodity",
                                    e.target.value || null,
                                  )
                                }
                              >
                                <option value="">Sélectionner…</option>
                                {catalogue.commodities.map((c) => (
                                  <option key={c.code} value={c.code}>
                                    {c.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="form-grid">
                              <label>
                                Quantité *
                                <input
                                  inputMode="decimal"
                                  value={p.quantity || ""}
                                  onChange={(e) =>
                                    product(
                                      i,
                                      "quantity",
                                      e.target.value || null,
                                    )
                                  }
                                  placeholder="Ex. 2500,5"
                                />
                              </label>
                              <label>
                                Unité *
                                <select
                                  value={p.unit}
                                  onChange={(e) =>
                                    product(i, "unit", e.target.value)
                                  }
                                >
                                  {catalogue.units.map((u) => (
                                    <option key={u} value={u}>
                                      {u}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <CountrySelect
                              name={"origin-" + i}
                              label="Pays de production déclaré"
                              catalogue={catalogue}
                              value={p.origin_country || ""}
                              onChange={(v) =>
                                product(i, "origin_country", v || null)
                              }
                            />
                          </article>
                        ))}
                        {payload.products.length < 20 && (
                          <button
                            className="button secondary"
                            onClick={() => {
                              setPayload((v) => ({
                                ...v,
                                products: [
                                  ...v.products,
                                  {
                                    name: "",
                                    commodity: null,
                                    quantity: null,
                                    unit: "KG",
                                    origin_country: null,
                                  },
                                ],
                              }));
                              setDirty(true);
                            }}
                          >
                            + Ajouter un produit
                          </button>
                        )}
                        <p className="caption">
                          20 produits maximum par collecte. Le rattachement aux
                          parcelles sera disponible ultérieurement.
                        </p>
                      </>
                    )}
                    {step === 2 && (
                      <>
                        <span className="eyebrow">ÉTAPE 3 SUR 3</span>
                        <h2>Vérifier avant de transmettre</h2>
                        <p>
                          <strong>
                            {payload.company.name ||
                              "Organisation à renseigner"}
                          </strong>{" "}
                          · {payload.products.length} produit(s) déclaré(s)
                        </p>
                        <p className="muted">
                          Relisez les deux premières étapes. Les informations
                          transmises sont conservées dans un historique ; elles
                          ne remplacent pas automatiquement les fiches de votre
                          client.
                        </p>
                        <div className="callout">
                          Cette collecte initiale ne contient ni parcelles ni
                          documents. Les propositions de parcelles se gèrent
                          séparément ci-dessous. Leur absence n’est pas une
                          preuve de conformité.
                        </div>
                        {collection.completeness.missing.length > 0 && (
                          <div className="callout warning">
                            La dernière version enregistrée est incomplète.
                            Complétez l’identité, le contact et au moins un
                            produit avec sa quantité, son unité, sa matière et
                            son pays de production.
                          </div>
                        )}
                        <label className="checkbox-label confirmation">
                          <input
                            type="checkbox"
                            checked={confirmed}
                            onChange={(e) => setConfirmed(e.target.checked)}
                          />
                          <span>
                            Je confirme avoir relu ces informations et les
                            transmettre à mon client. Ceci n’est pas une
                            déclaration réglementaire EUDR.
                          </span>
                        </label>
                      </>
                    )}
                  </fieldset>
                  <div className="portal-actions">
                    {editable && (
                      <button
                        className="button secondary"
                        disabled={busy || !dirty}
                        onClick={() => void save()}
                      >
                        {busy ? "Enregistrement…" : "Enregistrer mon brouillon"}
                      </button>
                    )}
                    {step < 2 ? (
                      <button
                        className="button primary"
                        onClick={() => setStep((v) => v + 1)}
                      >
                        Continuer →
                      </button>
                    ) : (
                      editable && (
                        <button
                          className="button primary"
                          disabled={
                            busy ||
                            dirty ||
                            !confirmed ||
                            collection.completeness.percent < 100
                          }
                          onClick={() => void submit()}
                        >
                          Transmettre à mon client
                        </button>
                      )
                    )}
                  </div>
                  {dirty && (
                    <p className="caption">
                      Enregistrez vos modifications avant de transmettre ou de
                      quitter cet espace.
                    </p>
                  )}
                </section>
              </>
            ) : (
              <div className="callout">
                Aucune collecte disponible. Contactez votre client.
              </div>
            )}
          </>
        )}
        {me && (
          <PortalPlots
            key={me.supplier_name + me.csrf_token}
            csrf={me.csrf_token}
            catalogue={catalogue}
          />
        )}
        <footer className="portal-footer">
          GeoForest Trace · Les données saisies sont déclaratives.
          <br />
          Ni certification juridique, ni déclaration automatique aux autorités.
        </footer>
      </main>
    </div>
  );
}
