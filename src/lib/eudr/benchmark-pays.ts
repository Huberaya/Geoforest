/**
 * Référentiel officiel du benchmark pays EUDR.
 *
 * ⚠️ SOURCE UNIQUE DE VÉRITÉ — ne pas éditer à la main sans mettre à jour
 *    `REFERENTIEL_VERSION` et `REFERENTIEL_SOURCE`.
 *
 * Texte : Règlement d'exécution (UE) 2025/1093 de la Commission du 22 mai 2025,
 *         annexe. Publié au JO L, 2025/1093, 23.5.2025. ELI
 *         http://data.europa.eu/eli/reg_impl/2025/1093/oj
 *
 * Article 1(1) : les pays LOW et HIGH sont ceux de l'annexe.
 * Article 1(2) : **tout pays non listé conserve le niveau STANDARD**.
 *
 * ⚠️ Ce qui est encodé ici est EXACTEMENT l'annexe : 140 pays LOW, 4 pays HIGH,
 *    aucun autre. Le niveau STANDARD n'est pas une liste — il est l'absence
 *    d'entrée. Ne jamais « compléter » la table par confort : un pays ajouté
 *    à tort en STANDARD produirait la même réponse qu'un pays correctement
 *    absent, et masquerait une régression de résolution.
 *
 * ⚠️ Cette liste est révisable. L'article 29(2) du règlement (UE) 2023/1115
 *    prévoit une révision « aussi souvent que nécessaire ». Au 05/11/2026,
 *    2025/1093 reste la dernière itération : les lignes directrices de la
 *    Commission du 20/07/2026 (OJ C/2026/3896, note 11) la citent comme telle,
 *    et aucun nouvel acte d'exécution n'a été publié. Toute révision devra
 *    produire une nouvelle version de ce fichier — jamais une modification
 *    silencieuse, car une analyse passée doit rester explicable avec le
 *    référentiel en vigueur au jour où elle a été menée.
 *
 * ⚠️ Portée : l'annexe liste des pays entiers. L'article 29 autorise la
 *    Commission à classer « des pays ou des parties de pays » ; ce n'est pas
 *    le cas ici. Le code ne doit donc pas prétendre à une granularité
 *    infranationale.
 */
import type { RiskLevel } from "./types";

/** Identifiant de version du référentiel — à consigner dans toute analyse. */
export const REFERENTIEL_VERSION = "EU-2025/1093";

/** Acte fondateur, tel qu'il doit apparaître dans une preuve d'audit. */
export const REFERENTIEL_SOURCE =
  "Règlement d'exécution (UE) 2025/1093 de la Commission du 22 mai 2025, annexe " +
  "(JO L, 2025/1093, 23.5.2025) — art. 1(2) : STANDARD par défaut";

/** Date à laquelle la conformité de cette table au texte a été vérifiée. */
export const REFERENTIEL_VERIFIE_LE = "2026-11-05";

/**
 * Les 4 pays HIGH de l'annexe. C'est la liste **complète** — l'annexe ne
 * comporte aucune autre classification élevée.
 */
export const PAYS_RISQUE_ELEVE: Readonly<Record<string, string>> = {
  BY: "Bélarus",
  KP: "République populaire démocratique de Corée",
  MM: "Myanmar",
  RU: "Fédération de Russie",
};

/**
 * Les 140 pays LOW de l'annexe, dans l'ordre alphabétique du texte officiel.
 * Les États membres de l'Union y figurent individuellement : l'annexe ne
 * connaît pas de regroupement « UE ».
 */
