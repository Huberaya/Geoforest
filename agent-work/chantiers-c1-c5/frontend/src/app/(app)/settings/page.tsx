"use client";

import { type FormEvent, useEffect, useState } from "react";
import {
  type OrgUser,
  changeMyPassword,
  deactivateUser,
  listOrgUsers,
  myProfile,
  updateMyProfile,
} from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";

const ROLE_LABELS: Record<OrgUser["role"], string> = {
  admin: "Administrateur",
  compliance: "Conformité",
  procurement: "Achats",
  analyst: "Analyste",
  viewer: "Lecture seule",
  supplier: "Fournisseur",
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function SettingsPage() {
  const { user, organization, setUser, canManageUsers, isAdmin } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [locale, setLocale] = useState("fr");
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);

  const [members, setMembers] = useState<OrgUser[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState<string | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    void myProfile().then((profile) => {
      if (cancelled) return;
      setFirstName(profile.first_name || "");
      setLastName(profile.last_name || "");
      setPhone(profile.phone || "");
      setLocale(profile.locale || "fr");
      setProfileError(null);
    }).catch((err: unknown) => {
      if (!cancelled) setProfileError(err instanceof Error ? err.message : "Impossible de charger votre profil.");
    });
    return () => { cancelled = true; };
  }, [user?.id]);

  useEffect(() => {
    let cancelled = false;
    if (!canManageUsers) {
      setMembers([]);
      setMembersLoading(false);
      return () => { cancelled = true; };
    }
    setMembersLoading(true);
    setMembersError(null);
    void listOrgUsers().then((result) => {
      if (!cancelled) setMembers(result);
    }).catch((err: unknown) => {
      if (!cancelled) setMembersError(err instanceof Error ? err.message : "La liste des membres est indisponible.");
    }).finally(() => {
      if (!cancelled) setMembersLoading(false);
    });
    return () => { cancelled = true; };
  }, [canManageUsers]);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileBusy(true);
    setProfileError(null);
    setProfileMessage(null);
    try {
      const updated = await updateMyProfile({
        first_name: firstName.trim() || null,
        last_name: lastName.trim() || null,
        phone: phone.trim() || null,
        locale,
      });
      setUser(updated);
      setProfileMessage("Votre profil a été mis à jour.");
    } catch (err) {
      setProfileError(err instanceof Error ? err.message : "Impossible d’enregistrer le profil.");
    } finally {
      setProfileBusy(false);
    }
  }

  async function savePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);
    if (newPassword.length < 10) {
      setPasswordError("Le nouveau mot de passe doit comporter au moins 10 caractères.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("La confirmation ne correspond pas au nouveau mot de passe.");
      return;
    }
    setPasswordBusy(true);
    try {
      const result = await changeMyPassword({ current_password: currentPassword, new_password: newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordMessage(result.message || "Mot de passe mis à jour.");
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : "Impossible de mettre à jour le mot de passe.");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function onDeactivate(member: OrgUser) {
    if (!isAdmin || member.id === user?.id || !member.is_active) return;
    if (!window.confirm(`Désactiver le compte de ${member.email} ?`)) return;
    setDeactivatingId(member.id);
    setMembersError(null);
    try {
      await deactivateUser(member.id);
      setMembers((current) => current.map((item) => item.id === member.id ? { ...item, is_active: false } : item));
    } catch (err) {
      setMembersError(err instanceof Error ? err.message : "Impossible de désactiver ce membre.");
    } finally {
      setDeactivatingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Paramètres</h1>
        <p className="mt-1 text-sm text-slate-500">Profil personnel, sécurité du compte et informations de votre organisation.</p>
      </header>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="card">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Mon profil</h2>
            <p className="mt-1 text-xs text-slate-500">L’adresse email et le rôle sont gérés par l’organisation et ne sont pas modifiables ici.</p>
          </div>
          <form className="space-y-3" onSubmit={saveProfile}>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Prénom</span>
                <input className="input" maxLength={100} value={firstName} onChange={(event) => setFirstName(event.target.value)} />
              </label>
              <label className="space-y-1 text-sm font-medium text-slate-700">
                <span>Nom</span>
                <input className="input" maxLength={100} value={lastName} onChange={(event) => setLastName(event.target.value)} />
              </label>
            </div>
            <label className="block space-y-1 text-sm font-medium text-slate-700">
              <span>Email</span>
              <input className="input bg-slate-50" value={user?.email || ""} readOnly />
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-700">
              <span>Téléphone</span>
              <input className="input" type="tel" maxLength={50} value={phone} onChange={(event) => setPhone(event.target.value)} />
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-700">
              <span>Langue de l’interface</span>
              <select className="input" value={locale} onChange={(event) => setLocale(event.target.value)}>
                <option value="fr">Français</option>
              </select>
            </label>
            {profileError && <p role="alert" className="text-sm text-red-700">{profileError}</p>}
            {profileMessage && <p role="status" className="text-sm text-emerald-700">{profileMessage}</p>}
            <button className="btn-primary" disabled={profileBusy || !user}>{profileBusy ? "Enregistrement…" : "Enregistrer le profil"}</button>
          </form>
        </section>

        <section className="card">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-900">Sécurité du compte</h2>
            <p className="mt-1 text-xs text-slate-500">Le mot de passe actuel est vérifié avant le changement. Les mots de passe ne sont pas enregistrés dans le journal d’audit.</p>
          </div>
          <form className="space-y-3" onSubmit={savePassword}>
            <label className="block space-y-1 text-sm font-medium text-slate-700">
              <span>Mot de passe actuel</span>
              <input className="input" type="password" autoComplete="current-password" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-700">
              <span>Nouveau mot de passe</span>
              <input className="input" type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
            </label>
            <label className="block space-y-1 text-sm font-medium text-slate-700">
              <span>Confirmer le nouveau mot de passe</span>
              <input className="input" type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
            </label>
            {passwordError && <p role="alert" className="text-sm text-red-700">{passwordError}</p>}
            {passwordMessage && <p role="status" className="text-sm text-emerald-700">{passwordMessage}</p>}
            <button className="btn-primary" disabled={passwordBusy || !user}>{passwordBusy ? "Mise à jour…" : "Changer le mot de passe"}</button>
          </form>
        </section>
      </div>

      <section className="card">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Organisation</h2>
            <p className="mt-1 text-xs text-slate-500">Consultation uniquement dans ce chantier; les modifications d’informations légales ne sont pas ouvertes ici.</p>
          </div>
          {organization && <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">Plan {organization.plan}</span>}
        </div>
        {organization ? (
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <div><dt className="text-xs text-slate-500">Nom</dt><dd className="mt-1 text-sm font-medium text-slate-800">{organization.name}</dd></div>
            <div><dt className="text-xs text-slate-500">Raison sociale</dt><dd className="mt-1 text-sm font-medium text-slate-800">{organization.legal_name || "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Pays</dt><dd className="mt-1 text-sm font-medium text-slate-800">{organization.country}</dd></div>
            <div><dt className="text-xs text-slate-500">SIRET</dt><dd className="mt-1 text-sm font-medium text-slate-800">{organization.siret || "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">EORI</dt><dd className="mt-1 text-sm font-medium text-slate-800">{organization.eori || "—"}</dd></div>
            <div><dt className="text-xs text-slate-500">Email de contact</dt><dd className="mt-1 break-all text-sm font-medium text-slate-800">{organization.contact_email || "—"}</dd></div>
            <div className="sm:col-span-2 lg:col-span-3"><dt className="text-xs text-slate-500">Adresse</dt><dd className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-800">{organization.address || "—"}</dd></div>
          </dl>
        ) : (
          <p className="text-sm text-slate-500">Aucune organisation interne n’est associée à ce compte.</p>
        )}
      </section>

      {canManageUsers && (
        <section className="card">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Membres de l’organisation</h2>
              <p className="mt-1 text-xs text-slate-500">La liste est réservée aux rôles admin et conformité. Seul un admin peut désactiver un autre membre.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{members.length} membre(s)</span>
          </div>
          <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-900">
            Les invitations de nouveaux membres par email et les liens de définition de mot de passe ne sont pas disponibles dans ce chantier; aucun compte inutilisable ne sera créé depuis cette page.
          </div>
          {membersError && <p role="alert" className="mb-3 text-sm text-red-700">{membersError}</p>}
          {membersLoading ? (
            <div className="py-8 text-center text-sm text-slate-500">Chargement des membres…</div>
          ) : members.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-500">Aucun membre à afficher.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-2">Membre</th><th className="px-3 py-2">Rôle</th><th className="px-3 py-2">Dernière connexion</th><th className="px-3 py-2">État</th><th className="px-3 py-2">Action</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((member) => (
                    <tr key={member.id}>
                      <td className="px-3 py-3"><div className="font-medium text-slate-800">{[member.first_name, member.last_name].filter(Boolean).join(" ") || member.email}</div><div className="text-xs text-slate-500">{member.email}</div></td>
                      <td className="px-3 py-3 text-slate-600">{ROLE_LABELS[member.role]}</td>
                      <td className="px-3 py-3 text-xs text-slate-600">{formatDate(member.last_login_at)}</td>
                      <td className="px-3 py-3"><span className={`rounded-full px-2 py-1 text-xs ${member.is_active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{member.is_active ? "Actif" : "Désactivé"}</span></td>
                      <td className="px-3 py-3">
                        {isAdmin && member.id !== user?.id && member.is_active ? (
                          <button className="btn-secondary px-2.5 py-1 text-xs text-red-700" disabled={deactivatingId === member.id} onClick={() => void onDeactivate(member)}>
                            {deactivatingId === member.id ? "Désactivation…" : "Désactiver"}
                          </button>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
