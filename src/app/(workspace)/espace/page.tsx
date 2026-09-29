"use client";
import Link from "next/link";
import { useAuthSession } from "@/components/auth/AuthSession";
import { DiligenceWorkspace } from "@/components/diligence/DiligenceWorkspace";
import { DocumentsWorkspace } from "@/components/documents/DocumentsWorkspace";
import { ComplianceWorkspace } from "@/components/documents/ComplianceWorkspace";
import { PlotsWorkspace } from "@/components/plots/PlotsWorkspace";
import { SupplyWorkspace } from "@/components/supply/SupplyWorkspace";
import { useEffect, useState, type FormEvent } from "react";

type Org = {
  id: string;
  name: string;
  version: number;
  role: string;
  supplier_id: string | null;
};
type Me = {
  user: { id: string; email: string; name: string };
  csrf_token: string;
  organizations: Org[];
  environment: string;
  admin_mfa_required: boolean;
  admin_mfa_satisfied: boolean;
};
type Member = {
  user_id: string;
  email: string;
  display_name: string;
  role: string;
  supplier_id: string | null;
};
type Audit = {
  id: string;
  action: string;
  created_at: string;
  actor_id: string | null;
  actor_kind: "user" | "supplier";
  supplier_actor_id: string | null;
  previous_value: unknown;
  new_value: unknown;
};
const roles = [
  "Admin",
  "Compliance Manager",
  "Procurement",
  "Analyst",
  "Viewer",
  "Supplier",
];
const actions: Record<string, string> = {
  "supplier.created": "Fournisseur créé",
  "supplier.updated": "Fournisseur modifié",
  "supplier.archived": "Fournisseur archivé",
  "supplier.imported": "Fournisseur importé",
  "contact.created": "Contact ajouté",
  "contact.updated": "Contact modifié",
  "contact.removed": "Contact retiré",
  "product.created": "Produit créé",
  "product.updated": "Produit modifié",
  "product.archived": "Produit archivé",
  "lot.created": "Lot créé",
  "lot.updated": "Lot modifié",
  "lot.archived": "Lot archivé",
  "supplier.invitation_created":
    "Lien fournisseur créé (transmission manuelle)",
  "supplier.invitation_revoked": "Accès fournisseur révoqué",
  "supplier.portal_opened": "Portail fournisseur ouvert",
  "supplier.collection_saved": "Brouillon fournisseur enregistré",
  "supplier.collection_submitted": "Collecte fournisseur transmise",
  "supplier.collection_reviewed": "Revue humaine de collecte",
  "organization.created": "Organisation créée",
  "organization.updated": "Organisation modifiée",
  "membership.created": "Membre ajouté",
  "membership.updated": "Accès modifié",
  "membership.removed": "Accès retiré",
};
function Mark() {
  return (
    <svg
      width="30"
      height="34"
      viewBox="0 0 30 34"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 2 3 21h7L6 28h18l-4-7h7L15 2Z"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <path d="M15 15v19" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
    shield: "M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Z M8 12l3 3 5-6",
    users:
      "M16 21v-3a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v3 M9 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-3a4 4 0 0 0-3-4 M17 3a4 4 0 0 1 0 7",
    map: "m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Z M9 3v16 M15 5v16",
    file: "M14 2H4v20h16V8L14 2Z M14 2v6h6 M8 13h8 M8 17h5",
    clock: "M12 8v5l3 2 M21 12a9 9 0 1 0-18 0 9 9 0 0 0 18 0",
    arrow: "M5 12h14 M13 6l6 6-6 6",
    settings: "M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  };
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name] || paths.file} />
    </svg>
  );
}

