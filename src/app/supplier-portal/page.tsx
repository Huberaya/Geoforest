"use client";

import { COMMODITIES, COMMODITY_LABELS, type Commodity } from "@/lib/eudr/types";
import Link from "next/link";
import { useState } from "react";

export default function SupplierPortalPage() {
  const [step, setStep] = useState(1);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // Form state
  const [form, setForm] = useState({
    companyName: "Coopérative Planteurs du Sassandra",
    country: "CI",
    eori: "CI00987654321",
    contactName: "Mamadou Traoré",
    phone: "+225 05 12 34 56",
    commodity: "cocoa" as Commodity,
    estimatedVolumeKg: 50000,
    plotName: "Parcelle Sassandra #01",
    plotCoordinates: "5.723450, -4.987650",
    plotAreaHa: 12.5,
    documentTitle: "Attestation foncière villageoise 2026",
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
    <div className="mx-auto max-w-xl pb-12">
      {/* Top Banner */}
      <div className="mb-6 flex items-center justify-between">
        <Link href="/" className="text-xs font-semibold text-emerald-800 hover:text-emerald-950 flex items-center gap-1">
          ← Retour au Dashboard
        </Link>
        <div className="rounded-full bg-emerald-100 px-3 py-1 text-[11px] font-bold text-emerald-800">
          Portail Producteur EUDR
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-7 shadow-sm">
        {/* Header */}
        <div className="text-center pb-4 border-b border-slate-100">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-600 text-white text-2xl shadow-sm mb-2">
            🌱
          </div>
          <h1 className="text-lg font-bold text-slate-900">Déclaration Fournisseur / Producteur</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Collecte simplifiée de vos parcelles et documents de conformité EUDR
          </p>
        </div>

        {/* Progress Bar (5 Steps) */}
        {!submitted && (
          <div className="my-6">
            <div className="flex items-center justify-between text-[11px] font-bold text-slate-500 mb-2">
              <span>Étape {step} sur 5</span>
              <span className="text-emerald-700">
                {step === 1 && "1. Entreprise"}
                {step === 2 && "2. Produits"}
                {step === 3 && "3. Parcelles (GPS)"}
                {step === 4 && "4. Documents"}
                {step === 5 && "5. Vérification"}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className="h-full rounded-full bg-emerald-600 transition-all duration-300"
                style={{ width: `${(step / 5) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Wizard Form */}
        {submitted ? (
          <div className="py-8 text-center space-y-4">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-3xl">
              ✓
            </div>
            <h2 className="text-lg font-bold text-slate-900">Déclaration transmise avec succès !</h2>
            <p className="text-xs text-slate-600 max-w-md mx-auto leading-relaxed">
              Vos coordonnées parcellaires et documents ont été enregistrés et intégrés au dossier de diligence raisonnée de <strong>GeoForest Agrobusiness SAS</strong>.
            </p>
            <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 text-left text-xs space-y-1.5 font-mono">
              <div>Réf dossier : <strong>DDR-2026-SUPP-9812</strong></div>
              <div>Parcelle : {form.plotName} ({form.plotAreaHa} ha)</div>
              <div>Coordonnées : {form.plotCoordinates}</div>
              <div>Horodatage : {new Date().toLocaleString("fr-FR")}</div>
            </div>
            <div className="pt-2">
              <Link
                href="/suppliers"
                className="inline-block rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                Retour à l'espace Entreprise
              </Link>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Step 1 : Entreprise */}
            {step === 1 && (
              <div className="space-y-3.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">1. Identité de votre coopérative / entreprise</h2>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Raison sociale *</label>
                  <input
                    type="text"
                    required
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Pays *</label>
                    <input
                      type="text"
                      required
                      value={form.country}
                      onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">N° EORI / Registre</label>
                    <input
                      type="text"
                      value={form.eori}
                      onChange={(e) => setForm({ ...form, eori: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Contact référent *</label>
                    <input
                      type="text"
                      required
                      value={form.contactName}
                      onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Téléphone mobile *</label>
                    <input
                      type="text"
                      required
                      value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 2 : Produits */}
            {step === 2 && (
              <div className="space-y-3.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">2. Matières premières récoltées</h2>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Commodity principale *</label>
                  <select
                    value={form.commodity}
                    onChange={(e) => setForm({ ...form, commodity: e.target.value as Commodity })}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500"
                  >
                    {COMMODITIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Volume estimé livré par an (kg) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={form.estimatedVolumeKg}
                    onChange={(e) => setForm({ ...form, estimatedVolumeKg: Number(e.target.value) })}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
              </div>
            )}

            {/* Step 3 : Parcelles GPS */}
            {step === 3 && (
              <div className="space-y-3.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">3. Géolocalisation de la parcelle</h2>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Nom / Référence de la parcelle *</label>
                  <input
                    type="text"
                    required
                    value={form.plotName}
                    onChange={(e) => setForm({ ...form, plotName: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>

                {/* GPS Capture Button */}
                <div className="rounded-xl bg-emerald-50 p-3.5 border border-emerald-200 text-center space-y-2">
                  <div className="text-xs font-semibold text-emerald-950">Option 1 : Position GPS sur le terrain</div>
                  <button
                    type="button"
                    onClick={handleGetGps}
                    disabled={gpsLoading}
                    className="w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm transition-all"
                  >
                    {gpsLoading ? "Acquisition GPS en cours..." : "📍 Capturer ma position GPS actuelle"}
                  </button>
                  <p className="text-[10px] text-emerald-800">
                    Précision attendue : ≥ 6 décimales WGS84 (requis par l'article 9 EUDR).
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Coordonnées GPS (Lat, Lon) *</label>
                    <input
                      type="text"
                      required
                      value={form.plotCoordinates}
                      onChange={(e) => setForm({ ...form, plotCoordinates: e.target.value })}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Surface (hectares) *</label>
                    <input
                      type="number"
                      step="0.01"
                      required
                      value={form.plotAreaHa}
                      onChange={(e) => setForm({ ...form, plotAreaHa: Number(e.target.value) })}
                      className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Step 4 : Documents */}
            {step === 4 && (
              <div className="space-y-3.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">4. Titres de propriété & Légalité</h2>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Type de document légal *</label>
                  <input
                    type="text"
                    required
                    value={form.documentTitle}
                    onChange={(e) => setForm({ ...form, documentTitle: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Date d'expiration *</label>
                  <input
                    type="date"
                    required
                    value={form.documentExpiry}
                    onChange={(e) => setForm({ ...form, documentExpiry: e.target.value })}
                    className="w-full rounded-xl border border-slate-200 px-3.5 py-2.5 text-xs focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <div className="rounded-xl border-2 border-dashed border-slate-200 p-6 text-center hover:bg-slate-50">
                  <div className="text-2xl mb-1">📄</div>
                  <div className="text-xs font-semibold text-slate-800">Sélectionner ou prendre une photo du document</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">PDF, PNG, JPG jusqu'à 15 Mo</div>
                </div>
              </div>
            )}

            {/* Step 5 : Vérification */}
            {step === 5 && (
              <div className="space-y-3.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">5. Récapitulatif & Déclaration d'honneur</h2>
                <div className="rounded-xl bg-slate-50 p-4 border border-slate-100 text-xs space-y-2">
                  <div><strong>Fournisseur :</strong> {form.companyName} ({form.country})</div>
                  <div><strong>Produit :</strong> {COMMODITY_LABELS[form.commodity]} ({form.estimatedVolumeKg} kg)</div>
                  <div><strong>Parcelle :</strong> {form.plotName} ({form.plotAreaHa} ha)</div>
                  <div><strong>GPS :</strong> {form.plotCoordinates}</div>
                  <div><strong>Document :</strong> {form.documentTitle} (Expire le {form.documentExpiry})</div>
                </div>
                <div className="rounded-xl bg-amber-50 p-3 border border-amber-200 text-xs text-amber-900 leading-relaxed">
                  ✓ Je certifie sur l'honneur que ces parcelles n'ont subi aucune déforestation après le 31 décembre 2020 et que la récolte respecte la législation nationale applicable.
                </div>
              </div>
            )}

            {/* Wizard Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-100">
              {step > 1 ? (
                <button
                  type="button"
                  onClick={() => setStep(step - 1)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
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
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-500 shadow-sm"
                >
                  Suivant ➔
                </button>
              ) : (
                <button
                  type="submit"
                  className="rounded-xl bg-emerald-600 px-6 py-2.5 text-xs font-bold text-white hover:bg-emerald-700 shadow-sm"
                >
                  Confirmer et Envoyer ➔
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
