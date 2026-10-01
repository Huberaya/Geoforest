/**
 * Contrôle P1-08 — le nouveau balayage détecte-t-il **exactement** les mêmes
 * croisements que l'ancienne comparaison exhaustive ?
 *
 * ⚠️ Pourquoi ce script existe.
 *
 * Remplacer un algorithme quadratique par un balayage est l'opération la plus
 * dangereuse d'un chantier de performance : le gain est spectaculaire et
 * immédiatement visible, l'erreur est silencieuse et ne se voit jamais. Un
 * croisement manqué, et un polygone topologiquement invalide est accepté comme
 * parcelle EUDR. Aucune mesure de vitesse ne compense cela.
 *
 * La méthode est donc **différentielle** : l'ancienne implémentation est
 * conservée ici comme référence, et les deux sont confrontées sur des
 * dizaines de milliers de géométries, dont des cas dégénérés.
 *
 * Exécution : npx tsx scripts/check-gis-topology.ts
 */
import { ringSelfIntersects, validateGeometry } from "../src/lib/eudr/gis-validator";
import type { GeoJsonInput, Position } from "../src/lib/eudr/types";

let passed = 0;
const echecs: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    echecs.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  🔴 ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(titre: string): void {
  console.log(`\n\u001b[1m${titre}\u001b[0m`);
}

// --------------------------------------------------------------------------
// Référence : l'implémentation d'origine, en O(n²), conservée trait pour trait.
// Elle ne sert qu'à étalonner la nouvelle. Ne pas la réutiliser ailleurs.
// --------------------------------------------------------------------------

function ccw(a: Position, b: Position, c: Position): number {
  return (c[1] - a[1]) * (b[0] - a[0]) > (b[1] - a[1]) * (c[0] - a[0])
    ? 1
    : (c[1] - a[1]) * (b[0] - a[0]) < (b[1] - a[1]) * (c[0] - a[0])
      ? -1
      : 0;
}

function referenceSegmentsIntersect(a: Position, b: Position, c: Position, d: Position): boolean {
  const d1 = ccw(c, d, a);
  const d2 = ccw(c, d, b);
  const d3 = ccw(a, b, c);
  const d4 = ccw(a, b, d);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

function referenceRingSelfIntersects(ring: Position[]): Position | null {
  const n = ring.length - 1;
  for (let i = 0; i < n; i++) {
    const a = ring[i];
    const b = ring[i + 1];
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === n - 1) continue;
      const c = ring[j];
      const d = ring[j + 1];
      if (referenceSegmentsIntersect(a, b, c, d)) return a;
    }
  }
  return null;
}

// --------------------------------------------------------------------------
// Générateur pseudo-aléatoire déterministe : un contrôle qui ne se rejoue pas
// à l'identique ne verrouille rien.
// --------------------------------------------------------------------------

let graine = 20260930;
function random(): number {
  graine = (graine * 1103515245 + 12345) & 0x7fffffff;
  return graine / 0x7fffffff;
}

function anneauFerme(points: Position[]): Position[] {
  const r = points.map((p) => [p[0], p[1]] as Position);
  r.push([r[0][0], r[0][1]]);
  return r;
}

/** Points quelconques dans un carré : produit surtout des anneaux croisés. */
function anneauAleaatoire(n: number): Position[] {
  const pts: Position[] = [];
  for (let i = 0; i < n; i++) pts.push([random() * 10 - 5, random() * 10 - 5]);
  return anneauFerme(pts);
}

/** Polygone convexe : points d'un cercle triés par angle, donc simple. */
function polygoneConvexe(n: number): Position[] {
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push(random() * 2 * Math.PI);
  angles.sort((p, q) => p - q);
  return anneauFerme(angles.map((a) => [Math.cos(a) * 3, Math.sin(a) * 3] as Position));
}

