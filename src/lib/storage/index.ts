/**
 * Stockage des pièces justificatives.
 *
 * ⚠️ P1-02 — état réel, sans enjolivement.
 *
 * Aucun stockage n'existait : les documents étaient des métadonnées, et l'API
 * le disait. Deux adaptateurs sont fournis :
 *
 *   · **`stockageDisque`** — écrit réellement sur le disque local. C'est
 *     l'adaptateur **monté et vérifié** dans ce chantier : le fichier est
 *     écrit, relu, son condensat recalculé, son téléchargement éprouvé.
 *   · **`stockageS3`** — écrit pour un service compatible S3 (AWS S3, Cloudflare
 *     R2, MinIO). **Jamais exécuté** : aucun service de ce type n'est joignable
 *     ici. Il est livré pour que la mise en service se réduise à renseigner
 *     des variables d'environnement, et il est marqué non validé partout où il
 *     est mentionné. Le présenter comme opérationnel serait un mensonge.
 *
 * Choix commun aux deux adaptateurs, et il n'est pas anodin :
 *
 *   · l'**adressage par contenu** — le nom du fichier sur le support est son
 *     condensat SHA-256, jamais le nom saisi par l'utilisateur. Deux dépôts
 *     identiques partagent le même objet, et le nom d'origine ne peut pas
 *     servir à atteindre un fichier d'un autre dossier ;
 *   · le **cloisonnement par organisation** dès le chemin : chaque organisation
 *     a son répertoire. Un défaut d'autorisation ne suffit donc pas à sortir
 *     du périmètre, il faut en plus traverser le système de fichiers.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export interface ObjetStocke {
  /** Chemin de l'objet dans le support. Opaque, ne jamais construire à la main. */
  cle: string;
  /** Condensat SHA-256 du contenu, en hexadécimal. */
  sha256: string;
  /** Taille en octets. */
  taille: number;
}

export interface Stockage {
  readonly nom: string;
  /** Vrai si cet adaptateur a déjà été éprouvé sur une instance réelle. */
  readonly valide: boolean;
  ecrire(organisationId: string, contenu: Uint8Array, extension: string): Promise<ObjetStocke>;
  lire(cle: string): Promise<Uint8Array | null>;
  supprimer(cle: string): Promise<void>;
}

export function condensat(contenu: Uint8Array): string {
  return createHash("sha256").update(contenu).digest("hex");
}

/** N'accepte qu'un UUID : toute autre forme est refusée, sans exception. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Extensions admises dans une clé : lettres et chiffres uniquement. */
const EXTENSION = /^[a-z0-9]{1,12}$/;
/** Clé complète : organisation / deux premiers caractères / condensat . extension */
const CLE = /^[0-9a-f-]{36}\/[0-9a-f]{2}\/[0-9a-f]{64}\.[a-z0-9]{1,12}$/;

/**
 * Vérifie qu'une clé ne peut pas sortir du répertoire de stockage.
 *
 * ⚠️ Une clé provient de la base de données, donc d'une écriture antérieure —
 * mais la base n'est pas à l'abri d'une injection ou d'une erreur, et `..` dans
 * un chemin suffirait à lire n'importe quel fichier du serveur. La clé est donc
 * validée par une expression **fermée** : pas de `..`, pas de séparateur
 * imprévu, pas de caractère exotique.
 */
export function cleValide(cle: string): boolean {
  return CLE.test(cle);
}

// ------------------------------------------------------------------- Disque
export function repertoireStockage(): string {
  return resolve(process.env.GF_STORAGE_DIR ?? join(process.cwd(), "var", "storage"));
}

