import { type Commodity, type RiskItem, type RiskLevel, type RiskMitigationStatus } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

const MOCK_RISKS: RiskItem[] = [
  {
    id: "risk-001-br-para",
    reference: "RSK-BR-2026-001",
    title: "Déforestation post-2020 avérée — Fazenda Santa Maria",
    commodity: "soya",
    supplierId: "sup-br-002",
    supplierName: "AgroPecuária do Pará Ltda",
    overallScore: 92,
    riskLevel: "CRITICAL",
    status: "TO_TREAT",
    countryRisk: "STANDARD",
    deforestationRisk: "CRITICAL",
    legalityRisk: "HIGH",
    supplyChainRisk: "STANDARD",
    reasons: [
      "Perte de 58.4 ha de forêt primaire détectée en 2022 par Hansen GFW",
      "Baisse de l'indice NDVI Sentinel-2 (Δ -0.53) confirmant le changement d'usage des sols",
      "Certificat de conformité fiscale et du travail expiré depuis juin 2025",
    ],
    mitigationPlan: "Bloquer l'expédition dans le dossier DDR et exiger un audit terrain indépendant ou exclure la parcelle.",
    assignedTo: "Claire Dupont (Lead Compliance)",
    deadline: "2026-10-05",
    validatedAt: null,
    createdAt: "2026-09-27T10:00:00Z",
  },
  {
    id: "risk-002-ci-divo",
    reference: "RSK-CI-2026-002",
    title: "Permis de récolte arrivant à échéance sous 15 jours",
    commodity: "cocoa",
    supplierId: "sup-ci-001",
    supplierName: "Coopérative Cacaoyère de Divo (COOPADI)",
    overallScore: 38,
    riskLevel: "STANDARD",
    status: "IN_PROGRESS",
    countryRisk: "STANDARD",
    deforestationRisk: "LOW",
    legalityRisk: "STANDARD",
    supplyChainRisk: "LOW",
    reasons: [
      "L'agrément exportateur CCC arrive à échéance le 15/10/2026",
      "Risque de blocage en douane au port d'Anvers si non renouvelé avant l'embarquement",
    ],
    mitigationPlan: "Relance automatique envoyée au directeur de coopérative pour transmission du récépissé de renouvellement 2026/2027.",
    assignedTo: "Marc Lemoine (Auditeur EUDR)",
    deadline: "2026-10-10",
    validatedAt: null,
    createdAt: "2026-09-25T14:30:00Z",
  },
  {
    id: "risk-003-id-riau",
    reference: "RSK-ID-2026-003",
    title: "Alerte déforestation dans la zone tampon de 50m (Lisière)",
    commodity: "palm_oil",
    supplierId: "sup-id-003",
    supplierName: "PT Sumatra Agro Palm",
    overallScore: 45,
    riskLevel: "STANDARD",
    status: "RESOLVED",
    countryRisk: "STANDARD",
    deforestationRisk: "STANDARD",
    legalityRisk: "LOW",
    supplyChainRisk: "LOW",
    reasons: [
      "2 alertes de défrichage détectées à 35m de la frontière sud de la parcelle",
      "Risque d'empiètement non intentionnel lors des récoltes",
    ],
    mitigationPlan: "Fourniture des traces GPS des bornes physiques et confirmation de non-franchissement du fossé pare-feu.",
    assignedTo: "Marc Lemoine (Auditeur EUDR)",
    deadline: "2026-09-30",
    validatedAt: "2026-09-29T18:00:00Z",
    createdAt: "2026-09-20T09:15:00Z",
  },
  {
    id: "risk-004-vn-coffee",
    reference: "RSK-VN-2026-004",
    title: "Document phytosanitaire en attente de vérification",
    commodity: "coffee",
    supplierId: "sup-vn-004",
    supplierName: "Dak Lak Robusta Alliance",
    overallScore: 22,
    riskLevel: "LOW",
    status: "TO_TREAT",
    countryRisk: "STANDARD",
    deforestationRisk: "LOW",
    legalityRisk: "LOW",
    supplyChainRisk: "LOW",
    reasons: [
      "Nouveau certificat transmis par le portail fournisseur",
      "Vérification obligatoire de la signature de l'autorité PPD",
    ],
    mitigationPlan: "Contrôle visuel du QR code officiel et validation dans le coffre documentaire.",
    assignedTo: "Claire Dupont (Lead Compliance)",
    deadline: "2026-10-02",
    validatedAt: null,
    createdAt: "2026-09-29T16:30:00Z",
  },
];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const riskLevel = searchParams.get("riskLevel");

    let filtered = MOCK_RISKS;
    if (status && status !== "ALL") filtered = filtered.filter((r) => r.status === status);
    if (riskLevel && riskLevel !== "ALL") filtered = filtered.filter((r) => r.riskLevel === riskLevel);

    return NextResponse.json(filtered);
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la récupération des risques" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      title,
      commodity = "cocoa",
      supplierName = "Fournisseur",
      overallScore = 50,
      riskLevel = "STANDARD",
      reasons = [],
      mitigationPlan = "Plan d'action en cours de définition",
      deadline,
    } = body;

    const newRisk: RiskItem = {
      id: `risk-${Date.now()}`,
      reference: `RSK-${Date.now().toString().slice(-4)}`,
      title,
      commodity: commodity as Commodity,
      supplierName,
      overallScore,
      riskLevel: riskLevel as RiskLevel,
      status: "TO_TREAT",
      countryRisk: "STANDARD",
      deforestationRisk: "STANDARD",
      legalityRisk: "STANDARD",
      supplyChainRisk: "LOW",
      reasons,
      mitigationPlan,
      deadline: deadline || "2026-10-15",
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json(newRisk, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la création de l'évaluation de risque" }, { status: 500 });
  }
}
