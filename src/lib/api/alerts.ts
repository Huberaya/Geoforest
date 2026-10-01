import { complianceTasks, documents, dueDiligenceStatements, parcelAudits, plots, suppliers } from "@/db/schema";
import type { Alert } from "@/lib/eudr/types";
import { and, asc, eq, isNotNull, lt, sql } from "drizzle-orm";
import type { TenantTx } from "@/lib/tenant";

/** Horizon d'anticipation des échéances documentaires, en jours. */
export const ALERT_HORIZON_DAYS = 60;

/**
 * Alertes **calculées** à partir des données réelles du tenant.
 *
 * ⚠️ Aucune alerte n'est codée en dur. Un tenant sans donnée obtient une liste
 * vide — ce qui est une information exacte, pas une absence de fonctionnalité.
 *
 * Cette fonction est partagée par `GET /api/v1/alerts` et par la synthèse du
 * tableau de bord, afin que les deux ne puissent pas afficher des compteurs
 * différents calculés avec des règles différentes.
 */
export async function deriveAlerts(tx: TenantTx, organizationId: string): Promise<Alert[]> {
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + ALERT_HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
  const alerts: Alert[] = [];

  // 1. Documents expirés ou proches de l'échéance
  const docs = await tx
    .select({
      id: documents.id,
      title: documents.title,
      expiryDate: documents.expiryDate,
      supplierName: suppliers.name,
    })
    .from(documents)
    .leftJoin(suppliers, eq(suppliers.id, documents.supplierId))
    .where(
      and(
        eq(documents.organizationId, organizationId),
        isNotNull(documents.expiryDate),
        sql`${documents.expiryDate} <= ${horizon}`,
      ),
    )
    .orderBy(asc(documents.expiryDate))
    .limit(100);

  for (const d of docs) {
    const expired = (d.expiryDate ?? "") < today;
    alerts.push({
      id: `doc-${d.id}`,
      severity: expired ? "CRITICAL" : "MEDIUM",
      kind: "DOCUMENT_EXPIRY",
      title: expired ? `Document expiré — ${d.title}` : `Document à renouveler — ${d.title}`,
      description:
        `${d.supplierName ? `Fournisseur ${d.supplierName} · ` : ""}` +
        (expired ? `Échu depuis le ${d.expiryDate}.` : `Échéance le ${d.expiryDate}.`),
      entityType: "DOCUMENT",
      entityId: d.id,
      href: "/documents",
      dueDate: d.expiryDate,
    });
  }

  // 2. Déforestation détectée par une analyse (uniquement si elle est probante
  //    et concluante : une analyse indisponible n'est pas une alerte)
  const deforestation = await tx
    .select({
      id: parcelAudits.id,
      parcelReference: parcelAudits.parcelReference,
      lossYear: parcelAudits.lossYear,
      countryCode: parcelAudits.countryCode,
    })
    .from(parcelAudits)
    .where(
      and(
        eq(parcelAudits.organizationId, organizationId),
        eq(parcelAudits.analysisProbative, true),
        sql`${parcelAudits.lossYear} > 2020`,
      ),
    )
    .limit(100);

  for (const a of deforestation) {
    alerts.push({
      id: `def-${a.id}`,
      severity: "CRITICAL",
      kind: "DEFORESTATION",
      title: `Déforestation détectée — ${a.parcelReference ?? a.id.slice(0, 8)}`,
      description:
        `Perte de couvert forestier en ${a.lossYear} (après la date butoir du 31/12/2020), ` +
        `sur une parcelle située en ${a.countryCode}. Analyse probante.`,
      entityType: "AUDIT",
      entityId: a.id,
      href: "/analyses",
      dueDate: null,
    });
  }

  // 3. Tâches échues
  const overdue = await tx
    .select({ task: complianceTasks, ddsReference: dueDiligenceStatements.reference })
    .from(complianceTasks)
    .leftJoin(dueDiligenceStatements, eq(dueDiligenceStatements.id, complianceTasks.diligenceId))
    .where(
      and(
        eq(complianceTasks.organizationId, organizationId),
        isNotNull(complianceTasks.dueDate),
        lt(complianceTasks.dueDate, today),
        sql`${complianceTasks.status} in ('TO_HANDLE','IN_PROGRESS')`,
      ),
    )
    .limit(100);

  for (const t of overdue) {
    alerts.push({
      id: `task-${t.task.id}`,
      severity: t.task.severity === "CRITICAL" ? "CRITICAL" : "HIGH",
      kind: "TASK_OVERDUE",
      title: `Action en retard — ${t.task.title}`,
      description: `${t.ddsReference ? `Dossier ${t.ddsReference} · ` : ""}Échéance dépassée le ${t.task.dueDate}.`,
      entityType: "TASK",
      entityId: t.task.id,
      href: "/risks",
      dueDate: t.task.dueDate,
    });
  }

  // 4. Fournisseurs sans parcelle : donnée manquante bloquante pour un DDS.
  //    Le rattachement est compté à partir de `gf_plots`, et non de la colonne
  //    `plots_count` : cette dernière n'était maintenue que par le portail
  //    fournisseur, si bien qu'une parcelle créée depuis l'écran Parcelles ne
  //    s'y reflétait pas et déclenchait cette alerte à tort.
  const rattachees = await tx
    .select({ supplierId: plots.supplierId })
    .from(plots)
    .where(eq(plots.organizationId, organizationId));
  const ayantUneParcelle = new Set(
    rattachees.map((r) => r.supplierId).filter((v): v is string => Boolean(v)),
  );

  const tousLesFournisseurs = await tx
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(eq(suppliers.organizationId, organizationId))
    .limit(100);
  const noPlots = tousLesFournisseurs.filter((s) => !ayantUneParcelle.has(s.id));

  for (const s of noPlots) {
    alerts.push({
      id: `sup-${s.id}`,
      severity: "MEDIUM",
      kind: "MISSING_DATA",
      title: `Aucune parcelle déclarée — ${s.name}`,
      description:
        "Sans géolocalisation des parcelles, aucun dossier de diligence raisonnée ne peut être " +
        "constitué pour ce fournisseur (art. 9(1)(d) du règlement 2023/1115).",
      entityType: "SUPPLIER",
      entityId: s.id,
      href: "/suppliers",
      dueDate: null,
    });
  }

  // 5. Parcelles de plus de 4 ha sans polygone
  const bigPoints = await tx
    .select({ id: plots.id, name: plots.name, areaHa: plots.areaHa })
    .from(plots)
    .where(
      and(eq(plots.organizationId, organizationId), eq(plots.geometryType, "Point"), sql`${plots.areaHa} > 4`),
    )
    .limit(100);

  for (const p of bigPoints) {
    alerts.push({
      id: `geo-${p.id}`,
      severity: "HIGH",
      kind: "MISSING_DATA",
      title: `Polygone requis — ${p.name}`,
      description:
        `Parcelle déclarée à ${p.areaHa.toFixed(2)} ha avec un simple point. Au-delà de 4 ha, ` +
        `le règlement exige un polygone géolocalisé (art. 9(1)(d)).`,
      entityType: "PLOT",
      entityId: p.id,
      href: "/plots",
      dueDate: null,
    });
  }

  const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));

  return alerts;
}

/** Compteurs par sévérité, dérivés de la même liste que celle affichée. */
export function countAlerts(alerts: Alert[]): { critical: number; high: number; medium: number; total: number } {
  return {
    critical: alerts.filter((a) => a.severity === "CRITICAL").length,
    high: alerts.filter((a) => a.severity === "HIGH").length,
    medium: alerts.filter((a) => a.severity === "MEDIUM").length,
    total: alerts.length,
  };
}