export const PAYS_RISQUE_FAIBLE: Readonly<Record<string, string>> = {
  AF: "Afghanistan",
  AL: "Albanie",
  DZ: "Algérie",
  AD: "Andorre",
  AG: "Antigua-et-Barbuda",
  AM: "Arménie",
  AU: "Australie",
  AT: "Autriche",
  AZ: "Azerbaïdjan",
  BS: "Bahamas",
  BH: "Bahreïn",
  BD: "Bangladesh",
  BB: "Barbade",
  BE: "Belgique",
  BT: "Bhoutan",
  BA: "Bosnie-Herzégovine",
  BN: "Brunéi Darussalam",
  BG: "Bulgarie",
  BI: "Burundi",
  CV: "Cabo Verde",
  CA: "Canada",
  CF: "République centrafricaine",
  CL: "Chili",
  CN: "Chine",
  KM: "Comores",
  CG: "Congo",
  CR: "Costa Rica",
  HR: "Croatie",
  CU: "Cuba",
  CY: "Chypre",
  CZ: "Tchéquie",
  DK: "Danemark",
  DJ: "Djibouti",
  DM: "Dominique",
  DO: "République dominicaine",
  EG: "Égypte",
  EE: "Estonie",
  SZ: "Eswatini",
  FJ: "Fidji",
  FI: "Finlande",
  FR: "France",
  GA: "Gabon",
  GE: "Géorgie",
  DE: "Allemagne",
  GH: "Ghana",
  GR: "Grèce",
  GD: "Grenade",
  GY: "Guyana",
  HU: "Hongrie",
  IS: "Islande",
  IN: "Inde",
  IR: "Iran (République islamique d')",
  IQ: "Irak",
  IE: "Irlande",
  IT: "Italie",
  JM: "Jamaïque",
  JP: "Japon",
  JO: "Jordanie",
  KZ: "Kazakhstan",
  KE: "Kenya",
  KI: "Kiribati",
  KW: "Koweït",
  KG: "Kirghizistan",
  LA: "République démocratique populaire lao",
  LV: "Lettonie",
  LB: "Liban",
  LS: "Lesotho",
  LY: "Libye",
  LI: "Liechtenstein",
  LT: "Lituanie",
  LU: "Luxembourg",
  MG: "Madagascar",
  MV: "Maldives",
  ML: "Mali",
  MT: "Malte",
  MH: "Îles Marshall",
  MU: "Maurice",
  FM: "Micronésie (États fédérés de)",
  MC: "Monaco",
  MN: "Mongolie",
  ME: "Monténégro",
  MA: "Maroc",
  NR: "Nauru",
  NP: "Népal",
  NL: "Pays-Bas (Royaume des)",
  NZ: "Nouvelle-Zélande",
  MK: "Macédoine du Nord",
  NO: "Norvège",
  OM: "Oman",
  PW: "Palaos",
  PS: "Palestine",
  PG: "Papouasie-Nouvelle-Guinée",
  PH: "Philippines",
  PL: "Pologne",
  PT: "Portugal",
  QA: "Qatar",
  KR: "République de Corée",
  MD: "République de Moldova",
  RO: "Roumanie",
  RW: "Rwanda",
  KN: "Saint-Kitts-et-Nevis",
  LC: "Sainte-Lucie",
  VC: "Saint-Vincent-et-les-Grenadines",
  WS: "Samoa",
  SM: "Saint-Marin",
  ST: "Sao Tomé-et-Principe",
  SA: "Arabie saoudite",
  RS: "Serbie",
  SC: "Seychelles",
  SG: "Singapour",
  SK: "Slovaquie",
  SI: "Slovénie",
  SB: "Îles Salomon",
  ZA: "Afrique du Sud",
  SS: "Soudan du Sud",
  ES: "Espagne",
  LK: "Sri Lanka",
  SR: "Suriname",
  SE: "Suède",
  CH: "Suisse",
  SY: "République arabe syrienne",
  TJ: "Tadjikistan",
  TH: "Thaïlande",
  TL: "Timor-Leste",
  TG: "Togo",
  TO: "Tonga",
  TT: "Trinité-et-Tobago",
  TN: "Tunisie",
  TR: "Türkiye",
  TM: "Turkménistan",
  TV: "Tuvalu",
  UA: "Ukraine",
  AE: "Émirats arabes unis",
  GB: "Royaume-Uni de Grande-Bretagne et d'Irlande du Nord",
  US: "États-Unis d'Amérique",
  UY: "Uruguay",
  UZ: "Ouzbékistan",
  VU: "Vanuatu",
  VN: "Vietnam",
  YE: "Yémen",
};

/**
 * Niveau de risque d'un pays au titre du règlement d'exécution (UE) 2025/1093.
 *
 * ⚠️ `CRITICAL` existe dans le type `RiskLevel` mais **n'est jamais produit
 *    ici** : le règlement ne connaît que trois niveaux. L'ajouter depuis une
 *    classification pays serait une invention.
 */
export function niveauBenchmark(iso2: string): RiskLevel {
  const code = iso2.trim().toUpperCase();
  if (code in PAYS_RISQUE_ELEVE) return "HIGH";
  if (code in PAYS_RISQUE_FAIBLE) return "LOW";
  return "STANDARD";
}

/** Vrai si le pays figure explicitement à l'annexe (LOW ou HIGH). */
export function estListeALAnnexe(iso2: string): boolean {
  const code = iso2.trim().toUpperCase();
  return code in PAYS_RISQUE_ELEVE || code in PAYS_RISQUE_FAIBLE;
}

/** Nom officiel du pays tel qu'il figure à l'annexe, ou `null` si non listé. */
export function nomOfficiel(iso2: string): string | null {
  const code = iso2.trim().toUpperCase();
  return PAYS_RISQUE_ELEVE[code] ?? PAYS_RISQUE_FAIBLE[code] ?? null;
}
