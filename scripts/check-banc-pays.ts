/**
 * Banc de régression — résolution du pays d'origine et benchmark EUDR.
 *
 * ⚠️ Ce script est VOLONTAIREMENT ROUGE au moment où il est écrit (C6a).
 *    C'est le livrable, pas un défaut : il rend mesurables les écarts entre le
 *    code et le référentiel officiel AVANT qu'on y touche. Sans lui, on ne peut
 *    pas distinguer « corrigé » de « pas encore touché ».
 *
 * Référentiel de vérité :
 *   Règlement d'exécution (UE) 2025/1093 du 22 mai 2025, annexe — 140 pays
 *   LOW, 4 pays HIGH (Biélorussie, Corée du Nord, Myanmar, Russie).
 *   Article 1(2) : tout pays non listé est STANDARD par défaut.
 *
 * ⚠️ La liste est appelée à être révisée (art. 29(2) du règlement (UE)
 *    2023/1115). Au 05/11/2026, 2025/1093 reste la dernière itération — les
 *    lignes directrices de la Commission du 20/07/2026 (OJ C/2026/3896) la
 *    citent comme telle. Toute révision devra se refléter ici ET dans le
 *    référentiel applicatif, avec sa date de version.
 *
 * Usage : npm run check:banc-pays
 */
import { resolveCountry } from "../src/lib/eudr/satellite-checker";

type Tiers = "LOW" | "STANDARD" | "HIGH";

interface PointReference {
  nom: string;
  lon: number;
  lat: number;
  /**
   * Codes ISO acceptés. Plusieurs valeurs quand le regroupement est légitime :
   * un État membre peut être identifié « EU » à ce stade — ce qui compte pour
   * la DDR est le niveau LOW, et non le découpage fin. L'identification à
   * l'État membre relève de C6c, pour le champ « pays de production » TRACES.
   */
  iso2Attendus: string[];
  /** Niveau attendu au titre du règlement d'exécution (UE) 2025/1093. */
  tier: Tiers;
  /** P pourquoi ce point est dans le banc. */
  motif: string;
}

/**
 * ⚠️ Les coordonnées sont des chefs-lieux ou des centroïdes de région
 *    productrice, jamais des points frontaliers : un point sur une frontière
 *    n'a pas de réponse unique, et l'inclure rendrait le banc instable.
 */
