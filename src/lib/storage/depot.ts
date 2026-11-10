/**
 * Réception d'une pièce justificative : contrôles, écriture, traçabilité.
 *
 * ⚠️ P1-02 — l'ordre des opérations est structurant, et il n'est pas celui
 * qu'on écrirait naïvement.
 *
 *   1. lire en bornant (refus si trop volumineux) ;
 *   2. déterminer le type **réel** par les octets, avant toute écriture ;
 *   3. refuser les types qui n'ont rien à faire dans un dossier de conformité ;
 *   4. analyser (ou constater qu'aucun moteur n'est disponible) ;
 *   5. écrire sur le support, puis **relire** et vérifier le condensat ;
 *   6. seulement alors, enregistrer en base.
 *
 * Écrire avant de contrôler reviendrait à accepter un exécutable le temps de
 * le supprimer, et à faire figurer en base un fichier absent du support. La
 * relaise après écriture n'est pas une précaution théorique : sans elle, une
 * troncature silencieuse donnerait un document déclaré intact et récupérable,
 * qui ne le serait pas.
 */

import { and, eq, sql } from "drizzle-orm";

import { documentVersions, documents } from "@/db/schema";
import { FICHIER_MAX_OCTETS, TYPES_REFUSES } from "@/lib/api/limits";
import type { FichierMultipart } from "@/lib/api/multipart";

import { messageQuota, quotaStockageOctets, verifierQuota } from "@/lib/rgpd/quota-stockage";

import { analyseObligatoire, analyseurCourant, type ResultatAnalyse } from "./antivirus";
import { detecterType, ecartDeType, type TypeReel } from "./file-type";
import { stockageCourant, stockageValide } from "./index";

export interface PieceDeposee {
  cle: string;
  sha256: string;
  taille: number;
  nomFichier: string;
  typeReel: TypeReel;
  typeDeclare: string | null;
  /** Vrai si le type annoncé ne correspond pas aux octets. */
  typeTrompeur: boolean;
  analyse: ResultatAnalyse;
  version: number;
  avertissements: string[];
}

export type DepotRefuse = { refuse: true; statut: number; detail: string; code?: string };
export type DepotAccepte = { refuse: false; piece: PieceDeposee };

/**
 * Résultat des contrôles préalables, **avant toute écriture**.
 *
 * ⚠️ Pourquoi séparer « contrôler » de « déposer ».
 *   Lorsqu'une fiche est créée avec sa pièce en une seule requête, la fiche est
 *   insérée d'abord (une pièce ne peut pas être rattachée à un document qui
 *   n'existe pas). Si le contrôle du fichier n'avait lieu qu'après, une pièce
 *   refusée laisserait une fiche orpheline validée par la transaction — un
 *   dossier qui cite un document dont le fichier n'existera jamais. Contrôler
 *   avant l'insertion rend le refus sans trace.
 */
export interface ControlePiece {
  typeReel: TypeReel;
  typeTrompeur: boolean;
  analyse: ResultatAnalyse;
  avertissements: string[];
}

export type VerdictControle = DepotRefuse | { refuse: false; controle: ControlePiece };

const CARACTERES_INTERDITS = /[\\/:*?"<>|\x00-\x1f]/g;

function nettoyerNom(nom: string): string {
  return nom.replace(CARACTERES_INTERDITS, "_").replace(/^\.+/, "").slice(0, 255) || "piece";
}

/** Numéro de version suivant, calculé dans la transaction pour éviter les doublons. */
async function versionSuivante(
  tx: any,
  documentId: string,
  organisationId: string,
): Promise<number> {
  const [ligne] = await tx
    .select({ max: sql<number>`coalesce(max(${documentVersions.version}), 0)` })
    .from(documentVersions)
    .where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.organizationId, organisationId)));
  return Number(ligne?.max ?? 0) + 1;
}

/**
 * Dépose une pièce et l'attache à un document existant.
 *
 * Le document doit déjà appartenir à l'organisation appelante : c'est ici, et
 * pas seulement dans la politique RLS, que se joue le cloisonnement. Une pièce
 * rattachée à un document d'une autre organisation serait stockée sous le
 * répertoire de l'appelant, donc invisible de son propriétaire — et lisible
 * par lui.
 */
