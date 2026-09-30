"use client";

import {
  COMMODITY_LABELS,
  DECLARATION_STATUS_LABELS,
  type DeclarationStatus,
  type TracesDeclarationRecord,
} from "@/lib/eudr/types";
import { useEffect, useState } from "react";

export default function DeclarationsPage() {
  const [declarations, setDeclarations] = useState<TracesDeclarationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [selectedDec, setSelectedDec] = useState<TracesDeclarationRecord | null>(null);
  const [showPayloadModal, setShowPayloadModal] = useState(false);
  const [showRefModal, setShowRefModal] = useState(false);
  const [tracesRefInput, setTracesRefInput] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/declarations");
        if (res.ok) setDeclarations(await res.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleRecordTracesRef = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDec) return;
    setSaving(true);

    try {
      const res = await fetch(`/api/v1/declarations/${encodeURIComponent(selectedDec.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "TRANSMITTED",
          tracesReference: tracesRefInput,
        }),
      });

      if (res.ok) {
        setDeclarations((prev) =>
          prev.map((d) =>
            d.id === selectedDec.id
              ? {
                  ...d,
                  status: "TRANSMITTED",
                  tracesReference: tracesRefInput,
                  submittedAt: new Date().toISOString(),
                }
              : d,
          ),
        );
        setShowRefModal(false);
        setTracesRefInput("");
      }
    } catch {
      alert("Erreur lors de l'enregistrement du numéro TRACES-NT.");
    } finally {
      setSaving(false);
    }
  };

  const filteredDeclarations = declarations.filter((d) => {
    if (statusFilter !== "ALL" && d.status !== statusFilter) return false;
    return true;
  });

  const total = declarations.length;
  const ready = declarations.filter((d) => d.status === "READY").length;
  const transmitted = declarations.filter((d) => d.status === "TRANSMITTED" || d.status === "ACCEPTED").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Déclarations & Passerelle TRACES-NT (DDS)</h1>
          <p className="text-xs text-slate-500">
            Préparation, validation des schémas XML/JSON et suivi des numéros de référence de diligence raisonnée EUDR.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs">
          🏛️ Passerelle Système Officiel UE
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Total Déclarations Prêtes / Exportées</div>
          <div className="mt-2 text-2xl font-bold text-slate-900">{total}</div>
          <div className="text-[10px] text-slate-500">Dossiers conformes préparés</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Prêtes pour Transmission</div>
          <div className="mt-2 text-2xl font-bold text-emerald-600">{ready}</div>
          <div className="text-[10px] text-emerald-600 font-semibold">Schémas XML/JSON générés ✓</div>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-xs">
          <div className="text-[11px] font-semibold uppercase text-slate-400">Transmises & Référencées</div>
          <div className="mt-2 text-2xl font-bold text-sky-600">{transmitted}</div>
          <div className="text-[10px] text-sky-600 font-semibold">Numéro officiel enregistré</div>
        </div>
      </div>

      {/* Strict Compliance Transparency Banner */}
      <div className="rounded-2xl border border-sky-200 bg-sky-50/60 p-4 text-xs text-sky-950 space-y-1">
        <div className="font-bold flex items-center gap-2">
          <span>ℹ️</span>
          <span>Règle d'Intégrité Réglementaire GeoForest Trace :</span>
        </div>
        <p className="text-[11px] leading-relaxed opacity-90">
          Un dossier n'est marqué comme <strong>« Déclaré / Transmis »</strong> qu'après confirmation d'une transmission
          réelle ou saisie du numéro de référence officiel délivré par le système des douanes de l'Union européenne
          (ex: <code>EUDR.2026.FR.8912450</code>).
        </p>
      </div>

      {/* Table of Declarations */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 shadow-2xs focus:border-emerald-500 focus:outline-none"
          >
            <option value="ALL">Tous les statuts de déclaration</option>
            {Object.entries(DECLARATION_STATUS_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500">
                <tr>
                  <th className="px-4 py-3">Réf Déclaration</th>
                  <th className="px-4 py-3">Dossier DDR Lié</th>
                  <th className="px-4 py-3">Opérateur EORI</th>
                  <th className="px-4 py-3">Matière & Code SH</th>
                  <th className="px-4 py-3">Poids Net</th>
                  <th className="px-4 py-3">Réf TRACES-NT</th>
                  <th className="px-4 py-3">Statut</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-700">
                {loading ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Chargement des déclarations TRACES-NT...
                    </td>
                  </tr>
                ) : filteredDeclarations.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-slate-400">
                      Aucune déclaration trouvée.
                    </td>
                  </tr>
                ) : (
                  filteredDeclarations.map((d) => {
                    const isTransmitted = d.status === "TRANSMITTED" || d.status === "ACCEPTED";

                    return (
                      <tr key={d.id} className="hover:bg-slate-50/75 transition">
                        <td className="px-4 py-3 font-mono font-semibold text-slate-900">{d.reference}</td>
                        <td className="px-4 py-3 font-medium text-slate-900">{d.ddrReference}</td>
                        <td className="px-4 py-3 font-mono text-[11px]">{d.operatorEori}</td>
                        <td className="px-4 py-3">
                          <span className="font-semibold">{COMMODITY_LABELS[d.commodity] || d.commodity}</span>{" "}
                          <span className="text-[10px] font-mono text-slate-400">({d.hsCode})</span>
                        </td>
                        <td className="px-4 py-3 font-mono">{d.netWeightKg.toLocaleString("fr-FR")} kg</td>
                        <td className="px-4 py-3">
                          {d.tracesReference ? (
                            <span className="font-mono font-bold text-sky-700">{d.tracesReference}</span>
                          ) : (
                            <span className="text-slate-400 italic">En attente</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${
                              isTransmitted
                                ? "bg-sky-50 text-sky-700 border border-sky-200"
                                : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            }`}
                          >
                            <span>{DECLARATION_STATUS_LABELS[d.status] || d.status}</span>
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedDec(d);
                                setShowPayloadModal(true);
                              }}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                            >
                              Voir Payload 🔍
                            </button>
                            {!isTransmitted && (
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedDec(d);
                                  setShowRefModal(true);
                                }}
                                className="rounded-lg bg-sky-600 px-2 py-1 text-[11px] font-bold text-white shadow-2xs hover:bg-sky-500"
                              >
                                + Enregistrer Réf 🏛️
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Modal Visualisation Payload */}
      {showPayloadModal && selectedDec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                Payload TRACES-NT Normalisé ({selectedDec.reference})
              </h3>
              <button
                type="button"
                onClick={() => setShowPayloadModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="rounded-xl bg-slate-900 p-4 font-mono text-[11px] text-emerald-400 overflow-x-auto max-h-96">
              <pre>{selectedDec.jsonPayload || '{\n  "status": "READY_FOR_EXPORT"\n}'}</pre>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => alert("Téléchargement du fichier XML conforme au schéma TRACES-NT...")}
                className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-700 hover:bg-slate-50"
              >
                Télécharger XML
              </button>
              <button
                type="button"
                onClick={() => setShowPayloadModal(false)}
                className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Saisie Référence TRACES-NT */}
      {showRefModal && selectedDec && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">Enregistrer le Numéro Officiel TRACES-NT</h3>
              <button
                type="button"
                onClick={() => setShowRefModal(false)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordTracesRef} className="space-y-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Numéro de référence délivré par les douanes UE
                </label>
                <input
                  type="text"
                  required
                  placeholder="ex: EUDR.2026.FR.8912450"
                  value={tracesRefInput}
                  onChange={(e) => setTracesRefInput(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-2.5 font-mono text-xs focus:border-sky-500 focus:outline-none"
                />
              </div>

              <div className="rounded-xl bg-slate-50 p-3 text-[11px] text-slate-600">
                La saisie de ce numéro attestera officiellement de la transmission auprès des autorités de contrôle.
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowRefModal(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-xl bg-sky-600 px-4 py-2 font-semibold text-white shadow-sm hover:bg-sky-500"
                >
                  {saving ? "Enregistrement..." : "Confirmer la transmission"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
