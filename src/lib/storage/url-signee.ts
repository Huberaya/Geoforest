/**
 * URLs signées à durée limitée, pour le téléchargement des pièces.
 *
 * ⚠️ P1-02 — ce que la signature apporte, et ce qu'elle ne remplace pas.
 *
 * Une URL signée permet de donner accès à un fichier **sans** ouvrir l'accès
 * au stockage : l'URL expire, et elle est liée à une organisation. Elle ne
 * dispense en revanche d'aucun contrôle d'autorisation : la route de
 * téléchargement vérifie la session **et** l'appartenance du document à
 * l'organisation, indépendamment de la signature.
 *
 * C'est volontairement redondant, et c'est le point important : la signature
 * seule ne protégerait pas d'une URL interceptée, l'autorisation seule
 * laisserait des URL valables indéfiniment. La réunion des deux fait qu'une
 * URL volée expire, et qu'une URL valide ne donne rien hors de son
 * organisation.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PLACEHOLDER_DEV = "dev-only-insecure-signing-secret-change-me";

function lireSecret(): string {
  const secret = process.env.GF_STORAGE_SIGNING_SECRET;
  if (!secret || secret.trim().length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "GF_STORAGE_SIGNING_SECRET est absent ou trop court (≥ 32 caractères). " +
          "Refus de signer des URLs de téléchargement en production sans secret.",
      );
    }
    return PLACEHOLDER_DEV;
  }
  if (secret === PLACEHOLDER_DEV && process.env.NODE_ENV === "production") {
    throw new Error("GF_STORAGE_SIGNING_SECRET contient la valeur de développement. Refus de démarrer.");
  }
  return secret;
}

let cache: string | null = null;
function secret(): string {
  cache ??= lireSecret();
  return cache;
}

/** Vrai si l'instance tourne avec le secret de développement (jamais en production). */
export function secretDeDeveloppement(): boolean {
  return secret() === PLACEHOLDER_DEV;
}

/** Durée de validité par défaut d'une URL de téléchargement : 5 minutes. */
export const DUREE_PAR_DEFAUT_SECONDES = 300;

/** Bornes : une URL ne se demande pas pour la journée, ni pour zéro seconde. */
export const DUREE_MIN_SECONDES = 10;
export const DUREE_MAX_SECONDES = 3600;

export interface ChargeUtile {
  documentId: string;
  version: number;
  organisationId: string;
  /** Date d'expiration, en secondes depuis l'époque Unix. */
  expiration: number;
}

/**
 * Ce que la signature couvre.
 *
 * L'organisation **et** la version en font partie : une URL émise pour la
 * version 2 d'un document ne permet pas de lire la version 1, et une URL
 * émise pour une organisation n'a aucune valeur pour une autre. Sans la
 * version, une URL resterait valable après remplacement du fichier — donc
 * après qu'un document ait été corrigé ou retiré.
 */
function messageDe(charge: ChargeUtile): string {
  return `v1.${charge.documentId}.${charge.version}.${charge.organisationId}.${charge.expiration}`;
}

function signer(message: string): string {
  return createHmac("sha256", secret()).update(message, "utf8").digest("base64url");
}

