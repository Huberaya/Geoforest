"use client";

import { COMMODITIES, COMMODITY_LABELS, type Commodity } from "@/lib/eudr/types";
import Link from "next/link";
import { useState } from "react";

export default function SupplierPortalPage() {
  const [viewMode, setViewMode] = useState<"welcome" | "wizard" | "tracking">("welcome");
  const [step, setStep] = useState(1);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const [form, setForm] = useState({
    companyName: "Coopérative Cacaoyère de Divo (COOPADI)",
    country: "CI",
    eori: "CI123456789012",
    contactName: "Kouamé Konan",
    phone: "+225 07 48 92 10",
    commodity: "cocoa" as Commodity,
    estimatedVolumeKg: 45000,
    plotName: "PLT-008742 (Divo Est)",
    plotCoordinates: "5.482100, -4.027800",
    plotAreaHa: 14.8,
    documentTitle: "Certificat Foncier Rural Coutumier 2025",
    documentExpiry: "2028-12-31",
  });

  const handleGetGps = () => {
    if (!navigator.geolocation) {
      alert("La géolocalisation n'est pas supportée par votre navigateur.");
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude.toFixed(6);
        const lon = pos.coords.longitude.toFixed(6);
        setForm((prev) => ({
          ...prev,
          plotCoordinates: `${lat}, ${lon}`,
        }));
        setGpsLoading(false);
      },
      (err) => {
        alert(`Impossible d'obtenir la position GPS : ${err.message}`);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="mx-auto max-w-md pb-12 font-sans">
      {/* Top Mobile Bar */}
      <div className="mb-4 flex items-center justify-between">
        <Link href="/" className="text-xs font-semibold text-[#0D5B41] hover:underline flex items-center gap-1">
          ← Espace Entreprise
        </Link>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-[11px] shadow-2xs font-semibold">
          <button
            type="button"
            onClick={() => setViewMode("welcome")}
            className={`rounded-md px-2 py-0.5 ${viewMode === "welcome" ? "bg-[#0D5B41] text-white" : "text-slate-600"}`}
          >
            Accueil
          </button>
          <button
            type="button"
            onClick={() => setViewMode("wizard")}
            className={`rounded-md px-2 py-0.5 ${viewMode === "wizard" ? "bg-[#0D5B41] text-white" : "text-slate-600"}`}
          >
            Formulaire
          </button>
          <button
            type="button"
            onClick={() => setViewMode("tracking")}
            className={`rounded-md px-2 py-0.5 ${viewMode === "tracking" ? "bg-[#0D5B41] text-white" : "text-slate-600"}`}
          >
            Mon Suivi
          </button>
        </div>
      </div>

      {/* VIEW 1 : WELCOME SCREEN (Mockup 5.2 Screen 1) */}
      {viewMode === "welcome" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md text-center space-y-6">
          <div className="flex items-center justify-center gap-2 pt-2">
            <span className="text-2xl">🌿</span>
            <span className="font-extrabold text-slate-900 text-sm">GeoForest Trace</span>
          </div>

          <div className="py-6 space-y-3">
            <div className="h-44 w-full rounded-2xl bg-gradient-to-br from-emerald-900 via-emerald-800 to-slate-900 flex items-center justify-center p-6 text-white text-center relative overflow-hidden shadow-inner">
              <div className="space-y-2 z-10">
                <span className="text-3xl">📱 🛰️</span>
                <h2 className="text-base font-extrabold leading-tight">Complétez votre dossier EUDR</h2>
                <p className="text-[11px] text-emerald-200 leading-relaxed">
                  En quelques étapes, transmettez vos informations, vos parcelles et vos produits.
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setViewMode("wizard")}
              className="w-full rounded-2xl bg-[#0D5B41] py-3.5 text-xs font-bold text-white shadow-md hover:bg-[#0a4833] transition"
            >
              Commencer
            </button>
            <button
              type="button"
              onClick={() => setViewMode("tracking")}
              className="text-xs text-slate-500 font-semibold hover:text-slate-900 block w-full py-1"
            >
              Besoin d'aide ? / Voir mon suivi
            </button>
          </div>
        </div>
      )}

      {/* VIEW 2 : 5-STEP WIZARD (Mockup 5.2 Screen 2) */}
      {viewMode === "wizard" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md space-y-5">
          {/* Header */}
          <div className="flex items-center justify-between border-b pb-3">
            <div>
              <span className="text-[11px] font-bold text-slate-400">Étape {step}/5</span>
              <h2 className="text-sm font-extrabold text-slate-900">
                {step === 1 && "1. Votre Entreprise"}
                {step === 2 && "2. Vos Produits"}
                {step === 3 && "Vos parcelles"}
                {step === 4 && "4. Documents de légalité"}
                {step === 5 && "5. Vérification & Accord"}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setViewMode("welcome")}
              className="text-slate-400 hover:text-slate-600 text-sm"
            >
              ✕
            </button>
          </div>

          {/* Progress Bar */}
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-[#0D5B41] transition-all duration-300"
              style={{ width: `${(step / 5) * 100}%` }}
            />
          </div>

          {submitted ? (
            <div className="py-6 text-center space-y-4">
              <div className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100 text-[#0D5B41] text-2xl font-bold">
                ✓
              </div>
              <h3 className="text-base font-bold text-slate-900">Dossier transmis !</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Vos données parcellaires sont transmises et vérifiées par l'opérateur.
              </p>
              <button
                type="button"
                onClick={() => setViewMode("tracking")}
                className="w-full rounded-2xl bg-[#0D5B41] py-3 text-xs font-bold text-white shadow-sm"
              >
                Voir mon suivi →
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 text-xs">
              {/* Step 1 : Entreprise */}
              {step === 1 && (
                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Raison sociale *</label>
                    <input
                      type="text"
                      required
                      value={form.companyName}
                      onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Pays de production *</label>
                    <input
                      type="text"
                      required
                      value={form.country}
                      onChange={(e) => setForm({ ...form, country: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none uppercase"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Contact référent *</label>
                    <input
                      type="text"
                      required
                      value={form.contactName}
                      onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Step 2 : Produits */}
              {step === 2 && (
                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Matière première récoltée *</label>
                    <select
                      value={form.commodity}
                      onChange={(e) => setForm({ ...form, commodity: e.target.value as Commodity })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                    >
                      {COMMODITIES.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Volume estimé livré par an (kg) *</label>
                    <input
                      type="number"
                      required
                      min={1}
                      value={form.estimatedVolumeKg}
                      onChange={(e) => setForm({ ...form, estimatedVolumeKg: Number(e.target.value) })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none font-mono"
                    />
                  </div>
                </div>
              )}

              {/* Step 3 : Vos parcelles (Matching Screen 2 of Mockup 5.2) */}
              {step === 3 && (
                <div className="space-y-3">
                  <p className="text-slate-500 text-[11px]">
                    Ajoutez vos parcelles en les dessinant sur la carte ou en important un fichier GPS.
                  </p>

                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={handleGetGps}
                      disabled={gpsLoading}
                      className="w-full rounded-2xl bg-[#0D5B41] p-3 text-xs font-bold text-white shadow-xs hover:bg-[#0a4833] flex items-center justify-center gap-2"
                    >
                      <span>📍</span>
                      <span>{gpsLoading ? "Acquisition GPS..." : "Utiliser ma position"}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => alert("Outil de tracé de polygone interactif activé sur la carte.")}
                      className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs flex items-center justify-center gap-2"
                    >
                      <span>✏️</span>
                      <span>Dessiner sur la carte</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => alert("Sélectionnez votre fichier GeoJSON ou KML...")}
                      className="w-full rounded-2xl border border-slate-200 bg-white p-3 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs flex items-center justify-center gap-2"
                    >
                      <span>📂</span>
                      <span>Importer un fichier</span>
                    </button>
                  </div>

                  <div className="rounded-xl bg-slate-50 p-3 border border-slate-100 font-mono text-[11px] space-y-1">
                    <div className="text-slate-500 text-[10px]">Coordonnées actuelles :</div>
                    <div className="font-bold text-slate-900">{form.plotCoordinates}</div>
                    <div className="text-slate-700">Surface : {form.plotAreaHa} hectares</div>
                  </div>
                </div>
              )}

              {/* Step 4 : Documents */}
              {step === 4 && (
                <div className="space-y-3">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Titre du document légal *</label>
                    <input
                      type="text"
                      required
                      value={form.documentTitle}
                      onChange={(e) => setForm({ ...form, documentTitle: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Date d'expiration *</label>
                    <input
                      type="date"
                      required
                      value={form.documentExpiry}
                      onChange={(e) => setForm({ ...form, documentExpiry: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 p-2.5 text-xs focus:border-[#0D5B41] focus:outline-none"
                    />
                  </div>
                  <div className="rounded-2xl border-2 border-dashed border-slate-200 p-5 text-center text-slate-500 hover:bg-slate-50">
                    <span className="text-2xl block mb-1">📄</span>
                    <span className="font-semibold text-slate-800">Prendre une photo ou importer un PDF</span>
                  </div>
                </div>
              )}

              {/* Step 5 : Vérification */}
              {step === 5 && (
                <div className="space-y-3">
                  <div className="rounded-2xl bg-slate-50 p-3.5 border border-slate-100 space-y-1 text-[11px]">
                    <div><strong>Entreprise :</strong> {form.companyName}</div>
                    <div><strong>Matière :</strong> {COMMODITY_LABELS[form.commodity]} ({form.estimatedVolumeKg} kg)</div>
                    <div><strong>Parcelle :</strong> {form.plotName} ({form.plotAreaHa} ha)</div>
                    <div><strong>Coordonnées GPS :</strong> {form.plotCoordinates}</div>
                  </div>
                  <div className="rounded-2xl bg-emerald-50 p-3 text-emerald-950 text-[11px] border border-emerald-200">
                    ✓ Je certifie sur l'honneur l'exactitude des informations et le respect des critères zéro déforestation post-2020.
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
                  <div />
                )}

                {step < 5 ? (
                  <button
                    type="button"
                    onClick={() => setStep(step + 1)}
                    className="rounded-xl bg-[#0D5B41] px-5 py-2 font-bold text-white shadow-xs hover:bg-[#0a4833]"
                  >
                    Suivant ➔
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="rounded-xl bg-[#0D5B41] px-6 py-2.5 font-bold text-white shadow-xs hover:bg-[#0a4833]"
                  >
                    Confirmer et Envoyer ➔
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      )}

      {/* VIEW 3 : MON SUIVI (Matching Screen 3 of Mockup 5.2 - Circular Gauge 72%) */}
      {viewMode === "tracking" && (
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-md text-center space-y-6">
          <div className="flex items-center justify-between border-b pb-3">
            <span className="font-extrabold text-slate-900 text-sm">Mon suivi</span>
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
              En cours
            </span>
          </div>

          {/* 72% Gauge (Exact match Mockup 5.2 Screen 3) */}
          <div className="flex flex-col items-center justify-center my-2">
            <div className="relative flex items-center justify-center w-28 h-28">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" stroke="#F1F5F9" strokeWidth="9" fill="transparent" />
                <circle
                  cx="50"
                  cy="50"
                  r="40"
                  stroke="#0D5B41"
                  strokeWidth="9"
                  strokeDasharray="251.2"
                  strokeDashoffset="70.3"
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute text-center">
                <span className="text-2xl font-black text-slate-900">72%</span>
              </div>
            </div>
            <div className="text-xs font-bold text-slate-800 mt-2">Dossier complété à 72%</div>
          </div>

          {/* Checklist (Exact match Mockup 5.2 Screen 3) */}
          <div className="space-y-2.5 text-left text-xs bg-slate-50 p-4 rounded-2xl border border-slate-100">
            <div className="flex items-center justify-between">
              <span className="text-slate-700">Entreprise</span>
              <span className="text-emerald-700 font-bold">✓</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-700">Produits</span>
              <span className="text-emerald-700 font-bold">✓</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-700">Parcelles</span>
              <span className="font-semibold text-slate-900">2 / 5</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-700">Documents</span>
              <span className="font-semibold text-slate-900">1 / 5</span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-slate-200">
              <span className="text-slate-500 font-semibold">Vérification</span>
              <span className="rounded bg-amber-100 px-1.5 py-0.2 text-[10px] font-bold text-amber-800">
                En cours
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setViewMode("wizard")}
            className="w-full rounded-2xl bg-[#0D5B41] py-3 text-xs font-bold text-white shadow-xs hover:bg-[#0a4833]"
          >
            Voir mon dossier
          </button>
        </div>
      )}
    </div>
  );
}
