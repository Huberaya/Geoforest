/**
 * Validation satellite sur le jeu de référence (B1).
 *
 * Usage :
 *   GFW_API_KEY=… npx tsx --conditions=react-server scripts/satellite/validate-reference.ts
 *
 * Règles :
 *   - Aucun résultat n'est fabriqué : une géométrie absente = cas NON EXÉCUTÉ.
 *   - Le mode démonstration est désactivé pour toute la run.
 *   - Code de sortie 0 uniquement si TOUS les cas sont exécutés et conformes.
 *     Code 2 si au moins un cas n'a pas été exécuté (ne jamais lire un passage partiel comme vert).
 *     Code 1 si un cas exécuté donne un résultat différent de l'attendu.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { checkDeforestationRisk } from "../../src/lib/eudr/satellite-checker";
import { validateGeometry } from "../../src/lib/eudr/gis-validator";

type Cas = {
  id: string;
  label: string;
  geometry: Record<string, unknown> | null;
  expected: string;
  expected_before_run: string | null;
};

type Issue = "COMPLIANT" | "NON_COMPLIANT" | "NO_VERDICT" | "UNAVAILABLE" | "REJECTED";

async function resultatDe(cas: Cas): Promise<{ issue: Issue; detail: string }> {
  const geo = cas.geometry as never;
  const validation = validateGeometry(geo as never);
  if (!validation.valid) {
    return { issue: "REJECTED", detail: validation.errors.map((e: { code?: string }) => e.code ?? "").join(",") };
  }
  const r = await checkDeforestationRisk(geo, "2024-06-01");
  if (r.source === "unavailable") return { issue: "UNAVAILABLE", detail: String(r.details ?? "") };
  if (r.compliant === true) return { issue: "COMPLIANT", detail: `perte post-2020 : ${r.loss_area_ha ?? 0} ha` };
  if (r.compliant === false) return { issue: "NON_COMPLIANT", detail: `année de perte : ${r.loss_year}` };
  return { issue: "NO_VERDICT", detail: String(r.details ?? "") };
}

async function main(): Promise<void> {
  // Garde-fou : jamais de simulation dans une validation.
  process.env.GFW_DEMO_MODE = "false";
  const fichier = join(__dirname, "reference-cases.json");
  const { cases } = JSON.parse(readFileSync(fichier, "utf-8")) as { cases: Cas[] };

  let nonExecutes = 0;
  let echecs = 0;
  for (const cas of cases) {
    if (cas.id === "D") {
      // Clé factice : l'appel part vers l'hôte officiel et échoue (réseau ou refus).
      if (!process.env.GFW_API_KEY) process.env.GFW_API_KEY = "cle-factice-validation-indisponible";
    }
    if (cas.geometry === null) {
      nonExecutes++;
      console.log(`${cas.id}  NON EXÉCUTÉ — géométrie non fournie (${cas.label})`);
      continue;
    }
    if (cas.id !== "C" && cas.id !== "D" && !process.env.GFW_API_KEY) {
      nonExecutes++;
      console.log(`${cas.id}  NON EXÉCUTÉ — GFW_API_KEY absente (${cas.label})`);
      continue;
    }
    if (cas.expected_before_run === null) {
      nonExecutes++;
      console.log(`${cas.id}  NON EXÉCUTÉ — résultat attendu non pré-enregistré`);
      continue;
    }
    const obtenu = await resultatDe(cas);
    const ok = obtenu.issue === cas.expected;
    if (!ok) echecs++;
    console.log(`${cas.id}  ${ok ? "OK    " : "ÉCHEC "} attendu=${cas.expected} obtenu=${obtenu.issue} — ${obtenu.detail}`);
  }

  console.log(`\nexécutés: ${cases.length - nonExecutes}/${cases.length} · échecs: ${echecs} · non exécutés: ${nonExecutes}`);
  if (echecs > 0) process.exit(1);
  if (nonExecutes > 0) process.exit(2);
  process.exit(0);
}

void main();
