import { NextResponse } from "next/server";

export async function GET() {
  const sources = [
    {
      id: "hansen_umd_gfw",
      name: "Hansen / UMD Tree Cover Loss",
      provider: "Global Forest Watch & University of Maryland",
      resolution: "30m",
      cadence: "Annuel (2001 - 2024)",
      status: "OPERATIONAL",
      description: "Perte de couvert arboré avec seuil de canopée paramétrique (>10% à >75%). Base de référence historique EUDR.",
    },
    {
      id: "sentinel_2_msi",
      name: "Copernicus Sentinel-2 MSI",
      provider: "European Space Agency (ESA) & Union Européenne",
      resolution: "10m",
      cadence: "Tous les 5 jours",
      status: "OPERATIONAL",
      description: "Imagerie optique multispectrale. Calcul automatisé du différentiel NDVI et NBR entre 2020 et aujourd'hui.",
    },
    {
      id: "esa_worldcover",
      name: "ESA WorldCover",
      provider: "European Space Agency",
      resolution: "10m",
      cadence: "Annuel (2020, 2021)",
      status: "OPERATIONAL",
      description: "Cartographie globale de l'occupation des sols en 11 classes (arbres, cultures, bâti, eau, etc.).",
    },
    {
      id: "jrc_forest_cover",
      name: "JRC Global Forest Cover & Degradation",
      provider: "Joint Research Centre (JRC) Commission Européenne",
      resolution: "10m / 30m",
      cadence: "Annuel",
      status: "OPERATIONAL",
      description: "Données de référence de la Commission européenne pour l'identification des forêts primaires et dégradées.",
    },
  ];

  return NextResponse.json(sources);
}
