"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import {
  type SupplierPortalProfile,
  type SupplierPortalProfileUpdate,
  type UserPublic,
  acceptSupplierMagicLink,
  clearStoredAuth,
  fetchMe,
  getSupplierPortalProfile,
  requestSupplierMagicLink,
  updateSupplierPortalProfile,
} from "@/lib/api";

const EDITABLE_FIELDS: Array<{
  key: keyof SupplierPortalProfileUpdate;
  label: string;
  placeholder: string;
  multiline?: boolean;
}> = [
  { key: "legal_name", label: "Raison sociale", placeholder: "Nom légal de l'entreprise" },
  { key: "address", label: "Adresse", placeholder: "Adresse du siège ou du site", multiline: true },
  { key: "region", label: "Région", placeholder: "Région / province" },
  { key: "phone", label: "Téléphone général", placeholder: "+33…" },
  { key: "contact_name", label: "Nom du contact", placeholder: "Nom et prénom" },
  { key: "contact_phone", label: "Téléphone du contact", placeholder: "+33…" },
  { key: "tax_id", label: "Identifiant fiscal", placeholder: "Numéro fiscal" },
  { key: "registration_number", label: "Numéro d'immatriculation", placeholder: "Registre de commerce…" },
  { key: "eori", label: "Numéro EORI", placeholder: "Ex. FR12345678900000" },
];

type View = "booting" | "public" | "portal" | "operator";
type EditableKey = keyof SupplierPortalProfileUpdate;
type EditableValues = Record<EditableKey, string>;

function editableFromProfile(profile: SupplierPortalProfile): EditableValues {
  return {
    legal_name: profile.legal_name || "",
    address: profile.address || "",
    region: profile.region || "",
    phone: profile.phone || "",
    contact_name: profile.contact_name || "",
    contact_phone: profile.contact_phone || "",
    tax_id: profile.tax_id || "",
    registration_number: profile.registration_number || "",
    eori: profile.eori || "",
  };
}

