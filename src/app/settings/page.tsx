"use client";

import { useAuth } from "@/context/AuthContext";
import { useState } from "react";

export default function SettingsPage() {
  const { organization, user, updateOrganization, switchOrganization, availableOrganizations } = useAuth();
  const [activeTab, setActiveTab] = useState<"org" | "team" | "api" | "security" | "billing">("org");
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Form states
  const [orgForm, setOrgForm] = useState({
    name: organization?.name || "Entreprise SA",
    eori: organization?.eori || "FR123456789",
    country: organization?.country || "FR",
    address: organization?.address || "12 rue de la Paix, 75002 Paris, France",
    vatNumber: organization?.vatNumber || "FR32123456789",
  });

  const [apiKeys, setApiKeys] = useState([
    {
      id: "key-01",
      name: "Connecteur ERP SAP Production",
      prefix: "gf_live_98ab42...",
      createdAt: "2026-01-10",
      lastUsed: "Il y a 2 minutes",
    },
    {
      id: "key-02",
      name: "Intégration WMS Logistique Anvers",
      prefix: "gf_live_33cd71...",
      createdAt: "2026-03-15",
      lastUsed: "Il y a 3 heures",
    },
  ]);

  const [teamMembers, setTeamMembers] = useState([
    {
      id: "tm-1",
      name: "Marie Dupont",
      email: "marie.dupont@entreprise-sa.fr",
      role: "ADMIN_OPERATOR",
      roleLabel: "Administrateur Opérateur",
      status: "ACTIVE",
    },
    {
      id: "tm-2",
      name: "Julien Moreau",
      email: "j.moreau@entreprise-sa.fr",
      role: "COMPLIANCE_OFFICER",
      roleLabel: "Responsable Conformité EUDR",
      status: "ACTIVE",
    },
    {
      id: "tm-3",
      name: "Clara Benali",
      email: "c.benali@entreprise-sa.fr",
      role: "AUDITOR",
      roleLabel: "Auditeur Interne",
      status: "ACTIVE",
    },
  ]);

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("COMPLIANCE_OFFICER");

  const handleSaveOrg = (e: React.FormEvent) => {
    e.preventDefault();
    updateOrganization(orgForm);
    setSavedMessage("Paramètres de l'organisation sauvegardés avec succès !");
    setTimeout(() => setSavedMessage(null), 3000);
  };

  const handleAddMember = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail) return;
    setTeamMembers((prev) => [
      ...prev,
      {
        id: `tm-${Date.now()}`,
        name: inviteEmail.split("@")[0].replace(".", " "),
        email: inviteEmail,
        role: inviteRole,
        roleLabel:
          inviteRole === "ADMIN_OPERATOR"
            ? "Administrateur Opérateur"
            : inviteRole === "COMPLIANCE_OFFICER"
            ? "Responsable Conformité EUDR"
            : "Auditeur",
        status: "ACTIVE",
      },
    ]);
    setShowInviteModal(false);
    setInviteEmail("");
  };

  return (
    <div className="space-y-6 font-sans">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Paramètres de l'Organisation</h1>
          <p className="text-xs text-slate-500">
            Gestion du compte multi-tenant, référentiel EORI, sécurité et connecteurs TRACES-NT
          </p>
        </div>

        {/* Tenant Switcher dropdown */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-slate-500">Tenant actif :</span>
          <select
            value={organization?.id}
            onChange={(e) => switchOrganization(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-800 shadow-2xs focus:border-[#0D5B41] focus:outline-none"
          >
            {availableOrganizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name} ({org.eori})
              </option>
            ))}
          </select>
        </div>
      </div>

      {savedMessage && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
          ✓ {savedMessage}
        </div>
      )}

      {/* Navigation Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2 text-xs overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab("org")}
          className={`px-3 py-1.5 rounded-xl font-bold transition ${
            activeTab === "org"
              ? "bg-[#0D5B41] text-white shadow-2xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          🏢 Organisation & EORI
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("team")}
          className={`px-3 py-1.5 rounded-xl font-bold transition ${
            activeTab === "team"
              ? "bg-[#0D5B41] text-white shadow-2xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          👥 Équipe & Rôles ({teamMembers.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("api")}
          className={`px-3 py-1.5 rounded-xl font-bold transition ${
            activeTab === "api"
              ? "bg-[#0D5B41] text-white shadow-2xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          🔑 Clés API & TRACES-NT
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("security")}
          className={`px-3 py-1.5 rounded-xl font-bold transition ${
            activeTab === "security"
              ? "bg-[#0D5B41] text-white shadow-2xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          🛡️ Sécurité & Rétention 5 ans
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("billing")}
          className={`px-3 py-1.5 rounded-xl font-bold transition ${
            activeTab === "billing"
              ? "bg-[#0D5B41] text-white shadow-2xs"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          💳 Abonnement & Quotas
        </button>
      </div>

      {/* TAB 1 : Organisation & EORI */}
      {activeTab === "org" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
          <div className="border-b pb-3">
            <h2 className="text-sm font-extrabold text-slate-900">Identification Légale de l'Opérateur</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Ces données sont transmises aux autorités compétentes européennes lors de l'envoi des déclarations de diligence raisonnée.
            </p>
          </div>

          <form onSubmit={handleSaveOrg} className="space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Raison sociale complète *</label>
                <input
                  type="text"
                  required
                  value={orgForm.name}
                  onChange={(e) => setOrgForm({ ...orgForm, name: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Numéro EORI (Douane UE) *</label>
                <input
                  type="text"
                  required
                  value={orgForm.eori}
                  onChange={(e) => setOrgForm({ ...orgForm, eori: e.target.value.toUpperCase() })}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none font-mono"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Pays du siège social *</label>
                <input
                  type="text"
                  required
                  value={orgForm.country}
                  onChange={(e) => setOrgForm({ ...orgForm, country: e.target.value.toUpperCase() })}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none uppercase"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Numéro de TVA Intracommunautaire</label>
                <input
                  type="text"
                  value={orgForm.vatNumber}
                  onChange={(e) => setOrgForm({ ...orgForm, vatNumber: e.target.value })}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Adresse postale légale *</label>
              <input
                type="text"
                required
                value={orgForm.address}
                onChange={(e) => setOrgForm({ ...orgForm, address: e.target.value })}
                className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
              />
            </div>

            <div className="flex justify-end pt-3 border-t">
              <button
                type="submit"
                className="rounded-xl bg-[#0D5B41] px-5 py-2.5 text-xs font-bold text-white shadow-xs hover:bg-[#0a4833]"
              >
                Sauvegarder les modifications
              </button>
            </div>
          </form>
        </div>
      )}

      {/* TAB 2 : Équipe & Rôles */}
      {activeTab === "team" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">Membres et Accès RBAC</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Contrôle d'accès basé sur les rôles conforme aux exigences de conformité et de séparation des tâches.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowInviteModal(true)}
              className="rounded-xl bg-[#0D5B41] px-3.5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-[#0a4833] flex items-center gap-1.5"
            >
              <span>+</span>
              <span>Inviter un collaborateur</span>
            </button>
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 border-b text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">Utilisateur</th>
                  <th className="px-4 py-3">Rôle</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {teamMembers.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{m.name}</div>
                      <div className="text-[10px] text-slate-400">{m.email}</div>
                    </td>
                    <td className="px-4 py-3 font-semibold text-slate-700">{m.roleLabel}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                        {m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => alert(`Modifier les autorisations de ${m.name}`)}
                        className="text-slate-400 hover:text-slate-700 font-semibold"
                      >
                        Gérer →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3 : Clés API & Connecteurs TRACES-NT */}
      {activeTab === "api" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <h2 className="text-sm font-extrabold text-slate-900">Clés API & Intégrations Systèmes</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Connectez vos ERP (SAP, Oracle, Odoo) et configurez les passerelles Web Services TRACES-NT.
              </p>
            </div>
            <button
              type="button"
              onClick={() =>
                setApiKeys((prev) => [
                  ...prev,
                  {
                    id: `key-${Date.now()}`,
                    name: "Nouvelle clé API ERP",
                    prefix: "gf_live_" + Math.random().toString(36).substring(2, 8) + "...",
                    createdAt: new Date().toISOString().split("T")[0],
                    lastUsed: "Jamais",
                  },
                ])
              }
              className="rounded-xl bg-[#0D5B41] px-3.5 py-2 text-xs font-bold text-white shadow-2xs hover:bg-[#0a4833]"
            >
              + Générer une clé API
            </button>
          </div>

          <div className="space-y-3">
            {apiKeys.map((k) => (
              <div key={k.id} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-slate-900">{k.name}</div>
                  <div className="font-mono text-[11px] text-slate-500 mt-0.5">{k.prefix}</div>
                  <div className="text-[10px] text-slate-400 mt-1">
                    Créée le {k.createdAt} • Dernière activité : {k.lastUsed}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setApiKeys(apiKeys.filter((item) => item.id !== k.id))}
                  className="rounded-lg border border-rose-200 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700 hover:bg-rose-50"
                >
                  Révoquer
                </button>
              </div>
            ))}
          </div>

          {/* TRACES-NT Web Services Connector Config */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <div className="flex items-center justify-between border-b pb-2">
              <span className="font-bold text-slate-900 text-xs">🏛️ Passerelle TRACES-NT (Commission Européenne)</span>
              <span className="rounded bg-emerald-100 px-2 py-0.5 text-[9px] font-bold text-emerald-800">
                Connecteur Prêt
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-slate-600 mb-1">Environnement TRACES</label>
                <select className="w-full rounded-xl border border-slate-200 p-2 text-xs">
                  <option>TRACES-NT Production (EU DG ENV)</option>
                  <option>TRACES-NT Bac à sable (Acceptance Test)</option>
                </select>
              </div>
              <div>
                <label className="block text-slate-600 mb-1">Identifiant Client API TRACES</label>
                <input
                  type="text"
                  defaultValue="TRACES-CLIENT-ENTREPRISE-SA"
                  className="w-full rounded-xl border border-slate-200 p-2 text-xs font-mono"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4 : Sécurité & Rétention 5 ans */}
      {activeTab === "security" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
          <div className="border-b pb-3">
            <h2 className="text-sm font-extrabold text-slate-900">Conformité Article 12 & Sécurité des Données</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              L'article 12 du Règlement (UE) 2023/1115 impose la conservation de toutes les preuves et données de diligence raisonnée pendant 5 ans.
            </p>
          </div>

          <div className="space-y-4 text-xs">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 space-y-2">
              <div className="font-bold text-emerald-950 flex items-center gap-2">
                <span>✓</span>
                <span>Politique d'Archivage Légal 5 Ans Active</span>
              </div>
              <p className="text-emerald-900 text-[11px] leading-relaxed">
                Toutes les géométries parcellaires, analyses satellites Copernicus/Hansen, titres de propriété et déclarations signées sont archivés dans un stockage immuable avec scellement cryptographique d'intégrité (SHA-256).
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
              <div className="font-bold text-slate-900">Double Authentification (2FA / TOTP)</div>
              <p className="text-slate-500 text-[11px]">
                Renforcez la sécurité de votre organisation en exigeant l'utilisation d'une application d'authentification (Google Authenticator, Microsoft Authenticator) pour tous les administrateurs.
              </p>
              <button
                type="button"
                onClick={() => alert("Génération du QR Code 2FA...")}
                className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
              >
                Activer le 2FA pour mon compte
              </button>
            </div>

            <div className="rounded-2xl border border-slate-200 p-4 space-y-2">
              <div className="font-bold text-slate-900">Export Intégral d'Audit (Format Réglementaire)</div>
              <p className="text-slate-500 text-[11px]">
                Téléchargez l'intégralité du registre de traçabilité et des journaux d'audit pour transmission aux autorités de contrôle nationales.
              </p>
              <button
                type="button"
                onClick={() => alert("Génération de l'archive ZIP chiffrée de conformité EUDR...")}
                className="rounded-xl bg-slate-900 px-4 py-2 font-bold text-white shadow-xs hover:bg-slate-800"
              >
                Télécharger l'archive d'audit complète (.zip)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5 : Abonnement & Quotas */}
      {activeTab === "billing" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
          <div className="border-b pb-3">
            <h2 className="text-sm font-extrabold text-slate-900">Plan d'Abonnement SaaS & Utilisation</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Suivez en temps réel la consommation de votre quota de parcelles et de requêtes satellites.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
              <div className="text-[11px] font-semibold uppercase text-slate-400">Plan Actif</div>
              <div className="text-xl font-black text-slate-900">{organization?.plan || "ENTERPRISE"}</div>
              <div className="text-[10px] text-emerald-700 font-bold">Renouvellement annuel (Actif)</div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
              <div className="text-[11px] font-semibold uppercase text-slate-400">Parcelles Gérées</div>
              <div className="text-xl font-black text-slate-900">
                {organization?.plotsUsed.toLocaleString("fr-FR")} / {organization?.plotsLimit.toLocaleString("fr-FR")}
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full rounded-full bg-[#0D5B41] w-[35%]" />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 space-y-2">
              <div className="text-[11px] font-semibold uppercase text-slate-400">Audits Satellites</div>
              <div className="text-xl font-black text-slate-900">
                {organization?.satelliteAuditsUsed.toLocaleString("fr-FR")} / {organization?.satelliteAuditsLimit.toLocaleString("fr-FR")}
              </div>
              <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                <div className="h-full rounded-full bg-[#0D5B41] w-[42%]" />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Inviter un Collaborateur */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h3 className="font-bold text-slate-900 text-sm">Inviter un collaborateur</h3>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddMember} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Email professionnel *</label>
                <input
                  type="email"
                  required
                  placeholder="collaborateur@entreprise.com"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Rôle et permissions *</label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                >
                  <option value="ADMIN_OPERATOR">Administrateur Opérateur (Accès total)</option>
                  <option value="COMPLIANCE_OFFICER">Responsable Conformité EUDR (DDR & Parcelles)</option>
                  <option value="AUDITOR">Auditeur / Contrôleur (Lecture & Revue)</option>
                  <option value="VIEWER">Lecteur Simple</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowInviteModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-[#0D5B41] px-4 py-2 font-bold text-white shadow-xs hover:bg-[#0a4833]"
                >
                  Envoyer l'invitation
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
