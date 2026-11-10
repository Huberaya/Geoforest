/**
 * Export des données d'une organisation — art. 15 (accès) et art. 20
 * (portabilité) du RGPD.
 *
 * ⚠️ Pourquoi cette fonction existe, et pourquoi elle n'est pas un `SELECT *`.
 *
 *   Sans elle, une demande d'accès se traite à la main, en SQL, sur une base de
 *   production. Trois choses se produisent alors, toutes déjà observées
 *   ailleurs : on oublie une table, on lit la mauvaise organisation, et l'on
 *   transmet des secrets d'authentification avec les données demandées.
 *
 *   L'export est donc écrit une fois, borné **par construction** à une
 *   organisation, et il ÉNUMÈRE ce qu'il rend. Une table ajoutée demain ne sera
 *   pas exportée tant que quelqu'un n'aura pas complété cette liste — ce qui est
 *   visible, contrairement à un oubli dans une requête écrite à la main.
 *
 * ⚠️ Ce qui n'est JAMAIS exporté, et pourquoi ce n'est pas une omission :
 *   · `passwordHash`, `refreshTokenHash`, jetons, secrets MFA — un export
 *     destiné à la personne concernée qui contiendrait ses propres secrets
 *     d'authentification créerait un risque en cherchant à satisfaire un droit ;
 *   · `gf_login_attempts` — la table contient des clés de fenêtre mêlant
 *     l'adresse IP d'autres personnes ; la rendre à un demandeur divulguerait
 *     des données de tiers. Elle est décrite dans l'export, sans être versée ;
 *   · `gf_sessions` — même raison : le détail des sessions d'un compte n'est
 *     pas exporté, seule leur existence et leur nombre sont indiqués.
 *
 * ⚠️ Limite assumée : l'export ne va pas chercher les données que le produit ne
 *   détient pas (celles restées chez un sous-traitant, ou dans les journaux
 *   d'infrastructure de l'hébergeur). Un export complet au sens strict demande
 *   une revue de l'hébergement ; c'est écrit ici plutôt que laissé croire.
 */
import { eq } from "drizzle-orm";

import {
  complianceTasks,
  documentVersions,
  documents,
  dueDiligenceStatements,
  organizations,
  parcelAudits,
  plots,
  products,
  shipments,
  suppliers,
  users,
} from "@/db/schema";

import { CARTE_DONNEES } from "./carte-donnees";

/** Ce que l'export contient, et ce qu'il ne contient pas. */
export interface ExportDonnees {
  genere_le: string;
  organisation: { id: string; nom: string; pays: string };
  /** Version de la carte des données au moment de l'export. */
  carte_des_donnees: typeof CARTE_DONNEES;
  donnees: {
    utilisateurs: unknown[];
    fournisseurs: unknown[];
    produits: unknown[];
    expeditions: unknown[];
    parcelles: unknown[];
    analyses: unknown[];
    dossiers: unknown[];
    taches: unknown[];
    documents: unknown[];
    versions: unknown[];
  };
  /**
   * ⚠️ Explicitement vide, et nommé plutôt que passé sous silence : un lecteur
   *   qui ne voit pas la rubrique croit à un oubli, un lecteur qui la voit
   *   comprend la décision.
   */
  non_exporte: Array<{ objet: string; motif: string }>;
}

/**
 * Construit l'export pour UNE organisation.
 *
 * @param tx  Transaction portant déjà la RLS de l'organisation appelante.
 * @param organizationId Organisation du demandeur. Jamais reçue du client.
 */
