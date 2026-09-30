"use client";

import Link from "next/link";
import { useState } from "react";

export default function OnboardingPage() {
  const [completedSteps, setCompletedSteps] = useState<number[]>([1]);

  const markStepDone = (step: number) => {
    if (!completedSteps.includes(step)) {
      setCompletedSteps([...completedSteps, step]);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6 font-sans py-4">
      <div className="text-center space-y-2">
        <span className="text-3xl">🌱 🛰️</span>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Bienvenue sur GeoForest Trace</h1>
        <p className="text-xs text-slate-500 max-w-lg mx-auto">
          Configurez votre espace de diligence raisonnée en 4 étapes clés pour aligner votre chaîne d'approvisionnement avec le règlement EUDR.
        </p>
      </div>

      <div className="space-y-4">
        {/* Step 1 */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-[#0D5B41] font-bold text-xs">
              ✓
            </span>
            <div>
              <div className="font-bold text-slate-900 text-xs">1. Identité légale & EORI configurés</div>
              <div className="text-[11px] text-slate-500">Votre organisation est initialisée avec le statut d'opérateur UE.</div>
            </div>
          </div>
          <Link href="/settings" className="text-xs font-bold text-[#0D5B41] hover:underline">
            Modifier →
          </Link>
        </div>

        {/* Step 2 */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                completedSteps.includes(2) ? "bg-emerald-100 text-[#0D5B41]" : "bg-slate-100 text-slate-600"
              }`}
            >
              2
            </span>
            <div>
              <div className="font-bold text-slate-900 text-xs">2. Inviter vos premiers fournisseurs ou producteurs</div>
              <div className="text-[11px] text-slate-500">
                Envoyez un lien d'onboarding mobile-first pour collecter leurs parcelles GPS.
              </div>
            </div>
          </div>
          <Link
            href="/suppliers"
            onClick={() => markStepDone(2)}
            className="rounded-xl bg-[#0D5B41] px-4 py-2 text-xs font-bold text-white shadow-2xs hover:bg-[#0a4833]"
          >
            Inviter un fournisseur →
          </Link>
        </div>

        {/* Step 3 */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                completedSteps.includes(3) ? "bg-emerald-100 text-[#0D5B41]" : "bg-slate-100 text-slate-600"
              }`}
            >
              3
            </span>
            <div>
              <div className="font-bold text-slate-900 text-xs">3. Importer et auditer vos parcelles géographiques</div>
              <div className="text-[11px] text-slate-500">
                Vérifiez la conformité zéro-déforestation post-31/12/2020 avec Hansen et Copernicus Sentinel-2.
              </div>
            </div>
          </div>
          <Link
            href="/plots"
            onClick={() => markStepDone(3)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
          >
            Importer GeoJSON / Shapefile →
          </Link>
        </div>

        {/* Step 4 */}
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span
              className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                completedSteps.includes(4) ? "bg-emerald-100 text-[#0D5B41]" : "bg-slate-100 text-slate-600"
              }`}
            >
              4
            </span>
            <div>
              <div className="font-bold text-slate-900 text-xs">4. Créer votre première Déclaration DDR TRACES-NT</div>
              <div className="text-[11px] text-slate-500">
                Générez le dossier complet avec scellement d'intégrité et export XML officiel.
              </div>
            </div>
          </div>
          <Link
            href="/due-diligence"
            onClick={() => markStepDone(4)}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
          >
            Créer un dossier DDR →
          </Link>
        </div>
      </div>

      <div className="pt-4 text-center">
        <Link
          href="/"
          className="inline-block rounded-2xl bg-[#0D5B41] px-8 py-3 text-xs font-bold text-white shadow-md hover:bg-[#0a4833]"
        >
          Accéder directement au Dashboard ➔
        </Link>
      </div>
    </div>
  );
}