/** Spirale : cas défavorable au balayage, chaque arête traversant la largeur. */
function spirale(n: number): Position[] {
  const pts: Position[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 12 * Math.PI;
    const r = 0.05 + (i / n) * 4;
    pts.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  return anneauFerme(pts);
}

/** Anneau sur une grille : très souvent des points alignés ou confondus. */
function grille(n: number): Position[] {
  const pts: Position[] = [];
  const cote = Math.max(2, Math.round(Math.sqrt(n)));
  for (let i = 0; i < n; i++) {
    pts.push([((i % cote) - cote / 2) * 0.5, (Math.floor(i / cote) - cote / 2) * 0.5]);
  }
  return anneauFerme(pts);
}

// --------------------------------------------------------------------------

function comparer(nom: string, anneaux: Position[][]): void {
  let divergences = 0;
  let premiers: string[] = [];
  for (const anneau of anneaux) {
    const ref = referenceRingSelfIntersects(anneau);
    const nouv = ringSelfIntersects(anneau);
    const refTrouve = ref !== null;
    const nouvTrouve = nouv !== null;
    if (refTrouve !== nouvTrouve) {
      divergences += 1;
      if (premiers.length < 3) {
        premiers.push(
          `${anneau.length - 1} arêtes : référence=${refTrouve ? "croisement" : "aucun"}, ` +
            `nouveau=${nouvTrouve ? "croisement" : "aucun"}`,
        );
      }
    }
  }
  check(
    nom,
    divergences === 0,
    divergences === 0
      ? `${anneaux.length} géométries comparées`
      : `${divergences}/${anneaux.length} divergent — ${premiers.join(" ; ")}`,
  );
}

function principale(): number {
  console.log("\u001b[1mContrôle différentiel — détection d'auto-intersection (P1-08)\u001b[0m");
  console.log("Nouveau balayage confronté à l'ancienne comparaison exhaustive.\n");

  // ---- A. Géométries aléatoires
  section("A. Confrontation sur des géométries aléatoires");
  const aleatoires: Position[][] = [];
  for (let i = 0; i < 4_000; i++) aleatoires.push(anneauAleaatoire(4 + Math.floor(random() * 60)));
  comparer("anneaux quelconques (mélange de simples et de croisés)", aleatoires);

  const convexes: Position[][] = [];
  for (let i = 0; i < 2_000; i++) convexes.push(polygoneConvexe(4 + Math.floor(random() * 80)));
  comparer("polygones convexes (toujours simples)", convexes);

  const grilles: Position[][] = [];
  for (let i = 0; i < 2_000; i++) grilles.push(grille(4 + Math.floor(random() * 60)));
  comparer("anneaux sur grille (points alignés et confondus)", grilles);

  const petits: Position[][] = [];
  for (let i = 0; i < 1_000; i++) petits.push(anneauAleaatoire(4 + Math.floor(random() * 8)));
  comparer("tout petits anneaux (4 à 11 sommets)", petits);

  const spirales: Position[][] = [];
  for (let i = 0; i < 200; i++) spirales.push(spirale(20 + Math.floor(random() * 400)));
  comparer("spirales (cas défavorable au balayage)", spirales);

  // ---- B. Cas construits
  section("B. Cas construits");

  const carre: Position[] = [
    [0, 0], [1, 0], [1, 1], [0, 1], [0, 0],
  ];
  check("carré : aucun croisement", ringSelfIntersects(carre) === null);

  const huit: Position[] = [
    [0, 0], [2, 2], [2, 0], [0, 2], [0, 0],
  ];
  check("huit (croisement franc) : détecté", ringSelfIntersects(huit) !== null);

  const etoile: Position[] = [];
  for (let i = 0; i < 5; i++) {
    const a = (i * 4 * Math.PI) / 5 - Math.PI / 2;
    etoile.push([Math.cos(a) * 2, Math.sin(a) * 2]);
  }
  etoile.push([etoile[0][0], etoile[0][1]]);
  check("pentagramme {5/2} : détecté", ringSelfIntersects(etoile) !== null);

  const triangle: Position[] = [[0, 0], [1, 0], [0, 1], [0, 0]];
  check("triangle : aucun croisement", ringSelfIntersects(triangle) === null);

  const pointsConfondus: Position[] = [
    [0, 0], [0, 0], [1, 0], [1, 1], [0, 1], [0, 0],
  ];
  check(
    "sommets confondus : même verdict que la référence",
    (ringSelfIntersects(pointsConfondus) !== null) ===
      (referenceRingSelfIntersects(pointsConfondus) !== null),
  );

  const alignes: Position[] = [
    [0, 0], [1, 0], [2, 0], [2, 2], [0, 2], [0, 0],
  ];
  check("arêtes alignées (pas un croisement) : aucun", ringSelfIntersects(alignes) === null);

  const verticales: Position[] = [
    [0, 0], [0, 2], [1, 0], [1, 2], [0, 0],
  ];
  check(
    "arêtes verticales : même verdict que la référence",
    (ringSelfIntersects(verticales) !== null) ===
      (referenceRingSelfIntersects(verticales) !== null),
  );

  // Le prédicat ne détecte pas les contacts en un sommet ni les
  // recouvrements colinéaires. C'est une limite héritée, volontairement
  // conservée ici : la constater n'est pas la corriger (P1-16).
  const contactSommet: Position[] = [
    [0, 0], [2, 0], [1, 1], [1, 0], [2, 2], [0, 2], [0, 0],
  ];
  const refContact = referenceRingSelfIntersects(contactSommet) !== null;
  const nouvContact = ringSelfIntersects(contactSommet) !== null;
  check(
    "contact en un sommet : identique à la référence (limite héritée, P1-16)",
    refContact === nouvContact,
    refContact ? "détecté par les deux" : "non détecté par les deux — limite connue du prédicat",
  );

  // ---- C. À l'échelle
  section("C. Confrontation à l'échelle du plafond produit");
  const grands: Position[][] = [];
  for (let i = 0; i < 20; i++) grands.push(anneauAleaatoire(2_000 + Math.floor(random() * 8_000)));
  comparer("grands anneaux aléatoires (2 000 à 10 000 arêtes)", grands);

  const grandConvexe = polygoneConvexe(9_999);
  const t0 = performance.now();
  const verdictGrand = ringSelfIntersects(grandConvexe);
  const duree = performance.now() - t0;
  check(
    "polygone convexe de 10 000 sommets : simple, et rapide",
    verdictGrand === null && duree < 200,
    `${duree.toFixed(1)} ms`,
  );

  // ---- D. Le validateur complet rend-il le même verdict ?
  section("D. Validateur complet : même code d'erreur");
  let divergencesCode = 0;
  for (const anneau of [...aleatoires.slice(0, 800), ...convexes.slice(0, 400)]) {
    const geo = { type: "Polygon", coordinates: [anneau] } as unknown as GeoJsonInput;
    const texte = JSON.stringify(geo);
    const r = validateGeometry(geo, { rawText: texte, declaredAreaHa: null });
    const codePresent = r.errors.some((e) => e.code === "SELF_INTERSECTION");
    const attendu = referenceRingSelfIntersects(anneau) !== null;
    // Le validateur peut refuser pour une autre raison avant d'arriver à la
    // topologie ; on ne compare que lorsque la topologie est seule en cause.
    const autresErreurs = r.errors.some(
      (e) => e.code !== "SELF_INTERSECTION" && e.code !== "INSUFFICIENT_PRECISION",
    );
    if (autresErreurs) continue;
    if (codePresent !== attendu) divergencesCode += 1;
  }
  check("le validateur signale SELF_INTERSECTION exactement comme la référence",
        divergencesCode === 0,
        divergencesCode === 0 ? "1 200 géométries" : `${divergencesCode} divergences`);

  console.log("\n" + "=".repeat(70));
  console.log(`CONTRÔLES RÉUSSIS : ${passed}/${passed + echecs.length}`);
  if (echecs.length > 0) {
    console.log("\nÉchecs :");
    echecs.forEach((e) => console.log("  🔴 " + e));
  }
  console.log("=".repeat(70));
  return echecs.length === 0 ? 0 : 1;
}

process.exit(principale());
