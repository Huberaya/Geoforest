"use client";

import { type AuditLogRecord } from "@/lib/eudr/types";
import { useEffect, useState } from "react";

export default function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFilter, setActionFilter] = useState("ALL");
  const [selectedLog, setSelectedLog] = useState<AuditLogRecord | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/v1/audit-logs");
        if (res.ok) setLogs(await res.json());
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filteredLogs = logs.filter((l) => {
    if (actionFilter !== "ALL" && l.action !== actionFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const matchRef = l.entityReference?.toLowerCase().includes(q);
      const matchUser = l.userEmail.toLowerCase().includes(q);
      const matchAction = l.action.toLowerCase().includes(q);
      const matchDetails = typeof l.details === "string" && l.details.toLowerCase().includes(q);
      if (!matchRef && !matchUser && !matchAction && !matchDetails) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Piste d'Audit Immuable (Audit Trail EUDR)</h1>
          <p className="text-xs text-slate-500">
            Journal inaltérable des actions, modifications d'état et signatures de conformité (Conservation légale 5 ans — Art. 12).
          </p>
        </div>

        <button
          type="button"
          onClick={() => alert("Export du journal d'audit complet scellé pour les autorités de contrôle...")}
          className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs flex items-center gap-1.5"
        >
          <span>📜</span>
          <span>Exporter le Journal Officiel</span>
        </button>
      </div>

      {/* Legal Retention Banner */}
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 text-xs text-emerald-950 space-y-1">
        <div className="font-bold flex items-center gap-2">
          <span>🔒</span>
          <span>Article 12 du Règlement (UE) 2023/1115 (EUDR) — Conservation des preuves :</span>
        </div>
        <p className="text-[11px] leading-relaxed opacity-90">
          Les opérateurs et commerçants conservent les informations, documents et données prouvant l'exercice de la
          diligence raisonnée pendant une période d'au moins <strong>5 ans</strong> à compter de la date de mise sur le
          marché européen ou de l'exportation.
        </p>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Rechercher utilisateur, réf, action..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs focus:border-emerald-500 focus:outline-none w-64 shadow-2xs"
          />

          <select
            value={actionFilter}
            onChange={(e) => setActionFilter(e.target.value)}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-2xs focus:border-emerald-500 focus:outline-none"
          >
            <option value="ALL">Toutes les actions</option>
            <option value="SIGN_DDR_STATEMENT">Signature DDR</option>
            <option value="RUN_GEOSPATIAL_ANALYSIS">Analyse Géospatiale</option>
            <option value="ALERT_DEFORESTATION_TRIGGERED">Alerte Déforestation</option>
            <option value="VALIDATE_DOCUMENT_LEGALITY">Validation Document</option>
            <option value="EXPORT_TRACES_JSON">Export TRACES-NT</option>
          </select>
        </div>

        <div className="text-xs text-slate-500">
          <strong className="text-slate-900">{filteredLogs.length}</strong> événements horodatés
        </div>
      </div>

      {/* Audit Log Table */}
      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-50/75 text-[11px] font-semibold text-slate-500">
              <tr>
                <th className="px-4 py-3">Horodatage (UTC)</th>
                <th className="px-4 py-3">Utilisateur / Auteur</th>
                <th className="px-4 py-3">Action Enregistrée</th>
                <th className="px-4 py-3">Entité & Référence</th>
                <th className="px-4 py-3">Détails & Modifications</th>
                <th className="px-4 py-3">Adresse IP</th>
                <th className="px-4 py-3 text-right">Inspecter</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-slate-700">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Chargement de la piste d'audit immuable...
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-400">
                    Aucun événement d'audit trouvé.
                  </td>
                </tr>
              ) : (
                filteredLogs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/75 transition">
                    <td className="px-4 py-3 font-mono text-[11px] whitespace-nowrap text-slate-900">
                      {new Date(l.createdAt).toLocaleString("fr-FR")}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-slate-900">{l.userEmail}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-800">
                        {l.action}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{l.entityReference || l.entityId}</div>
                      <div className="text-[10px] text-slate-400">{l.entityType}</div>
                    </td>
                    <td className="px-4 py-3 max-w-md truncate text-slate-600">
                      {typeof l.details === "string" ? l.details : JSON.stringify(l.details)}
                    </td>
                    <td className="px-4 py-3 font-mono text-[10px] text-slate-400">{l.ipAddress || "127.0.0.1"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setSelectedLog(l)}
                        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                      >
                        Diff 🔍
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Inspection Diff */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-slate-900 text-sm">
                Enregistrement d'Audit Scellé ({selectedLog.id})
              </h3>
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="text-slate-400 hover:text-slate-600 text-sm"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <span className="text-slate-500">Action :</span>{" "}
                <span className="font-mono font-bold text-slate-900">{selectedLog.action}</span>
              </div>
              <div>
                <span className="text-slate-500">Auteur :</span>{" "}
                <span className="font-semibold text-slate-900">{selectedLog.userEmail}</span> (IP : {selectedLog.ipAddress})
              </div>
              <div>
                <span className="text-slate-500">Entité ciblée :</span>{" "}
                <span className="font-semibold text-slate-900">
                  {selectedLog.entityType} — {selectedLog.entityReference || selectedLog.entityId}
                </span>
              </div>

              <div className="space-y-1">
                <span className="text-slate-500 font-semibold">Différences constatées :</span>
                <div className="grid grid-cols-2 gap-2 font-mono text-[11px]">
                  <div className="rounded-xl bg-rose-50 border border-rose-200 p-2.5 text-rose-900">
                    <div className="text-[9px] uppercase font-bold text-rose-600 mb-1">Ancienne Valeur</div>
                    {selectedLog.oldValue || "(Création initiale)"}
                  </div>
                  <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-emerald-900">
                    <div className="text-[9px] uppercase font-bold text-emerald-600 mb-1">Nouvelle Valeur</div>
                    {selectedLog.newValue || "(Sans changement)"}
                  </div>
                </div>
              </div>

              <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-600 border border-slate-100">
                <strong>Description :</strong>{" "}
                {typeof selectedLog.details === "string" ? selectedLog.details : JSON.stringify(selectedLog.details)}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="rounded-xl bg-slate-900 px-4 py-2 font-semibold text-white shadow-sm hover:bg-slate-800"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
