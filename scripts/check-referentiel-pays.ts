/**
 * Contrôle d'intégrité du référentiel pays (règlement d'exécution (UE) 2025/1093).
 *
 * ⚠️ Pourquoi ce fichier existe, séparé du banc de régression (C6a).
 *
 *   Le banc vérifie que `resolveCountry` répond juste sur 45 points. Ce fichier
 *   vérifie autre chose : que le **référentiel lui-même** est fidèle à l'annexe.
 *   Ce sont deux fautes distinctes. Une table fausse rendrait des réponses
 *   fausses avec une géométrie parfaite, et le banc ne le verrait que là où il
 *   a des points.
 *
 * ⚠️ Le compte seul ne prouve rien. Au premier jet de cette table, il y avait
 *   exactement 140 entrées — et deux pays faux, compensés par deux pays
 *   manquants. Un test qui se contente de compter serait passé au vert.
 */
import {
  PAYS_RISQUE_ELEVE,
  PAYS_RISQUE_FAIBLE,
  REFERENTIEL_SOURCE,
  REFERENTIEL_VERSION,
  REFERENTIEL_VERIFIE_LE,
  estListeALAnnexe,
  niveauBenchmark,
  nomOfficiel,
} from "../src/lib/eudr/benchmark-pays";

interface Controle {
  nom: string;
  ok: boolean;
  detail?: string;
}

const controles: Controle[] = [];
const verifier = (nom: string, ok: boolean, detail?: string): void => {
  controles.push({ nom, ok, detail });
};

const faible = Object.keys(PAYS_RISQUE_FAIBLE);
const eleve = Object.keys(PAYS_RISQUE_ELEVE);

/* --- Conformité au texte : les effectifs de l'annexe ---------------------- */

// L'annexe du règlement d'exécution (UE) 2025/1093 comporte 140 pays LOW et
// 4 pays HIGH. Ces deux nombres sont la signature du texte.
verifier("140 pays de risque faible", faible.length === 140, `obtenu : ${faible.length}`);
verifier("4 pays de risque élevé", eleve.length === 4, `obtenu : ${eleve.length}`);

/* --- Les 4 pays HIGH, nommés --------------------------------------------- */

// ⚠️ Ce sont les seuls cas où une erreur produit un faux « conforme »
//   rassurant sur une origine réellement à risque.
const HIGH_ATTENDUS = ["BY", "KP", "MM", "RU"];
verifier(
  "les 4 pays HIGH sont exactement Biélorussie, Corée du Nord, Myanmar, Russie",
  HIGH_ATTENDUS.every((c) => c in PAYS_RISQUE_ELEVE) && eleve.length === 4,
  `obtenu : ${eleve.sort().join(", ")}`,
);

// Un pays ne peut pas être à la fois LOW et HIGH.
const conflits = faible.filter((c) => c in PAYS_RISQUE_ELEVE);
verifier("aucun pays présent dans les deux listes", conflits.length === 0, conflits.join(", "));

/* --- Forme des codes ----------------------------------------------------- */

const codes = [...faible, ...eleve];
const malFormes = codes.filter((c) => !/^[A-Z]{2}$/.test(c));
verifier("tous les codes sont ISO 3166-1 alpha-2", malFormes.length === 0, malFormes.join(", "));
verifier(
  "aucun code en double",
  new Set(codes).size === codes.length,
  `${codes.length} codes pour ${new Set(codes).size} uniques`,
);

/* --- Les 27 États membres sont LOW, individuellement -------------------- */

// L'annexe ne connaît pas de regroupement « Union européenne » : chaque État
// membre y figure nommément. Les manquer rendrait toute origine européenne
// STANDARD par défaut.
const UE_27 = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU",
  "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
];
const ueAbsents = UE_27.filter((c) => niveauBenchmark(c) !== "LOW");
verifier("les 27 États membres sont LOW", ueAbsents.length === 0, ueAbsents.join(", "));

/* --- Pays producteurs suivis par le produit ----------------------------- */

// ⚠️ Ces pays ont été choisis parce que le produit les connaît déjà (table de
//   boîtes, export TRACES) et parce qu'ils ont été faux au moins une fois.
const ATTENDUS: Record<string, "LOW" | "STANDARD" | "HIGH"> = {
  GH: "LOW", KE: "LOW", IN: "LOW", TH: "LOW", VN: "LOW", CR: "LOW", PG: "LOW",
  MN: "LOW", GA: "LOW", ZA: "LOW", MA: "LOW", TN: "LOW", TR: "LOW", UA: "LOW",
  CI: "STANDARD", CM: "STANDARD", NG: "STANDARD", CD: "STANDARD", BR: "STANDARD",
  ID: "STANDARD", MY: "STANDARD", CO: "STANDARD", PE: "STANDARD", BO: "STANDARD",
  EC: "STANDARD", MX: "STANDARD", AR: "STANDARD", PY: "STANDARD", LR: "STANDARD",
  TZ: "STANDARD", UG: "STANDARD", ET: "STANDARD", KH: "STANDARD", GT: "STANDARD",
  HN: "STANDARD", NI: "STANDARD", BY: "HIGH", KP: "HIGH", MM: "HIGH", RU: "HIGH",
};
const ecarts = Object.entries(ATTENDUS).filter(([c, t]) => niveauBenchmark(c) !== t);
verifier(
  `${Object.keys(ATTENDUS).length} pays producteurs au bon niveau`,
  ecarts.length === 0,
  ecarts.map(([c, t]) => `${c} : attendu ${t}, obtenu ${niveauBenchmark(c)}`).join(" ; "),
);

/* --- Le défaut n'est pas une liste --------------------------------------- */

// ⚠️ Un pays non listé est STANDARD (art. 1(2)). C'est l'ABSENCE d'entrée, et
//   non une entrée : le vérifier prouve que la table ne « complète » pas.
verifier("un pays non listé est STANDARD", niveauBenchmark("XX") === "STANDARD");
verifier("un pays inventé est STANDARD", niveauBenchmark("ZZ") === "STANDARD");
verifier("un pays non listé n'est pas listé à l'annexe", !estListeALAnnexe("BR"));
verifier("un pays listé est reconnu comme tel", estListeALAnnexe("GH"));
verifier("le code est insensible à la casse", niveauBenchmark("gh") === "LOW");
verifier("le nom officiel est restitué", nomOfficiel("GH") === "Ghana");
verifier("un pays non listé n'a pas de nom officiel", nomOfficiel("BR") === null);

/* --- Traçabilité de la source -------------------------------------------- */

// Une classification sans source ni date est indatable : elle ne pourra pas
// être opposée lors d'un contrôle, ni expliquer une analyse passée.
verifier("la version du référentiel est renseignée", REFERENTIEL_VERSION.length > 0);
verifier("la source cite l'acte fondateur", /2025\/1093/.test(REFERENTIEL_SOURCE));
verifier("la source cite l'article 1(2)", /art\.\s*1\(2\)/.test(REFERENTIEL_SOURCE));
verifier(
  "la date de vérification est au format ISO",
  /^\d{4}-\d{2}-\d{2}$/.test(REFERENTIEL_VERIFIE_LE),
  REFERENTIEL_VERIFIE_LE,
);

/* ------------------------------- Rapport --------------------------------- */

const echecs = controles.filter((c) => !c.ok);
for (const c of controles) {
  if (!c.ok) console.log(`🔴 ${c.nom}${c.detail ? ` — ${c.detail}` : ""}`);
}
console.log(`\n${controles.length - echecs.length}/${controles.length} contrôle(s) réussi(s)`);
process.exit(echecs.length === 0 ? 0 : 1);