export async function verifierPiece(fichier: FichierMultipart): Promise<VerdictControle> {
  const avertissements: string[] = [];

  // ⚠️ Un adaptateur qui n'a jamais été éprouvé n'est pas un adaptateur prêt.
  //   Le support S3 est écrit mais n'a jamais tourné contre un compartiment
  //   réel : le laisser recevoir des pièces en production reviendrait à
  //   présenter comme opérationnel un chemin de code jamais exécuté. Il ne
  //   s'allume donc que sur un acquittement explicite de l'exploitant, et le
  //   dépôt reste signalé comme non validé même acquitté.
  //
  //   Le contrôle est placé ici — et non au moment de l'écriture — pour qu'un
  //   refus ne laisse aucune fiche derrière lui : la fiche est créée après les
  //   contrôles, jamais avant.
  const stockage = stockageCourant();
  if (!stockage.valide && process.env.GF_STORAGE_ACCEPT_NON_VALIDE !== "1") {
    return {
      refuse: true,
      statut: 503,
      detail:
        `Support « ${stockage.nom} » sélectionné mais jamais validé sur une instance réelle : ` +
        `dépôt refusé par défaut. Ce chantier (P1-02) n'a été éprouvé qu'en stockage disque ` +
        `local. Validez l'adaptateur en recette, puis posez ` +
        `GF_STORAGE_ACCEPT_NON_VALIDE=1 pour l'autoriser en connaissance de cause.`,
    };
  }

  if (fichier.contenu.length === 0) {
    return { refuse: true, statut: 422, detail: "Fichier vide" };
  }
  if (fichier.contenu.length > FICHIER_MAX_OCTETS) {
    return { refuse: true, statut: 413, detail: "Fichier trop volumineux" };
  }

  // 2. type réel, lu dans les octets
  const typeReel = detecterType(fichier.contenu);

  // 3. refus des types qui n'ont rien à faire dans un dossier de conformité
  if ((TYPES_REFUSES as readonly string[]).includes(typeReel.mime) || typeReel.dangereux) {
    return {
      refuse: true,
      statut: 422,
      detail:
        `Type de fichier refusé : ${typeReel.libelle}. ` +
        `Un dossier de conformité n'accepte ni exécutable, ni script, ni archive de macros — ` +
        `même déposé sous un nom anodin.`,
    };
  }

  const typeTrompeur = ecartDeType(fichier.typeDeclare, typeReel);
  if (typeTrompeur) {
    avertissements.push(
      `Type annoncé « ${fichier.typeDeclare} » mais les octets indiquent « ${typeReel.libelle} » ` +
        `(probablement ${typeReel.mime}). Le type réel est celui qui est retenu.`,
    );
  }

  // 4. analyse
  const analyse = await analyseurCourant().analyser(fichier.contenu, fichier.nomFichier);
  if (analyse.statut === "INFECTED") {
    return { refuse: true, statut: 422, detail: `Fichier écarté par l'analyse : ${analyse.detail ?? ""}` };
  }
  if (analyse.statut === "NOT_SCANNED") {
    if (analyseObligatoire()) {
      return {
        refuse: true,
        statut: 503,
        detail:
          "Aucun moteur antivirus n'est disponible et la politique exige une analyse : dépôt refusé. " +
          "Configurez un moteur ou revisez la politique.",
      };
    }
    avertissements.push(analyse.detail ?? "Aucun moteur antivirus configuré : le fichier n'a pas été analysé.");
  }

  return { refuse: false, controle: { typeReel, typeTrompeur, analyse, avertissements } };
}

/**
 * Écrit la pièce et l'attache au document.
 *
 * @param controle Résultat de `verifierPiece`. S'il est fourni, les contrôles
 *   ne sont pas refaits — l'analyse antivirus ne doit pas être exécutée deux
 *   fois pour un même dépôt, et le verdict doit être celui qui a été affiché.
 */
