/**
 * Identité de l'opérateur — règle unique du lot A.
 *
 * ⚠️ Pourquoi ce module existe.
 *
 * La route d'audit fabriquait une identité de remplissage quand l'appelant
 * n'en fournissait pas :
 *
 *     { name: "Opérateur non renseigné",
 *       eori: "XX0000000000000",
 *       country: "XX" }
 *
 * Cette valeur a la **forme** d'une identité réelle. Une fois écrite en base,
 * plus rien ne la distingue d'une identité véritablement déclarée : elle
 * traverse l'historique, puis l'export, et le dossier part en déclaration en
 * paraissant complet.
 *
 * L'absence d'identité est donc représentée par `null`, et un dossier hérité
 * portant encore la valeur de remplissage est **reconnu** comme tel — la
 * décision de le réécrire appartient à l'exploitant, pas à une fonction de
 * lecture.
 *
 * ⚠️ Une seule classification.
 *
 *   Deux lignes de travail avaient produit deux vocabulaires
 *   (`declared`/`missing`/`legacy_placeholder` d'un côté,
 *   `COMPLETE`/`ABSENTE`/`PARTIELLE`/`PLACEHOLDER` de l'autre). Le même dossier
 *   pouvait donc être « complet » ici et « missing » là. Ce module expose **un
 *   seul** classement, et des prédicats booléens (`paysValide`, `eoriValide`,
 *   `nomValide`) qui en sont la brique de base.
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
export const EORI_PLACEHOLDER_HISTORIQUE = "XX0000000000000";
/** Alias conservé pour les appelants de la ligne de sécurité. */
export const EORI_SENTINELLE = EORI_PLACEHOLDER_HISTORIQUE;

export type EtatIdentiteOperateur = "declared" | "missing" | "legacy_placeholder";

export interface ClassementIdentiteOperateur {
  etat: EtatIdentiteOperateur;
  /** Le dossier peut-il alimenter une déclaration ? */
  exportable: boolean;
  /** Explication destinée au message d'erreur, jamais à l'export. */
  raison: string;
}

/** Identité réellement déclarée, telle qu'elle peut être persistée. */
export interface IdentiteOperateur {
  name: string;
  eori: string;
  country: string | null;
  address?: string | null;
  email?: string | null;
}

