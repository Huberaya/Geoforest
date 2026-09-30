"use client";

import { useAuth } from "@/context/AuthContext";
import { COMMODITIES } from "@/lib/eudr/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [form, setForm] = useState({
    // Step 1: Admin
    name: "Alexandre Martin",
    email: "a.martin@bioagro-europe.com",
    password: "PasswordSecure2026!",
    jobTitle: "Directeur Achats & Conformité",
    // Step 2: Company
    companyName: "BioAgro Europe SAS",
    eori: "FR998877665544",
    vatNumber: "FR88998877665",
    country: "FR",
    address: "28 rue de Châteaudun, 75009 Paris",
    operatorType: "OPERATOR", // OPERATOR (Imprimeur/Metteur sur marché) ou TRADER
    // Step 3: Commodities
    selectedCommodities: ["cocoa", "coffee"] as string[],
    estimatedVolumeTonnes: 1200,
    // Step 4: Plan
    plan: "PRO",
  });

  const toggleCommodity = (val: string) => {
    setForm((prev) => ({
      ...prev,
      selectedCommodities: prev.selectedCommodities.includes(val)
        ? prev.selectedCommodities.filter((c) => c !== val)
        : [...prev.selectedCommodities, val],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      await register({
        name: form.name,
        email: form.email,
        companyName: form.companyName,
        eori: form.eori,
        country: form.country,
      });

      router.push("/");
    } catch {
      setError("Une erreur est survenue lors de l'enregistrement de l'organisation.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0D5B41]/10 via-slate-50 to-emerald-50 flex items-center justify-center p-4 font-sans">
      <div className="w-full max-w-xl space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#0D5B41] text-white text-2xl shadow-md">
            🌿
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">GeoForest Trace</h1>
          <p className="text-xs font-semibold text-[#0D5B41] uppercase tracking-wider">
            Inscription Opérateur / Commerçant EUDR (UE 2023/1115)
          </p>
        </div>

        {/* Wizard Card */}
        <div className="rounded-3xl border border-slate-200 bg-white p-7 shadow-lg space-y-6">
          {/* Header & Steps Indicator */}
          <div>
            <div className="flex items-center justify-between text-xs font-bold text-slate-500 mb-2">
              <span className="text-slate-900">Étape {step} sur 4</span>
              <span className="text-[#0D5B41]">
                {step === 1 && "1. Administrateur du compte"}
                {step === 2 && "2. Entité Légale & EORI"}
                {step === 3 && "3. Filières & Commodities"}
                {step === 4 && "4. Choix de l'abonnement"}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-[#0D5B41] transition-all duration-300"
                style={{ width: `${(step / 4) * 100}%` }}
              />
            </div>
          </div>

          {error && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 p-3 text-xs text-rose-700 font-semibold">
              ⚠️ {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            {/* STEP 1 : Administrateur */}
            {step === 1 && (
              <div className="space-y-3.5">
                <div className="border-b pb-2">
                  <h3 className="font-bold text-slate-900 text-sm">Informations de votre compte</h3>
                  <p className="text-slate-500 text-[11px]">Créez l'accès de l'administrateur principal de la plateforme.</p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Nom complet *</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Email professionnel *</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Fonction / Titre *</label>
                  <input
                    type="text"
                    required
                    value={form.jobTitle}
                    onChange={(e) => setForm({ ...form, jobTitle: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Mot de passe sécurisé *</label>
                  <input
                    type="password"
                    required
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                  />
                  <span className="text-[10px] text-slate-400 mt-0.5 block">
                    Minimum 8 caractères dont une majuscule et un chiffre.
                  </span>
                </div>
              </div>
            )}

            {/* STEP 2 : Entité Légale & EORI */}
            {step === 2 && (
              <div className="space-y-3.5">
                <div className="border-b pb-2">
                  <h3 className="font-bold text-slate-900 text-sm">Structure & Identification Douanière</h3>
                  <p className="text-slate-500 text-[11px]">Renseignez les données légales qui figureront sur les déclarations TRACES-NT.</p>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Raison sociale complète *</label>
                  <input
                    type="text"
                    required
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Numéro EORI (Douane UE) *</label>
                    <input
                      type="text"
                      required
                      value={form.eori}
                      onChange={(e) => setForm({ ...form, eori: e.target.value.toUpperCase() })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none font-mono"
                      placeholder="ex: FR123456789"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Pays du siège social *</label>
                    <input
                      type="text"
                      required
                      value={form.country}
                      onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none uppercase"
                    />
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Adresse légale du siège *</label>
                  <input
                    type="text"
                    required
                    value={form.address}
                    onChange={(e) => setForm({ ...form, address: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Statut au titre de l'EUDR *</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, operatorType: "OPERATOR" })}
                      className={`p-2.5 rounded-xl border text-left transition ${
                        form.operatorType === "OPERATOR"
                          ? "border-[#0D5B41] bg-emerald-50/50 text-[#0D5B41] font-bold"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      <div className="text-xs">Opérateur</div>
                      <div className="text-[10px] text-slate-400 font-normal">Mise sur le marché UE / Export</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setForm({ ...form, operatorType: "TRADER" })}
                      className={`p-2.5 rounded-xl border text-left transition ${
                        form.operatorType === "TRADER"
                          ? "border-[#0D5B41] bg-emerald-50/50 text-[#0D5B41] font-bold"
                          : "border-slate-200 text-slate-600"
                      }`}
                    >
                      <div className="text-xs">Commerçant / Négociant</div>
                      <div className="text-[10px] text-slate-400 font-normal">Distribution en aval (PME / GE)</div>
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3 : Commodities & Filières */}
            {step === 3 && (
              <div className="space-y-3.5">
                <div className="border-b pb-2">
                  <h3 className="font-bold text-slate-900 text-sm">Matières premières concernées</h3>
                  <p className="text-slate-500 text-[11px]">Sélectionnez les commodités que vous importez ou transformez.</p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {COMMODITIES.map((c) => {
                    const isSelected = form.selectedCommodities.includes(c.value);
                    return (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => toggleCommodity(c.value)}
                        className={`p-2.5 rounded-xl border text-left flex items-center justify-between transition ${
                          isSelected
                            ? "border-[#0D5B41] bg-emerald-50/60 text-[#0D5B41] font-bold"
                            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <div>
                          <div className="text-xs">{c.label}</div>
                          <div className="text-[10px] text-slate-400 font-mono">SH: {c.hsCode}</div>
                        </div>
                        <span className="text-xs">{isSelected ? "✓" : "+"}</span>
                      </button>
                    );
                  })}
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Volume annuel estimé (tonnes métriques)</label>
                  <input
                    type="number"
                    min={1}
                    value={form.estimatedVolumeTonnes}
                    onChange={(e) => setForm({ ...form, estimatedVolumeTonnes: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none font-mono"
                  />
                </div>
              </div>
            )}

            {/* STEP 4 : Plan d'abonnement */}
            {step === 4 && (
              <div className="space-y-3.5">
                <div className="border-b pb-2">
                  <h3 className="font-bold text-slate-900 text-sm">Formule d'abonnement & Essai 14 jours</h3>
                  <p className="text-slate-500 text-[11px]">Tous les plans incluent un essai gratuit de 14 jours sans engagement.</p>
                </div>

                <div className="space-y-2.5">
                  {[
                    {
                      id: "STARTER",
                      name: "Starter EUDR",
                      price: "490 € / mois",
                      desc: "Jusqu'à 1 000 parcelles, portail producteur mobile et exports XML TRACES-NT.",
                    },
                    {
                      id: "PRO",
                      name: "Pro Entreprise (Recommandé)",
                      price: "1 290 € / mois",
                      badge: "Populaire",
                      desc: "Jusqu'à 10 000 parcelles, analyses Sentinel-2 / Hansen illimitées, multi-utilisateurs RBAC.",
                    },
                    {
                      id: "ENTERPRISE",
                      name: "Enterprise Multi-Sites",
                      price: "Sur devis",
                      desc: "Parcelles illimitées, connecteur ERP SAP/Odoo dédié, SLA 99.9% et support juridique.",
                    },
                  ].map((p) => (
                    <div
                      key={p.id}
                      onClick={() => setForm({ ...form, plan: p.id })}
                      className={`p-3.5 rounded-2xl border cursor-pointer transition ${
                        form.plan === p.id
                          ? "border-[#0D5B41] bg-emerald-50/40 shadow-xs ring-1 ring-[#0D5B41]"
                          : "border-slate-200 bg-white hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <input
                            type="radio"
                            name="plan"
                            checked={form.plan === p.id}
                            onChange={() => setForm({ ...form, plan: p.id })}
                            className="accent-[#0D5B41]"
                          />
                          <span className="font-bold text-slate-900">{p.name}</span>
                        </div>
                        <span className="font-bold text-[#0D5B41]">{p.price}</span>
                      </div>
                      <p className="text-[11px] text-slate-500 mt-1 pl-5">{p.desc}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 border border-slate-100">
                  ✓ En créant votre compte, vous acceptez les Conditions Générales d'Utilisation et la Politique de protection des données conformes RGPD et EUDR.
                </div>
              </div>
            )}

            {/* Navigation Buttons */}
            <div className="flex items-center justify-between pt-3 border-t">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                >
                  ← Précédent
                </button>
              ) : (
                <Link href="/login" className="text-xs text-slate-500 hover:underline">
                  Déjà un compte ? Se connecter
                </Link>
              )}

              {step < 4 ? (
                <button
                  type="button"
                  onClick={() => setStep(step + 1)}
                  className="rounded-xl bg-[#0D5B41] px-5 py-2.5 font-bold text-white shadow-xs hover:bg-[#0a4833]"
                >
                  Continuer ➔
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-[#0D5B41] px-6 py-2.5 font-bold text-white shadow-md hover:bg-[#0a4833] disabled:opacity-50"
                >
                  {loading ? "Création du tenant..." : "Finaliser & Accéder au Cockpit 🚀"}
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
