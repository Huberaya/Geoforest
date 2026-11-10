/**
 * Générateur des frontières pays à partir de Natural Earth (domaine public).
 *
 * ⚠️ Ce script s'exécute à la main, pas en CI. Il produit
 *    `src/lib/eudr/frontieres-pays.json`, qui est COMMITÉ.
 *
 * Pourquoi un fichier généré et commité plutôt qu'une dépendance :
 *   - la résolution du pays d'origine est une donnée réglementaire. Elle doit
 *     être stable et auditable : emporter une bibliothèque qui peut changer de
 *     contenu sous nos pieds rendrait une analyse passée inexplicable ;
 *   - le fichier est versionné, daté, et sa source est citée.
 *
 * Pourquoi Natural Earth et pas autre chose :
 *   - domaine public, pas de contrainte de licence ;
 *   - c'est la référence cartographique utilisée par la Commission elle-même
 *     dans ses publications, à défaut d'une source officielle d'annexes (la
 *     Commission publie des listes de pays, pas des frontières) ;
 *   - la version 50m offre un compromis correct : la 110m fait disparaître
 *     des États insulaires entiers, la 10m pèse 3,7 Mo compressés.
 *
 * ⚠️ Ce que ces frontières ne sont PAS : des frontières juridiques. Natural
 *    Earth est une compilation cartographique, pas un traité de délimitation.
 *    Un point situé sur un litige frontalier n'a pas de réponse unique, et
 *    c'est pourquoi le résolveur renvoie un conflit explicite plutôt que de
 *    trancher (voir `resolveCountry`).
 *
 * Usage :
 *   npm pack world-atlas i18n-iso-countries   (dans un dossier temporaire)
 *   npx tsx scripts/generer-frontieres-pays.ts <chemin world-atlas> <chemin codes.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Un anneau : suite fermée de points [lon, lat]. */
type Anneau = number[][];

interface Topologie {
  objects: { countries: { geometries: Array<{ id?: string; type: string; arcs: unknown }> } };
  arcs: number[][][];
  transform?: { scale: [number, number]; translate: [number, number] };
}

const [, , cheminAtlas, cheminCodes, cheminAtlasFin] = process.argv;
if (!cheminAtlas || !cheminCodes) {
  console.error("usage : generer-frontieres-pays.ts <countries-50m.json> <codes.json> [countries-10m.json]");
  process.exit(2);
}

/** Précision d'arrondi : ≈ 1,1 km à l'équateur. Suffisant pour lever une
 *  ambiguïté de pays sans conserver des îlots de 3 points. */
const DECIMALES = 2;

/** Nombre minimal de sommets pour qu'un anneau soit conservé. En dessous, il
 *  ne peut pas représenter une frontière — seulement un artefact. */
const MIN_SOMMETS = 4;

/** Tolérance de simplification (degrés), ou 0 pour désactiver.
 *  ⚠️ La simplification de Douglas-Peucker peut DÉPLACER une frontière de la
 *  tolérance choisie. À 0,01° (≈ 1,1 km) on rabote des côtes entières ; à
 *  0,002° (≈ 220 m) on gagne surtout du poids sur la côte chilienne ou
 *  norvégienne sans changer un verdict. Cette valeur est un compromis assumé,
 *  et le banc de régression doit rester vert après changement. */
const TOLERANCE = Number(process.env.TOLERANCE ?? 0);

const atlas = JSON.parse(readFileSync(cheminAtlas, "utf-8")) as Topologie;
const codes = JSON.parse(readFileSync(cheminCodes, "utf-8")) as Record<string, string[]>;

// ISO numérique (3 chiffres, celui de Natural Earth) -> ISO alpha-2.
const numeriqueVersAlpha2 = new Map<string, string>();
for (const ligne of Object.values(codes)) {
  if (!Array.isArray(ligne) || ligne.length < 3) continue;
  const [alpha2, , numerique] = ligne;
  if (alpha2 && numerique) numeriqueVersAlpha2.set(String(numerique), alpha2);
}

/** Décode les arcs TopoJSON en anneaux de coordonnées [lon, lat]. */
function decoderAnnexes(arcs: number[][][], transform?: Topologie["transform"]): number[][][] {
  // TopoJSON quantifié : les coordonnées sont des entiers delta-encodés.
  if (transform) {
    const [sx, sy] = transform.scale;
    const [tx, ty] = transform.translate;
    for (const arc of arcs) {
      let x = 0;
      let y = 0;
      for (const point of arc) {
        x += point[0];
        y += point[1];
        point[0] = x * sx + tx;
        point[1] = y * sy + ty;
      }
    }
  }
  return arcs as number[][][];
}

