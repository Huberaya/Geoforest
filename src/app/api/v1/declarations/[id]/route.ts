import { type DeclarationStatus, type TracesDeclarationRecord } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const dec: TracesDeclarationRecord = {
    id,
    ddrId: "ddr-001",
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
    createdAt: "2026-09-29T16:00:00Z",
  };

  return NextResponse.json(dec);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();
  const { status, tracesReference } = body;

  const updated: Partial<TracesDeclarationRecord> = {
    id,
    status: status as DeclarationStatus,
    tracesReference: tracesReference || undefined,
    submittedAt: tracesReference ? new Date().toISOString() : undefined,
  };

  return NextResponse.json(updated);
}