const POINTS: PointReference[] = [
  /* --- Les 4 seuls pays HIGH du règlement d'exécution --------------------- */
  { nom: "Minsk (BY)", lon: 27.57, lat: 53.9, iso2Attendus: ["BY"], tier: "HIGH", motif: "HIGH officiel" },
  { nom: "Pyongyang (KP)", lon: 125.75, lat: 39.03, iso2Attendus: ["KP"], tier: "HIGH", motif: "HIGH officiel" },
  { nom: "Yangon (MM)", lon: 96.16, lat: 16.87, iso2Attendus: ["MM"], tier: "HIGH", motif: "HIGH officiel" },
  { nom: "Moscou (RU)", lon: 37.62, lat: 55.75, iso2Attendus: ["RU"], tier: "HIGH", motif: "HIGH officiel" },

  /* --- LOW officiels que le code classe STANDARD -------------------------- */
  { nom: "Accra (GH)", lon: -0.19, lat: 5.6, iso2Attendus: ["GH"], tier: "LOW", motif: "LOW officiel — cacao" },
  { nom: "Kerala (IN)", lon: 76.3, lat: 10.5, iso2Attendus: ["IN"], tier: "LOW", motif: "LOW officiel — café, caoutchouc" },
  { nom: "Nairobi (KE)", lon: 36.82, lat: -1.29, iso2Attendus: ["KE"], tier: "LOW", motif: "LOW officiel — café" },
  { nom: "Bangkok (TH)", lon: 100.5, lat: 13.75, iso2Attendus: ["TH"], tier: "LOW", motif: "LOW officiel — caoutchouc" },
  { nom: "Hanoï (VN)", lon: 105.85, lat: 21.03, iso2Attendus: ["VN"], tier: "LOW", motif: "LOW officiel — bois, café" },
  { nom: "San José (CR)", lon: -84.09, lat: 9.93, iso2Attendus: ["CR"], tier: "LOW", motif: "LOW officiel" },

  /* --- LOW officiels totalement absents de la table du code --------------- */
  { nom: "Libreville (GA)", lon: 9.45, lat: 0.39, iso2Attendus: ["GA"], tier: "LOW", motif: "LOW officiel — absent de la table" },
  { nom: "Johannesburg (ZA)", lon: 28.05, lat: -26.2, iso2Attendus: ["ZA"], tier: "LOW", motif: "LOW officiel — absent de la table" },
  { nom: "Oslo (NO)", lon: 10.75, lat: 59.91, iso2Attendus: ["NO"], tier: "LOW", motif: "LOW officiel — absent de la table" },
  { nom: "Berne (CH)", lon: 7.45, lat: 46.95, iso2Attendus: ["CH"], tier: "LOW", motif: "LOW officiel — absent de la table" },
  { nom: "Londres (GB)", lon: -0.13, lat: 51.51, iso2Attendus: ["GB"], tier: "LOW", motif: "LOW officiel — absent de la table" },
  { nom: "Rabat (MA)", lon: -6.84, lat: 34.02, iso2Attendus: ["MA"], tier: "LOW", motif: "LOW officiel — résolu EU aujourd'hui" },
  { nom: "Tunis (TN)", lon: 10.18, lat: 36.8, iso2Attendus: ["TN"], tier: "LOW", motif: "LOW officiel — résolu EU aujourd'hui" },
  { nom: "Ankara (TR)", lon: 32.86, lat: 39.93, iso2Attendus: ["TR"], tier: "LOW", motif: "LOW officiel — résolu EU aujourd'hui" },
  { nom: "Kyiv (UA)", lon: 30.52, lat: 50.45, iso2Attendus: ["UA"], tier: "LOW", motif: "LOW officiel — résolu RU/HIGH aujourd'hui" },
  { nom: "Alger (DZ)", lon: 3.06, lat: 36.75, iso2Attendus: ["DZ"], tier: "LOW", motif: "LOW officiel — résolu EU aujourd'hui" },

  /* --- États membres : la boîte « EU » doit rester correcte --------------- */
  { nom: "Helsinki (FI)", lon: 24.94, lat: 60.17, iso2Attendus: ["EU", "FI"], tier: "LOW", motif: "État membre" },
  { nom: "Lisbonne (PT)", lon: -9.14, lat: 38.72, iso2Attendus: ["EU", "PT"], tier: "LOW", motif: "État membre" },
  { nom: "Séville (ES)", lon: -5.98, lat: 37.39, iso2Attendus: ["EU", "ES"], tier: "LOW", motif: "État membre" },
  { nom: "Palerme (IT)", lon: 13.36, lat: 38.12, iso2Attendus: ["EU", "IT"], tier: "LOW", motif: "État membre" },
  { nom: "La Valette (MT)", lon: 14.51, lat: 35.9, iso2Attendus: ["EU", "MT"], tier: "LOW", motif: "État membre — le plus au sud" },
  { nom: "Varsovie (PL)", lon: 21.01, lat: 52.23, iso2Attendus: ["EU", "PL"], tier: "LOW", motif: "État membre" },
  { nom: "Stockholm (SE)", lon: 18.07, lat: 59.33, iso2Attendus: ["EU", "SE"], tier: "LOW", motif: "État membre" },

  /* --- STANDARD : non listés, donc standard par défaut (art. 1(2)) -------- */
  { nom: "Manaus (BR)", lon: -60.02, lat: -3.12, iso2Attendus: ["BR"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Jakarta (ID)", lon: 106.85, lat: -6.21, iso2Attendus: ["ID"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Kuala Lumpur (MY)", lon: 101.69, lat: 3.14, iso2Attendus: ["MY"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Abidjan (CI)", lon: -4.02, lat: 5.35, iso2Attendus: ["CI"], tier: "STANDARD", motif: "STANDARD par défaut — cacao" },
  { nom: "Douala (CM)", lon: 9.7, lat: 4.05, iso2Attendus: ["CM"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Lagos (NG)", lon: 3.39, lat: 6.45, iso2Attendus: ["NG"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Kinshasa (CD)", lon: 15.31, lat: -4.33, iso2Attendus: ["CD"], tier: "STANDARD", motif: "STANDARD par défaut — bassin du Congo" },
  { nom: "Bogotá (CO)", lon: -74.07, lat: 4.71, iso2Attendus: ["CO"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Lima (PE)", lon: -77.04, lat: -12.05, iso2Attendus: ["PE"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Mexico (MX)", lon: -99.13, lat: 19.43, iso2Attendus: ["MX"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Buenos Aires (AR)", lon: -58.38, lat: -34.6, iso2Attendus: ["AR"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Addis-Abeba (ET)", lon: 38.75, lat: 9.03, iso2Attendus: ["ET"], tier: "STANDARD", motif: "STANDARD par défaut — café" },
  { nom: "Dar es Salaam (TZ)", lon: 39.28, lat: -6.79, iso2Attendus: ["TZ"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Kampala (UG)", lon: 32.58, lat: 0.35, iso2Attendus: ["UG"], tier: "STANDARD", motif: "STANDARD par défaut" },
  { nom: "Monrovia (LR)", lon: -10.76, lat: 6.3, iso2Attendus: ["LR"], tier: "STANDARD", motif: "STANDARD par défaut — caoutchouc" },
  { nom: "Phnom Penh (KH)", lon: 104.92, lat: 11.55, iso2Attendus: ["KH"], tier: "STANDARD", motif: "STANDARD — boîte VN voisine" },
  { nom: "Oulan-Bator (MN)", lon: 106.92, lat: 47.89, iso2Attendus: ["MN"], tier: "STANDARD", motif: "STANDARD — boîte CN voisine" },
  { nom: "Port Moresby (PG)", lon: 147.15, lat: -9.44, iso2Attendus: ["PG"], tier: "STANDARD", motif: "STANDARD par défaut — bois" },
];

/* -------------------------------------------------------------------------- */
/* Garde-fous du banc lui-même                                                */
/*                                                                            */
/* ⚠️ Un banc faux est pire qu'aucun banc : il rendrait vert sur du code cassé. */
/*    Ces contrôles vérifient le banc AVANT de l'utiliser.                    */

const anomaliesBanc: string[] = [];

if (POINTS.length < 40) {
  anomaliesBanc.push(`seulement ${POINTS.length} points : un banc trop court ne détecte pas les régressions`);
}

const nomsVus = new Set<string>();
for (const p of POINTS) {
  if (nomsVus.has(p.nom)) anomaliesBanc.push(`point en double : ${p.nom}`);
  nomsVus.add(p.nom);
  if (p.lat < -90 || p.lat > 90) anomaliesBanc.push(`latitude hors bornes : ${p.nom}`);
  if (p.lon < -180 || p.lon > 180) anomaliesBanc.push(`longitude hors bornes : ${p.nom}`);
  if (p.iso2Attendus.length === 0) anomaliesBanc.push(`aucun code ISO attendu : ${p.nom}`);
}

// Les 4 pays HIGH du règlement doivent tous figurer : ce sont les seuls cas où
// une erreur de résolution produit un faux « conforme » rassurant.
for (const iso2 of ["BY", "KP", "MM", "RU"]) {
  if (!POINTS.some((p) => p.iso2Attendus.includes(iso2) && p.tier === "HIGH")) {
    anomaliesBanc.push(`pays HIGH absent du banc : ${iso2}`);
  }
}

if (anomaliesBanc.length > 0) {
  console.error("🔴 Le banc de régression lui-même est incorrect :");
  for (const a of anomaliesBanc) console.error(`   ${a}`);
  process.exit(2);
}

/* -------------------------------------------------------------------------- */

type Nature = "TIER" | "PAYS" | "NON_RESOLU";

interface Ecart {
  point: PointReference;
  obtenuIso2: string;
  obtenuTier: string;
  nature: Nature;
}

const ecarts: Ecart[] = [];
let conforme = 0;

for (const point of POINTS) {
  const r = resolveCountry(point.lon, point.lat);
  const tierOk = r.risk === point.tier;
  const paysOk = point.iso2Attendus.includes(r.iso2);

  if (tierOk && paysOk) {
    conforme += 1;
    continue;
  }

  const nature: Nature = r.iso2 === "XX" ? "NON_RESOLU" : tierOk ? "PAYS" : "TIER";
  ecarts.push({ point, obtenuIso2: r.iso2, obtenuTier: r.risk, nature });
}

/* ------------------------------- Rapport --------------------------------- */

if (ecarts.length > 0) {
  console.log(`\n${ecarts.length} écart(s) sur ${POINTS.length} points de référence\n`);

  const parNature: Record<Nature, Ecart[]> = {
    TIER: ecarts.filter((e) => e.nature === "TIER"),
    PAYS: ecarts.filter((e) => e.nature === "PAYS"),
    NON_RESOLU: ecarts.filter((e) => e.nature === "NON_RESOLU"),
  };

  if (parNature.TIER.length > 0) {
    console.log("── Niveau de risque faux (le plus grave : il fausse la DDR) ──");
    for (const e of parNature.TIER) {
      console.log(
        `  🔴 ${e.point.nom.padEnd(20)} ${e.obtenuIso2.padEnd(3)} ${e.obtenuTier.padEnd(9)}` +
          ` → attendu ${e.point.tier.padEnd(9)} (${e.point.motif})`,
      );
    }
    console.log("");
  }

  if (parNature.NON_RESOLU.length > 0) {
    console.log("── Pays non résolu (XX) ──");
    for (const e of parNature.NON_RESOLU) {
      console.log(`  🔴 ${e.point.nom.padEnd(20)} XX        → attendu ${e.point.iso2Attendus[0]} / ${e.point.tier} (${e.point.motif})`);
    }
    console.log("");
  }

  if (parNature.PAYS.length > 0) {
    console.log("── Pays faux, niveau correct ──");
    for (const e of parNature.PAYS) {
      console.log(`  🔴 ${e.point.nom.padEnd(20)} ${e.obtenuIso2.padEnd(3)}       → attendu ${e.point.iso2Attendus[0]} (${e.point.motif})`);
    }
    console.log("");
  }
}

console.log(`${conforme}/${POINTS.length} point(s) conforme(s)`);
console.log(
  ecarts.length === 0
    ? "✅ Résolution du pays et benchmark conformes au règlement d'exécution (UE) 2025/1093."
    : "🔴 Écarts avec le règlement d'exécution (UE) 2025/1093 — voir ci-dessus.",
);

process.exit(ecarts.length === 0 ? 0 : 1);
