/**
 * Identité de l'opérateur — P0.
 *
 * ⚠️ Règle unique : une identité absente reste absente.
 *
 *   L'ancienne route d'audit construisait un opérateur fictif
 *   (`Opérateur non renseigné`, `XX0000000000000`, `XX`) et l'export le
 *   présentait comme réel. Une déclaration pouvait donc désigner une entité
 *   inexistante. Ce module centralise la reconnaissance des valeurs valides,
 *   absentes et fictives, pour que les route, export et tests partagent la
 *   même définition.
 *
 *   Aucune fonction de ce module n'invente de valeur : elles constatent.
 */

/** Format EORI : code pays ISO (2 lettres) + 1 à 15 caractères alphanumériques. */
export const EORI_PATTERN = /^[A-Z]{2}[A-Z0-9]{1,15}$/;

/**
 * Noms qui ne désignent aucune entité. La comparaison est faite sur une forme
 * normalisée (minuscules, accents retirés, espaces réduits).
 */
export const NOMS_FICTIFS = [
  "operateur non renseigne",
  "non renseigne",
  "inconnu",
  "unknown",
  "n/a",
  "na",
  "-",
  "sans objet",
  "non applicable",
] as const;

/** EORI sentinelle historique de l'ancienne route. */
export const EORI_SENTINELLE = "XX0000000000000";

export interface IdentiteOperateur {
  name: string;
  eori: string;
  country: string;
  address?: string | null;
  email?: string | null;
}

export interface ChampsIdentite {
  name?: string | null;
  eori?: string | null;
  country?: string | null;
}

export type StatutIdentite = "COMPLETE" | "ABSENTE" | "PARTIELLE" | "PLACEHOLDER";

export interface ClassementIdentite {
  statut: StatutIdentite;
  /** Vrai seulement si les trois champs sont présents et valides. */
  complete: boolean;
  /** Champs réellement absents (null, vide). */
  manquants: Array<"name" | "eori" | "country">;
  /** Champs présents mais invalides ou fictifs. */
  invalides: Array<"name" | "eori" | "country">;
  /** Explications lisibles, sans recopier de secret. */
  motifs: string[];
}

function normaliserNom(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Vrai si le code est un code pays ISO à deux lettres, hors sentinelle XX. */
export function paysValide(valeur: string | null | undefined): boolean {
  if (typeof valeur !== "string") return false;
  const code = valeur.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) && code !== "XX";
}

/** Vrai si l'EORI a la forme attendue et n'est pas une sentinelle. */
export function eoriValide(valeur: string | null | undefined): boolean {
  if (typeof valeur !== "string") return false;
  const eori = valeur.trim().toUpperCase();
  if (!EORI_PATTERN.test(eori)) return false;
  if (eori.startsWith("XX")) return false;
  // Un EORI entièrement nul (`FR0000000000000`) est une valeur de remplissage.
  if (/^[A-Z]{2}0+$/.test(eori)) return false;
  return true;
}

/** Vrai si le nom désigne une entité réelle et non un libellé de remplissage. */
export function nomValide(valeur: string | null | undefined): boolean {
  if (typeof valeur !== "string") return false;
  const nom = valeur.trim();
  if (nom.length < 2 || nom.length > 200) return false;
  return !(NOMS_FICTIFS as readonly string[]).includes(normaliserNom(nom));
}

/**
 * Classe une identité sans jamais la compléter.
 *
 * Un champ présent mais fictif est classé `PLACEHOLDER` : le distinguer d'un
 * champ absent permet à l'appelant d'expliquer le refus sans laisser croire
 * qu'une valeur réelle a été perdue.
 */
export function classerIdentite(champs: ChampsIdentite): ClassementIdentite {
  const name = typeof champs.name === "string" ? champs.name.trim() : null;
  const eori = typeof champs.eori === "string" ? champs.eori.trim().toUpperCase() : null;
  const country = typeof champs.country === "string" ? champs.country.trim().toUpperCase() : null;

  const manquants: ClassementIdentite["manquants"] = [];
  const invalides: ClassementIdentite["invalides"] = [];
  const motifs: string[] = [];

  if (!name) manquants.push("name");
  else if (!nomValide(name)) {
    invalides.push("name");
    motifs.push("operator.name est un libellé de remplissage, pas une entité déclarée.");
  }

  if (!eori) manquants.push("eori");
  else if (!eoriValide(eori)) {
    invalides.push("eori");
    motifs.push(
      eori.startsWith("XX") || eori === EORI_SENTINELLE
        ? "operator.eori est la sentinelle d'un opérateur fictif (XX…)."
        : "operator.eori ne respecte pas le format EORI (2 lettres + 1 à 15 alphanumériques).",
    );
  }

  if (!country) manquants.push("country");
  else if (!paysValide(country)) {
    invalides.push("country");
    motifs.push(
      country === "XX"
        ? "operator.country vaut XX : ce n'est pas un pays."
        : "operator.country n'est pas un code ISO à deux lettres.",
    );
  }

  const complete = manquants.length === 0 && invalides.length === 0;
  const statut: StatutIdentite = complete
    ? "COMPLETE"
    : manquants.length === 3
      ? "ABSENTE"
      : invalides.length > 0
        ? "PLACEHOLDER"
        : "PARTIELLE";

  return { statut, complete, manquants, invalides, motifs };
}

/** Identité exploitable pour un export, ou `null` si elle n'est pas complète. */
export function identiteComplete(champs: ChampsIdentite): IdentiteOperateur | null {
  const classement = classerIdentite(champs);
  if (!classement.complete) return null;
  return {
    name: (champs.name as string).trim(),
    eori: (champs.eori as string).trim().toUpperCase(),
    country: (champs.country as string).trim().toUpperCase(),
  };
}

/**
 * Normalise ce qu'un client déclare, sans jamais inventer de champ.
 * Le pays n'est dérivé de l'EORI que si le préfixe est un pays valide : c'est
 * une information portée par l'identifiant lui-même, pas une supposition.
 */
export function identiteDeclaree(brut: {
  name?: unknown;
  eori?: unknown;
  country?: unknown;
  address?: unknown;
  email?: unknown;
}): IdentiteOperateur | null {
  const name = typeof brut.name === "string" ? brut.name.trim() : "";
  const eori = typeof brut.eori === "string" ? brut.eori.replace(/\s+/g, "").toUpperCase() : "";
  const prefixe = eori.slice(0, 2);
  const country =
    typeof brut.country === "string" && brut.country.trim()
      ? brut.country.trim().toUpperCase()
      : paysValide(prefixe)
        ? prefixe
        : "";

  if (!nomValide(name) || !eoriValide(eori) || !paysValide(country)) return null;

  return {
    name,
    eori,
    country,
    address: typeof brut.address === "string" ? brut.address.trim().slice(0, 300) : null,
    email: typeof brut.email === "string" ? brut.email.trim().slice(0, 200) : null,
  };
}
