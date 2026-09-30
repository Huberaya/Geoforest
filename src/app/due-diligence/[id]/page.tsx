"use client";

import {
  COMMODITY_LABELS,
  DDR_STATUS_LABELS,
  type DueDiligenceStatementRecord,
} from "@/lib/eudr/types";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useState } from "react";

const STEPPER = [
  { id: 1, label: "Opérateur" },
  { id: 2, label: "Produit" },
  { id: 3, label: "Fournisseur" },
  { id: 4, label: "Parcelles" },
  { id: 5, label: "Déforestation" },
  { id: 6, label: "Légalité" },
  { id: 7, label: "Réduction" },
  { id: 8, label: "Validation" },
  { id: 9, label: "Déclaration" },
];

export default function DdrDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [ddr, setDdr] = useState<DueDiligenceStatementRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState(8);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/v1/due-diligence/${encodeURIComponent(id)}`);
        if (res.ok) setDdr(await res.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleExportTraces = async () => {
    setExporting(true);
    try {
      const res = await fetch("/api/v1/declarations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ddrId: ddr?.id,
          ddrReference: ddr?.reference,
          operatorName: ddr?.operatorInfo?.name,
          operatorEori: ddr?.operatorInfo?.eori,
          commodity: ddr?.commodity,
          hsCode: ddr?.hsCode,
          netWeightKg: ddr?.netWeightKg,
        }),
      });

      if (res.ok) {
        router.push("/declarations");
      }
    } catch {
      alert("Erreur lors de l'export TRACES-NT.");
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-xs text-slate-400">
        Chargement du dossier de diligence raisonnée...
      </div>
    );
  }

  const d: DueDiligenceStatementRecord = ddr ?? {
    id,
    reference: "DDR-2026-00142",
    title: "Dossier DDR Cacao Fèves Brutes — Lot Anvers Octobre 2026",
    commodity: "cocoa",
    hsCode: "18010000",
    supplierId: "sup-ci-001",
    supplierName: "Coopérative Cacaoyère de Divo (COOPADI)",
    productId: "prod-ci-001",
    productName: "Cacao - fèves",
    status: "READY_FOR_DECLARATION",
    riskLevel: "LOW",
    completenessScore: 100,
    plotsCount: 8,
    totalAreaHa: 42.6,
    netWeightKg: 24000,
    countryOfProduction: "CI",
    operatorInfo: {
      name: "Entreprise SA",
      eori: "FR123456789",
      country: "FR",
      address: "12 rue de la Paix, 75002 Paris, France",
      email: "compliance@entreprise-sa.fr",
    },
    declarationSignedBy: "Marie Dupont (Lead EUDR)",
    declarationSignedAt: "2026-09-29T15:30:00Z",
    tracesReference: null,
    submittedAt: null,
    createdAt: "2026-09-15T09:00:00Z",
    updatedAt: "2026-09-29T15:30:00Z",
  };

  const isReady = d.status === "READY_FOR_DECLARATION" || d.status === "DECLARED";

  return (
    <div className="space-y-6 font-sans">
      {/* 5.8 Master Mockup Stepper (10 steps) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs overflow-x-auto">
        <div className="flex items-center justify-between min-w-[700px] gap-2 text-xs">
          {STEPPER.map((s, idx) => {
            const isDone = s.id <= currentStep;
            const isCurrent = s.id === currentStep;

            return (
              <div key={s.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setCurrentStep(s.id)}
                  className="flex items-center gap-1.5 focus:outline-none"
                >
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ${
                      isDone
                        ? "bg-[#0D5B41] text-white"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {isDone ? "✓" : s.id}
                  </span>
                  <span
                    className={`font-semibold ${
                      isCurrent
                        ? "text-[#0D5B41] font-bold"
                        : isDone
                        ? "text-slate-800"
                        : "text-slate-400"
                    }`}
                  >
                    {s.label}
                  </span>
                </button>
                {idx < STEPPER.length - 1 && <span className="text-slate-300">→</span>}
              </div>
            );
          })}
        </div>
      </div>

      {/* 5.8 Master Mockup Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-extrabold text-slate-900">Dossier DDR — {d.reference}</h1>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-bold text-emerald-800 flex items-center gap-1">
            <span>✓</span>
            <span>Prêt à déclarer</span>
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => alert("Génération du dossier complet PDF de Diligence Raisonnée...")}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-2xs"
          >
            Exporter PDF
          </button>
          {isReady && (
            <button
              type="button"
              onClick={handleExportTraces}
              disabled={exporting}
              className="rounded-xl bg-[#0D5B41] px-4 py-2 text-xs font-bold text-white shadow-xs hover:bg-[#0a4833]"
            >
              {exporting ? "Préparation..." : "Transmettre sur TRACES-NT 🚀"}
            </button>
          )}
        </div>
      </div>

      {/* 5.8 Master Mockup Main Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left Column : Cards 1 (Opérateur) & 2 (Produit) & Sections */}
        <div className="lg:col-span-8 space-y-4">
          {/* Card 1: 1. Opérateur (Exact match Mockup 5.8) */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">1. Opérateur</h2>
            <div className="space-y-1.5 text-xs text-slate-700">
              <div className="font-bold text-slate-900 text-sm">{d.operatorInfo?.name || "Entreprise SA"}</div>
              <div>
                Numéro EORI : <span className="font-mono font-bold text-slate-900">{d.operatorInfo?.eori || "FR123456789"}</span>
              </div>
              <div className="text-slate-500">Adresse : {d.operatorInfo?.address || "12 rue de la Paix, 75002 Paris, France"}</div>
            </div>
          </div>

          {/* Card 2: 2. Produit (Exact match Mockup 5.8) */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">2. Produit</h2>
            <div className="space-y-1.5 text-xs text-slate-700">
              <div className="font-bold text-slate-900 text-sm">{d.productName || "Cacao - fèves"}</div>
              <div>
                Quantité : <strong>{Math.round(d.netWeightKg / 1000)} tonnes</strong> ({d.netWeightKg.toLocaleString("fr-FR")} kg)
              </div>
              <div>Origine : <strong>Côte d'Ivoire (CI)</strong></div>
            </div>
          </div>

          {/* Card 3: Fournisseurs & Parcelles */}
          <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">3. Parcelles & Traçabilité</h2>
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="rounded-2xl bg-slate-50 p-3 border border-slate-100">
                <div className="text-[10px] text-slate-400">Fournisseur direct</div>
                <div className="font-bold text-slate-900">{d.supplierName}</div>
              </div>
              <div className="rounded-2xl bg-slate-50 p-3 border border-slate-100">
                <div className="text-[10px] text-slate-400">Parcelles auditées</div>
                <div className="font-bold text-emerald-700">8 polygones WGS84 ({d.totalAreaHa} ha)</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column : Résumé du dossier (Exact match Mockup 5.8) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-xs space-y-5">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">Résumé du dossier</h2>

            {/* Checklist */}
            <div className="space-y-2.5 text-xs">
              <div className="flex items-center gap-2 text-slate-800">
                <span className="text-emerald-700 font-bold">✓</span>
                <span>Déforestation : <strong>conforme</strong></span>
              </div>
              <div className="flex items-center gap-2 text-slate-800">
                <span className="text-emerald-700 font-bold">✓</span>
                <span>Légalité : <strong>conforme</strong></span>
              </div>
              <div className="flex items-center gap-2 text-slate-800">
                <span className="text-emerald-700 font-bold">✓</span>
                <span>Risque : <strong>faible</strong></span>
              </div>
            </div>

            {/* Complétude Bar */}
            <div className="space-y-1.5 pt-2 border-t border-slate-100">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-700">Complétude</span>
                <span className="text-emerald-700">100%</span>
              </div>
              <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full rounded-full bg-[#0D5B41] w-full" />
              </div>
            </div>

            <button
              type="button"
              onClick={() => alert("Visualisation complète de l'ensemble des 8 parcelles et documents...")}
              className="w-full text-center rounded-2xl border border-slate-200 bg-slate-50 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 shadow-2xs"
            >
              Voir le détail complet
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
