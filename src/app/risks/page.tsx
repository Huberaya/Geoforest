"use client";

import { COMMODITY_LABELS, type RiskItem, type RiskMitigationStatus } from "@/lib/eudr/types";
import { useEffect, useState } from "react";

export default function RisksPage() {
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"ALL" | "TO_TREAT" | "IN_PROGRESS" | "RESOLVED">("ALL");
  const [selectedRisk, setSelectedRisk] = useState<RiskItem | null>(null);
  const [showMitigationModal, setShowMitigationModal] = useState(false);
  const [mitigationPlanInput, setMitigationPlanInput] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/risks");
        if (res.ok) setRisks(await res.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleUpdateStatus = async (id: string, newStatus: RiskMitigationStatus, plan?: string) => {
    try {
      const res = await fetch(`/api/v1/risks/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          mitigationPlan: plan,
        }),
      });

      if (res.ok) {
        setRisks((prev) =>
          prev.map((r) =>
            r.id === id
              ? {
                  ...r,
                  status: newStatus,
                  mitigationPlan: plan !== undefined ? plan : r.mitigationPlan,
                  validatedAt: newStatus === "VALIDATED" ? new Date().toISOString() : r.validatedAt,
                }
              : r,
          ),
        );
        setShowMitigationModal(false);
      }
    } catch {
      alert("Erreur lors de la mise à jour du risque.");
    }
  };

  const filteredRisks = risks.filter((r) => {
    if (activeTab === "TO_TREAT" && r.status !== "TO_TREAT") return false;
    if (activeTab === "IN_PROGRESS" && r.status !== "IN_PROGRESS") return false;
    if (activeTab === "RESOLVED" && !(r.status === "RESOLVED" || r.status === "VALIDATED")) return false;
    return true;
  });

  const totalRisks = risks.length;
  const criticalCount = risks.filter((r) => r.riskLevel === "CRITICAL").length;
  const toTreatCount = risks.filter((r) => r.status === "TO_TREAT").length;
  const inProgressCount = risks.filter((r) => r.status === "IN_PROGRESS").length;
  const resolvedCount = risks.filter((r) => r.status === "RESOLVED" || r.status === "VALIDATED").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Centre d'Évaluation & Traitement des Risques EUDR</h1>
          <p className="text-xs text-slate-500">
            Matrice des 4 piliers de diligence raisonnée : Benchmark Pays (Art. 29), Satellite (Art. 3), Légalité (Art. 9/10) et Traçabilité.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs">
            🛡️ Validation humaine obligatoire
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Total Risques Détectés</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{totalRisks}</div>
          <div className="text-[10px] text-slate-500">Tous facteurs confondus</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Risques Critiques (Bloquants DDR)</div>
          <div className="mt-2 text-2xl font-bold text-rose-600">{criticalCount}</div>
          <div className="text-[10px] text-rose-600 font-semibold">Interdiction de déclaration</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">En Cours de Mitigation</div>
          <div className="mt-2 text-2xl font-bold text-amber-600">{inProgressCount}</div>
          <div className="text-[10px] text-amber-600 font-semibold">Actions correctives engagées</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Risques Résolus & Validés</div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{resolvedCount}</div>
          <div className="text-[10px] text-emerald-600 font-semibold">Diligence raisonnée satisfaite ✓</div>
        </div>
      </div>

      {/* 4 EUDR Pillars Architecture Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
          Matrice d'Évaluation des 4 Piliers EUDR (Règlement 2023/1115)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1">
            <div className="font-bold text-slate-900">1. Risque Pays (Art. 29)</div>
            <p className="text-[11px] text-slate-500">
              Benchmark officiel de la Commission (Faible, Standard, Élevé) basé sur les taux de déforestation nationaux.
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1">
            <div className="font-bold text-slate-900">2. Satellite & Déforestation (Art. 3)</div>
            <p className="text-[11px] text-slate-500">
              Croisement GFW Hansen 30m, Sentinel-2 10m et dégradation forestière par rapport au 31/12/2020.
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1">
            <div className="font-bold text-slate-900">3. Légalité & Droits Humains (Art. 9/10)</div>
            <p className="text-[11px] text-slate-500">
              Droits fonciers, droit du travail, légalité fiscale et consentement libre et éclairé (FPIC peuples autochtones).
            </p>
          </div>
          <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3 space-y-1">
            <div className="font-bold text-slate-900">4. Traçabilité & Complexité</div>
            <p className="text-[11px] text-slate-500">
              Nombre d'intermédiaires, mélange de lots et fiabilité des géolocalisations polygonales fournies.
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("ALL")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "ALL"
                ? "bg-slate-900 text-white shadow-2xs"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            Tous les risques ({totalRisks})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("TO_TREAT")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "TO_TREAT"
                ? "bg-rose-600 text-white shadow-2xs"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            À traiter ({toTreatCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("IN_PROGRESS")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "IN_PROGRESS"
                ? "bg-amber-600 text-white shadow-2xs"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            En cours de mitigation ({inProgressCount})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("RESOLVED")}
            className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition ${
              activeTab === "RESOLVED"
                ? "bg-emerald-600 text-white shadow-2xs"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            Résolus & Validés ({resolvedCount})
          </button>
        </div>
      </div>

      {/* Risks Cards Board */}
      <div className="space-y-4">
        {loading ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
            Chargement de la matrice des risques...
          </div>
        ) : filteredRisks.length === 0 ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-xs text-slate-400">
            Aucun risque dans cette catégorie.
          </div>
        ) : (
          filteredRisks.map((r) => {
            const isCritical = r.riskLevel === "CRITICAL";
            const isHigh = r.riskLevel === "HIGH";
            const isStandard = r.riskLevel === "STANDARD";

            const isToTreat = r.status === "TO_TREAT";
            const isInProgress = r.status === "IN_PROGRESS";
            const isResolved = r.status === "RESOLVED";
            const isValidated = r.status === "VALIDATED";

            return (
              <div
                key={r.id}
                className={`rounded-2xl border bg-white p-5 shadow-xs transition space-y-4 ${
                  isCritical
                    ? "border-rose-200 bg-rose-50/20"
                    : isHigh
                    ? "border-amber-200 bg-amber-50/20"
                    : "border-slate-200"
                }`}
              >
                {/* Header item */}
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-bold ${
                        isCritical
                          ? "bg-rose-600 text-white"
                          : isHigh
                          ? "bg-amber-600 text-white"
                          : isStandard
                          ? "bg-slate-800 text-white"
                          : "bg-emerald-600 text-white"
                      }`}
                    >
                      Score : {r.overallScore}/100 • Risque {r.riskLevel}
                    </span>
                    <span className="font-mono text-xs font-semibold text-slate-500">{r.reference}</span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-lg px-2.5 py-1 text-xs font-bold ${
                        isToTreat
                          ? "bg-rose-100 text-rose-800"
                          : isInProgress
                          ? "bg-amber-100 text-amber-800"
                          : isResolved
                          ? "bg-emerald-100 text-emerald-800"
                          : "bg-emerald-600 text-white"
                      }`}
                    >
                      {isToTreat
                        ? "À traiter"
                        : isInProgress
                        ? "En cours"
                        : isResolved
                        ? "Résolu"
                        : "Validé Compliance"}
                    </span>
                  </div>
                </div>

                {/* Title & Details */}
                <div>
                  <h3 className="text-sm font-bold text-slate-900">{r.title}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-4 text-xs text-slate-500">
                    <span>
                      🏢 Fournisseur : <strong className="text-slate-800">{r.supplierName}</strong>
                    </span>
                    <span>
                      📦 Matière :{" "}
                      <strong className="text-slate-800">{COMMODITY_LABELS[r.commodity] || r.commodity}</strong>
                    </span>
                    {r.deadline && (
                      <span>
                        ⏰ Échéance : <strong className="text-rose-600">{new Date(r.deadline).toLocaleDateString("fr-FR")}</strong>
                      </span>
                    )}
                    {r.assignedTo && (
                      <span>
                        👤 Assigné à : <strong className="text-slate-800">{r.assignedTo}</strong>
                      </span>
                    )}
                  </div>
                </div>

                {/* Pillars Breakdown */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="rounded-lg bg-white p-2 border border-slate-100">
                    <div className="text-[10px] text-slate-400">1. Pays Benchmark</div>
                    <div className="font-bold text-slate-800">{r.countryRisk}</div>
                  </div>
                  <div className="rounded-lg bg-white p-2 border border-slate-100">
                    <div className="text-[10px] text-slate-400">2. Déforestation Satellite</div>
                    <div className={`font-bold ${r.deforestationRisk === "CRITICAL" ? "text-rose-600" : "text-slate-800"}`}>
                      {r.deforestationRisk}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white p-2 border border-slate-100">
                    <div className="text-[10px] text-slate-400">3. Légalité Documentaire</div>
                    <div className={`font-bold ${r.legalityRisk === "HIGH" ? "text-amber-600" : "text-slate-800"}`}>
                      {r.legalityRisk}
                    </div>
                  </div>
                  <div className="rounded-lg bg-white p-2 border border-slate-100">
                    <div className="text-[10px] text-slate-400">4. Chaîne & Traçabilité</div>
                    <div className="font-bold text-slate-800">{r.supplyChainRisk}</div>
                  </div>
                </div>

                {/* Sourced Reasons */}
                <div className="rounded-xl bg-slate-50 p-3 text-xs space-y-1 border border-slate-100">
                  <div className="font-bold text-slate-800">Facteurs & Preuves à l'origine de l'évaluation :</div>
                  <ul className="list-disc pl-4 space-y-0.5 text-slate-600">
                    {r.reasons.map((reason, i) => (
                      <li key={i}>{reason}</li>
                    ))}
                  </ul>
                </div>

                {/* Mitigation Plan & Actions */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-t border-slate-100 pt-3 text-xs">
                  <div className="flex-1 text-slate-600">
                    <strong className="text-slate-900">Plan de mitigation : </strong>
                    <span>{r.mitigationPlan}</span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isToTreat && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(r.id, "IN_PROGRESS")}
                        className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-1.5 font-bold text-amber-700 hover:bg-amber-100"
                      >
                        Engager la mitigation ⏳
                      </button>
                    )}
                    {isInProgress && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(r.id, "RESOLVED")}
                        className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-1.5 font-bold text-emerald-700 hover:bg-emerald-100"
                      >
                        Marquer résolu ✓
                      </button>
                    )}
                    {isResolved && (
                      <button
                        type="button"
                        onClick={() => handleUpdateStatus(r.id, "VALIDATED")}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 font-bold text-white shadow-xs hover:bg-emerald-500"
                      >
                        Valider (Lead Compliance) 🛡️
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRisk(r);
                        setMitigationPlanInput(r.mitigationPlan);
                        setShowMitigationModal(true);
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                    >
                      Éditer le plan ✏️
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Modal Edition Plan de Mitigation */}
      {showMitigationModal && selectedRisk && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                Plan d'Action & Réduction du Risque ({selectedRisk.reference})
              </h3>
              <button
                type="button"
                onClick={() => setShowMitigationModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Mesures correctives / Preuves exigées</label>
                <textarea
                  rows={4}
                  value={mitigationPlanInput}
                  onChange={(e) => setMitigationPlanInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600 space-y-1">
                <strong>Exigence EUDR (Article 10 & 11) :</strong> Toute mesure de réduction de risque doit être
                documentée, proportionnée aux signaux détectés et vérifiable avant la soumission de la DDR sur TRACES-NT.
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setShowMitigationModal(false)}
                className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={() => handleUpdateStatus(selectedRisk.id, selectedRisk.status, mitigationPlanInput)}
                className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500"
              >
                Enregistrer les mesures
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
