import { type AlertRecord } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

const MOCK_ALERTS: AlertRecord[] = [
  {
    id: "alt-001-deforestation",
    type: "CRITICAL_DEFORESTATION",
    severity: "CRITICAL",
    title: "Alerte Déforestation Post-2020 Détectée",
    description: "La parcelle Fazenda Santa Maria (Brésil) présente 58.4 ha de perte forestière en 2022. Blocage préventif du lot de soja.",
    linkHref: "/plots/plot-br-002",
    linkLabel: "Inspecter la parcelle",
    status: "UNREAD",
    createdAt: "2026-09-28T09:15:00Z",
  },
  {
    id: "alt-002-expiring-doc",
    type: "EXPIRING_DOCUMENT",
    severity: "HIGH",
    title: "Document de Légalité Expire sous 15 jours",
    description: "Le permis d'exportation de la Coopérative Cacaoyère de Divo (CCC-EXP-2026-9912) arrive à échéance le 15/10/2026.",
    linkHref: "/documents",
    linkLabel: "Renouveler le document",
    status: "UNREAD",
    createdAt: "2026-09-27T14:00:00Z",
  },
  {
    id: "alt-003-missing-data",
    type: "MISSING_DATA",
    severity: "MEDIUM",
    title: "Coordonnées GPS Incomplètes pour Expédition",
    description: "L'expédition SHP-2026-ID-003 (Huile de palme) nécessite la validation de 4 polygones parcellaires supplémentaires.",
    linkHref: "/shipments",
    linkLabel: "Compléter le lot",
    status: "ACKNOWLEDGED",
    createdAt: "2026-09-25T11:20:00Z",
  },
  {
    id: "alt-004-satellite-pass",
    type: "NEW_SATELLITE_PASS",
    severity: "LOW",
    title: "Nouvelle Passe Sentinel-2 MSI Disponible",
    description: "Mise à jour des tuiles optiques et de l'indice NDVI pour le bassin de production ivoirien (Divo / Abengourou).",
    linkHref: "/analyses",
    linkLabel: "Voir les analyses",
    status: "ACKNOWLEDGED",
    createdAt: "2026-09-24T08:00:00Z",
  },
];

export async function GET() {
  return NextResponse.json(MOCK_ALERTS);
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { id, status } = body;

    return NextResponse.json({ id, status, updatedAt: new Date().toISOString() });
  } catch {
    return NextResponse.json({ error: "Erreur lors de la mise à jour de l'alerte" }, { status: 500 });
  }
}
