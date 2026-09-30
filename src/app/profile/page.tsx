"use client";

import { useAuth } from "@/context/AuthContext";
import { useState } from "react";

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const [name, setName] = useState(user?.name || "Marie Dupont");
  const [jobTitle, setJobTitle] = useState(user?.jobTitle || "Lead EUDR & Responsable Conformité RSE");
  const [preferredLanguage, setPreferredLanguage] = useState(user?.preferredLanguage || "fr");
  const [emailNotifications, setEmailNotifications] = useState(user?.emailNotifications ?? true);
  const [satelliteAlerts, setSatelliteAlerts] = useState(user?.satelliteAlerts ?? true);
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    updateUser({
      name,
      jobTitle,
      preferredLanguage,
      emailNotifications,
      satelliteAlerts,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 font-sans">
      <div className="border-b pb-3">
        <h1 className="text-xl font-extrabold text-slate-900 tracking-tight">Mon Profil Utilisateur</h1>
        <p className="text-xs text-slate-500">
          Gérez vos informations personnelles, préférences linguistiques et notifications d'alertes EUDR.
        </p>
      </div>

      {saved && (
        <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-3 text-xs font-bold text-emerald-800">
          ✓ Profil mis à jour avec succès !
        </div>
      )}

      <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-6">
        <div className="flex items-center gap-4 border-b pb-4">
          <div className="h-16 w-16 rounded-2xl bg-[#0D5B41] text-white flex items-center justify-center font-bold text-xl shadow-md">
            {user?.avatar || "MD"}
          </div>
          <div>
            <h2 className="text-base font-extrabold text-slate-900">{user?.name}</h2>
            <div className="text-xs text-slate-500">{user?.email}</div>
            <div className="text-[11px] font-bold text-[#0D5B41] mt-0.5">
              {user?.organizationName} • {user?.jobTitle}
            </div>
          </div>
        </div>

        <form onSubmit={handleSave} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Nom complet *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Email professionnel (identifiant)</label>
            <input
              type="email"
              disabled
              value={user?.email}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-500 font-mono cursor-not-allowed"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Titre du poste / Fonction *</label>
            <input
              type="text"
              required
              value={jobTitle}
              onChange={(e) => setJobTitle(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">Langue de l'interface</label>
            <select
              value={preferredLanguage}
              onChange={(e) => setPreferredLanguage(e.target.value)}
              className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
            >
              <option value="fr">Français (FR)</option>
              <option value="en">English (EU / US)</option>
              <option value="es">Español</option>
              <option value="pt">Português</option>
            </select>
          </div>

          <div className="space-y-2 pt-2 border-t">
            <span className="font-bold text-slate-900 block text-xs">Préférences de Notification</span>
            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={satelliteAlerts}
                onChange={(e) => setSatelliteAlerts(e.target.checked)}
                className="rounded accent-[#0D5B41]"
              />
              <span>Recevoir les alertes de survol satellite en temps réel (perte de canopée GFW / Sentinel-2)</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer text-slate-700">
              <input
                type="checkbox"
                checked={emailNotifications}
                onChange={(e) => setEmailNotifications(e.target.checked)}
                className="rounded accent-[#0D5B41]"
              />
              <span>Recevoir les relances documentaires et échéances de déclarations TRACES-NT</span>
            </label>
          </div>

          <div className="flex justify-end pt-3 border-t">
            <button
              type="submit"
              className="rounded-xl bg-[#0D5B41] px-5 py-2.5 font-bold text-white shadow-xs hover:bg-[#0a4833]"
            >
              Enregistrer mon profil
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