/** Identité telle qu'elle est stockée (potentiellement partielle). */
export interface IdentiteStockee {
  name: string | null;
  eori: string | null;
  country: string | null;
  address: string | null;
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
 * Classe une identité stockée. Ne modifie rien, ne devine rien.
 *
 * Un EORI vide compte comme absent : `""` n'est pas une identité, et le
 * traiter comme telle reproduirait le défaut sous une autre forme.
 */
export function classerIdentiteOperateur(
  nom: string | null | undefined,
  eori: string | null | undefined,
): ClassementIdentiteOperateur {
  const eoriNormalise = typeof eori === "string" ? eori.trim() : "";
  const nomNormalise = typeof nom === "string" ? nom.trim() : "";

  if (!eoriNormalise) {
    return {
      etat: "missing",
      exportable: false,
      raison:
        "Aucune identité d'opérateur n'est enregistrée pour ce dossier : " +
        "une déclaration de diligence raisonnée doit identifier l'opérateur (nom et numéro EORI).",
    };
  }

  // Comparaison insensible à la casse : la valeur de remplissage est une
  // **sentinelle**, pas un identifiant. `xx0000000000000` désigne la même
  // absence ; la laisser passer en `declared` ferait exporter un faux EORI.
  if (eoriNormalise.toUpperCase() === EORI_PLACEHOLDER_HISTORIQUE) {
    return {
      etat: "legacy_placeholder",
      exportable: false,
      raison:
        "Ce dossier porte l'identité de remplissage héritée des versions antérieures " +
        "(XX0000000000000) : l'opérateur réel n'a jamais été saisi. " +
        "La valeur est conservée telle quelle ; elle doit être reprise explicitement.",
    };
  }

  if (!eoriValide(eoriNormalise)) {
    return {
      etat: "missing",
      exportable: false,
      raison:
        "Le numéro EORI enregistré n'a pas un format exploitable " +
        "(code pays à deux lettres suivi de 1 à 15 caractères alphanumériques).",
    };
  }

  if (!nomValide(nomNormalise)) {
    return {
      etat: "missing",
      exportable: false,
      raison:
        "Le dossier porte un EORI mais aucun nom d'opérateur exploitable : " +
        "une déclaration doit nommer l'opérateur.",
    };
  }

  return { etat: "declared", exportable: true, raison: "" };
}

/**
 * Construit une identité déclarée à partir de champs saisis.
 *
 * Retourne `null` dès qu'un champ manque ou est fictif : l'appelant ne doit
 * jamais compléter lui-même les trous. Le pays reste facultatif à la saisie
 * (`null`), mais s'il est fourni il doit être valide — `XX` n'est pas un pays.
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
  const countryBrut = typeof brut.country === "string" ? brut.country.trim().toUpperCase() : "";

  if (!nomValide(name) || !eoriValide(eori)) return null;
  if (countryBrut !== "" && !paysValide(countryBrut)) return null;

  return {
    name,
    eori,
    country: countryBrut === "" ? null : countryBrut,
    address: typeof brut.address === "string" ? brut.address.trim().slice(0, 300) : null,
    email: typeof brut.email === "string" ? brut.email.trim().slice(0, 200) : null,
  };
}

/**
 * Construit une identité à partir de valeurs stockées.
 *
 * `null` si le nom manque ou si l'EORI est absent, vide, hors format ou
 * sentinelle : un dossier sans nom n'est pas « complet », et un EORI vide n'est
 * pas une identité.
 *
 * Le pays est **facultatif** (`null` = non déclaré) : la règle d'export le
 * déduit alors du préfixe de l'EORI, qui est un fait attaché à l'identifiant.
 * S'il est présent, il doit être valide — `XX` est refusé.
 */
export function identiteComplete(champs: {
  name?: string | null;
  eori?: string | null;
  country?: string | null;
}): IdentiteOperateur | null {
  const name = typeof champs.name === "string" ? champs.name.trim() : "";
  const eori = typeof champs.eori === "string" ? champs.eori.trim().toUpperCase() : "";
  const country = typeof champs.country === "string" ? champs.country.trim().toUpperCase() : "";

  if (!nomValide(name) || !eoriValide(eori)) return null;
  if (country !== "" && !paysValide(country)) return null;

  return { name, eori, country: country === "" ? null : country, address: null, email: null };
}

// --------------------------------------------------------------- Export

export type ResolutionIdentiteExport =
  | {
      statut: "ok";
      operator: { name: string; eori: string; country: string; address: string; email: string };
      /** D'où vient l'identité retenue — jamais d'un remplissage. */
      source: "dossier" | "requete";
      etat: EtatIdentiteOperateur;
    }
  | { statut: "invalide"; detail: string }
  | { statut: "refus"; etat: EtatIdentiteOperateur; raison: string };

/**
 * Décide quelle identité alimente un export TRACES.
 *
 * Fonction pure, extraite de la route pour être **exécutable en test** : la
 * règle « pas d'identité → pas d'export » ne doit pas être vérifiable seulement
 * par lecture du code. La route se contente de traduire le résultat en réponse
 * HTTP, ce qui laisse la décision à un seul endroit.
 *
 * Ordre de priorité : identité fournie dans la requête, puis identité du
 * dossier. Aucun repli n'est inventé ; un dossier hérité portant la valeur de
 * remplissage est refusé **même si** son nom est renseigné.
 */
export function resoudreIdentiteExport(
  stockee: IdentiteStockee,
  demandee: unknown,
): ResolutionIdentiteExport {
  if (demandee !== null && demandee !== undefined) {
    if (typeof demandee !== "object" || Array.isArray(demandee)) {
      return { statut: "invalide", detail: "operator doit être un objet" };
    }
    const o = demandee as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const eori = typeof o.eori === "string" ? o.eori.replace(/\s+/g, "").toUpperCase() : "";
    const country = typeof o.country === "string" ? o.country.trim().toUpperCase() : "";

    if (!nomValide(name) || !eoriValide(eori)) {
      return {
        statut: "invalide",
        detail:
          "Opérateur invalide : nom réel (2 à 200 caractères) et EORI conforme " +
          "(code pays + 1 à 15 alphanumériques, hors sentinelle) requis",
      };
    }
    if (country !== "" && !paysValide(country)) {
      return { statut: "invalide", detail: "Opérateur invalide : pays ISO à deux lettres requis" };
    }

    return {
      statut: "ok",
      source: "requete",
      etat: "declared",
      operator: {
        name,
        eori,
        // Le pays déclaré est retenu ; à défaut, le préfixe de l'EORI — un fait
        // attaché à l'identifiant, pas une valeur par défaut arbitraire.
        country: country !== "" ? country : eori.slice(0, 2),
        address: typeof o.address === "string" ? o.address : "",
        email: typeof o.email === "string" ? o.email : "",
      },
    };
  }

  const classement = classerIdentiteOperateur(stockee.name, stockee.eori);
  if (!classement.exportable) {
    return { statut: "refus", etat: classement.etat, raison: classement.raison };
  }
  const eori = (stockee.eori as string).trim().toUpperCase();
  const paysStocke = typeof stockee.country === "string" ? stockee.country.trim().toUpperCase() : "";

  return {
    statut: "ok",
    source: "dossier",
    etat: classement.etat,
    operator: {
      name: (stockee.name as string).trim(),
      eori,
      // Jamais `FR` ni `XX` : soit le pays réellement stocké, soit le préfixe
      // de l'EORI.
      country: paysValide(paysStocke) ? paysStocke : eori.slice(0, 2),
      address: stockee.address ?? "",
      email: "",
    },
  };
}