export default function Home() {
  const authSession = useAuthSession();
  const [me, setMe] = useState<Me | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [selected, setSelected] = useState(""),
    [view, setView] = useState("overview"),
    [busy, setBusy] = useState(false),
    [members, setMembers] = useState<Member[]>([]),
    [events, setEvents] = useState<Audit[]>([]),
    [dataLoading, setDataLoading] = useState(false),
    [revision, setRevision] = useState(0);
  const org = me?.organizations.find((o) => o.id === selected);
  const admin = org?.role === "Admin" && me?.admin_mfa_satisfied;
  const canAudit = org?.role === "Compliance Manager" || admin;
  async function api(path: string, method = "GET", body?: unknown) {
    const res = await fetch("/api/v1" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": me?.csrf_token || "",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401) {
      setMe(null);
      throw new Error("Votre session a expiré. Reconnectez-vous.");
    }
    if (!res.ok) {
      const d = await res.json();
      throw new Error(
        typeof d.detail === "string"
          ? d.detail
          : "Vérifiez les informations saisies.",
      );
    }
    return res.status === 204 ? null : res.json();
  }
  async function refresh(preferred?: string) {
    const data = await api("/me");
    setMe(data);
    setSelected((old) => preferred || old || data.organizations[0]?.id || "");
    setRevision((r) => r + 1);
  }
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/v1/me", { signal: controller.signal })
      .then(async (r) => {
        if (r.status === 401) return null;
        if (!r.ok)
          throw new Error(
            "Le service est indisponible. Réessayez dans quelques instants.",
          );
        return r.json();
      })
      .then((data) => {
        if (!controller.signal.aborted) {
          setMe(data);
          setSelected(data?.organizations[0]?.id || "");
          if (new URLSearchParams(window.location.search).has("auth_error"))
            setError(
              "Connexion non aboutie. Vérifiez votre compte et votre adresse email, puis réessayez.",
            );
        }
      })
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [authSession.generation]);
  useEffect(() => {
    if (!selected || !me) return;
    const c = new AbortController();
    async function load() {
      setDataLoading(true);
      setMembers([]);
      setEvents([]);
      try {
        const get = async (path: string) => {
          const r = await fetch("/api/v1/organizations/" + selected + path, {
            signal: c.signal,
          });
          if (!r.ok)
            throw new Error(
              "Impossible de charger cet espace. Vérifiez vos permissions ou rechargez la page.",
            );
          return r.json();
        };
        const [m, a] = await Promise.all([
          admin ? get("/members") : Promise.resolve([]),
          canAudit ? get("/audit") : Promise.resolve([]),
        ]);
        if (!c.signal.aborted) {
          setMembers(m);
          setEvents(a);
        }
      } catch (e) {
        if (!c.signal.aborted) setError((e as Error).message);
      } finally {
        if (!c.signal.aborted) setDataLoading(false);
      }
    }
    void load();
    return () => c.abort();
  }, [selected, admin, canAudit, me, revision]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = new FormData(form).get("name");
    await run(async () => {
      const data = await api("/organizations", "POST", { name });
      await refresh(data.id);
      setView("overview");
      setNotice("Votre organisation a été créée.");
      form.reset();
    });
  }
  async function rename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const name = new FormData(e.currentTarget).get("name");
    await run(async () => {
      await api("/organizations/" + selected, "PATCH", {
        name,
        version: org?.version,
      });
      await refresh();
      setNotice("Les paramètres ont été enregistrés.");
    });
  }
  async function member(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget,
      d = new FormData(form);
    await run(async () => {
      await api("/organizations/" + selected + "/members", "PUT", {
        email: d.get("email"),
        role: d.get("role"),
        supplier_id: d.get("supplier_id") || null,
      });
      await refresh();
      setNotice("Les permissions ont été enregistrées.");
      form.reset();
    });
  }
  async function logout() {
    await run(async () => {
      if (authSession.provider === "clerk_development") {
        await authSession.logout();
        return;
      }
      const r = await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "X-CSRF-Token": me?.csrf_token || "" },
      });
      if (!r.ok) throw new Error("Déconnexion impossible. Réessayez.");
      setMe(null);
      setSelected("");
      setMembers([]);
      setEvents([]);
      setNotice(
        "Session GeoForest fermée. Votre session chez le fournisseur d’identité peut rester ouverte.",
      );
    });
  }
  const feedback = (
    <>
      {error && (
        <div role="alert" className="message error">
          {error}
          <button onClick={() => setError("")} aria-label="Fermer le message">
            ×
          </button>
        </div>
      )}
      {notice && (
        <div role="status" className="message success">
          {notice}
        </div>
      )}
    </>
  );
  if (loading)
    return (
      <main className="loading">
        <Mark />
        <p>Ouverture de votre espace sécurisé…</p>
      </main>
    );
  if (!me)
    return (
      <main className="login">
        <div className="login-story">
          <Link className="brand" href="/">
            <Mark />
            <span>
              GeoForest<span className="brand-light"> Trace</span>
            </span>
          </Link>
          <div className="story-copy">
            <span className="eyebrow">
              TRAÇABILITÉ · RESPONSABILITÉ · CONFIANCE
            </span>
            <h1>
              La diligence raisonnée
              <br />
              commence par des
              <br />
              <em>données protégées.</em>
            </h1>
            <p>
              Un espace de travail pour organiser votre démarche EUDR. Chaque
              entreprise conserve le contrôle de ses accès et de ses
              informations.
            </p>
            <div className="story-line">
              <Icon name="shield" /> Accès authentifié <span>·</span> Accès par
              organisation
            </div>
          </div>
          <div className="contours" aria-hidden="true">
            <svg viewBox="0 0 600 300">
              <g fill="none" stroke="currentColor">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                  <ellipse
                    key={i}
                    cx="380"
                    cy="300"
                    rx={90 + i * 28}
                    ry={70 + i * 21}
                    transform="rotate(-25 380 300)"
                  />
                ))}
              </g>
            </svg>
          </div>
          <footer>
            GEOFOREST TRACE <span>Conçu pour la diligence raisonnée</span>
          </footer>
        </div>
        <section className="login-panel">
          <div className="login-box">
            <span className="badge neutral">
              ESPACE PRIVÉ · DILIGENCE ASSISTÉE
            </span>
            <h2>
              Bienvenue dans
              <br />
              votre espace.
            </h2>
            <p className="muted">
              Connectez-vous avec le fournisseur d’identité de votre
              organisation.
            </p>
            {feedback}
            <a className="button primary login-button" href="/api/auth/login">
              Se connecter en toute sécurité <Icon name="arrow" />
            </a>
            <div className="login-note">
              <Icon name="shield" />
              <p>
                Vos identifiants restent chez votre fournisseur d’identité.
                GeoForest ne stocke aucun mot de passe.
              </p>
            </div>
            <div className="phase-note">
              <strong>Des décisions humaines documentées</strong>
              <p>
                Collecte, observations indicatives et dossiers internes selon
                les modules activés. Aucun dépôt aux autorités ni certification
                automatique.
              </p>
            </div>
            <span className="help">
              Besoin d’un accès ? Contactez votre administrateur.
            </span>
          </div>
        </section>
      </main>
    );
  return (
    <div className="shell">
      <a className="skip" href="#main">
        Aller au contenu
      </a>
      <aside className="sidebar">
        <Link className="brand" href="/">
          <Mark />
          <span>
            GeoForest<span className="brand-light"> Trace</span>
          </span>
        </Link>
        <div className="workspace-label">ESPACE DE TRAVAIL</div>
        <label className="sr-only" htmlFor="org-select">
          Organisation active
        </label>
        <select
          id="org-select"
          className="org-select"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            setError("");
            setNotice("");
            setView("overview");
          }}
        >
          <option value="" disabled>
            Choisir une organisation
          </option>
          {me.organizations.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <nav aria-label="Navigation principale">
          <button
            className={view === "overview" ? "active" : ""}
            onClick={() => setView("overview")}
          >
            <Icon name="grid" />
            Vue d’ensemble
          </button>
          <div className="nav-label">VOTRE CHAÎNE D’APPROVISIONNEMENT</div>
          {[
            ["users", "Fournisseurs", "suppliers"],
            ["file", "Produits", "products"],
            ["grid", "Lots", "lots"],
            ["map", "Parcelles", "plots"],
            ["file", "Documents", "documents"],
            ["shield", "Légalité & risque", "compliance"],
            ["shield", "Diligence raisonnée", "diligence"],
          ]
            .filter(
              ([, , id]) => id !== "diligence" || org?.role !== "Supplier",
            )
            .map(([icon, label, id]) => (
              <button
                key={id}
                disabled={
                  !org ||
                  (["compliance", "diligence"].includes(id) &&
                    org.role === "Supplier")
                }
                className={view === id ? "active" : ""}
                onClick={() => setView(id)}
              >
                <Icon name={icon} />
                {label}
              </button>
            ))}
          <div className="nav-label">ADMINISTRATION</div>
          <button
            className={view === "members" ? "active" : ""}
            disabled={!admin}
            onClick={() => setView("members")}
          >
            <Icon name="users" />
            Membres & accès
          </button>
          <button
            className={view === "audit" ? "active" : ""}
            disabled={!canAudit}
            onClick={() => setView("audit")}
          >
            <Icon name="clock" />
            Journal d’activité
          </button>
          <button
            className={view === "settings" ? "active" : ""}
            disabled={!admin}
            onClick={() => setView("settings")}
          >
            <Icon name="settings" />
            Paramètres
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="security-note">
            <Icon name="shield" />
            <div>
              Votre espace, vos données
              <small>Accès limités par organisation</small>
            </div>
          </div>
          <button
            className="profile"
            onClick={logout}
            disabled={busy}
            title="Fermer la session GeoForest"
          >
            <span className="avatar">
              {me.user.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              {me.user.name}
              <small>Se déconnecter ↗</small>
            </span>
          </button>
        </div>
      </aside>
      <div className="content">
        <header className="topbar">
          <div>
            Organisation <span>/</span>{" "}
            <strong>{org?.name || "Première configuration"}</strong>
          </div>
          <span className="badge neutral">
            <span className="dot" />
            {me.environment === "production"
              ? "Production"
              : "Environnement de développement"}
          </span>
        </header>
        <main id="main" className="main">
          {![
            "suppliers",
            "products",
            "lots",
            "plots",
            "documents",
            "compliance",
            "diligence",
          ].includes(view) && (
            <div className="page-heading">
              <div>
                <span className="eyebrow">VOTRE ESPACE GEOFOREST</span>
                <h1>
                  {view === "members"
                    ? "Membres & accès"
                    : view === "audit"
                      ? "Journal d’activité"
                      : view === "settings"
                        ? "Paramètres"
                        : "Vue d’ensemble"}
                </h1>
                <p className="muted">
                  {view === "overview"
                    ? "Posez les bases de votre démarche de diligence raisonnée."
                    : "Gérez votre organisation avec des actions traçables."}
                </p>
              </div>
              {org && <span className="badge role">{org.role}</span>}
            </div>
          )}
          {feedback}
          {org && view === "documents" && (
            <DocumentsWorkspace
              key={org.id}
              org={org.id}
              csrf={me.csrf_token}
              writable={Boolean(
                admin ||
                ["Compliance Manager", "Procurement"].includes(org.role),
              )}
              reviewer={Boolean(canAudit)}
            />
          )}
          {org && view === "compliance" && org.role !== "Supplier" && (
            <ComplianceWorkspace
              key={org.id}
              org={org.id}
              csrf={me.csrf_token}
              reviewer={Boolean(canAudit)}
            />
          )}
          {org && view === "diligence" && org.role !== "Supplier" && (
            <DiligenceWorkspace
              key={org.id}
              org={org.id}
              csrf={me.csrf_token}
              role={org.role}
            />
          )}
          {org && view === "plots" && (
            <PlotsWorkspace
              key={org.id}
              org={org.id}
              csrf={me.csrf_token}
              role={org.role}
              writable={Boolean(
                admin ||
                ["Compliance Manager", "Procurement"].includes(org.role),
              )}
            />
          )}
          {org && ["suppliers", "products", "lots"].includes(view) && (
            <SupplyWorkspace
              key={org.id + view}
              kind={view as "suppliers" | "products" | "lots"}
              org={org.id}
              role={org.role}
              csrf={me.csrf_token}
              writable={Boolean(
                admin ||
                ["Compliance Manager", "Procurement"].includes(org.role),
              )}
            />
          )}
          {!me.admin_mfa_satisfied && (
            <div className="message warning">
              Une authentification renforcée est requise pour administrer cet
              espace. <a href="/api/auth/login">Renforcer ma connexion</a>
            </div>
          )}
          {view === "overview" && (
            <>
              <section className="welcome">
                <div>
                  <span className="badge light">ÉTAPE 02 / 08</span>
                  <h2>
                    Des partenaires identifiés.
                    <br />
                    Une collecte qui avance.
                  </h2>
                  <p>
                    Référencez vos fournisseurs, reliez vos produits et vos
                    lots, puis invitez vos contacts à compléter leur collecte
                    initiale.
                  </p>
                  <button
                    className="button white"
                    disabled={!org}
                    onClick={() => setView("suppliers")}
                  >
                    Ouvrir les fournisseurs <Icon name="arrow" />
                  </button>
                </div>
                <div className="welcome-emblem" aria-hidden="true">
                  <Icon name="shield" />
                  <span>
                    COLLECTE
                    <br />& TRAÇABILITÉ
                  </span>
                  <div className="orbit one" />
                  <div className="orbit two" />
                </div>
              </section>
              <div className="stat-grid">
                <article className="stat">
                  <span className="stat-icon">
                    <Icon name="users" />
                  </span>
                  <span className="muted">Organisations accessibles</span>
                  <strong>
                    {me.organizations.length.toString().padStart(2, "0")}
                  </strong>
                  <small>Selon vos appartenances</small>
                </article>
                <article className="stat">
                  <span className="stat-icon">
                    <Icon name="shield" />
                  </span>
                  <span className="muted">Authentification</span>
                  <strong className="word-stat">OIDC</strong>
                  <small>Session serveur révocable</small>
                </article>
                <article className="stat">
                  <span className="stat-icon">
                    <Icon name="clock" />
                  </span>
                  <span className="muted">Traçabilité</span>
                  <strong className="word-stat">
                    {canAudit ? "Journal actif" : "Accès limité"}
                  </strong>
                  <small>
                    {canAudit
                      ? "Actions et collectes enregistrées"
                      : "Selon votre rôle dans cet espace"}
                  </small>
                </article>
              </div>
              <div className="two-col">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Votre parcours de mise en place</h2>
                    <span className="muted">Le socle d’abord</span>
                  </div>
                  <ol className="steps">
                    <li className="done">
                      <span>✓</span>
                      <div>
                        <strong>Vérifier votre identité</strong>
                        <p>Connexion via un fournisseur d’identité.</p>
                      </div>
                      <span className="badge green">Terminé</span>
                    </li>
                    <li className={org ? "done" : ""}>
                      <span>{org ? "✓" : "2"}</span>
                      <div>
                        <strong>Créer votre organisation</strong>
                        <p>Un espace distinct pour votre entreprise.</p>
                      </div>
                      {org && <span className="badge green">Terminé</span>}
                    </li>
                    <li>
                      <span>3</span>
                      <div>
                        <strong>Définir les accès de votre équipe</strong>
                        <p>Attribuez un rôle adapté à chaque membre.</p>
                      </div>
                    </li>
                    <li>
                      <span>4</span>
                      <div>
                        <strong>Collecter les données fournisseurs</strong>
                        <p>
                          Fiches, produits, lots et portail sécurisé
                          disponibles.
                        </p>
                      </div>
                    </li>
                  </ol>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Créer un nouvel espace</h2>
                    <Icon name="grid" />
                  </div>
                  <p className="muted">
                    Une organisation dispose de ses propres membres et
                    paramètres.
                  </p>
                  <form onSubmit={create}>
                    <label htmlFor="org-name">Nom de l’organisation</label>
                    <input
                      id="org-name"
                      name="name"
                      required
                      minLength={2}
                      maxLength={160}
                      placeholder="Ex. Coopérative Démo"
                    />
                    <button
                      disabled={busy || !me.admin_mfa_satisfied}
                      className="button primary"
                    >
                      {busy ? "Enregistrement…" : "Créer l’organisation"}
                      <span>+</span>
                    </button>
                  </form>
                  <p className="caption">
                    Vous deviendrez administrateur de cet espace. Aucun
                    fournisseur ni dossier fictif ne sera créé.
                  </p>
                </section>
              </div>
              <section className="disclaimer">
                <Icon name="file" />
                <div>
                  <strong>
                    Des fonctions disponibles, sans promesse réglementaire
                    prématurée.
                  </strong>
                  <p>
                    Aucune analyse de déforestation, certification de conformité
                    ou transmission aux autorités n’est réalisée dans ce
                    chantier.
                  </p>
                </div>
                <span className="badge neutral">En construction</span>
              </section>
            </>
          )}
          {view === "settings" && org && admin && (
            <section className="panel narrow">
              <h2>Identité de l’organisation</h2>
              <form key={org.id + org.version} onSubmit={rename}>
                <label htmlFor="rename">Nom</label>
                <input
                  id="rename"
                  name="name"
                  defaultValue={org.name}
                  required
                  minLength={2}
                  maxLength={160}
                />
                <button className="button primary" disabled={busy}>
                  Enregistrer les modifications
                </button>
              </form>
              <p className="caption">
                Version {org.version} · Les modifications sont enregistrées dans
                le journal.
              </p>
              <p className="caption">Identifiant : {org.id}</p>
            </section>
          )}
          {view === "members" && admin && (
            <>
              <section className="panel">
                <div className="panel-heading">
                  <h2>Équipe de l’organisation</h2>
                  <span className="badge neutral">
                    {dataLoading
                      ? "Chargement…"
                      : `${members.length} membre(s)`}
                  </span>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Membre</th>
                        <th>Rôle</th>
                        <th>Périmètre fournisseur</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {members.map((m) => (
                        <tr key={m.user_id}>
                          <td>
                            <strong>{m.display_name}</strong>
                            <small>{m.email}</small>
                          </td>
                          <td>
                            <span className="badge role">{m.role}</span>
                          </td>
                          <td>
                            <small>{m.supplier_id || "Organisation"}</small>
                          </td>
                          <td>
                            <button
                              className="text-button danger"
                              disabled={busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Retirer les accès de ce membre ?",
                                  )
                                )
                                  void run(async () => {
                                    await api(
                                      "/organizations/" +
                                        selected +
                                        "/members/" +
                                        m.user_id,
                                      "DELETE",
                                    );
                                    await refresh();
                                    setNotice("Accès retiré.");
                                  });
                              }}
                            >
                              Retirer
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="panel narrow member-form">
                <h2>Ajouter ou modifier un accès</h2>
                <p className="muted">
                  Le membre doit s’être connecté une première fois avec une
                  adresse email vérifiée. Les invitations seront ajoutées au
                  chantier 2.
                </p>
                <form onSubmit={member}>
                  <label htmlFor="member-email">Email du compte</label>
                  <input
                    id="member-email"
                    type="email"
                    name="email"
                    required
                    maxLength={320}
                  />
                  <label htmlFor="member-role">Rôle</label>
                  <select id="member-role" name="role" defaultValue="Viewer">
                    {roles.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                  <label htmlFor="supplier-scope">
                    Identifiant de périmètre fournisseur
                  </label>
                  <input
                    id="supplier-scope"
                    name="supplier_id"
                    placeholder="UUID — uniquement pour le rôle Supplier"
                  />
                  <p className="caption">
                    Obligatoire uniquement pour Supplier : UUID d’une fiche
                    active de cette organisation. Pour le portail sans compte,
                    créez plutôt un lien sécurisé depuis la fiche fournisseur.
                  </p>
                  <button className="button primary" disabled={busy}>
                    Enregistrer les permissions
                  </button>
                </form>
              </section>
            </>
          )}
          {view === "audit" && canAudit && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Historique de l’organisation</h2>
                <span className="muted">50 événements les plus récents</span>
              </div>
              {dataLoading ? (
                <p>Chargement du journal…</p>
              ) : events.length === 0 ? (
                <p className="empty">Aucun événement à afficher.</p>
              ) : (
                <div className="timeline">
                  {events.map((e) => (
                    <article key={e.id}>
                      <span className="event-icon">
                        <Icon name="clock" />
                      </span>
                      <div>
                        <strong>{actions[e.action] || e.action}</strong>
                        <small>
                          {new Date(e.created_at).toLocaleString("fr-FR")} ·
                          Auteur :{" "}
                          {e.actor_kind === "supplier"
                            ? "Portail fournisseur · " + e.supplier_actor_id
                            : e.actor_id}
                        </small>
                        <details>
                          <summary>Voir les valeurs avant / après</summary>
                          <pre>
                            {JSON.stringify(
                              { avant: e.previous_value, après: e.new_value },
                              null,
                              2,
                            )}
                          </pre>
                        </details>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              <p className="caption">
                Journal non modifiable par l’application. Il ne constitue pas un
                archivage inviolable face à un administrateur de base de
                données.
              </p>
            </section>
          )}
        </main>
        <footer className="main-footer">
          <span>© GeoForest Trace</span>
          <span>Chantier 07 · Dossiers de diligence</span>
        </footer>
      </div>
    </div>
  );
}
