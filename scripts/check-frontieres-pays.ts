/**
 * Contrôle d'intégrité des frontières pays (`src/lib/eudr/frontieres-pays.json`).
 *
 * ⚠️ Pourquoi ce contrôle existe.
 *
 *   Un défaut réel a été trouvé ici, et pas par le banc de régression : la
 *   Fidji et la Tchoukotka traversent l'antiméridien, et Natural Earth les
 *   encode avec des points de part et d'autre de ±180°. Lu naïvement, un tel
 *   anneau devient une bande qui couvre le monde entier — la Fidji
 *   « contenait » l'Angola, et un point angolais ressortait en conflit de
 *   frontière.
 *
 *   Le banc de régression ne pouvait pas le voir : il ne testait que des
 *   points où l'on attendait un pays. Chercher ce qu'on n'attend pas est une
 *   autre démarche.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface Fichier {
  source: string;
  genere_le: string;
  decimales: number;
  tolerance_simplification: number;
  comble_depuis_10m?: string[];
  pays: Array<{ iso2: string; polygones: number[][][][] }>;
}

const chemin = join("src", "lib", "eudr", "frontieres-pays.json");
const brut = readFileSync(chemin, "utf-8");
const donnees = JSON.parse(brut) as Fichier;

const controles: Array<{ nom: string; ok: boolean; detail?: string }> = [];
const verifier = (nom: string, ok: boolean, detail?: string): void => {
  controles.push({ nom, ok, detail });
};

/* --- Traçabilité --------------------------------------------------------- */

verifier("la source est citée", /Natural Earth/.test(donnees.source), donnees.source);
verifier("la date de génération est renseignée", /^\d{4}-\d{2}-\d{2}$/.test(donnees.genere_le));
verifier("la tolérance de simplification est consignée", typeof donnees.tolerance_simplification === "number");

/* --- Couverture du référentiel ------------------------------------------ */

const referentiel = readFileSync(join("src", "lib", "eudr", "benchmark-pays.ts"), "utf-8");
const codesAnnexe = [...referentiel.matchAll(/^\s{2}([A-Z]{2}): "/gm)].map((m) => m[1]);
const couverts = new Set(donnees.pays.map((p) => p.iso2));
const manquants = codesAnnexe.filter((c) => !couverts.has(c));

verifier(
  `les ${codesAnnexe.length} pays du référentiel ont un contour`,
  manquants.length === 0,
  manquants.join(", "),
);

verifier("aucun code en double", couverts.size === donnees.pays.length);
verifier("aucun pays sans polygone", donnees.pays.every((p) => p.polygones.length > 0));

/* --- Intégrité géométrique ---------------------------------------------- */

// ⚠️ Le contrôle central : un contour dont l'amplitude en longitude dépasse
//   350° est presque toujours un artefact d'antiméridien. Un pays réel de
//   moins de 360° d'étendue ne peut pas couvrir la planète.
const trop3tendus: string[] = [];
// Une longitude hors de [-540, 540] signalerait un déroulement qui a dérapé.
const horsBornes: string[] = [];
// Un anneau non fermé rend le point-dans-polygone arbitraire près de la
// frontière de fermeture.
const nonFermes: string[] = [];

for (const pays of donnees.pays) {
  for (const polygone of pays.polygones) {
    for (const anneau of polygone) {
      if (anneau.length < 4) {
        trop3tendus.push(`${pays.iso2} (anneau de ${anneau.length} points)`);
        continue;
      }
      const lon = anneau.map((p) => p[0]);
      const lat = anneau.map((p) => p[1]);
      const etendue = Math.max(...lon) - Math.min(...lon);
      if (etendue > 350) trop3tendus.push(`${pays.iso2} (${etendue.toFixed(0)}°)`);
      if (Math.min(...lon) < -540 || Math.max(...lon) > 540) horsBornes.push(pays.iso2);
      if (Math.min(...lat) < -90 || Math.max(...lat) > 90) horsBornes.push(pays.iso2);
      const [premier, dernier] = [anneau[0], anneau[anneau.length - 1]];
      if (premier[0] !== dernier[0] || premier[1] !== dernier[1]) nonFermes.push(pays.iso2);
    }
  }
}

verifier(
  "aucun contour d'amplitude aberrante (artefact d'antiméridien)",
  trop3tendus.length === 0,
  [...new Set(trop3tendus)].slice(0, 8).join(" ; "),
);
verifier("toutes les coordonnées sont dans des bornes plausibles", horsBornes.length === 0, [...new Set(horsBornes)].join(", "));
verifier("tous les anneaux sont fermés", nonFermes.length === 0, [...new Set(nonFermes)].join(", "));

/* --- Poids -------------------------------------------------------------- */

const ko = brut.length / 1024;
verifier("le fichier reste sous 2 Mo", ko < 2048, `${ko.toFixed(0)} Ko`);

/* --- Couverture des cas de bord connus ---------------------------------- */

// ⚠️ Ces pays ont tous posé problème au moins une fois.
for (const code of ["FJ", "RU", "US", "NZ", "TV", "LS"]) {
  verifier(`${code} a un contour`, couverts.has(code));
}

/* ------------------------------- Rapport -------------------------------- */

const echecs = controles.filter((c) => !c.ok);
for (const c of controles) {
  if (!c.ok) console.log(`🔴 ${c.nom}${c.detail ? ` — ${c.detail}` : ""}`);
}
console.log(`${donnees.pays.length} pays, ${(ko / 1024).toFixed(2)} Mo`);
console.log(`\n${controles.length - echecs.length}/${controles.length} contrôle(s) réussi(s)`);
process.exit(echecs.length === 0 ? 0 : 1);
