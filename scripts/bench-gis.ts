/**
 * Mesure P1-08 — coût du validateur géographique.
 *
 * ⚠️ Deux précautions de mesure, toutes deux imposées par des erreurs
 *    commises en écrivant ce script.
 *
 * 1. **Le plafond de P1-07 coupe la mesure.** Depuis ce chantier, le produit
 *    refuse au-delà de 10 000 sommets. Une mesure passant par HTTP s'arrête
 *    donc là et donnerait un résultat vide de sens. La fonction de détection
 *    est donc appelée directement, et le coût HTTP est mesuré à part, au
 *    plafond.
 *
 * 2. **Une seule forme ne prouve rien.** La première version ne mesurait
 *    qu'un peigne, et annonçait 18 ms. Un serpentin — géométrie tout aussi
 *    valide — en demandait 13 527. Puis le correctif qui réglait le serpentin
 *    a ramené le peigne à 8 308 ms. Aucun de ces deux chiffres n'était
 *    « le » temps de calcul : c'était celui d'une forme particulière. Le banc
 *    mesure donc **sept formes**, dont deux construites contre l'algorithme.
 *
 * Exécution : npx tsx scripts/bench-gis.ts
 */
import { ringSelfIntersects, validateGeometry } from "../src/lib/eudr/gis-validator";
import type { GeoJsonInput, Position } from "../src/lib/eudr/types";

let verifsReussies = 0;
const verifsEchouees: string[] = [];

