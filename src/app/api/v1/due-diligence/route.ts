import { type Commodity, type DueDiligenceStatementRecord } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

const MOCK_DDRS: DueDiligenceStatementRecord[] = [
  {
    id: "ddr-001-cacao-ci",
    reference: "DDR-2026-CI-001",
    title: "Dossier DDR Cacao Fèves Brutes — Lot Anvers Octobre 2026",
    commodity: "cocoa",
    hsCode: "18010000",
    supplierId: "sup-ci-001",
    supplierName: "Coopérative Cacaoyère de Divo (COOPADI)",
    productId: "prod-ci-001",
    productName: "Fèves de Cacao Fermentées Séchées",
    status: "READY_FOR_DECLARATION",
    riskLevel: "LOW",
    completenessScore: 100,
    plotsCount: 8,
    totalAreaHa: 42.6,
    netWeightKg: 25000,
    countryOfProduction: "CI",
    operatorInfo: {
      name: "Chocolaterie Européenne SAS",
      eori: "FR12345678901234",
      country: "FR",
      address: "12 Rue de la Paix, 75002 Paris",
      email: "compliance@chocolat-europe.com",
    },
    declarationSignedBy: "Claire Dupont (Responsable Conformité EUDR)",
    declarationSignedAt: "2026-09-29T15:30:00Z",
    tracesReference: null,
    submittedAt: null,
    createdAt: "2026-09-15T09:00:00Z",
    updatedAt: "2026-09-29T15:30:00Z",
  },
  {
    id: "ddr-002-soja-br",
    reference: "DDR-2026-BR-002",
    title: "Dossier DDR Tourteaux de Soja — Port de Santos",
    commodity: "soya",
    hsCode: "12019000",
    supplierId: "sup-br-002",
    supplierName: "AgroPecuária do Pará Ltda",
    productId: "prod-br-002",
    productName: "Graines de Soja Non OGM",
    status: "RISK_IDENTIFIED",
    riskLevel: "CRITICAL",
    completenessScore: 65,
    plotsCount: 4,
    totalAreaHa: 184.0,
    netWeightKg: 500000,
    countryOfProduction: "BR",
    operatorInfo: {
      name: "AgriTrade Europe NV",
      eori: "BE09876543210001",
      country: "BE",
      address: "Havenlaan 88, 2000 Antwerpen",
      email: "eudr-desk@agritrade.eu",
    },
    declarationSignedBy: null,
    declarationSignedAt: null,
    tracesReference: null,
    submittedAt: null,
    createdAt: "2026-09-20T11:00:00Z",
    updatedAt: "2026-09-28T16:00:00Z",
  },
  {
    id: "ddr-003-palme-id",
    reference: "DDR-2026-ID-003",
    title: "Dossier DDR Huile de Palme Raffinée — Riau",
    commodity: "palm_oil",
    hsCode: "15111000",
    supplierId: "sup-id-003",
    supplierName: "PT Sumatra Agro Palm",
    productId: "prod-id-003",
    productName: "Huile de Palme Brute (CPO)",
    status: "ACTION_REQUIRED",
    riskLevel: "STANDARD",
    completenessScore: 85,
    plotsCount: 12,
    totalAreaHa: 96.5,
    netWeightKg: 120000,
    countryOfProduction: "ID",
    operatorInfo: {
      name: "BioOils International BV",
      eori: "NL11223344556677",
      country: "NL",
      address: "Westhaven 14, 1013 AL Amsterdam",
      email: "regulatory@biooils.nl",
    },
    declarationSignedBy: null,
    declarationSignedAt: null,
    tracesReference: null,
    submittedAt: null,
    createdAt: "2026-09-22T08:30:00Z",
    updatedAt: "2026-09-29T10:00:00Z",
  },
  {
    id: "ddr-004-cafe-vn",
    reference: "DDR-2026-VN-004",
    title: "Dossier DDR Café Robusta Vert — Dak Lak Highlands",
    commodity: "coffee",
    hsCode: "09011100",
    supplierId: "sup-vn-004",
    supplierName: "Dak Lak Robusta Alliance",
    productId: "prod-vn-004",
    productName: "Café Robusta Grade 1 Screen 18",
    status: "DECLARED",
    riskLevel: "LOW",
    completenessScore: 100,
    plotsCount: 6,
    totalAreaHa: 28.0,
    netWeightKg: 18000,
    countryOfProduction: "VN",
    operatorInfo: {
      name: "Chocolaterie Européenne SAS",
      eori: "FR12345678901234",
      country: "FR",
      address: "12 Rue de la Paix, 75002 Paris",
      email: "compliance@chocolat-europe.com",
    },
    declarationSignedBy: "Claire Dupont (Lead Compliance)",
    declarationSignedAt: "2026-09-25T14:00:00Z",
    tracesReference: "EUDR.2026.FR.8912450",
    submittedAt: "2026-09-26T09:15:00Z",
    createdAt: "2026-09-10T14:00:00Z",
    updatedAt: "2026-09-26T09:15:00Z",
  },
];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const commodity = searchParams.get("commodity");

    let filtered = MOCK_DDRS;
    if (status && status !== "ALL") filtered = filtered.filter((d) => d.status === status);
    if (commodity && commodity !== "ALL") filtered = filtered.filter((d) => d.commodity === commodity);

    return NextResponse.json(filtered);
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la récupération des dossiers DDR" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      title,
      commodity = "cocoa",
      hsCode = "18010000",
      supplierName = "Coopérative Fournisseur",
      productName = "Produit Réglementé EUDR",
      netWeightKg = 10000,
      countryOfProduction = "CI",
      operatorInfo,
    } = body;

    const newDdr: DueDiligenceStatementRecord = {
      id: `ddr-${Date.now()}`,
      reference: `DDR-2026-${countryOfProduction}-${Date.now().toString().slice(-3)}`,
      title: title || "Nouveau Dossier de Diligence Raisonnée",
      commodity: commodity as Commodity,
      hsCode,
      supplierName,
      productName,
      status: "DRAFT",
      riskLevel: "STANDARD",
      completenessScore: 40,
      plotsCount: 1,
      totalAreaHa: 10.0,
      netWeightKg: Number(netWeightKg),
      countryOfProduction,
      operatorInfo: operatorInfo || {
        name: "Opérateur Déclarant",
        eori: "FR12345678901234",
        country: "FR",
        address: "Paris, France",
        email: "contact@operator.eu",
      },
      declarationSignedBy: null,
      declarationSignedAt: null,
      tracesReference: null,
      submittedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json(newDdr, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la création du dossier DDR" }, { status: 500 });
  }
}
