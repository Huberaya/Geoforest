/**
 * Export au format GeoJSON attendu par le système d'information EUDR (EUDR-IS).
 *
 * ⚠️ Périmètre et limites — à lire avant tout usage réglementaire :
 *
 * Ce module produit un **fichier de géolocalisation** conforme à la description
 * publiée par la Commission pour le dépôt des déclarations de diligence
 * raisonnée. Il ne **transmet** rien : la transmission relève d'un appel
 * authentifié au SI EUDR (serveur ACCEPTANCE puis PRODUCTION), qui n'est pas
 * implémenté dans ce produit à ce jour (cf. P0-06).
 *
 * Source de la spécification : « EUDR-IS GeoJSON File Description »,
 * portail d'acceptance EUDR (acceptance.eudr.webcloud.ec.europa.eu),
 * version consultée le 30/09/2026. Points retenus :
 *   - coordonnées tronquées par le SI à 6 décimales ;
 *   - types acceptés : Point, Polygon, MultiPolygon (LineString refusé) ;
 *   - trous et auto-intersections refusés ;
 *   - propriétés optionnelles reconnues : ProducerName, ProducerCountry,
 *     ProductionPlace, Area ;
 *   - à défaut de `Area`, un Point vaut 4 ha ;
 *   - taille maximale du fichier : 25 Mo.
 *
 * ⚠️ Ces règles n'ont pas pu être confrontées au SI réel faute d'identifiants
 * d'accès. Toute mise en service doit les vérifier sur le serveur ACCEPTANCE.
 */

import type { Position, SupportedGeometry } from "./types";

/** Nombre de décimales conservées — le SI tronque au-delà. */
const IS_DECIMALS = 6;
/** Taille maximale acceptée par le SI. */
export const IS_MAX_FILE_BYTES = 25 * 1024 * 1024;

export interface EudrIsProperties {
  ProducerName?: string;
  ProducerCountry?: string;
  ProductionPlace?: string;
  /** Surface en hectares. */
  Area?: number;
}

export interface EudrIsFeature {
  type: "Feature";
  properties: EudrIsProperties;
  geometry: SupportedGeometry;
}

export interface EudrIsFeatureCollection {
  type: "FeatureCollection";
  features: EudrIsFeature[];
}

export interface EudrIsExportResult {
  geojson: EudrIsFeatureCollection;
  /** Avertissements à présenter à l'utilisateur avant dépôt manuel. */
  warnings: string[];
  /** Nombre d'octets du fichier sérialisé. */
  sizeBytes: number;
}

/**
 * Tronque (et non arrondit) une coordonnée à 6 décimales, comme le fait le SI.
 * L'arrondi pourrait faire sortir la valeur de l'emprise déclarée ; la
 * troncation reproduit exactement le comportement du système.
 */
function truncate(value: number): number {
  const factor = 10 ** IS_DECIMALS;
  return Math.trunc(value * factor) / factor;
}

function truncatePositions(positions: Position[]): Position[] {
  return positions.map((p) => p.map(truncate));
}

/**
 * Prépare une géométrie pour le SI : types acceptés uniquement, troncation à
 * 6 décimales. Renvoie `null` si le type est refusé (LineString, etc.).
 */
export function toEudrIsGeometry(geometry: SupportedGeometry): SupportedGeometry | null {
  switch (geometry.type) {
    case "Point":
      return { type: "Point", coordinates: truncatePositions([geometry.coordinates])[0] };
    case "MultiPoint":
      return { type: "MultiPoint", coordinates: truncatePositions(geometry.coordinates) };
    case "Polygon":
      return { type: "Polygon", coordinates: geometry.coordinates.map(truncatePositions) };
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((poly) => poly.map(truncatePositions)),
      };
    default:
      return null;
  }
}

export interface EudrIsPlotInput {
  geometry: SupportedGeometry;
  /** Surface déclarée en hectares, si elle est connue. */
  areaHa?: number | null;
  producerName?: string | null;
  /** Code pays ISO 2 du lieu de production. */
  producerCountry?: string | null;
  productionPlace?: string | null;
}

/**
 * Construit la FeatureCollection à déposer.
 *
 * Les parcelles dont la géométrie n'est pas acceptée par le SI sont écartées et
 * signalées : mieux vaut un fichier incomplet qu'un fichier refusé en bloc.
 */
export function buildEudrIsGeoJson(plots: EudrIsPlotInput[]): EudrIsExportResult {
  const warnings: string[] = [];
  const features: EudrIsFeature[] = [];

  plots.forEach((plot, index) => {
    const geometry = toEudrIsGeometry(plot.geometry);
    if (!geometry) {
      warnings.push(
        `Parcelle #${index + 1} : type « ${plot.geometry.type} » refusé par le SI EUDR ` +
          `(seuls Point, Polygon et MultiPolygon sont acceptés). Parcelle exclue du fichier.`,
      );
      return;
    }
    if (plot.geometry.type === "Polygon" && (plot.geometry.coordinates?.length ?? 0) > 1) {
      warnings.push(
        `Parcelle #${index + 1} : le polygone comporte des trous, que le SI EUDR refuse. ` +
          `Vérifiez la géométrie avant dépôt.`,
      );
    }

    const properties: EudrIsProperties = {};
    if (plot.producerName) properties.ProducerName = plot.producerName;
    if (plot.producerCountry) properties.ProducerCountry = plot.producerCountry.slice(0, 2).toUpperCase();
    if (plot.productionPlace) properties.ProductionPlace = plot.productionPlace;
    if (plot.areaHa !== null && plot.areaHa !== undefined) {
      properties.Area = Number(plot.areaHa.toFixed(4));
    }

    features.push({ type: "Feature", properties, geometry });
  });

  if (features.length === 0) {
    warnings.push("Aucune parcelle exploitable : le fichier serait vide et refusé par le SI.");
  }

  const geojson: EudrIsFeatureCollection = { type: "FeatureCollection", features };
  const serialized = JSON.stringify(geojson);
  const sizeBytes = Buffer.byteLength(serialized, "utf8");

  if (sizeBytes > IS_MAX_FILE_BYTES) {
    warnings.push(
      `Le fichier pèse ${(sizeBytes / 1024 / 1024).toFixed(1)} Mo, au-delà de la limite de 25 Mo ` +
        `acceptée par le SI. Il devra être divisé en plusieurs déclarations.`,
    );
  }

  return { geojson, warnings, sizeBytes };
}
