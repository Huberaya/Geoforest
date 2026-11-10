/**
 * Résolution du pays d'origine d'un point géographique.
 *
 * ⚠️ Remplace la résolution par rectangles englobants, qui produisait de faux
 *    verdicts mesurés (C6a) : Bangkok résolue au Myanmar, Oulan-Bator en
 *    Russie, Kuala Lumpur en Indonésie, Phnom Penh au Vietnam.
 *
 * ⚠️ Ce que ce module fait : il identifie un pays par son contour.
 *    Ce qu'il ne fait pas : il ne tranche pas un litige frontalier. Un point
 *    situé à l'intérieur de plusieurs pays — cas réel des frontières non
 *    délimitées — est signalé comme CONFLIT, jamais résolu au hasard de
 *    l'ordre du fichier. Un opérateur doit pouvoir expliquer pourquoi son
 *    dossier a été classé d'une certaine façon.
 */
import frontieres from "./frontieres-pays.json";
import { niveauBenchmark, nomOfficiel, estListeALAnnexe } from "./benchmark-pays";
import type { RiskLevel } from "./types";

/** Un point GeoJSON : [longitude, latitude]. */
type Point = number[];
/** Un anneau : suite fermée de points. */
type Anneau = Point[];
/** Un polygone : contour extérieur suivi de ses trous. */
type Polygone = Anneau[];
interface EntreePays {
  iso2: string;
  polygones: Polygone[];
}

const PAYS = (frontieres as { pays: EntreePays[] }).pays;

/** 0,5 m de côté : les contours sont arrondis à 2 décimales (≈ 1,1 km). */
const EPSILON = 1e-5;

/**
 * Point-dans-anneau par lancer de rayon.
 *
 * ⚠️ Le sens de parcours de l'anneau est ignoré : le calcul de parité est
 *    indépendant de l'orientation. C'est volontaire — les contours Natural
 *    Earth n'ont pas tous la même orientation, et dépendre d'elle produirait
 *    des trous silencieux.
 */