export async function deposerPiece(
  tx: any,
  organisationId: string,
  documentId: string,
  fichier: FichierMultipart,
  utilisateur: string,
  controle?: ControlePiece,
): Promise<DepotRefuse | DepotAccepte> {
  const verif: VerdictControle = controle
    ? { refuse: false, controle }
    : await verifierPiece(fichier);
  if (verif.refuse) return verif;

  const { typeReel, typeTrompeur, analyse } = verif.controle;
  const avertissements = [...verif.controle.avertissements];

  // ---------------------------------------------------------------- C11
  // 4 bis. QUOTA — vérifié AVANT toute écriture.
  //
  // ⚠️ Le stockage est un répertoire disque partagé, cloisonné par préfixe
  //   d'organisation. Sans quota, une organisation remplit le disque et rend le
  //   service indisponible pour toutes les autres : ce n'est pas un forfait
  //   dépassé, c'est une panne provoquée par un seul tenant.
  //
  //   Le contrôle est placé ici, après les contrôles de type et d'analyse mais
  //   avant l'écriture : plus tôt, un fichier refusé pour son type aurait
  //   consommé une requête de comptage pour rien ; plus tard, le fichier serait
  //   déjà sur le disque et le refus ne protégerait de rien.
  const [usage] = await tx
    .select({ octets: sql<number>`coalesce(sum(${documentVersions.sizeBytes}), 0)` })
    .from(documentVersions)
    .where(eq(documentVersions.organizationId, organisationId));
  const quota = verifierQuota({
    utilise: Number(usage?.octets ?? 0),
    ajout: fichier.contenu.length,
    quota: quotaStockageOctets(),
  });
  if (quota.depasse) {
    return { refuse: true, statut: 413, detail: messageQuota(quota), code: "QUOTA_DEPASSE" };
  }

  // 5. écriture puis relecture
  const stockage = stockageCourant();


  const objet = await stockage.ecrire(organisationId, fichier.contenu, typeReel.extension);
  const relu = await stockage.lire(objet.cle);
  if (!relu) {
    return { refuse: true, statut: 500, detail: "La pièce n'a pas pu être relue après écriture : dépôt annulé." };
  }
  if (Buffer.from(relu).toString("base64") !== Buffer.from(fichier.contenu).toString("base64")) {
    return { refuse: true, statut: 500, detail: "Le contenu relu diffère du contenu déposé : dépôt annulé." };
  }

  // 6. enregistrement
  const version = await versionSuivante(tx, documentId, organisationId);
  const nomNettoye = nettoyerNom(fichier.nomFichier);

  await tx.insert(documentVersions).values({
    organizationId: organisationId,
    documentId,
    version,
    fileName: nomNettoye,
    storageKey: objet.cle,
    sha256: objet.sha256,
    sizeBytes: objet.taille,
    mimeDetected: typeReel.mime,
    mimeDeclared: fichier.typeDeclare ?? null,
    scanStatus: analyse.statut,
    scanMoteur: analyse.moteur,
    uploadedBy: utilisateur,
  });

  await tx
    .update(documents)
    .set({
      fileName: nomNettoye,
      storageKey: objet.cle,
      sha256: objet.sha256,
      sizeBytes: objet.taille,
      mimeDetected: typeReel.mime,
      mimeDeclared: fichier.typeDeclare ?? null,
      mimeMismatch: typeTrompeur,
      version,
      scanStatus: analyse.statut,
      scanDetail: analyse.detail,
      scanMoteur: analyse.moteur,
      uploadedBy: utilisateur,
      status: "TO_VERIFY",
    })
    .where(and(eq(documents.id, documentId), eq(documents.organizationId, organisationId)));

  if (!stockageValide()) {
    avertissements.push(
      `Support « ${stockage.nom} » non validé : jamais éprouvé sur une instance réelle. ` +
        `Le fichier a bien été écrit, mais ce mode de stockage reste à valider en recette.`,
    );
  }

  return {
    refuse: false,
    piece: {
      cle: objet.cle,
      sha256: objet.sha256,
      taille: objet.taille,
      nomFichier: nomNettoye,
      typeReel,
      typeDeclare: fichier.typeDeclare ?? null,
      typeTrompeur,
      analyse,
      version,
      avertissements,
    },
  };
}

/**
 * Efface les objets qui ne sont plus référencés par aucune version.
 *
 * ⚠️ P1-02 — pourquoi un comptage et pas un simple « je supprime ma clé ».
 *
 * Les objets sont adressés par leur contenu : deux documents de la même
 * organisation qui reçoivent le même fichier partagent la même clé. Supprimer
 * l'objet au départ du premier rendrait le second irrécupérable, sans que
 * rien ne le signale avant qu'on essaie de le télécharger. On ne supprime
 * donc que les clés dont le nombre de références est retombé à zéro.
 *
 * Les objets dont l'effacement échoue sont comptés à part : un fichier qui
 * reste sur le disque alors qu'il n'est plus référencé est un résidu à
 * reprendre par l'exploitation, pas une réussite.
 */
export async function purgerObjets(
  tx: any,
  organisationId: string,
  cles: string[],
): Promise<{ conserves: number; supprimes: number; echecs: number }> {
  const stockage = stockageCourant();
  const resultat = { conserves: 0, supprimes: 0, echecs: 0 };

  for (const cle of new Set(cles)) {
    const lignes = await tx
      .select({ id: documentVersions.id })
      .from(documentVersions)
      .where(and(eq(documentVersions.storageKey, cle), eq(documentVersions.organizationId, organisationId)))
      .limit(1);

    if (lignes.length > 0) {
      resultat.conserves += 1;
      continue;
    }

    try {
      await stockage.supprimer(cle);
      resultat.supprimes += 1;
    } catch (error) {
      console.error("P1-02 — effacement impossible sur le support", cle, error);
      resultat.echecs += 1;
    }
  }

  return resultat;
}
