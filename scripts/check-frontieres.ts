/**
 * Points de contrôle de la résolution pays, partagés avec le backend Python.
 *
 * ⚠️ Depuis C6c (`main`, PR #18), la résolution du pays côté TypeScript est
 *   faite par `src/lib/eudr/resolution-pays.ts` (contours Natural Earth 1:50m,
 *   `frontieres-pays.json`, benchmark du règlement d'exécution (UE) 2025/1093).
 *   Le module `src/lib/eudr/frontieres.ts` de la branche #11, qui faisait la
 *   même chose avec `data/frontieres/countries-50m.json`, a été retiré : deux
 *   résolveurs pour une même question finissent par diverger.
 *
 *   Ce qui est conservé de la branche : le jeu de points
 *   `data/frontieres/points-de-controle.json`, lu AUSSI par
 *   `backend/tests/test_frontieres.py`. Une divergence entre le résolveur
 *   TypeScript et le résolveur Python échoue ainsi dans les DEUX suites.
 *
 * Exécution : npx tsx --conditions=react-server scripts/check-frontieres.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { resoudrePays } from "../src/lib/eudr/resolution-pays";

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

interface PointDeControle {
  label: string;
  lon: number;
  lat: number;
  iso2: string;
  motif?: string;
}

const jeu = JSON.parse(readFileSync(join(process.cwd(), "data", "frontieres", "points-de-controle.json"), "utf8")) as {
  points: PointDeControle[];
};

console.log("\n\u001b[1mPoints de contrôle partagés avec Python (même fichier, même attendu)\u001b[0m");
check("au moins quinze points de contrôle", jeu.points.length >= 15, `${jeu.points.length}`);
for (const p of jeu.points) {
  const r = resoudrePays(p.lon, p.lat);
  const ok = p.iso2 === "XX" ? r.iso2 === "XX" && r.statut !== "RESOLU" : r.iso2 === p.iso2 && r.statut === "RESOLU";
  check(`${p.label} → ${p.iso2}`, ok, `${r.iso2} (${r.statut})${p.motif ? ` · ${p.motif}` : ""}`);
}

console.log("\n\u001b[1mHors couverture et entrées invalides : jamais un voisin substitué\u001b[0m");
check("haute mer → XX", resoudrePays(-30, 20).iso2 === "XX");
check("NaN → XX", resoudrePays(Number.NaN, 0).iso2 === "XX");
check("Infinity → XX", resoudrePays(Number.POSITIVE_INFINITY, 0).iso2 === "XX");
check("hors plage (lon 200) → XX", resoudrePays(200, 0).iso2 === "XX");

console.log(`\n${passed} contrôle(s) réussi(s), ${echecs.length} échec(s).`);
if (echecs.length > 0) {
  for (const e of echecs) console.log(`  - ${e}`);
  process.exit(1);
}