function pointDansAnneau(lon: number, lat: number, anneau: Anneau): boolean {
  let dedans = false;
  for (let i = 0, j = anneau.length - 1; i < anneau.length; j = i, i += 1) {
    const [xi, yi] = anneau[i];
    const [xj, yj] = anneau[j];
    // ⚠️ Comparaison stricte d'un côté de l'axe : un sommet exactement sur le
    //   rayon ne doit être compté qu'une fois, sinon le résultat dépend de
    //   l'ordre des sommets.
    const traverse = yi > lat !== yj > lat;
    if (traverse && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dedans = !dedans;
  }
  return dedans;
}

function pointDansPolygone(lon: number, lat: number, polygone: Polygone): boolean {
  const [exterieur, ...trous] = polygone;
  if (!exterieur || !pointDansAnneau(lon, lat, exterieur)) return false;
  // ⚠️ Un point dans un trou (enclave) n'appartient PAS au pays : sans ce
  //   contrôle, le Lesotho serait englobé par l'Afrique du Sud.
  return !trous.some((trou) => pointDansAnneau(lon, lat, trou));
}

export type StatutResolution = "RESOLU" | "CONFLIT" | "HORS_COUVERTURE";

export interface ResolutionPays {
  /** Code ISO alpha-2, ou "XX" si non résolu. */
  iso2: string;
  /** Nom officiel du référentiel, ou libellé explicite. */
  name: string;
  /** Niveau au titre du règlement d'exécution (UE) 2025/1093. */
  risk: RiskLevel;
  /** Vrai si le pays figure explicitement à l'annexe (LOW ou HIGH). */
  listeALAnnexe: boolean;
  statut: StatutResolution;
  /** Pays candidats — renseigné uniquement en cas de CONFLIT. */
  candidats?: string[];
  referentiel: string;
}

/**
 * Coordonnées valides. ⚠️ L'ordre GeoJSON est [longitude, latitude] — l'inverse
 * produit un point au milieu de l'océan et une résolution « hors couverture »
 * silencieuse, exactement le genre d'erreur qui ne se voit pas.
 */
export function coordonneesValides(lon: number, lat: number): boolean {
  return (
    Number.isFinite(lon) &&
    Number.isFinite(lat) &&
    lon >= -180 &&
    lon <= 180 &&
    lat >= -90 &&
    lat <= 90
  );
}

/** Résout le pays d'un point. Les résultats sont mémoïsés : un import de
 *  parcelle appelle souvent plusieurs fois la même position. */
const cache = new Map<string, ResolutionPays>();

export function resoudrePays(lon: number, lat: number): ResolutionPays {
  if (!coordonneesValides(lon, lat)) {
    return {
      iso2: "XX",
      name: "Coordonnées invalides",
      risk: "STANDARD",
      listeALAnnexe: false,
      statut: "HORS_COUVERTURE",
      referentiel: "EU-2025/1093",
    };
  }

  const cle = `${lon.toFixed(4)}:${lat.toFixed(4)}`;
  const enCache = cache.get(cle);
  if (enCache) return enCache;

  // ⚠️ Les contours traversant l'antiméridien sont déroulés : leurs
  //   longitudes peuvent sortir de [-180, 180] (Fidji, Tchoukotka). On teste
  //   donc le point aux trois positions équivalentes. Sans cela, la Fidji est
  //   introuvable à l'est de 180° et la Russie manque sa rive orientale.
  const candidats: string[] = [];
  for (const pays of PAYS) {
    const trouve = [lon, lon - 360, lon + 360].some((essai) =>
      pays.polygones.some((polygone) => pointDansPolygone(essai, lat, polygone)),
    );
    if (trouve) candidats.push(pays.iso2);
  }

  const resultat = deciderResolution(candidats);
  cache.set(cle, resultat);
  return resultat;
}

/**
 * Décision à partir des pays candidats — fonction pure, exportée pour être
 * testée directement.
 *
 * ⚠️ Pourquoi séparer la décision de la géométrie : en pratique, **aucun
 *   chevauchement naturel n'existe** dans le jeu de frontières. Natural Earth
 *   tranche lui-même les litiges (la Crimée sort en Russie, le Sahara
 *   occidental en EH). Le chemin CONFLIT est donc une défense contre une
 *   donnée corrompue ou mal générée — exactement le bug d'antiméridien qui a
 *   fait de la Fidji une bande couvrant l'Angola. Un chemin de code jamais
 *   atteint en production ne peut être vérifié qu'en le testant séparément.
 */
export function deciderResolution(candidats: string[]): ResolutionPays {
  return (() => {
    // ⚠️ Chevauchement : on ne choisit pas. Un point sur une frontière non
    //   délimitée est signalé, et la décision revient à l'opérateur.
    if (candidats.length > 1) {
      const tries = [...candidats].sort();
      return {
        iso2: "XX",
        name: `Conflit de frontière (${tries.join(" / ")})`,
        risk: "STANDARD",
        listeALAnnexe: false,
        statut: "CONFLIT" as const,
        candidats: tries,
        referentiel: "EU-2025/1093",
      };
    }

    if (candidats.length === 1) {
      const iso2 = candidats[0];
      return {
        iso2,
        name: nomOfficiel(iso2) ?? iso2,
        risk: niveauBenchmark(iso2),
        listeALAnnexe: estListeALAnnexe(iso2),
        statut: "RESOLU" as const,
        referentiel: "EU-2025/1093",
      };
    }

    // Aucun pays : haute mer, ou zone non couverte par Natural Earth.
    return {
      iso2: "XX",
      name: "Hors couverture terrestre",
      risk: "STANDARD",
      listeALAnnexe: false,
      statut: "HORS_COUVERTURE" as const,
      referentiel: "EU-2025/1093",
    };
  })();
}

/** Nombre de pays disposant d'un contour — exposé pour le diagnostic. */
export function nombrePaysCouverts(): number {
  return PAYS.length;
}

/** Source et date du jeu de frontières — à citer dans une preuve d'audit. */
export const FRONTIERES_SOURCE = (frontieres as { source: string }).source;
export const FRONTIERES_GENEREES_LE = (frontieres as { genere_le: string }).genere_le;
