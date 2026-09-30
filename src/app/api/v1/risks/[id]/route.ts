import { type RiskItem, type RiskMitigationStatus } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const item: RiskItem = {
    id,
    reference: "RSK-2026-001",
    title: "Évaluation de risque EUDR",
    commodity: "soya",
    supplierName: "AgroPecuária do Pará Ltda",
    overallScore: 85,
    riskLevel: "CRITICAL",
    status: "TO_TREAT",
    countryRisk: "STANDARD",
    deforestationRisk: "CRITICAL",
    legalityRisk: "HIGH",
    supplyChainRisk: "STANDARD",
    reasons: ["Perte forestière post-2020", "Document expiré"],
    mitigationPlan: "Mise en quarantaine du lot.",
    createdAt: "2026-09-27T10:00:00Z",
  };

  return NextResponse.json(item);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { status, mitigationPlan, assignedTo } = body;

  const updated: Partial<RiskItem> = {
    id,
    status: status as RiskMitigationStatus,
    mitigationPlan,
    assignedTo,
    validatedAt: status === "VALIDATED" ? new Date().toISOString() : null,
  };

  return NextResponse.json(updated);
}
