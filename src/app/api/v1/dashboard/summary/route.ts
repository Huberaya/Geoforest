import { auditLogs, complianceTasks, documents, dueDiligenceStatements, organizations, parcelAudits, plots, suppliers } from "@/db/schema";
import { supplierCompleteness, UNKNOWN_COUNTRY } from "@/lib/eudr/completeness";
import { and, desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/guard";
import { databaseUnavailableResponse, isDatabaseUnavailable } from "@/lib/api/db-error";
import { countAlerts, deriveAlerts } from "@/lib/api/alerts";

export const dynamic = "force-dynamic";

/** Horizon d'anticipation des échéances documentaires, en jours. */
const HORIZON_DAYS = 60;

/**
 * Synthèse du tableau de bord — uniquement des valeurs **calculées**.
 *
 * ⚠️ Règle de ce chantier (P0-09) : un indicateur qui ne peut pas être calculé
 * est renvoyé `null`, jamais approximé, jamais remplacé par une constante.
 * Ce fichier remplace une route qui déclarait « 14 fournisseurs, 42 parcelles,
 * 1 248,5 ha, 8 dossiers dont 5 prêts, 2 transmis » et un indice de conformité
 * de 91 %, **quelle que soit la base de données**.
 *
 * Chaque valeur non calculable est acompagnée d'une notice explicative, afin
 * que l'écran puisse afficher la raison de l'absence et non un tiret muet.
 */
export const GET = guard("supplier:read")(async (_request: Request, _ctx, { tx, organizationId }): Promise<Response> => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + HORIZON_DAYS * 86_400_000).toISOString().slice(0, 10);
    const notices: string[] = [];

    const [org] = await tx
      .select({ name: organizations.name, country: organizations.country })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    // ---------------------------------------------------------- Fournisseurs
    const supplierRows = await tx
      .select({
        id: suppliers.id,
        name: suppliers.name,
        country: suppliers.country,
        eori: suppliers.eori,
        contactName: suppliers.contactName,
        contactEmail: suppliers.contactEmail,
        contactPhone: suppliers.contactPhone,
        plotsCount: sql<number>`count(${plots.id})`,
        riskLevel: suppliers.riskLevel,
        status: suppliers.status,
      })
      .from(suppliers)
      .leftJoin(plots, eq(plots.supplierId, suppliers.id))
      .where(eq(suppliers.organizationId, organizationId))
      .groupBy(suppliers.id);

    const scores = supplierRows.map((r) => supplierCompleteness({ ...r, plotsCount: Number(r.plotsCount ?? 0) }));
    const suppliersStats = {
      total: supplierRows.length,
      active: supplierRows.filter((r) => r.status === "ACTIVE").length,
      atRisk: supplierRows.filter((r) => r.riskLevel === "HIGH" || r.riskLevel === "CRITICAL").length,
      withoutCountry: supplierRows.filter(
        (r) => !r.country || r.country.trim().toUpperCase() === UNKNOWN_COUNTRY,
      ).length,
      // NULL = non calculable : la moyenne d'un ensemble vide n'existe pas.
      completeness:
        supplierRows.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / supplierRows.length) : null,
    };

    // ------------------------------------------------------------- Parcelles
    const [plotAgg] = await tx
      .select({
        total: sql<number>`count(*)`,
        area: sql<number>`coalesce(sum(${plots.areaHa}), 0)`,
        compliant: sql<number>`count(*) filter (where ${plots.status} = 'COMPLIANT')`,
        nonCompliant: sql<number>`count(*) filter (where ${plots.status} = 'NON_COMPLIANT')`,
        pending: sql<number>`count(*) filter (where ${plots.status} in ('PENDING','INVALID_GEOMETRY'))`,
      })
      .from(plots)
      .where(eq(plots.organizationId, organizationId));

    const plotsTotal = Number(plotAgg?.total ?? 0);
    const plotsStats = {
      total: plotsTotal,
      compliant: Number(plotAgg?.compliant ?? 0),
      nonCompliant: Number(plotAgg?.nonCompliant ?? 0),
      pending: Number(plotAgg?.pending ?? 0),
      totalAreaHa: Number(plotAgg?.area ?? 0),
    };
    if (plotsTotal === 0) {
      notices.push("Aucune parcelle enregistrée : aucune surface ni taux de conformité ne peut être calculé.");
    }

    // ------------------------------------------------------ Analyses & score
    const [auditAgg] = await tx
      .select({
        total: sql<number>`count(*)`,
        probative: sql<number>`count(*) filter (where ${parcelAudits.analysisProbative} = true)`,
        compliant: sql<number>`count(*) filter (where ${parcelAudits.analysisProbative} = true and ${parcelAudits.compliant} = true)`,
        nonCompliant: sql<number>`count(*) filter (where ${parcelAudits.analysisProbative} = true and ${parcelAudits.compliant} = false)`,
      })
      .from(parcelAudits)
      .where(eq(parcelAudits.organizationId, organizationId));

    const probative = Number(auditAgg?.probative ?? 0);
    const decided = Number(auditAgg?.compliant ?? 0) + Number(auditAgg?.nonCompliant ?? 0);

    // Un taux de conformité se calcule sur des analyses probantes **et
    // concluantes**. Sans cela, il n'existe pas : on ne le devine pas.
    const complianceScore = decided > 0 ? Math.round((Number(auditAgg?.compliant ?? 0) / decided) * 100) : null;

    if (probative === 0) {
      notices.push(
        "Aucune analyse probante : l'indice de conformité n'est pas calculable et n'est donc pas affiché.",
      );
    } else if (decided === 0) {
      notices.push(
        "Des analyses ont été menées mais aucune n'est concluante : l'indice de conformité reste non calculable.",
      );
    }

    const analysesStats = {
      total: Number(auditAgg?.total ?? 0),
      probative,
      compliant: Number(auditAgg?.compliant ?? 0),
      nonCompliant: Number(auditAgg?.nonCompliant ?? 0),
    };

    // ----------------------------------------------------------------- Dossiers
    const ddsRows = await tx
      .select({ status: dueDiligenceStatements.status, n: sql<number>`count(*)` })
      .from(dueDiligenceStatements)
      .where(eq(dueDiligenceStatements.organizationId, organizationId))
      .groupBy(dueDiligenceStatements.status);

    const byStatus: Record<string, number> = Object.fromEntries(ddsRows.map((r) => [r.status, Number(r.n)]));
    const ddsTotal = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const ddsStats = {
      total: ddsTotal,
      byStatus,
      inProgress: (byStatus["DRAFT"] ?? 0) + (byStatus["IN_ANALYSIS"] ?? 0) + (byStatus["UNDER_REVIEW"] ?? 0),
      ready: byStatus["READY"] ?? 0,
      // Aucun composant du produit ne peut aujourd'hui transmettre au système
      // d'information EUDR : ce compteur est mesuré, et il est à 0.
      declared: byStatus["DECLARED"] ?? 0,
    };

    // ---------------------------------------------------------------- Documents
    const [docAgg] = await tx
      .select({
        total: sql<number>`count(*)`,
        expiringSoon: sql<number>`count(*) filter (where ${documents.expiryDate} is not null and ${documents.expiryDate} > ${today} and ${documents.expiryDate} <= ${horizon})`,
        expired: sql<number>`count(*) filter (where ${documents.expiryDate} is not null and ${documents.expiryDate} <= ${today})`,
      })
      .from(documents)
      .where(eq(documents.organizationId, organizationId));

    const documentsStats = {
      total: Number(docAgg?.total ?? 0),
      expiringSoon: Number(docAgg?.expiringSoon ?? 0),
      expired: Number(docAgg?.expired ?? 0),
      // NULL : aucune matrice de pièces obligatoires n'est configurée dans le
      // produit. Dire « 4 pièces manquantes » serait inventer une mesure.
      missing: null as number | null,
    };
    notices.push(
      "Aucune matrice de pièces obligatoires n'est configurée : le nombre de documents manquants n'est pas mesurable.",
    );

    // ------------------------------------------------------------ Alertes
    const alerts = await deriveAlerts(tx, organizationId);
    const alertCounts = countAlerts(alerts);

    // ------------------------------------------------ Actions en attente
    // Issues des tâches réellement enregistrées, jamais d'un scénario écrit
    // à l'avance. Une tâche sans échéance n'est pas « due aujourd'hui ».
    const taskRows = await tx
      .select({
        id: complianceTasks.id,
        title: complianceTasks.title,
        description: complianceTasks.description,
        severity: complianceTasks.severity,
        status: complianceTasks.status,
        dueDate: complianceTasks.dueDate,
        assignee: complianceTasks.assignee,
      })
      .from(complianceTasks)
      .where(
        and(
          eq(complianceTasks.organizationId, organizationId),
          sql`${complianceTasks.status} in ('TO_HANDLE','IN_PROGRESS')`,
        ),
      )
      .orderBy(complianceTasks.dueDate)
      .limit(20);

    const urgentActions = taskRows.map((t) => ({
      id: t.id,
      kind: "TASK",
      severity: t.severity,
      title: t.title,
      description: t.description ?? (t.assignee ? `Assigné à ${t.assignee}.` : null),
      dueDate: t.dueDate,
      overdue: t.dueDate !== null && t.dueDate < today,
      href: "/risks",
    }));

    // ---------------------------------------------------- Activité récente
    // Le journal d'audit est la seule source d'activité : toute entrée
    // provient d'une action réellement effectuée dans le produit.
    const activityRows = await tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        userEmail: auditLogs.userEmail,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .where(eq(auditLogs.organizationId, organizationId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(8);

    const recentActivities = activityRows.map((a) => ({
      id: a.id,
      // Horodatage réel, jamais recalculé à partir de `Date.now()`.
      timestamp: a.createdAt.toISOString(),
      actor: a.userEmail,
      action: a.action,
      entityType: a.entityType,
      entityId: a.entityId,
    }));


    return NextResponse.json({
      organizationName: org?.name ?? null,
      organizationCountry: org?.country ?? null,
      generatedAt: new Date().toISOString(),
      // NULL = non calculable. L'écran affiche « — » et la notice associée.
      complianceScore,
      complianceScoreBasis: {
        probativeAnalyses: probative,
        decidedAnalyses: decided,
        compliant: Number(auditAgg?.compliant ?? 0),
        nonCompliant: Number(auditAgg?.nonCompliant ?? 0),
      },
      stats: {
        suppliers: suppliersStats,
        plots: plotsStats,
        analyses: analysesStats,
        dds: ddsStats,
        documents: documentsStats,
        alerts: alertCounts,
      },
      urgentActions,
      recentActivities,
      notices,
      // Ce qui alimente chaque chiffre, pour qu'un auditeur puisse vérifier.
      derived_from: [
        "gf_suppliers",
        "gf_plots",
        "parcel_audits (analyses probantes uniquement)",
        "gf_due_diligence_statements",
        "gf_documents",
        "gf_compliance_tasks",
        "gf_audit_logs",
      ],
    });
  } catch (err) {
    // P0-07 : une base injoignable se déclare en 503, une erreur inattendue en
    // 500 explicite. Dans les deux cas, aucun chiffre n'est inventé.
    console.error("Dashboard summary error:", err);
    if (isDatabaseUnavailable(err)) return databaseUnavailableResponse(err);
    return NextResponse.json({ detail: "Synthèse indisponible" }, { status: 500 });
  }
});
