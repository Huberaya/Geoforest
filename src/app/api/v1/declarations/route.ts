import { type DeclarationStatus, type TracesDeclarationRecord } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

const MOCK_DECLARATIONS: TracesDeclarationRecord[] = [
  {
    id: "dec-001-vn-coffee",
    ddrId: "ddr-004-cafe-vn",
    ddrReference: "DDR-2026-VN-004",
    reference: "TRACES-2026-09-001",
    tracesReference: "EUDR.2026.FR.8912450",
    operatorName: "Chocolaterie Européenne SAS",
    operatorEori: "FR12345678901234",
    commodity: "coffee",
    hsCode: "09011100",
    netWeightKg: 18000,
    activityType: "IMPORT",
    status: "TRANSMITTED",
    exportedAt: "2026-09-25T16:00:00Z",
    submittedAt: "2026-09-26T09:15:00Z",
    jsonPayload: JSON.stringify(
      {
        eudrDeclaration: {
          reference: "EUDR.2026.FR.8912450",
          operator: { name: "Chocolaterie Européenne SAS", eori: "FR12345678901234" },
          commodity: "09011100",
          netWeightKg: 18000,
          complianceStatement: "Art. 4, 8, 9, 10, 11 Regulation (EU) 2023/1115",
          plots: [{ polygonCount: 6, areaHa: 28.0, country: "VN" }],
        },
      },
      null,
      2,
    ),
    createdAt: "2026-09-25T15:00:00Z",
  },
  {
    id: "dec-002-ci-cacao",
    ddrId: "ddr-001-cacao-ci",
    ddrReference: "DDR-2026-CI-001",
    reference: "TRACES-2026-09-002",
    tracesReference: null,
    operatorName: "Chocolaterie Européenne SAS",
    operatorEori: "FR12345678901234",
    commodity: "cocoa",
    hsCode: "18010000",
    netWeightKg: 25000,
    activityType: "IMPORT",
    status: "READY",
    exportedAt: null,
    submittedAt: null,
    jsonPayload: JSON.stringify(
      {
        eudrDeclaration: {
          operator: { name: "Chocolaterie Européenne SAS", eori: "FR12345678901234" },
          commodity: "18010000",
          netWeightKg: 25000,
          complianceStatement: "Article 4, 9 Regulation (EU) 2023/1115 verified",
          plots: [{ polygonCount: 8, areaHa: 42.6, country: "CI" }],
        },
      },
      null,
      2,
    ),
    createdAt: "2026-09-29T16:00:00Z",
  },
];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");

    let filtered = MOCK_DECLARATIONS;
    if (status && status !== "ALL") filtered = filtered.filter((d) => d.status === status);

    return NextResponse.json(filtered);
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la récupération des déclarations" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { ddrId, ddrReference, operatorName, operatorEori, commodity, hsCode, netWeightKg } = body;

    const newDec: TracesDeclarationRecord = {
      id: `dec-${Date.now()}`,
      ddrId: ddrId || "ddr-001",
      ddrReference: ddrReference || "DDR-2026-001",
      reference: `TRACES-${Date.now().toString().slice(-4)}`,
      tracesReference: null,
      operatorName: operatorName || "Opérateur UE",
      operatorEori: operatorEori || "FR12345678901234",
      commodity: commodity || "cocoa",
      hsCode: hsCode || "18010000",
      netWeightKg: Number(netWeightKg) || 10000,
      activityType: "IMPORT",
      status: "READY",
      exportedAt: new Date().toISOString(),
      submittedAt: null,
      jsonPayload: JSON.stringify(
        {
          eudrDeclaration: {
            operator: { name: operatorName, eori: operatorEori },
            commodity: hsCode,
            netWeightKg,
            status: "READY_FOR_SUBMISSION",
          },
        },
        null,
        2,
      ),
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json(newDec, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la création de la déclaration" }, { status: 500 });
  }
}
