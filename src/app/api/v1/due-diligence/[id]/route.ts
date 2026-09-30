import { type DdrStatus, type DueDiligenceStatementRecord } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const ddr: DueDiligenceStatementRecord = {
    id,
    reference: "DDR-2026-CI-001",
    title: "Dossier DDR Cacao Fèves Brutes — Lot Anvers Octobre 2026",
    commodity: "cocoa",
    hsCode: "18010000",
    supplierId: "sup-ci-001",
    supplierName: "Coopérative Cacaoyère de Divo (COOPADI)",
    productId: "prod-ci-001",
    productName: "Fèves de Cacao Fermentées Séchées",
    status: id.includes("br") ? "RISK_IDENTIFIED" : id.includes("vn") ? "DECLARED" : "READY_FOR_DECLARATION",
    riskLevel: id.includes("br") ? "CRITICAL" : "LOW",
    completenessScore: id.includes("br") ? 65 : 100,
    plotsCount: 8,
    totalAreaHa: 42.6,
    netWeightKg: 25000,
    countryOfProduction: id.includes("br") ? "BR" : "CI",
    operatorInfo: {
      name: "Chocolaterie Européenne SAS",
      eori: "FR12345678901234",
      country: "FR",
      address: "12 Rue de la Paix, 75002 Paris",
      email: "compliance@chocolat-europe.com",
    },
    declarationSignedBy: id.includes("br") ? null : "Claire Dupont (Lead Compliance EUDR)",
    declarationSignedAt: id.includes("br") ? null : "2026-09-29T15:30:00Z",
    tracesReference: id.includes("vn") ? "EUDR.2026.FR.8912450" : null,
    submittedAt: id.includes("vn") ? "2026-09-26T09:15:00Z" : null,
    createdAt: "2026-09-15T09:00:00Z",
    updatedAt: "2026-09-29T15:30:00Z",
  };

  return NextResponse.json(ddr);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { status, declarationSignedBy } = body;

  const updated: Partial<DueDiligenceStatementRecord> = {
    id,
    status: status as DdrStatus,
    declarationSignedBy: declarationSignedBy !== undefined ? declarationSignedBy : undefined,
    declarationSignedAt: declarationSignedBy ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  };

  return NextResponse.json(updated);
}