export const stockageDisque: Stockage = {
  nom: "disque-local",
  valide: true,

  async ecrire(organisationId, contenu, extension) {
    if (!UUID.test(organisationId)) {
      throw new Error(`identifiant d'organisation invalide : ${organisationId}`);
    }
    if (!EXTENSION.test(extension)) {
      throw new Error(`extension invalide : ${extension}`);
    }

    const sha256 = condensat(contenu);
    const cle = `${organisationId}/${sha256.slice(0, 2)}/${sha256}.${extension}`;
    const chemin = join(repertoireStockage(), ...cle.split("/"));

    await mkdir(join(chemin, ".."), { recursive: true });
    await writeFile(chemin, contenu);

    // Relu immédiatement : un objet déclaré écrit mais illisible est un
    // document perdu, et la perte ne se verrait qu'au téléchargement.
    const ecrit = await readFile(chemin);
    if (condensat(ecrit) !== sha256) {
      throw new Error("le contenu relu ne correspond pas au condensat calculé — écriture refusée");
    }

    return { cle, sha256, taille: contenu.length };
  },

  async lire(cle) {
    if (!cleValide(cle)) return null;
    const chemin = join(repertoireStockage(), ...cle.split("/"));
    // Contrôle de contention : même après validation de la clé, on vérifie
    // que le chemin résolu reste sous le répertoire de stockage.
    if (!chemin.startsWith(repertoireStockage() + sep)) return null;
    try {
      return new Uint8Array(await readFile(chemin));
    } catch {
      return null;
    }
  },

  async supprimer(cle) {
    if (!cleValide(cle)) return;
    const chemin = join(repertoireStockage(), ...cle.split("/"));
    if (!chemin.startsWith(repertoireStockage() + sep)) return;
    try {
      await unlink(chemin);
    } catch {
      /* déjà absent : rien à faire */
    }
  },
};

// ---------------------------------------------------------------------- S3
/**
 * ⚠️ **Adaptateur non validé.** Aucun service compatible S3 n'a été joint
 * depuis cet environnement : ce code n'a jamais été exécuté. Il est fourni
 * pour que la mise en service soit une affaire de configuration, mais il doit
 * être éprouvé sur un réel compartiment avant d'être déclaré opérationnel.
 *
 * Variables :
 *   S3_ENDPOINT · S3_REGION · S3_BUCKET · S3_ACCESS_KEY_ID · S3_SECRET_ACCESS_KEY
 *   S3_FORCE_PATH_STYLE (nécessaire pour MinIO)
 */
export const stockageS3: Stockage = {
  nom: "s3",
  // ⚠️ « valide » ne dit pas « le code a l'air juste », mais « éprouvé sur une
  //   instance réelle ». État au 2 octobre 2026 : la signature a été confrontée
  //   à l'implémentation de référence aws4 sur six cas, et l'aller-retour
  //   complet a réussi contre un serveur qui vérifie chaque signature — dans
  //   les deux styles d'adressage. Il reste à le faire sur un compartiment
  //   réel : ni la région, ni les droits de la clé, ni la cohérence du service
  //   ne se devinent depuis ici. La marque ne bougera qu'après
  //   `scripts/verifier-stockage-s3.ts` exécuté en production.
  valide: false,

  async ecrire(organisationId, contenu, extension) {
    if (!UUID.test(organisationId)) throw new Error("identifiant d'organisation invalide");
    if (!EXTENSION.test(extension)) throw new Error("extension invalide");

    const compartiment = process.env.S3_BUCKET;
    if (!compartiment) throw new Error("S3_BUCKET n'est pas défini");

    const sha256 = condensat(contenu);
    const cle = `${organisationId}/${sha256.slice(0, 2)}/${sha256}.${extension}`;

    // La signature AWS SigV4 est délibérément implémentée ici plutôt que par
    // une dépendance : le dépôt n'embarque aucun SDK de stockage, et ajouter
    // une bibliothèque jamais exécutée augmenterait la surface d'audit sans
    // rien garantir de plus.
    const { signerEtEnvoyer } = await import("./s3-signature");
    await signerEtEnvoyer("PUT", cle, Buffer.from(contenu), "application/octet-stream");

    return { cle, sha256, taille: contenu.length };
  },

  async lire(cle) {
    if (!cleValide(cle)) return null;
    const { signerEtEnvoyer } = await import("./s3-signature");
    const reponse = await signerEtEnvoyer("GET", cle, null, null);
    return reponse === null ? null : new Uint8Array(reponse);
  },

  async supprimer(cle) {
    if (!cleValide(cle)) return;
    const { signerEtEnvoyer } = await import("./s3-signature");
    await signerEtEnvoyer("DELETE", cle, null, null);
  },
};

/** Adaptateur monté, selon la configuration. */
export function stockageCourant(): Stockage {
  return process.env.S3_BUCKET ? stockageS3 : stockageDisque;
}

/** Vrai si l'adaptateur monté a déjà été éprouvé sur une instance réelle. */
export function stockageValide(): boolean {
  return stockageCourant().valide;
}

export async function tailleDe(cle: string): Promise<number | null> {
  if (stockageCourant() !== stockageDisque) return null;
  if (!cleValide(cle)) return null;
  const chemin = join(repertoireStockage(), ...cle.split("/"));
  try {
    const s = await stat(chemin);
    return s.size;
  } catch {
    return null;
  }
}
