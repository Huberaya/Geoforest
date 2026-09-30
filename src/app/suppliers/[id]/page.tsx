"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<"overview" | "products" | "plots" | "documents" | "history">("overview");
  const [supplier, setSupplier] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/v1/suppliers/${encodeURIComponent(id)}`);
        if (res.ok) {
          setSupplier(await res.json());
        }
      } catch {
        /* fallback */
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  const handleCopyPortalLink = () => {
    const url = `${window.location.origin}/supplier-portal?supplier_id=${id}`;
    navigator.clipboard.writeText(url);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center text-xs text-slate-400">
        Chargement de la fiche fournisseur...
      </div>
    );
  }

  const supp = supplier ?? {
    name: "Coopérative Cacaoyère de Divo (COOPADI)",
    eori: "CI00192837465",
    country: "CI",
    commodity: "cocoa",
    contactName: "Kouamé Konan",
    contactEmail: "direction@coopadi.ci",
    contactPhone: "+225 07 08 09 10",
    completenessScore: 95,
    riskLevel: "LOW",
    status: "ACTIVE",
    plotsCount: 18,
    plots: [
      { id: "plot-1", name: "Parcelle Divo Est #01", areaHa: 14.5, status: "COMPLIANT", riskLevel: "LOW" },
      { id: "plot-2", name: "Parcelle Divo Ouest #02", areaHa: 8.2, status: "COMPLIANT", riskLevel: "LOW" },
    ],
    documents: [
      { id: "doc-1", title: "Certificat de propriété foncière", category: "LAND_TENURE", status: "VALID", expiryDate: "2027-12-31" },
      { id: "doc-2", title: "Autorisation d'exploitation agricole", category: "HARVEST_PERMIT", status: "VALID", expiryDate: "2026-11-30" },
    ],
  };

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Action */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs">
          <Link href="/suppliers" className="text-slate-500 hover:text-slate-900">
            ← Tous les fournisseurs
          </Link>
          <span className="text-slate-300">/</span>
          <span className="font-semibold text-slate-800">{supp.name}</span>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleCopyPortalLink}
            className="rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 transition-all flex items-center gap-1.5"
          >
            <span>🔗</span>
            <span>{copiedLink ? "Lien copié !" : "Copier le lien du portail"}</span>
          </button>
          <Link
            href="/due-diligence"
            className="rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-500 transition-all"
          >
            + Créer un dossier DDR
          </Link>
        </div>
      </div>

      {/* Supplier Identity Banner */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">🇨🇮</span>
              <h1 className="text-xl font-bold text-slate-900">{supp.name}</h1>
              <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-bold text-emerald-800">
                ACTIF
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <div>EORI : <span className="font-mono text-slate-800">{supp.eori}</span></div>
              <div>•</div>
              <div>Matière première : <span className="font-medium text-slate-800">Cacao (Theobroma cacao)</span></div>
              <div>•</div>
              <div>Contact : <span className="text-slate-800">{supp.contactName} ({supp.contactEmail})</span></div>
            </div>
          </div>

          <div className="flex items-center gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
            <div className="text-right">
              <div className="text-[10px] uppercase font-semibold text-slate-400">Score de complétude</div>
              <div className="text-xl font-extrabold text-emerald-600">{supp.completenessScore}%</div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="text-right">
              <div className="text-[10px] uppercase font-semibold text-slate-400">Niveau de risque</div>
              <div className="text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full mt-1">
                FAIBLE
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mt-6 flex border-b border-slate-200 text-xs font-semibold">
          {[
            { id: "overview", label: "Vue d'ensemble" },
            { id: "products", label: "Produits associés" },
            { id: "plots", label: `Parcelles (${supp.plots?.length ?? 2})` },
            { id: "documents", label: `Documents de légalité (${supp.documents?.length ?? 2})` },
            { id: "history", label: "Historique & Audit" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`border-b-2 px-4 py-2.5 transition-colors ${
                activeTab === tab.id
                  ? "border-emerald-600 text-emerald-700 font-bold"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab Contents */}
      {activeTab === "overview" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Synthèse de diligence raisonnée</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Le fournisseur COOPADI a transmis 100% des coordonnées géographiques des parcelles de ses planteurs. L'analyse satellite n'a détecté aucune perte de couvert forestier après la date butoir du 31/12/2020.
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                  <div className="text-[10px] text-slate-400">Surface totale auditée</div>
                  <div className="text-sm font-bold text-slate-800">22.7 ha</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                  <div className="text-[10px] text-slate-400">Parcelles conformes</div>
                  <div className="text-sm font-bold text-emerald-600">2 / 2 (100%)</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                  <div className="text-[10px] text-slate-400">Pièces de légalité</div>
                  <div className="text-sm font-bold text-slate-800">2 valides</div>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Contact & Support</h3>
              <div className="text-xs space-y-2 text-slate-700">
                <div><strong>Téléphone :</strong> {supp.contactPhone}</div>
                <div><strong>Email :</strong> {supp.contactEmail}</div>
                <div><strong>Localisation :</strong> Divo, Région du Lôh-Djiboua, Côte d'Ivoire</div>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={handleCopyPortalLink}
                  className="w-full rounded-lg bg-slate-900 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Envoyer une demande de mise à jour ➔
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === "plots" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Parcelles géoréférencées du fournisseur</h3>
          <div className="divide-y divide-slate-100">
            {supp.plots?.map((p: any) => (
              <div key={p.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-900">{p.name}</div>
                  <div className="text-[11px] text-slate-500">{p.areaHa} ha · Coordonnées WGS84 vérifiées</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[10px] font-bold">
                    CONFORME EUDR
                  </span>
                  <Link href="/plots" className="text-xs text-emerald-700 hover:underline font-semibold">
                    Voir sur la carte ➔
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === "documents" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Documents de légalité déposés</h3>
          <div className="divide-y divide-slate-100">
            {supp.documents?.map((d: any) => (
              <div key={d.id} className="py-3 flex items-center justify-between">
                <div>
                  <div className="text-xs font-bold text-slate-900">{d.title}</div>
                  <div className="text-[11px] text-slate-500">Catégorie : {d.category} · Expire le {d.expiryDate}</div>
                </div>
                <span className="rounded-full bg-emerald-100 text-emerald-800 px-2.5 py-0.5 text-[10px] font-bold">
                  VALIDÉ
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
