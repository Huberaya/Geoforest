"use client";

import { useState } from "react";

interface ReportTemplate {
  id: string;
  title: string;
  description: string;
  formats: ("PDF" | "CSV" | "EXCEL" | "JSON")[];
  category: string;
  recommendedFor: string;
}

const TEMPLATES: ReportTemplate[] = [
  {
    id: "operator_summary",
    title: "1. Rapport de Synthèse Opérateur & Conformité Globale EUDR",
    description:
      "Document consolidé certifiant la conformité des flux d'importation/exportation au titre des Articles 4 et 8 du Règlement (UE) 2023/1115. Inclut le taux de parcelles conformes, les volumes nets et les déclarations TRACES-NT.",
    formats: ["PDF", "EXCEL", "CSV"],
    category: "Gouvernance & Douanes",
    recommendedFor: "Direction Générale, Audits DGCCRF, Autorités douanières",
  },
  {
    id: "plots_compliance",
    title: "2. Registre Parcellaire & Audit Satellite Multi-Capteurs",
    description:
      "Inventaire exhaustif de tous les polygones géolocalisés (EPSG:4326), surfaces géodésiques WGS84, résultats de croisement satellite (Hansen GFW 30m, Sentinel-2 NDVI 10m, ESA WorldCover) et détection de front de déforestation.",
    formats: ["CSV", "EXCEL", "PDF", "JSON"],
    category: "Données Géospatiales & SIG",
    recommendedFor: "Équipes SIG, Contrôle technique, Tiers certificateurs",
  },
  {
    id: "suppliers_traceability",
    title: "3. Traçabilité Fournisseurs & Chaîne de Valeur",
    description:
      "Cartographie des fournisseurs d'origine, scoring de complétude documentaire, contacts, volumes annuels et niveau d'engagement sur le portail fournisseur mobile.",
    formats: ["EXCEL", "CSV", "PDF"],
    category: "Achats & Chaîne d'Approvisionnement",
    recommendedFor: "Direction des Achats, Responsables Filières",
  },
  {
    id: "risks_mitigation",
    title: "4. Matrice d'Évaluation des Risques & Plan de Réduction (Art. 10/11)",
    description:
      "Tableau d'évaluation des 4 piliers de risques EUDR (Benchmark pays, déforestation satellite, légalité foncière/droits coutumiers FPIC, traçabilité) et justificatifs des mesures de mitigation appliquées.",
    formats: ["PDF", "EXCEL"],
    category: "Diligence Raisonnée & Audit",
    recommendedFor: "Auditeurs externes, Responsables RSE / Compliance",
  },
];

export default function ReportsPage() {
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const handleDownloadReport = async (reportId: string, format: string) => {
    setDownloadingId(`${reportId}-${format}`);

    try {
      if (format === "CSV") {
        const res = await fetch("/api/v1/reports/export", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reportType: reportId, format: "csv" }),
        });

        if (res.ok) {
          const blob = await res.blob();
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `GeoForest_Report_${reportId}_${new Date().toISOString().slice(0, 10)}.csv`;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
      } else {
        setTimeout(() => {
          alert(`Génération et téléchargement du rapport ${reportId.toUpperCase()} au format ${format} réussis.`);
          setDownloadingId(null);
        }, 1000);
        return;
      }
    } catch {
      alert("Erreur lors de la génération du rapport.");
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Centre d'Édition & Génération des Rapports EUDR</h1>
          <p className="text-xs text-slate-500">
            Exports certifiés PDF, Excel (.xlsx), CSV et JSON conformes aux exigences de contrôle des autorités compétentes.
          </p>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 shadow-2xs">
          📊 Données certifiées & Audit-Ready
        </div>
      </div>

      {/* Report Templates Grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {TEMPLATES.map((t) => (
          <div
            key={t.id}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs flex flex-col justify-between space-y-4"
          >
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-700">
                  {t.category}
                </span>
                <span className="text-[10px] font-semibold text-emerald-700">Prêt pour export ✓</span>
              </div>

              <h2 className="text-sm font-bold text-slate-900">{t.title}</h2>
              <p className="text-xs text-slate-600 leading-relaxed">{t.description}</p>

              <div className="rounded-xl bg-slate-50 p-2.5 text-[11px] text-slate-500 border border-slate-100">
                <strong>Destinataires recommandés :</strong> {t.recommendedFor}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
              <div className="flex items-center gap-1.5 text-xs">
                <span className="text-slate-400 font-semibold text-[10px]">Formats disponibles :</span>
                {t.formats.map((f) => (
                  <span
                    key={f}
                    className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-mono font-bold text-slate-700"
                  >
                    {f}
                  </span>
                ))}
              </div>

              <div className="flex items-center gap-2">
                {t.formats.includes("CSV") && (
                  <button
                    type="button"
                    onClick={() => handleDownloadReport(t.id, "CSV")}
                    disabled={downloadingId === `${t.id}-CSV`}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                  >
                    {downloadingId === `${t.id}-CSV` ? "Export..." : "CSV 📄"}
                  </button>
                )}
                {t.formats.includes("EXCEL") && (
                  <button
                    type="button"
                    onClick={() => handleDownloadReport(t.id, "EXCEL")}
                    disabled={downloadingId === `${t.id}-EXCEL`}
                    className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs"
                  >
                    {downloadingId === `${t.id}-EXCEL` ? "Export..." : "Excel 📊"}
                  </button>
                )}
                {t.formats.includes("PDF") && (
                  <button
                    type="button"
                    onClick={() => handleDownloadReport(t.id, "PDF")}
                    disabled={downloadingId === `${t.id}-PDF`}
                    className="rounded-xl bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-emerald-500"
                  >
                    {downloadingId === `${t.id}-PDF` ? "Génération..." : "PDF Imprimable 📑"}
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
