import { type DocumentRecord, type DocumentStatus } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const doc: DocumentRecord = {
    id,
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
  };

  return NextResponse.json(doc);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { status, notes } = body;

  const updated: DocumentRecord = {
    id,
    title: "Document de conformité",
    category: "LAND_TENURE",
    fileName: "document_preuve.pdf",
    fileSize: 1500000,
    status: (status as DocumentStatus) || "VALID",
    notes: notes || "Statut mis à jour par le responsable conformité.",
    createdAt: new Date().toISOString(),
  };

  return NextResponse.json(updated);
}