export default function SupplierPortalPage() {
  const { setUser: setAuthUser } = useAuth();
  const [view, setView] = useState<View>("booting");
  const [user, setUser] = useState<UserPublic | null>(null);
  const [profile, setProfile] = useState<SupplierPortalProfile | null>(null);
  const [values, setValues] = useState<EditableValues | null>(null);
  const [email, setEmail] = useState("");
  const [requestSent, setRequestSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const bootStarted = useRef(false);

  useEffect(() => {
    if (bootStarted.current) return;
    bootStarted.current = true;
    let alive = true;

    async function boot() {
      const fragment = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      const token = new URLSearchParams(fragment).get("token");
      if (token) {
        // Le secret est dans le fragment (jamais envoyé au serveur) ; on l'efface avant l'appel API.
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
        setBusy(true);
        try {
          const tokens = await acceptSupplierMagicLink(token);
          if (tokens.user.role !== "supplier") throw new Error("Ce lien n'ouvre pas un compte fournisseur.");
          const nextProfile = await getSupplierPortalProfile();
          if (!alive) return;
          setUser(tokens.user);
          setAuthUser(tokens.user);
          setProfile(nextProfile);
          setValues(editableFromProfile(nextProfile));
          setView("portal");
        } catch (err) {
          if (alive) {
            setError(err instanceof Error ? err.message : "Lien expiré ou déjà utilisé.");
            setView("public");
          }
        } finally {
          if (alive) setBusy(false);
        }
        return;
      }

      if (!window.localStorage.getItem("gft_access_token")) {
        if (alive) setView("public");
        return;
      }

      try {
        const currentUser = await fetchMe();
        if (!alive) return;
        if (currentUser.role === "supplier") {
          const currentProfile = await getSupplierPortalProfile();
          if (!alive) return;
          setUser(currentUser);
          setAuthUser(currentUser);
          setProfile(currentProfile);
          setValues(editableFromProfile(currentProfile));
          setView("portal");
        } else {
          setUser(currentUser);
          setAuthUser(currentUser);
          setView("operator");
        }
      } catch {
        if (alive) setView("public");
      }
    }

    void boot();
    return () => {
      alive = false;
    };
  }, []);

  async function onRequestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await requestSupplierMagicLink(email);
      setNotice(response.message);
      setRequestSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "La demande n'a pas pu être envoyée.");
    } finally {
      setBusy(false);
    }
  }

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!values) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const payload = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key, value.trim() || null]),
    ) as SupplierPortalProfileUpdate;
    try {
      const updated = await updateSupplierPortalProfile(payload);
      setProfile(updated);
      setValues(editableFromProfile(updated));
      setNotice("Votre profil a été enregistré.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  }

  function signOut() {
    clearStoredAuth();
    setAuthUser(null);
    setUser(null);
    setProfile(null);
    setValues(null);
    setView("public");
    setRequestSent(false);
    setNotice("Vous êtes déconnecté.");
    setError(null);
  }

  if (view === "booting") {
    return <main className="flex min-h-screen items-center justify-center p-6 text-sm text-slate-500">Ouverture du portail sécurisé…</main>;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3" aria-label="GeoForest Trace">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-700 text-xl text-white">🌿</span>
            <span>
              <span className="block text-lg font-bold text-slate-900">GeoForest Trace</span>
              <span className="block text-xs uppercase tracking-[0.16em] text-slate-500">Portail fournisseur</span>
            </span>
          </Link>
          {view === "portal" && (
            <button className="btn-secondary btn" type="button" onClick={signOut}>Se déconnecter</button>
          )}
        </header>

        {error && (
          <div role="alert" className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        )}
        {notice && (
          <div role="status" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
        )}

        {view === "public" && (
          <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
            <section className="rounded-3xl bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-800 p-8 text-white shadow-xl sm:p-10">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-200">Espace partenaire</div>
              <h1 className="mt-4 max-w-xl text-3xl font-bold leading-tight sm:text-4xl">Complétez les informations de votre entreprise.</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 text-emerald-50/90">
                Cet espace vous permet de vérifier et compléter les coordonnées de votre entreprise transmises par votre partenaire commercial. Vos modifications sont enregistrées dans un journal d'audit.
              </p>
              <div className="mt-8 rounded-2xl border border-white/15 bg-white/10 p-4 text-sm leading-6 text-emerald-50">
                Pour protéger votre compte, la connexion se fait avec un lien personnel à usage unique envoyé à l'adresse enregistrée par votre partenaire.
              </div>
              <div className="mt-8 text-xs text-emerald-100/75">Les informations de complétude sont un repère de saisie et ne constituent pas une certification de conformité EUDR.</div>
            </section>

            <section className="card self-start p-6 sm:p-8">
              <h2 className="text-xl font-bold text-slate-900">Recevoir un lien sécurisé</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">Saisissez l'adresse email communiquée à votre partenaire. Si elle correspond à un compte fournisseur actif, un lien sera envoyé lorsque l'email est configuré.</p>
              <form className="mt-6 space-y-4" onSubmit={onRequestLink}>
                <div>
                  <label className="label" htmlFor="supplier-email">Adresse email</label>
                  <input id="supplier-email" className="input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="vous@entreprise.com" />
                </div>
                <button type="submit" className="btn btn-primary w-full" disabled={busy || requestSent}>
                  {busy ? "Envoi…" : requestSent ? "Demande prise en compte" : "M'envoyer un lien"}
                </button>
              </form>
              <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Vous n'avez pas reçu d'invitation ? Contactez l'opérateur qui gère votre dossier. N'envoyez jamais votre lien de connexion à une autre personne.</p>
              <Link href="/auth/login" className="mt-5 inline-block text-xs font-semibold text-emerald-700 hover:underline">Accès opérateur →</Link>
            </section>
          </div>
        )}

        {view === "operator" && (
          <section className="card mx-auto max-w-xl p-8 text-center">
            <div className="text-4xl">🏢</div>
            <h1 className="mt-4 text-2xl font-bold text-slate-900">Compte opérateur détecté</h1>
            <p className="mt-2 text-sm text-slate-600">Cette page est réservée aux comptes fournisseur. Ouvrez votre espace opérateur ou déconnectez-vous pour suivre un lien d'invitation.</p>
            <div className="mt-6 flex justify-center gap-3">
              <Link href="/dashboard" className="btn btn-primary">Espace opérateur</Link>
              <button className="btn btn-secondary" onClick={signOut}>Se déconnecter</button>
            </div>
          </section>
        )}

        {view === "portal" && profile && values && (
          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
              <div className="flex flex-col justify-between gap-6 sm:flex-row sm:items-start">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Mon espace</div>
                  <h1 className="mt-2 text-3xl font-bold text-slate-900">{profile.name}</h1>
                  <p className="mt-2 text-sm text-slate-600">{profile.legal_name || "Raison sociale à compléter"} · {profile.country}</p>
                  {user?.email && <p className="mt-1 text-xs text-slate-500">Connecté en tant que {user.email}</p>}
                </div>
                <div className="min-w-44 rounded-2xl bg-slate-50 px-4 py-3 text-sm">
                  <div className="text-xs text-slate-500">Statut du fournisseur</div>
                  <div className="mt-1 font-semibold capitalize text-slate-800">{profile.status}</div>
                </div>
              </div>
            </section>

            <section className="grid gap-6 lg:grid-cols-[300px_1fr]">
              <aside className="card h-fit">
                <div className="flex items-end justify-between gap-3">
                  <div>
                    <h2 className="font-semibold text-slate-900">Complétude du profil</h2>
                    <p className="mt-1 text-xs text-slate-500">Repère de saisie uniquement</p>
                  </div>
                  <span className="text-2xl font-bold text-emerald-700">{profile.completeness_percent}%</span>
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-emerald-600 transition-all" style={{ width: `${profile.completeness_percent}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">{profile.completeness_completed} élément(s) sur {profile.completeness_total}</p>
                <ul className="mt-5 space-y-3">
                  {profile.completeness_items.map((item) => (
                    <li key={item.key} className="flex items-center gap-2 text-xs">
                      <span className={item.complete ? "text-emerald-600" : "text-slate-300"}>{item.complete ? "●" : "○"}</span>
                      <span className={item.complete ? "text-slate-700" : "text-slate-500"}>{item.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-5 border-t border-slate-100 pt-4 text-[11px] leading-5 text-slate-500">L'indicateur mesure uniquement la présence de certains champs. Il n'évalue ni le risque réel ni la conformité réglementaire.</p>
              </aside>

              <form className="card space-y-5" onSubmit={onSave}>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Informations de l'entreprise</h2>
                  <p className="mt-1 text-sm text-slate-500">Seuls les champs affichés ci-dessous peuvent être modifiés depuis ce portail.</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="label" htmlFor="supplier-name">Nom fournisseur</label>
                    <input id="supplier-name" className="input" value={profile.name} disabled />
                  </div>
                  <div>
                    <label className="label" htmlFor="supplier-type">Type d'organisation</label>
                    <input id="supplier-type" className="input" value={profile.supplier_type} disabled />
                  </div>
                  <div>
                    <label className="label" htmlFor="supplier-country">Pays</label>
                    <input id="supplier-country" className="input" value={profile.country} disabled />
                  </div>
                  <div>
                    <label className="label" htmlFor="supplier-contact-email">Email de contact</label>
                    <input id="supplier-contact-email" className="input" value={profile.contact_email || ""} disabled />
                  </div>
                  {EDITABLE_FIELDS.map((field) => (
                    <div key={field.key} className={field.multiline ? "sm:col-span-2" : ""}>
                      <label className="label" htmlFor={`supplier-${field.key}`}>{field.label}</label>
                      {field.multiline ? (
                        <textarea id={`supplier-${field.key}`} className="input min-h-24 resize-y" value={values[field.key]} placeholder={field.placeholder} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
                      ) : (
                        <input id={`supplier-${field.key}`} className="input" value={values[field.key]} placeholder={field.placeholder} onChange={(event) => setValues({ ...values, [field.key]: event.target.value })} />
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
                  <p className="max-w-lg text-xs leading-5 text-slate-500">Le niveau de risque affiché ({profile.risk_label}) est défini et suivi par l'opérateur, pas par ce formulaire.</p>
                  <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer mon profil"}</button>
                </div>
              </form>
            </section>
          </div>
        )}

        <footer className="mt-8 text-center text-[11px] text-slate-400">GeoForest Trace · Portail sécurisé · Les accès sont personnels et à usage limité.</footer>
      </div>
    </main>
  );
}