function check(nom: string, condition: boolean, detail = ""): void {
  if (condition) {
    verifsReussies += 1;
    console.log(`  ✅ ${nom}${detail ? ` — ${detail}` : ""}`);
  } else {
    verifsEchouees.push(nom);
    console.log(`  🔴 ${nom}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(titre: string): void {
  console.log(`\n\u001b[1m${titre}\u001b[0m`);
}

// ------------------------------------------------------------------ formes

/** Générateur déterministe : une mesure qui ne se rejoue pas à l'identique
 *  ne verrouille rien. */
let graine = 20260930;
function random(): number {
  graine = (graine * 1103515245 + 12345) & 0x7fffffff;
  return graine / 0x7fffffff;
}

function fermer(pts: Position[]): Position[] {
  const r = pts.map((p) => [p[0], p[1]] as Position);
  r.push([r[0][0], r[0][1]]);
  return r;
}

/** Peigne rectangulaire : la forme d'un parcelleire découpé. Simple. */
function peigne(n: number): Position[] {
  const distincts = Math.max(4, n - 1);
  const m = Math.floor(distincts / 2);
  const k = distincts - m;
  const pas = 0.00001;
  const h = 0.00002;
  const bas: Position[] = [];
  for (let i = 0; i < m; i++) bas.push([-5.5 + i * pas, 5.3]);
  const haut: Position[] = [];
  for (let i = 0; i < k; i++) haut.push([-5.5 + (k - 1 - i) * pas, 5.3 + h]);
  return fermer([...bas, ...haut]);
}

/** Serpentin horizontal : arêtes longues en x, écrasées en y. Simple.
 *  Construit contre un balayage par l'abscisse. */
function serpentinHorizontal(n: number): Position[] {
  const rangees = Math.max(2, Math.floor((n - 1) / 2));
  const pts: Position[] = [];
  for (let i = 0; i < rangees; i++) {
    const y = i * 0.00002;
    if (i % 2 === 0) pts.push([-5, y], [5, y]);
    else pts.push([5, y], [-5, y]);
  }
  return fermer(pts);
}

/** Serpentin diagonal : arêtes longues sur les deux axes à la fois. Simple.
 *  C'est le pire cas résiduel de la méthode — il est mesuré, pas caché. */
function serpentinDiagonal(n: number): Position[] {
  const rangees = Math.max(2, Math.floor((n - 1) / 2));
  const pts: Position[] = [];
  for (let i = 0; i < rangees; i++) {
    const d = i * 0.00002;
    if (i % 2 === 0) pts.push([-5 + d, -5], [5 + d, 5]);
    else pts.push([5 + d, 5], [-5 + d, -5]);
  }
  return fermer(pts);
}

/** Spirale : enroulement serré, arêtes courtes. */
function spirale(n: number): Position[] {
  const pts: Position[] = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * 12 * Math.PI;
    const r = 0.05 + (i / n) * 4;
    pts.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  return fermer(pts);
}

/** Polygone convexe : la forme d'une parcelle réelle. Toujours simple. */
function convexe(n: number): Position[] {
  const angles: number[] = [];
  for (let i = 0; i < n; i++) angles.push((i / n) * 2 * Math.PI + random() * 1e-9);
  return fermer(angles.map((a) => [Math.cos(a) * 3, Math.sin(a) * 3] as Position));
}

/** Anneau quelconque : se croise presque toujours. */
function quelconque(n: number): Position[] {
  const pts: Position[] = [];
  for (let i = 0; i < n; i++) pts.push([random() * 10 - 5, random() * 10 - 5]);
  return fermer(pts);
}

/** Trace GPS réaliste : cheminement sur une grille fine, simple. */
function traceGps(n: number): Position[] {
  const pts: Position[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += (random() - 0.5) * 0.0002;
    y += (random() - 0.5) * 0.0002;
    pts.push([x, y]);
  }
  return fermer(pts);
}

// ------------------------------------------------------------------ mesure

interface Forme {
  nom: string;
  note: string;
  fabrique: (n: number) => Position[];
}

const FORMES: Forme[] = [
  { nom: "peigne", note: "parcelleire découpé", fabrique: peigne },
  { nom: "convexe", note: "parcelle réelle", fabrique: convexe },
  { nom: "trace GPS", note: "cheminement réaliste", fabrique: traceGps },
  { nom: "quelconque", note: "anneau aléatoire (croisé)", fabrique: quelconque },
  { nom: "spirale", note: "enroulement", fabrique: spirale },
  { nom: "serpentin ⚠️", note: "construit contre l'algorithme", fabrique: serpentinHorizontal },
  { nom: "serpentin diagonal ⚠️", note: "pire cas résiduel", fabrique: serpentinDiagonal },
];

const TAILLES = [1_000, 5_000, 10_000, 25_000, 50_000];

/** Durée d'un appel, répété pour sortir du bruit de mesure. */
function mesurer(anneau: Position[]): number {
  ringSelfIntersects(anneau); // passage à blanc
  const essai = performance.now();
  ringSelfIntersects(anneau);
  const dureeUnitaire = performance.now() - essai;
  const repetitions = dureeUnitaire > 40 ? 1 : Math.max(1, Math.ceil(40 / Math.max(0.05, dureeUnitaire)));
  const t0 = performance.now();
  for (let r = 0; r < repetitions; r++) ringSelfIntersects(anneau);
  return (performance.now() - t0) / repetitions;
}

function principale(): number {
  console.log("\u001b[1mMesure P1-08 — détection d'auto-intersection\u001b[0m");
  console.log("Fonction appelée directement (le produit refuse au-delà de 10 000 sommets).\n");

  const table = new Map<string, number[]>();

  for (const forme of FORMES) {
    section(`${forme.nom} — ${forme.note}`);
    const durees: number[] = [];
    console.log("  sommets │      durée │  µs/sommet │  loi mesurée");
    console.log(" ─────────┼────────────┼────────────┼──────────────");
    let precedente: { n: number; ms: number } | null = null;
    for (const n of TAILLES) {
      const anneau = forme.fabrique(n);
      const ms = mesurer(anneau);
      durees.push(ms);
      let loi = "";
      if (precedente) {
        const e = Math.log(ms / precedente.ms) / Math.log(n / precedente.n);
        loi = `O(n^${e.toFixed(2)})`;
      }
      console.log(
        `  ${String(n).padStart(7)} │ ${(ms.toFixed(1) + " ms").padStart(10)} │ ` +
          `${((ms * 1000) / n).toFixed(2).padStart(10)} │ ${loi.padStart(13)}`,
      );
      precedente = { n, ms };
    }
    table.set(forme.nom, durees);
  }

  // ---- Synthèse
  section("Synthèse — durée par forme");
  console.log(`  ${"forme".padEnd(24)} │ ${("10 000").padStart(10)} │ ${("50 000").padStart(10)}`);
  console.log(`  ${"─".repeat(24)}─┼─${"─".repeat(10)}─┼─${"─".repeat(10)}`);
  for (const forme of FORMES) {
    const d = table.get(forme.nom)!;
    console.log(
      `  ${forme.nom.padEnd(24)} │ ${(d[2].toFixed(1) + " ms").padStart(10)} │ ${(d[4].toFixed(1) + " ms").padStart(10)}`,
    );
  }

  // ---- Validateur complet, au plafond réel du produit
  section("Validateur complet au plafond du produit (10 000 sommets)");
  console.log("  C'est le coût réellement payé par une requête HTTP.\n");
  const anneau = peigne(10_000)
    .map(([lon, lat]) => `[${lon.toFixed(6)},${lat.toFixed(6)}]`)
    .join(",");
  const texte = `{"type":"Polygon","coordinates":[[${anneau}]]}`;
  const objet = JSON.parse(texte) as GeoJsonInput;
  validateGeometry(objet, { rawText: texte, declaredAreaHa: null });
  const reps = 5;
  const t0 = performance.now();
  let dernier: { valid: boolean; errors: { code: string }[] } = { valid: false, errors: [] };
  for (let r = 0; r < reps; r++) {
    dernier = validateGeometry(objet, { rawText: texte, declaredAreaHa: null }) as typeof dernier;
  }
  const totalMs = (performance.now() - t0) / reps;
  const partMs = mesurer(peigne(10_000));
  console.log(`  validateur complet : ${totalMs.toFixed(1)} ms · valide=${dernier.valid}`);
  console.log(`  dont auto-intersection : ${partMs.toFixed(1)} ms (${((partMs / totalMs) * 100).toFixed(0)} %)`);

  // ---- Bilan
  const seuil = 500;
  section("Bilan — critère P1-08 : 50 000 sommets en moins de 500 ms");
  const cinquante = TAILLES.indexOf(50_000);
  for (const forme of FORMES) {
    const ms = table.get(forme.nom)![cinquante];
    check(`${forme.nom}`, ms < seuil, `${ms.toFixed(1)} ms`);
  }
  check(
    "validateur complet au plafond du produit (10 000) < 500 ms",
    totalMs < seuil,
    `${totalMs.toFixed(1)} ms`,
  );

  console.log("\n" + "=".repeat(70));
  console.log(`CONTRÔLES RÉUSSIS : ${verifsReussies}/${verifsReussies + verifsEchouees.length}`);
  if (verifsEchouees.length > 0) {
    console.log("\nÉchecs :");
    verifsEchouees.forEach((e) => console.log("  🔴 " + e));
  }
  console.log("=".repeat(70));
  return verifsEchouees.length === 0 ? 0 : 1;
}

process.exit(principale());
