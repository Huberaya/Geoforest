"use client";

import { COMMODITY_LABELS, type Commodity, type RiskLevel, type SupplierDetail } from "@/lib/eudr/types";
import { UNKNOWN_COUNTRY } from "@/lib/eudr/completeness";
import Link from "next/link";
import { use, useEffect, useState } from "react";

const RISK_LABELS: Record<RiskLevel, string> = {
  LOW: "Faible",
  STANDARD: "Standard",
  HIGH: "Élevé",
  CRITICAL: "Critique",
};

const RISK_STYLES: Record<RiskLevel, string> = {
  LOW: "bg-emerald-100 text-emerald-800",
  STANDARD: "bg-slate-100 text-slate-700",
  HIGH: "bg-amber-100 text-amber-800",
  CRITICAL: "bg-rose-100 text-rose-800",
};

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Actif",
  PENDING_INVITE: "Invitation en attente",
  SUSPENDED: "Suspendu",
};

const PLOT_STATUS_LABELS: Record<string, string> = {
  COMPLIANT: "Conforme",
  NON_COMPLIANT: "Non conforme",
  PENDING: "À analyser",
  INVALID_GEOMETRY: "Géométrie invalide",
};

const PLOT_STATUS_STYLES: Record<string, string> = {
  COMPLIANT: "bg-emerald-100 text-emerald-800",
  NON_COMPLIANT: "bg-rose-100 text-rose-800",
  PENDING: "bg-slate-100 text-slate-600",
  INVALID_GEOMETRY: "bg-amber-100 text-amber-800",
};

const DOC_STATUS_LABELS: Record<string, string> = {
  VALID: "Valide",
  EXPIRED: "Expiré",
  TO_VERIFY: "À vérifier",
  REJECTED: "Rejeté",
};

const DOC_STATUS_STYLES: Record<string, string> = {
  VALID: "bg-emerald-100 text-emerald-800",
  EXPIRED: "bg-rose-100 text-rose-800",
  TO_VERIFY: "bg-amber-100 text-amber-800",
  REJECTED: "bg-slate-100 text-slate-600",
};

/** Drapeau dérivé du code pays ; aucun drapeau n'est affiché pour un pays inconnu. */
function flagOf(code: string | null): string {
  if (!code || code.trim().toUpperCase() === UNKNOWN_COUNTRY || !/^[A-Za-z]{2}$/.test(code)) return "🌐";
  return String.fromCodePoint(...code.toUpperCase().split("").map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function countryLabel(code: string | null): string {
  if (!code || code.trim().toUpperCase() === UNKNOWN_COUNTRY) return "Pays non renseigné";
  return code.toUpperCase();
}

const surface = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2 });