function comparaisonSure(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  // `timingSafeEqual` exige des longueurs égales : la comparer d'abord évite
  // une exception, et révéler la longueur n'apprend rien d'utile ici.
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface UrlSignee {
  url: string;
  expiration: number;
  /** Secondes de validité accordées. */
  dureeSecondes: number;
}

/**
 * Fabrique une URL de téléchargement valable `dureeSecondes`.
 *
 * ⚠️ `baseUrl` est celle de la requête, jamais une constante : une URL signée
 * construite depuis une adorce fixe casserait derrière un mandataire, et le
 * produit se retrouverait avec des liens inutilisables plutôt qu'avec une
 * erreur franche.
 */
export function creerUrlSignee(
  baseUrl: string,
  documentId: string,
  version: number,
  organisationId: string,
  dureeSecondes: number = DUREE_PAR_DEFAUT_SECONDES,
): UrlSignee {
  const duree = Math.min(Math.max(Math.floor(dureeSecondes), DUREE_MIN_SECONDES), DUREE_MAX_SECONDES);
  const expiration = Math.floor(Date.now() / 1000) + duree;
  const charge: ChargeUtile = { documentId, version, organisationId, expiration };
  const signature = signer(messageDe(charge));
  const url =
    `${baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/download` +
    `?exp=${expiration}&v=${version}&sig=${encodeURIComponent(signature)}`;
  return { url, expiration, dureeSecondes: duree };
}

export type Verification =
  | { valide: true; charge: ChargeUtile }
  | { valide: false; raison: "SIGNATURE_INVALID" | "EXPIREE" | "VERSION" | "ORGANISATION" | "MALFORMEE" };

/**
 * Vérifie une URL signée, pour l'organisation et la version attendues.
 *
 * ⚠️ L'ordre des contrôles n'est pas indifférent : la signature est vérifiée
 * **avant** l'expiration. Contrôler l'expiration d'abord permettrait à un
 * attaquant de distinguer « URL expirée mais bien signée » d'« URL fausse »,
 * ce qui est une information. Ici, une URL falsifiée échoue toujours de la
 * même façon.
 */
export function verifierUrlSignee(params: {
  documentId: string;
  versionAttendue: number;
  organisationId: string;
  expiration: string | null;
  version: string | null;
  signature: string | null;
}): Verification {
  if (!params.expiration || !params.version || !params.signature) {
    return { valide: false, raison: "MALFORMEE" };
  }
  const expiration = Number(params.expiration);
  const version = Number(params.version);
  if (!Number.isFinite(expiration) || !Number.isInteger(version)) {
    return { valide: false, raison: "MALFORMEE" };
  }
  const charge: ChargeUtile = {
    documentId: params.documentId,
    version,
    organisationId: params.organisationId,
    expiration,
  };

  if (!comparaisonSure(params.signature, signer(messageDe(charge)))) {
    return { valide: false, raison: "SIGNATURE_INVALID" };
  }
  if (expiration * 1000 <= Date.now()) {
    return { valide: false, raison: "EXPIREE" };
  }
  if (version !== params.versionAttendue) {
    return { valide: false, raison: "VERSION" };
  }
  return { valide: true, charge };
}

/**
 * Origine à employer pour fabriquer une URL remise à un client.
 *
 * ⚠️ `request.url` suffit en développement, pas derrière un mandataire : le
 * serveur y voit alors son propre nom interne (`0.0.0.0:3000`, ou le nom du
 * conteneur) et fabrique des liens qu'aucun navigateur ne sait résoudre. On
 * suit donc les en-têtes de délégation lorsqu'ils sont présents, comme le fait
 * déjà le reste de l'application.
 *
 * ⚠️ Ces en-têtes sont choisis par le client : on les reprend uniquement parce
 * que le mandataire est censé les réécrire. Si un mandataire ne les réécrit
 * pas, il faut renseigner `GF_PUBLIC_BASE_URL` — une URL signée pointant vers
 * la mauvaise origine reste inutilisable, elle ne devient pas dangereuse.
 */
export function originePublique(request: Request): string {
  const explicite = process.env.GF_PUBLIC_BASE_URL?.trim();
  if (explicite) return explicite.replace(/\/$/, "");

  const entetes = request.headers;
  const hote = entetes.get("x-forwarded-host") ?? entetes.get("host") ?? "";
  if (hote) {
    const proto = (entetes.get("x-forwarded-proto")?.split(",")[0] ?? "").trim();
    const scheme = proto || (hote.startsWith("localhost") || hote.startsWith("127.0.0.1") ? "http" : "https");
    return `${scheme}://${hote.split(",")[0].trim()}`;
  }
  return new URL(request.url).origin;
}
