"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import KpiCard from "@/components/ui/KpiCard";
import AlertRow from "@/components/dashboard/AlertRow";
import OnboardingChecklist from "@/components/dashboard/OnboardingChecklist";
import QuickActions from "@/components/dashboard/QuickActions";
import { useAuth } from "@/contexts/AuthContext";
import {
  type DashboardOverview,
  markAlertRead,
  fetchDashboardOverview,
} from "@/lib/api";

function formatNumber(n: number) {
  return new Intl.NumberFormat("fr-FR").format(n);
}

function formatPct(n: number | null) {
  if (n === null || n === undefined) return "—";
  return `${Math.round(n)} %`;
}

export default function DashboardPage() {
  const { user, organization } = useAuth();
  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const d = await fetchDashboardOverview();
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger le tableau de bord");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleMarkRead(id: string) {
    await markAlertRead(id);
    void load();
  }

  if (loading && !data) {
    return (
      <div className="flex h-96 items-center justify-center text-sm text-slate-500">
        Chargement du tableau de bord…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card max-w-lg">
        <h2 className="text-lg font-semibold text-red-700">Erreur</h2>
        <p className="mt-1 text-sm text-slate-600">{error}</p>
        <button className="btn-secondary mt-4" onClick={load}>Réessayer</button>
      </div>
    );
  }

  const k = data.kpis;
  const completed = data.onboarding.completed;
  const total = data.onboarding.total;
  const isEmptyState = completed === 0;

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Bienvenue, {user?.first_name || user?.email} 👋
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Espace de conformité EUDR — <span className="font-semibold text-slate-700">{organization?.name}</span>
            {organization?.country ? ` (${organization.country})` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            Mise à jour : {new Date(data.generated_at).toLocaleTimeString("fr-FR")}
          </span>
          <button
            onClick={load}
            className="btn-secondary px-3 py-1.5 text-xs"
            aria-label="Actualiser"
          >
            ↻ Actualiser
          </button>
        </div>
      </div>

      {/* KPI principaux */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard
          label="Conformité globale"
          value={formatPct(k.compliance_pct)}
          sub={k.compliance_pct === null ? "Aucun dossier pour le moment" : "Dossiers DDR validés"}
          icon={<span>🎯</span>}
          tone={k.compliance_pct === null ? "slate" : k.compliance_pct >= 80 ? "emerald" : k.compliance_pct >= 50 ? "amber" : "red"}
        />
        <KpiCard
          label="Parcelles analysées"
          value={formatNumber(k.plots_analyzed)}
          sub={`${formatNumber(k.plots_total)} parcelles au total`}
          icon={<span>🗺️</span>}
          tone="sky"
          comingSoon
        />
        <KpiCard
          label="Parcelles à action"
          value={formatNumber(k.plots_action_required)}
          sub="Géométrie invalide ou à vérifier"
          icon={<span>📍</span>}
          tone={k.plots_action_required > 0 ? "amber" : "emerald"}
          onClick={() => (window.location.href = "/plots")}
        />
        <KpiCard
          label="Dossiers prêts"
          value={formatNumber(k.dds_ready)}
          sub={`${formatNumber(k.dds_incomplete)} incomplets · ${formatNumber(k.dds_at_risk)} à risque`}
          icon={<span>📋</span>}
          tone={k.dds_ready > 0 ? "emerald" : "slate"}
          comingSoon
        />
      </div>

      {/* KPI secondaires */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
        <KpiCard label="Fournisseurs" value={formatNumber(k.suppliers_count)} icon={<span>🏭</span>} tone="violet" onClick={() => (window.location.href = "/suppliers")} />
        <KpiCard label="Produits" value={formatNumber(k.products_count)} icon={<span>📦</span>} onClick={() => (window.location.href = "/products")} />
        <KpiCard label="Lots" value={formatNumber(k.shipments_count)} icon={<span>🚚</span>} onClick={() => (window.location.href = "/shipments")} />
        <KpiCard
          label="Documents expirés"
          value={formatNumber(k.documents_expiring_soon)}
          icon={<span>📄</span>}
          tone={k.documents_expiring_soon > 0 ? "amber" : "slate"}
          comingSoon
        />
        <KpiCard
          label="Données manquantes"
          value={formatNumber(k.documents_missing)}
          icon={<span>❗</span>}
          tone={k.documents_missing > 0 ? "amber" : "slate"}
          comingSoon
        />
        <KpiCard
          label="Membres équipe"
          value={formatNumber(k.users_count)}
          sub="Équipe active"
          icon={<span>👥</span>}
          tone="emerald"
          onClick={() => {
            window.location.href = "/settings";
          }}
        />
      </div>

      {/* Alertes critiques / warning en haut */}
      {(k.critical_alerts > 0 || k.warning_alerts > 0) && (
        <div className="flex flex-wrap gap-2">
          {k.critical_alerts > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-semibold text-red-800">
              🔴 {k.critical_alerts} alerte{k.critical_alerts > 1 ? "s" : ""} critique{k.critical_alerts > 1 ? "s" : ""}
            </span>
          )}
          {k.warning_alerts > 0 && (
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
              🟠 {k.warning_alerts} avertissement{k.warning_alerts > 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      {/* Contenu principal */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Onboarding banner si état zéro */}
          {isEmptyState && (
            <div className="card border-emerald-200 bg-gradient-to-br from-emerald-50 to-white">
              <h2 className="text-base font-bold text-emerald-900">
                Votre espace est prêt 🌱
              </h2>
              <p className="mt-1 text-sm text-emerald-800">
                Suivez les étapes ci-contre pour configurer votre première chaîne
                d'approvisionnement : de vos fournisseurs jusqu'au dossier de
                diligence raisonnée.
              </p>
              <p className="mt-2 text-xs text-emerald-700/80">
                {data.labels.note}
              </p>
            </div>
          )}

          {/* Alertes récentes */}
          <div className="card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">🔔 Alertes récentes</h3>
              <Link
                href="/alerts"
                className="text-xs font-semibold text-emerald-700 hover:underline"
              >
                Voir tout →
              </Link>
            </div>
            <div className="space-y-2">
              {data.recent_alerts.length === 0 && (
                <p className="rounded-lg bg-slate-50 p-4 text-center text-xs text-slate-500">
                  Aucune alerte pour le moment.
                </p>
              )}
              {data.recent_alerts.map((a) => (
                <AlertRow key={a.id} alert={a} onMarkRead={handleMarkRead} />
              ))}
            </div>
          </div>

          {/* Info réglementaire */}
          <div className="card border-slate-200 bg-slate-50/50">
            <div className="flex gap-3">
              <span className="text-lg">🇪🇺</span>
              <div className="text-xs leading-relaxed text-slate-600">
                <strong className="text-slate-800">Rappel réglementaire.</strong>{" "}
                Le Règlement (UE) 2023/1115 (EUDR) s'applique à partir du{" "}
                <strong>30 décembre 2026</strong> pour les grandes et moyennes
                entreprises, et du <strong>30 juin 2027</strong> pour les micro et
                petites entreprises. Les analyses automatisées de GeoForest Trace
                sont systématiquement étiquetées et ne constituent pas une
                certification juridique : la validation humaine reste requise
                avant toute déclaration.
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <OnboardingChecklist
            steps={data.onboarding.steps}
            completed={data.onboarding.completed}
            total={data.onboarding.total}
          />
          <QuickActions />
        </aside>
      </div>
    </div>
  );
}