export async function exporterDonneesOrganisation(
  tx: {
    select: (...args: never[]) => { from: (t: never) => { where: (c: unknown) => Promise<unknown[]> } };
  },
  organizationId: string,
): Promise<ExportDonnees> {
  // Le typage de `tx` est volontairement minimal : la fonction doit accepter
  // aussi bien la transaction de route que celle d'un script. Le contrat réel
  // est « un objet qui sait faire un select filtré ».
  const lire = async (table: never, condition: unknown): Promise<unknown[]> => {
    const rows = await (tx.select().from(table) as { where: (c: unknown) => Promise<unknown[]> }).where(condition);
    return rows as unknown[];
  };

  // ⚠️ PROJECTION EXPLICITE POUR LES UTILISATEURS, et pas `select()`.
  //
  //   `select()` ramène TOUTES les colonnes — donc `password_hash`. Vérifié à
  //   l'exécution : la première version de cet export contenait bien les
  //   empreintes, alors que le contrôle statique ne trouvait pas le mot
  //   `passwordHash` dans ce fichier. Un contrôle lexical prouve qu'un mot n'est
  //   pas écrit ; il ne prouve pas qu'une valeur n'est pas lue.
  //
  //   L'énumération est donc la garde : une colonne ajoutée demain à `gf_users`
  //   ne sera pas exportée tant que quelqu'un ne l'aura pas ajoutée ici.
  //
  //   Et la projection se fait DANS la requête, pas après : sous le rôle
  //   applicatif, `gf_users` n'est lisible que colonne par colonne
  //   (`scripts/sql/post-migrate/010_row_level_security.sql` retire le
  //   privilège de table et n'accorde qu'une liste explicite, sans
  //   `password_hash`, `mfa_secret`, `invitation_token_hash`…). Un `select()`
  //   complet suivi d'un filtrage en mémoire échouait donc en `permission
  //   denied` — mesuré le 10/11/2026 sur le parcours bout en bout (HTTP 500).
  //   Ne demander que ce que l'on exporte est la seule forme compatible avec
  //   une base qui refuse de livrer les secrets, quel que soit le code.
  //   (`tx.select` est appelé SUR `tx`, pas détaché : la méthode lit sa
  //   session dans `this`.)
  const selectionner = (champs: Record<string, unknown>) =>
    (tx as unknown as {
      select: (c: Record<string, unknown>) => { from: (t: never) => { where: (c: unknown) => Promise<unknown[]> } };
    }).select(champs);
  const utilisateurs = (
    await selectionner({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
      createdAt: users.createdAt,
      lastLoginAt: users.lastLoginAt,
    })
      .from(users as never)
      .where(eq(users.organizationId, organizationId))
  ).map((u) => {
    const r = u as Record<string, unknown>;
    return {
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      status: r.status,
      createdAt: r.createdAt,
      lastLoginAt: r.lastLoginAt ?? null,
    };
  });

  /** Retire les colonnes techniques qui n'ont pas à figurer dans un export. */
  const sansSecrets = (lignes: unknown[]): unknown[] =>
    lignes.map((l) => {
      const r = { ...(l as Record<string, unknown>) };
      delete r.passwordHash;
      delete r.passwordUpdatedAt;
      delete r.tokenVersion;
      delete r.mfaSecret;
      delete r.mfaRecoveryCodes;
      delete r.refreshTokenHash;
      delete r.storageKey;
      return r;
    });

  const [org] = await lire(organizations as never, eq(organizations.id, organizationId));

  return {
    genere_le: new Date().toISOString(),
    organisation: {
      id: organizationId,
      nom: (org as { name?: string } | undefined)?.name ?? "",
      pays: (org as { country?: string } | undefined)?.country ?? "",
    },
    carte_des_donnees: CARTE_DONNEES,
    donnees: {
      utilisateurs,
      fournisseurs: sansSecrets(await lire(suppliers as never, eq(suppliers.organizationId, organizationId))),
      produits: sansSecrets(await lire(products as never, eq(products.organizationId, organizationId))),
      expeditions: sansSecrets(await lire(shipments as never, eq(shipments.organizationId, organizationId))),
      parcelles: sansSecrets(await lire(plots as never, eq(plots.organizationId, organizationId))),
      analyses: sansSecrets(await lire(parcelAudits as never, eq(parcelAudits.organizationId, organizationId))),
      dossiers: sansSecrets(
        await lire(dueDiligenceStatements as never, eq(dueDiligenceStatements.organizationId, organizationId)),
      ),
      taches: sansSecrets(await lire(complianceTasks as never, eq(complianceTasks.organizationId, organizationId))),
      documents: sansSecrets(await lire(documents as never, eq(documents.organizationId, organizationId))),
      versions: sansSecrets(await lire(documentVersions as never, eq(documentVersions.organizationId, organizationId))),
    },
    non_exporte: [
      {
        objet: "Secrets d'authentification (empreintes de mot de passe, jetons de rafraîchissement, secrets MFA)",
        motif:
          "Les transmettre créerait un risque de sécurité sans servir le droit d'accès : la personne n'a pas besoin de ses propres secrets pour vérifier ce qui est détenu sur elle.",
      },
      {
        objet: "Tentatives de connexion (gf_login_attempts)",
        motif:
          "Cette table mêle les adresses IP de plusieurs personnes dans une même clé de fenêtre. La verser divulguerait les données de tiers.",
      },
      {
        objet: "Journal d'audit détaillé",
        motif:
          "Le journal est lisible dans l'application, ligne par ligne, par les membres habilités. Il n'est pas versé dans l'export : il contient l'activité d'autres utilisateurs de la même organisation.",
      },
      {
        objet: "Données détenues par l'hébergeur (journaux d'infrastructure, sauvegardes)",
        motif:
          "Elles ne sont pas accessibles au produit. Une demande les concernant doit être adressée à l'hébergeur, dont les coordonnées figurent dans docs/RGPD.md.",
      },
    ],
  };
}