export default function SupplierDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [activeTab, setActiveTab] = useState<"overview" | "plots" | "documents">("overview");
  const [supplier, setSupplier] = useState<SupplierDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/v1/suppliers/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (cancelled) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        if (!res.ok) {
          setLoadError(`Fiche indisponible (HTTP ${res.status}).`);
          return;
        }
        setSupplier((await res.json()) as SupplierDetail);
      } catch {
        if (!cancelled) setLoadError("Impossible de joindre le serveur.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
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

  // ⚠️ P0-09 : aucun fournisseur de substitution n'est affiché. Un identifiant
  // inconnu ne « ressemble » pas à un fournisseur conforme : il n'existe pas.
  if (notFound || !supplier) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xs">
          <div className="text-3xl">🔍</div>
          <h1 className="mt-3 text-sm font-bold text-slate-900">Fournisseur introuvable</h1>
          <p className="mt-2 text-xs text-slate-500">
            {loadError ??
              "Aucun fournisseur ne correspond à cet identifiant dans votre organisation. Il a pu être supprimé, ou appartenir à une autre organisation."}
          </p>
          <Link
            href="/suppliers"
            className="mt-4 inline-block rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            ← Retour à la liste des fournisseurs
          </Link>
        </div>
      </div>
    );
  }

  const supp = supplier;
  const totalArea = supp.plots.reduce((sum, p) => sum + (p.areaHa ?? 0), 0);
  const compliantPlots = supp.plots.filter((p) => p.status === "COMPLIANT").length;
  const validDocs = supp.documents.filter((d) => d.status === "VALID").length;

  return (
    <div className="space-y-6">
      {/* Fil d'Ariane */}
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

      {/* Bandeau d'identité — toutes les valeurs viennent de l'API */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="text-2xl">{flagOf(supp.country)}</span>
              <h1 className="text-xl font-bold text-slate-900">{supp.name}</h1>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10px] font-bold text-slate-700">
                {STATUS_LABELS[supp.status] ?? supp.status}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <div>
                EORI :{" "}
                <span className="font-mono text-slate-800">
                  {supp.eori ?? <span className="text-amber-700">non renseigné</span>}
                </span>
              </div>
              <div>•</div>
              <div>
                Matière première :{" "}
                <span className="font-medium text-slate-800">
                  {COMMODITY_LABELS[supp.commodity as Commodity] ?? supp.commodity}
                </span>
              </div>
              <div>•</div>
              <div>
                Contact :{" "}
                <span className="text-slate-800">
                  {supp.contactName ?? <span className="text-amber-700">non renseigné</span>}
                  {supp.contactEmail ? ` (${supp.contactEmail})` : ""}
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-100">
            <div className="text-right">
              <div className="text-[10px] uppercase font-semibold text-slate-400">Score de complétude</div>
              <div className="text-xl font-extrabold text-slate-800">{supp.completenessScore}%</div>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="text-right">
              <div className="text-[10px] uppercase font-semibold text-slate-400">Niveau de risque</div>
              <div
                className={`text-xs font-bold px-2 py-0.5 rounded-full mt-1 ${RISK_STYLES[supp.riskLevel as RiskLevel] ?? RISK_STYLES.STANDARD}`}
              >
                {RISK_LABELS[supp.riskLevel as RiskLevel] ?? supp.riskLevel}
              </div>
            </div>
          </div>
        </div>

        {/* Onglets */}
        <div className="mt-6 flex flex-wrap border-b border-slate-200 text-xs font-semibold">
          {[
            { id: "overview", label: "Vue d'ensemble" },
            { id: "plots", label: `Parcelles (${supp.plots.length})` },
            { id: "documents", label: `Documents de légalité (${supp.documents.length})` },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as "overview" | "plots" | "documents")}
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

      {activeTab === "overview" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Synthèse de diligence raisonnée
              </h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                {supp.plots.length === 0
                  ? "Aucune parcelle géolocalisée n'est rattachée à ce fournisseur : aucune analyse satellite ne peut être menée et aucun dossier de diligence raisonnée ne peut être constitué."
                  : `Les valeurs ci-dessous sont calculées sur les ${supp.plots.length} parcelle(s) et les ${supp.documents.length} document(s) réellement enregistrés pour ce fournisseur.`}
              </p>
              <div className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3">
                <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                  <div className="text-[10px] text-slate-400">Surface totale déclarée</div>
                  <div className="text-sm font-bold text-slate-800">{surface.format(totalArea)} ha</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                  <div className="text-[10px] text-slate-400">Parcelles conformes</div>
                  <div className="text-sm font-bold text-slate-800">
                    {supp.plots.length > 0 ? `${compliantPlots} / ${supp.plots.length}` : "—"}
                  </div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3 border border-slate-100">
                  <div className="text-[10px] text-slate-400">Pièces de légalité valides</div>
                  <div className="text-sm font-bold text-slate-800">
                    {supp.documents.length > 0 ? `${validDocs} / ${supp.documents.length}` : "—"}
                  </div>
                </div>
              </div>
              {supp.missingData.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                    Données manquantes
                  </div>
                  <ul className="mt-1.5 space-y-0.5">
                    {supp.missingData.map((m) => (
                      <li key={m} className="text-[11px] text-amber-800">
                        • {m}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs space-y-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">Contact & localisation</h3>
              <div className="text-xs space-y-2 text-slate-700">
                <div>
                  <strong>Téléphone :</strong> {supp.contactPhone ?? <span className="text-amber-700">non renseigné</span>}
                </div>
                <div>
                  <strong>Courriel :</strong> {supp.contactEmail ?? <span className="text-amber-700">non renseigné</span>}
                </div>
                <div>
                  <strong>Pays :</strong> {countryLabel(supp.country)}
                </div>
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
          <h3 className="text-sm font-bold text-slate-900 mb-4">Parcelles rattachées à ce fournisseur</h3>
          {supp.plots.length === 0 ? (
            <p className="text-xs text-slate-500">Aucune parcelle enregistrée pour ce fournisseur.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {supp.plots.map((p) => (
                <div key={p.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-900">{p.name}</div>
                    <div className="text-[11px] text-slate-500">
                      {surface.format(p.areaHa ?? 0)} ha · {p.geometryType} · {p.countryCode}
                      {p.reference ? ` · réf. ${p.reference}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${PLOT_STATUS_STYLES[p.status] ?? PLOT_STATUS_STYLES.PENDING}`}
                    >
                      {PLOT_STATUS_LABELS[p.status] ?? p.status}
                    </span>
                    <Link href={`/plots/${p.id}`} className="text-xs text-emerald-700 hover:underline font-semibold">
                      Voir la fiche ➔
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === "documents" && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 mb-4">Documents de légalité déposés</h3>
          {supp.documents.length === 0 ? (
            <p className="text-xs text-slate-500">Aucun document déposé pour ce fournisseur.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {supp.documents.map((d) => (
                <div key={d.id} className="py-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold text-slate-900">{d.title}</div>
                    <div className="text-[11px] text-slate-500">
                      Catégorie : {d.category} ·{" "}
                      {d.expiryDate ? `Expire le ${d.expiryDate}` : "sans date d'expiration"}
                    </div>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${DOC_STATUS_STYLES[d.status] ?? DOC_STATUS_STYLES.TO_VERIFY}`}
                  >
                    {DOC_STATUS_LABELS[d.status] ?? d.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
