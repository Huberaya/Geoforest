/**
 * Identité de l'opérateur — trois états, jamais confondus.
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
 * paraissant complet. C'est exactement ce qu'il ne faut pas.
 *
 * L'absence d'identité est donc représentée par `null`, et un dossier hérité
 * portant encore la valeur de remplissage est **reconnu** comme tel — pas
 * réécrit : savoir qu'un dossier a été créé sans identité est une information,
 * l'effacer la détruirait.
 */

/** Valeur de remplissage écrite par les versions antérieures. */
export const EORI_PLACEHOLDER_HISTORIQUE = "XX0000000000000";

export type EtatIdentiteOperateur = "declared" | "missing" | "legacy_placeholder";

export interface IdentiteOperateur {
  etat: EtatIdentiteOperateur;
  /** Le dossier peut-il alimenter une déclaration ? */
  exportable: boolean;
  /** Explication destinée au message d'erreur, jamais à l'export. */
  raison: string;
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
): IdentiteOperateur {
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

  // Comparaison insensible à la casse : la valeur de remplissage est un
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

  if (nomNormalise.length < 2) {
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

// --------------------------------------------------------------- Export
/** Format d'EORI accepté par les routes (même règle que la route d'audit). */
const EORI_PATTERN_EXPORT = /^[A-Z]{2}[A-Z0-9]{1,15}$/;

export interface IdentiteStockee {
  name: string | null;
  eori: string | null;
  country: string | null;
  address: string | null;
}

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
    if (typeof demandee !== "object") {
      return { statut: "invalide", detail: "operator doit être un objet" };
    }
    const o = demandee as Record<string, unknown>;
    const name = typeof o.name === "string" ? o.name.trim() : "";
    const eori = typeof o.eori === "string" ? o.eori.replace(/\s+/g, "").toUpperCase() : "";
    if (name.length < 2 || !EORI_PATTERN_EXPORT.test(eori)) {
      return {
        statut: "invalide",
        detail: "Opérateur invalide (nom ≥ 2 caractères et EORI conforme requis)",
      };
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
        country:
          typeof o.country === "string" && o.country.length === 2
            ? o.country.toUpperCase()
            : eori.slice(0, 2),
        address: typeof o.address === "string" ? o.address : "",
        email: typeof o.email === "string" ? o.email : "",
      },
    };
  }

  const classement = classerIdentiteOperateur(stockee.name, stockee.eori);
  if (!classement.exportable) {
    return { statut: "refus", etat: classement.etat, raison: classement.raison };
  }
  const eori = (stockee.eori as string).trim();
  return {
    statut: "ok",
    source: "dossier",
    etat: classement.etat,
    operator: {
      name: stockee.name ?? "",
      eori,
      country: stockee.country ?? eori.slice(0, 2),
      address: stockee.address ?? "",
      email: "",
    },
  };
}