/**
 * Déroule les longitudes d'un anneau traversant l'antiméridien.
 *
 * ⚠️ Natural Earth encode Fidji et la Tchoukotka russe avec des points de part
 *   et d'autre de ±180°. Lu naïvement, un tel anneau devient une BANDE qui
 *   couvre le monde entier : la Fidji « contenait » l'Angola, et un point
 *   angolais ressortait en conflit de frontière. Le banc ne l'a pas vu, la
 *   recherche systématique de chevauchements si.
 *
 *   On décale chaque longitude de ±360 pour que deux points consécutifs ne
 *   diffèrent jamais de plus de 180°. Les coordonnées peuvent alors sortir de
 *   [-180, 180], et le résolveur teste le point à lon, lon-360 et lon+360.
 */
function deroulerAntemeridien(anneau: Anneau): Anneau {
  if (anneau.length === 0) return anneau;
  const sortie: Anneau = [[anneau[0][0], anneau[0][1]]];
  for (let i = 1; i < anneau.length; i += 1) {
    const [lon, lat] = anneau[i];
    const precedent = sortie[i - 1][0];
    let ajuste = lon;
    while (ajuste - precedent > 180) ajuste -= 360;
    while (ajuste - precedent < -180) ajuste += 360;
    sortie.push([ajuste, lat]);
  }
  return sortie;
}

/** Douglas-Peucker, appliqué sur un anneau fermé. */
function simplifier(points: number[][], tolerance: number): number[][] {
  if (tolerance <= 0 || points.length <= MIN_SOMMETS) return points;

  const distanceSegment = (p: number[], a: number[], b: number[]): number => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
  };

  const garder = new Array<boolean>(points.length).fill(false);
  garder[0] = true;
  garder[points.length - 1] = true;

  const pile: Array<[number, number]> = [[0, points.length - 1]];
  while (pile.length > 0) {
    const [debut, fin] = pile.pop()!;
    let dmax = 0;
    let index = -1;
    for (let i = debut + 1; i < fin; i += 1) {
      const d = distanceSegment(points[i], points[debut], points[fin]);
      if (d > dmax) {
        dmax = d;
        index = i;
      }
    }
    if (dmax > tolerance && index > 0) {
      garder[index] = true;
      pile.push([debut, index], [index, fin]);
    }
  }

  return points.filter((_, i) => garder[i]);
}

function anneauDepuisArcs(indices: number[], arcs: number[][][]): number[][] {
  const points: number[][] = [];
  for (const index of indices) {
    const arc = index >= 0 ? arcs[index] : arcs[~index].slice().reverse();
    // Le premier point d'un arc est déjà le dernier du précédent : on évite le doublon.
    points.push(...(points.length === 0 ? arc : arc.slice(1)));
  }

  // ⚠️ Fermeture obligatoire pour un point-dans-polygone par lancer de rayon :
  //   sans elle, le dernier segment n'est pas testé et les points proches de
  //   la frontière de fermeture donnent un résultat arbitraire.
  if (points.length > 0) {
    const [premier, dernier] = [points[0], points[points.length - 1]];
    if (premier[0] !== dernier[0] || premier[1] !== dernier[1]) points.push([premier[0], premier[1]]);
  }

  const arrondis = points.map(([lon, lat]) => [
    Number(lon.toFixed(DECIMALES)),
    Number(lat.toFixed(DECIMALES)),
  ]);
  return simplifier(deroulerAntemeridien(arrondis), TOLERANCE);
}

const arcs = decoderAnnexes(atlas.arcs, atlas.transform);

interface EntreePays {
  iso2: string;
  /** Un polygone = un contour extérieur suivi de ses trous. */
  polygones: number[][][][];
}

const pays: EntreePays[] = [];
const nonMappes: string[] = [];

for (const geometrie of atlas.objects.countries.geometries) {
  if (!geometrie.id) {
    nonMappes.push("(sans identifiant)");
    continue;
  }
  const iso2 = numeriqueVersAlpha2.get(String(geometrie.id));
  if (!iso2) {
    nonMappes.push(String(geometrie.id));
    continue;
  }

  const g = geometrie as unknown as {
    type: string;
    arcs: number[][] | number[][][];
  };

  // MultiPolygon : arcs = [[anneau ext, trou...], ...]
  // Polygon      : arcs = [anneau ext, trou...]
  const bruts = g.type === "Polygon" ? [g.arcs as number[][]] : (g.arcs as number[][][]);

  const polygones: number[][][][] = [];
  for (const polygone of bruts) {
    const anneaux = polygone.map((indices) => anneauDepuisArcs(indices, arcs));
    const exterieur = anneaux[0];
    if (!exterieur || exterieur.length < MIN_SOMMETS) continue;
    // Les trous ne servent qu'à exclure des enclaves ; en conserver de
    // minuscules ferait grossir le fichier sans changer un seul verdict.
    const trous = anneaux.slice(1).filter((a) => a.length >= MIN_SOMMETS);
    polygones.push([exterieur, ...trous]);
  }

  if (polygones.length > 0) pays.push({ iso2, polygones });
}

