import { type SatelliteAnalysis } from "@/lib/eudr/types";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  // Analyse type par défaut ou mock
  const analysis: SatelliteAnalysis = {
    analysis_id: id,
    created_at: "2026-09-28T14:32:00Z",
    plot_id: "plot-ci-001",
    plot_name: "Parcelle Cacao Divo Est #01",
    commodity: "cocoa",
    status: id.includes("para") || id.includes("br") ? "NON_COMPLIANT" : "COMPLIANT",
    risk_level: id.includes("para") || id.includes("br") ? "CRITICAL" : "LOW",
    compliant: !(id.includes("para") || id.includes("br")),
    confidence_score: 0.96,
    eudr_cutoff_date: "2020-12-31",
    area_ha: 14.5,
    centroid: [-5.359734, 5.842734],
    country_code: "CI",
    country_name: "Côte d'Ivoire",
    country_risk: "STANDARD",
    layers: {
      hansen: {
        source: "Hansen / UMD Tree Cover Loss (Global Forest Watch)",
        resolution_m: 30,
        canopy_threshold_pct: 30,
        loss_year: id.includes("para") ? 2022 : null,
        loss_area_ha: id.includes("para") ? 58.4 : 0.0,
        loss_detected_post_2020: id.includes("para"),
        tree_cover_2000_pct: 78.5,
      },
      sentinel2: {
        source: "Copernicus Sentinel-2 MSI Optical",
        resolution_m: 10,
        baseline_ndvi_2020: 0.81,
        current_ndvi: id.includes("para") ? 0.32 : 0.79,
        delta_ndvi: id.includes("para") ? -0.49 : -0.02,
        vegetation_loss_detected: id.includes("para"),
        cloud_cover_pct: 1.8,
        observation_period: "2020-2026",
      },
      esa_worldcover: {
        source: "ESA WorldCover 10m",
        resolution_m: 10,
        tree_cover_pct: id.includes("para") ? 12.0 : 74.0,
        cropland_pct: id.includes("para") ? 82.0 : 22.0,
        shrubland_pct: 4.0,
        other_pct: 0.0,
        dominant_land_cover: id.includes("para") ? "Cropland" : "Tree cover / Agroforestry",
      },
      buffer_encroachment: {
        buffer_distance_m: 50,
        encroachment_detected: id.includes("para"),
        buffer_loss_area_ha: id.includes("para") ? 14.2 : 0.0,
        buffer_alerts_count: id.includes("para") ? 5 : 0,
        buffer_risk_level: id.includes("para") ? "HIGH" : "LOW",
      },
    },
    summary: id.includes("para")
      ? "NON CONFORME EUDR : Déforestation détectée en 2022 après la date butoir."
      : "CONFORME EUDR : Aucune perte de couvert arboré post-2020 détectée sur l'emprise.",
    methodology:
      "Croisement multi-capteurs : Hansen GFW (30m), Sentinel-2 MSI (10m, indices NDVI), ESA WorldCover 10m et zone tampon 50m.",
    legal_disclaimer:
      "GeoForest Trace est un outil d'aide à la décision et de diligence raisonnée EUDR. Ne constitue pas un certificat juridique.",
  };

  return NextResponse.json(analysis);
}
