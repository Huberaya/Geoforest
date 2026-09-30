import { type AuditLogRecord } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

const MOCK_AUDIT_LOGS: AuditLogRecord[] = [
  {
    id: "log-001",
    userEmail: "claire.dupont@chocolat-europe.com",
    action: "SIGN_DDR_STATEMENT",
    entityType: "DUE_DILIGENCE_STATEMENT",
    entityId: "ddr-001-cacao-ci",
    entityReference: "DDR-2026-CI-001",
    details: "Signature électronique de l'attestation sur l'honneur (Art. 4(2) EUDR) - Risque Négligeable attesté.",
    oldValue: "status: DRAFT",
    newValue: "status: READY_FOR_DECLARATION",
    ipAddress: "194.254.120.34",
    createdAt: "2026-09-29T15:30:00Z",
  },
  {
    id: "log-002",
    userEmail: "marc.lemoine@chocolat-europe.com",
    action: "RUN_GEOSPATIAL_ANALYSIS",
    entityType: "PLOT",
    entityId: "plot-ci-001",
    entityReference: "PAR-CI-DIV-01",
    details: "Audit multi-spectral déforestation post-2020 : Hansen GFW 30m, Sentinel-2 NDVI et buffer 50m. Résultat : Conforme.",
    oldValue: "auditStatus: PENDING",
    newValue: "auditStatus: COMPLIANT",
    ipAddress: "194.254.120.35",
    createdAt: "2026-09-28T14:32:00Z",
  },
  {
    id: "log-003",
    userEmail: "system",
    action: "ALERT_DEFORESTATION_TRIGGERED",
    entityType: "PLOT",
    entityId: "plot-br-002",
    entityReference: "PAR-BR-PARA-04",
    details: "Perte de couvert forestier détectée en 2022 (58.4 ha). Statut mis à jour en NON_COMPLIANT.",
    oldValue: "status: PENDING",
    newValue: "status: NON_COMPLIANT, riskLevel: CRITICAL",
    ipAddress: "127.0.0.1",
    createdAt: "2026-09-27T09:15:00Z",
  },
  {
    id: "log-004",
    userEmail: "claire.dupont@chocolat-europe.com",
    action: "VALIDATE_DOCUMENT_LEGALITY",
    entityType: "DOCUMENT",
    entityId: "doc-001-foncier-ci",
    entityReference: "CFR-DIV-2025-084",
    details: "Validation du certificat foncier rural collectif émis par le Ministère de l'Agriculture de Côte d'Ivoire.",
    oldValue: "status: TO_VERIFY",
    newValue: "status: VALID",
    ipAddress: "194.254.120.34",
    createdAt: "2026-09-25T11:00:00Z",
  },
  {
    id: "log-005",
    userEmail: "claire.dupont@chocolat-europe.com",
    action: "EXPORT_TRACES_JSON",
    entityType: "DECLARATION",
    entityId: "dec-001-vn-coffee",
    entityReference: "TRACES-2026-09-001",
    details: "Génération et export du fichier normalisé pour transmission au portail douanier TRACES-NT.",
    oldValue: "status: DRAFT",
    newValue: "status: EXPORTED",
    ipAddress: "194.254.120.34",
    createdAt: "2026-09-25T16:00:00Z",
  },
];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");
    const entityType = searchParams.get("entityType");

    let filtered = MOCK_AUDIT_LOGS;
    if (action && action !== "ALL") filtered = filtered.filter((l) => l.action === action);
    if (entityType && entityType !== "ALL") filtered = filtered.filter((l) => l.entityType === entityType);

    return NextResponse.json(filtered);
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la récupération des logs d'audit" }, { status: 500 });
  }
}