/* --- Comblement des micro-États absents de l'échelle principale ----------- */

// ⚠️ À 1:50m, Natural Earth omet les États les plus petits (Tuvalu). Les
//   remplacer par une boîte approximative serait pire que de les laisser
//   absents : une boîte inventée peut capter un point voisin. On va donc
//   chercher leur contour exact dans l'échelle 1:10m, et seulement eux.
const dejaCouverts = new Set(pays.map((p) => p.iso2));
const comblePar10m: string[] = [];

if (cheminAtlasFin) {
  const atlasFin = JSON.parse(readFileSync(cheminAtlasFin, "utf-8")) as Topologie;
  const arcsFin = decoderAnnexes(atlasFin.arcs, atlasFin.transform);

  for (const geometrie of atlasFin.objects.countries.geometries) {
    if (!geometrie.id) continue;
    const iso2 = numeriqueVersAlpha2.get(String(geometrie.id));
    if (!iso2 || dejaCouverts.has(iso2)) continue;

    const g = geometrie as unknown as { type: string; arcs: number[][] | number[][][] };
    const bruts = g.type === "Polygon" ? [g.arcs as number[][]] : (g.arcs as number[][][]);
    const polygones: number[][][][] = [];
    for (const polygone of bruts) {
      const anneaux = polygone.map((indices) => anneauDepuisArcs(indices, arcsFin));
      const exterieur = anneaux[0];
      if (!exterieur || exterieur.length < MIN_SOMMETS) continue;
      polygones.push([exterieur, ...anneaux.slice(1).filter((a) => a.length >= MIN_SOMMETS)]);
    }
    if (polygones.length > 0) {
      pays.push({ iso2, polygones });
      comblePar10m.push(iso2);
    }
  }
}

// ⚠️ Natural Earth porte l'Australie sur deux identifiants (le continent et
//   l'île). Deux entrées pour un même pays ne cassent pas la résolution —
//   les polygones sont testés l'un après l'autre — mais elles faussent tout
//   contrôle de doublon et rendent le fichier ambigu. On les fusionne.
const fusionnes = new Map<string, EntreePays>();
for (const entree of pays) {
  const existant = fusionnes.get(entree.iso2);
  if (existant) existant.polygones.push(...entree.polygones);
  else fusionnes.set(entree.iso2, { iso2: entree.iso2, polygones: [...entree.polygones] });
}
const paysFusionnes = [...fusionnes.values()].sort((a, b) => a.iso2.localeCompare(b.iso2));

const sortie = {
  source: "Natural Earth 1:50m (via world-atlas@2.0.2, ISC) — domaine public",
  genere_le: new Date().toISOString().slice(0, 10),
  decimales: DECIMALES,
  tolerance_simplification: TOLERANCE,
  /** Pays dont le contour vient de l'échelle 1:10m, faute de présence à 1:50m. */
  comble_depuis_10m: comblePar10m.sort(),
  pays: paysFusionnes,
};

const cheminSortie = join("src", "lib", "eudr", "frontieres-pays.json");
writeFileSync(cheminSortie, JSON.stringify(sortie));

const octets = readFileSync(cheminSortie).length;
const codesObtenus = new Set(paysFusionnes.map((p) => p.iso2));
console.log(`${paysFusionnes.length} pays écrits dans ${cheminSortie} (${(octets / 1024).toFixed(0)} Ko)`);
console.log(`identifiants Natural Earth non mappés : ${nonMappes.length}`);

/* --- Vérification de couverture contre le référentiel officiel ------------ */

const referentiel = readFileSync(join("src", "lib", "eudr", "benchmark-pays.ts"), "utf-8");
const codesAnnexe = [...referentiel.matchAll(/^\s{2}([A-Z]{2}): "/gm)].map((m) => m[1]);
const manquants = codesAnnexe.filter((c) => !codesObtenus.has(c));
console.log(`\ncodes du référentiel : ${codesAnnexe.length}`);
console.log(`couverts par les frontières : ${codesAnnexe.length - manquants.length}`);
if (manquants.length > 0) {
  console.log(`⚠️ SANS FRONTIÈRE : ${manquants.join(", ")}`);
} else {
  console.log("✅ les 144 codes du référentiel ont une frontière");
}
if (comblePar10m.length > 0) console.log(`contours repris de 1:10m : ${comblePar10m.join(", ")}`);
