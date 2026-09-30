import { db } from "@/db";
import { documents as documentsTable, suppliers as suppliersTable } from "@/db/schema";
import { type DocumentCategory, type DocumentRecord, type DocumentStatus } from "@/lib/eudr/types";
import { desc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const MOCK_DOCUMENTS: DocumentRecord[] = [
  {
    id: "doc-001-foncier-ci",
    title: "Certificat Foncier Rural Collectif Divo",
    category: "LAND_TENURE",
    supplierId: "sup-ci-001",
    supplierName: "Coopérative Cacaoyère de Divo (COOPADI)",
    plotId: "plot-ci-001",
    plotName: "Parcelle Cacao Divo Est #01",
    fileName: "COOPADI_Certificat_Foncier_2025.pdf",
    fileSize: 2450000,
    expiryDate: "2028-12-31",
    status: "VALID",
    issuingAuthority: "Ministère de l'Agriculture et du Développement Rural CI",
    referenceNumber: "CFR-DIV-2025-084",
    notes: "Titre authentifié par le registre foncier ivoirien.",
    createdAt: "2026-09-10T10:00:00Z",
  },
  {
    id: "doc-002-recolte-ci",
    title: "Permis de Récolte & Agrément Exportateur Cacao",
    category: "HARVEST_PERMIT",
    supplierId: "sup-ci-001",
    supplierName: "Coopérative Cacaoyère de Divo (COOPADI)",
    fileName: "Agrement_Conseil_Cafe_Cacao_2026.pdf",
    fileSize: 1820000,
    expiryDate: "2026-10-15",
    status: "EXPIRING_SOON",
    issuingAuthority: "Conseil du Café-Cacao (CCC)",
    referenceNumber: "CCC-EXP-2026-9912",
    notes: "Arrive à échéance dans 15 jours — relance envoyée au fournisseur.",
    createdAt: "2026-09-12T14:20:00Z",
  },
  {
    id: "doc-003-fpic-id",
    title: "Procès-Verbal Consultation FPIC Communautés Locales",
    category: "FPIC_INDIGENOUS_RIGHTS",
    supplierId: "sup-id-003",
    supplierName: "PT Sumatra Agro Palm",
    plotId: "plot-id-003",
    plotName: "Perkebunan Sawit Riau Block B",
    fileName: "FPIC_Consent_Riau_Customary_Council.pdf",
    fileSize: 3100000,
    expiryDate: null,
    status: "VALID",
    issuingAuthority: "Conseil Coutumier des Peuples Autochtones de Riau",
    referenceNumber: "FPIC-RIAU-2024-11",
    notes: "Conformité stricte à l'Article 2(40) et Article 9(1)(h) EUDR.",
    createdAt: "2026-08-20T11:00:00Z",
  },
  {
    id: "doc-004-fiscal-br",
    title: "Certidão Negativa de Débitos Federais e Trabalhistas",
    category: "TAX_LABOR_COMPLIANCE",
    supplierId: "sup-br-002",
    supplierName: "AgroPecuária do Pará Ltda",
    fileName: "CND_Trabalhista_Para_2024.pdf",
    fileSize: 980000,
    expiryDate: "2025-06-30",
    status: "EXPIRED",
    issuingAuthority: "Receita Federal do Brasil",
    referenceNumber: "CND-RFB-987412-2024",
    notes: "Document expiré — non-conformité fiscale détectée.",
    createdAt: "2026-07-05T08:30:00Z",
  },
  {
    id: "doc-005-phyto-vn",
    title: "Phytosanitary Certificate Export Coffee Beans",
    category: "PHYTOSANITARY_CUSTOMS",
    supplierId: "sup-vn-004",
    supplierName: "Dak Lak Robusta Alliance",
    fileName: "Phyto_Certificate_VN_098234.pdf",
    fileSize: 1450000,
    expiryDate: "2026-12-31",
    status: "TO_VERIFY",
    issuingAuthority: "Plant Protection Department of Vietnam (PPD)",
    referenceNumber: "PPD-VN-2026-098234",
    notes: "En attente de validation humaine par le responsable conformité.",
    createdAt: "2026-09-29T16:00:00Z",
  },
  {
    id: "doc-006-certif-gh",
    title: "Rainforest Alliance Sustainable Agriculture Standard",
    category: "CERTIFICATION_AUDIT",
    supplierId: "sup-gh-005",
    supplierName: "Kumasi Agroforestry Group",
    fileName: "Rainforest_Alliance_Certificate_GH.pdf",
    fileSize: 2200000,
    expiryDate: "2027-05-30",
    status: "VALID",
    issuingAuthority: "Rainforest Alliance Certification Body",
    referenceNumber: "RA-CERT-GH-2024-554",
    notes: "Audit annuel favorable sans non-conformité majeure.",
    createdAt: "2026-09-18T09:00:00Z",
  },
];

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get("category");
    const status = searchParams.get("status");

    try {
      const rows = await db
        .select({
          id: documentsTable.id,
          title: documentsTable.title,
          category: documentsTable.category,
          supplierId: documentsTable.supplierId,
          plotId: documentsTable.plotId,
          fileName: documentsTable.fileName,
          fileSize: documentsTable.fileSize,
          fileUrl: documentsTable.fileUrl,
          expiryDate: documentsTable.expiryDate,
          status: documentsTable.status,
          notes: documentsTable.notes,
          createdAt: documentsTable.createdAt,
          supplierName: suppliersTable.name,
        })
        .from(documentsTable)
        .leftJoin(suppliersTable, eq(documentsTable.supplierId, suppliersTable.id))
        .orderBy(desc(documentsTable.createdAt));

      if (rows.length > 0) {
        const formatted: DocumentRecord[] = rows.map((r) => ({
          id: r.id,
          title: r.title,
          category: r.category as DocumentCategory,
          supplierId: r.supplierId,
          supplierName: r.supplierName ?? undefined,
          plotId: r.plotId,
          fileName: r.fileName,
          fileSize: r.fileSize ?? 1024000,
          fileUrl: r.fileUrl ?? undefined,
          expiryDate: r.expiryDate,
          status: (r.status ?? "VALID") as DocumentStatus,
          notes: r.notes,
          createdAt: r.createdAt.toISOString(),
        }));

        let filtered = formatted;
        if (category && category !== "ALL") filtered = filtered.filter((d) => d.category === category);
        if (status && status !== "ALL") filtered = filtered.filter((d) => d.status === status);
        return NextResponse.json(filtered);
      }
    } catch {
      /* fallback */
    }

    let filtered = MOCK_DOCUMENTS;
    if (category && category !== "ALL") filtered = filtered.filter((d) => d.category === category);
    if (status && status !== "ALL") filtered = filtered.filter((d) => d.status === status);

    return NextResponse.json(filtered);
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de la récupération des documents" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      title,
      category,
      supplierId,
      supplierName = "Fournisseur Partenaire",
      plotId,
      plotName,
      fileName = "document_preuve.pdf",
      fileSize = 1500000,
      expiryDate,
      issuingAuthority,
      referenceNumber,
      notes,
    } = body;

    const newDoc: DocumentRecord = {
      id: `doc-${Date.now()}`,
      title: title || "Nouveau document de conformité",
      category: category as DocumentCategory,
      supplierId,
      supplierName,
      plotId,
      plotName,
      fileName,
      fileSize,
      expiryDate,
      status: "TO_VERIFY",
      issuingAuthority,
      referenceNumber,
      notes,
      createdAt: new Date().toISOString(),
    };

    return NextResponse.json(newDoc, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: "Erreur lors de l'enregistrement du document" }, { status: 500 });
  }
}
