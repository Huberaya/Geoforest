/**
 * Contrôle du rôle de connexion — P1-10b.
 *
 * ⚠️ Pourquoi ce module existe.
 *
 * Le cloisonnement multi-tenant repose sur la RLS PostgreSQL. Or la RLS n'est
 * **pas** une barrière absolue : PostgreSQL la lève délibérément dans trois
 * cas, et chacun transforme le cloisonnement en décor :
 *
 *   1. le rôle connecté est **superutilisateur** ;
 *   2. le rôle connecté porte l'attribut **`BYPASSRLS`** — mesuré le
 *      02/10/2026 sur Neon : `neondb_owner` voit les lignes d'une table en
 *      RLS forcée, sans politique, là où un rôle ordinaire n'en voit aucune ;
 *   3. le rôle connecté est **propriétaire** de la table, sauf RLS forcée.
 *
 * Le cas n° 2 est celui qui menace la production : l'URL de base fournie par
 * l'hébergeur est celle du propriétaire. La brancher telle quelle dans
 * `DATABASE_URL` donne une application qui fonctionne parfaitement et qui
 * **voit toutes les organisations**. Aucune erreur, aucun test qui échoue :
 * c'est une défaillance silencieuse, de loin la pire espèce.
 *
 * Ce module la rend impossible à ignorer : il interroge la base avec les
 * droits réels du rôle connecté, et `src/instrumentation.ts` refuse le
 * démarrage du serveur si le contrôle échoue.
 *
 * ⚠️ Ce que ce contrôle ne fait pas : il ne corrige rien. Il constate. Une
 *   protection qui répare silencieusement sa propre configuration finit par
 *   masquer la configuration qu'elle a réparée.
 */
import type { Pool } from "pg";

/**
 * ⚠️ Import différé, et pourquoi : `./index` construit le pool au simple
 *   chargement du module. Un appelant qui fournit son propre pool — les
 *   scripts d'exploitation, via `verifierRoleAvec` — n'a aucune raison d'ouvrir
 *   en plus celui du produit, ni d'en attendre la configuration.
 */
async function poolApplication(): Promise<Pool> {
  const moduleDb = await import("./index");
  return moduleDb.pool;
}

export interface EtatRoleBase {
  /** Nom du rôle avec lequel l'application est réellement connectée. */
  role: string;
  /** `BYPASSRLS` : contourne la RLS sur toutes les tables, RLS forcée comprise. */
  contourneRls: boolean;
  /** Superutilisateur : contourne tout, RLS et privilèges. */
  superutilisateur: boolean;
  /** Tables dont le rôle est propriétaire et dont la RLS n'est pas forcée. */
  tablesSansCloisonnement: string[];
  /** Privilèges de destruction encore détenus : « table:PRIVILÈGE ». */
  droitsDestruction: string[];
  ok: boolean;
  /** Ce qui ne va pas, en clair. Vide quand tout va bien. */
  messages: string[];
}

/**
 * Une seule requête : ce contrôle s'exécute au démarrage et sur la sonde de
 * santé, il n'a aucune raison de coûter quatre allers-retours.
 *
 * ⚠️ Le filtre porte sur nos tables, pas sur tout le schéma : la base héberge
 *   aussi des tables étrangères au produit (issues d'un autre système de
 *   migration), dont le produit n'a pas à répondre.
 */

/**
 * ⚠️ Les deux agrégats sont convertis en `text[]`, et ce n'est pas une coquette
 *   rie : `pg_class.relname` et les colonnes d'`information_schema` sont de
 *   type `name`, dont le tableau n'a pas d'analyseur côté client `pg`. La
 *   valeur arrivait sous la forme d'une chaîne « {a,b} » et `join` levait une
 *   erreur — erreur constatée au premier essai, le 02/10/2026.
 */
const REQUETE = `
select
  current_user::text                                                as role,
  (select rolsuper     from pg_roles where rolname = current_user)  as superutilisateur,
  (select rolbypassrls from pg_roles where rolname = current_user)  as contourne_rls,
  coalesce((
    select array_agg(c.relname::text order by c.relname)
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and (c.relname like 'gf\\_%%' or c.relname = 'parcel_audits')
       and pg_get_userbyid(c.relowner) = current_user
       and not c.relforcerowsecurity
  ), '{}'::text[])                                                  as tables_sans_cloisonnement,
  coalesce((
    select array_agg(distinct g.table_name::text || ':' || g.privilege_type)
      from information_schema.role_table_grants g
     where g.grantee = current_user
       and g.privilege_type in ('DELETE', 'TRUNCATE')
       and (g.table_name like 'gf\\_%%' or g.table_name = 'parcel_audits')
  ), '{}'::text[])                                                  as droits_destruction
`;

interface Ligne {
  role: string;
  superutilisateur: boolean;
  contourne_rls: boolean;
  tables_sans_cloisonnement: string[];
  droits_destruction: string[];
}

export async function verifierRoleAvec(base: Pool): Promise<EtatRoleBase> {
  const { rows } = await base.query<Ligne>(REQUETE);
  const ligne = rows[0];

  const messages: string[] = [];

  if (ligne.superutilisateur) {
    messages.push(
      `le rôle « ${ligne.role} » est superutilisateur : il contourne la RLS et tous les privilèges. ` +
        "Aucune donnée d'une autre organisation n'est hors de sa portée.",
    );
  }

  if (ligne.contourne_rls) {
    messages.push(
      `le rôle « ${ligne.role} » porte l'attribut BYPASSRLS : il contourne la RLS, ` +
        "y compris sur les tables en RLS forcée (mesuré sur PostgreSQL 18). " +
        "C'est le rôle de l'hébergeur, jamais celui de l'application.",
    );
  }

  if (ligne.tables_sans_cloisonnement.length > 0) {
    messages.push(
      `le rôle « ${ligne.role} » est propriétaire de ${ligne.tables_sans_cloisonnement.length} ` +
        `table(s) dont la RLS n'est pas forcée (${ligne.tables_sans_cloisonnement.join(", ")}). ` +
        "Un propriétaire n'est pas soumis aux politiques qu'il a lui-même écrites.",
    );
  }

  if (ligne.droits_destruction.length > 0) {
    messages.push(
      `${ligne.droits_destruction.length} privilège(s) de destruction encore détenu(s) ` +
        `(${ligne.droits_destruction.join(", ")}). ` +
        "Le contrat de traçabilité veut que l'application ne puisse rien détruire.",
    );
  }

  return {
    role: ligne.role,
    contourneRls: ligne.contourne_rls,
    superutilisateur: ligne.superutilisateur,
    tablesSansCloisonnement: ligne.tables_sans_cloisonnement,
    droitsDestruction: ligne.droits_destruction,
    ok: messages.length === 0,
    messages,
  };
}

/** Contrôle la connexion que le produit utilise effectivement. */
export async function verifierRoleApplication(): Promise<EtatRoleBase> {
  return verifierRoleAvec(await poolApplication());
}


/**
 * Résultat de la comparaison des deux connexions déclarées.
 */
export interface SeparationConnexions {
  roleApplicatif: string | null;
  roleAdministration: string | null;
  /** Vrai si les deux connexions emploient le même rôle — configuration à proscrire. */
  memeRole: boolean;
  /** `DATABASE_URL_ADMIN` est déclaré explicitement, et non repris de `DATABASE_URL`. */
  adminDeclare: boolean;
  /** Une URL est absente ou illisible : on ne peut rien conclure, et on le dit. */
  indetermine: boolean;
}

/**
 * ⚠️ Seconde vérification, et pourquoi elle ne figure pas dans la première :
 *   `verifierRoleApplication()` constate l'état du rôle **applicatif**. Or le
 *   produit ouvre une seconde connexion (`src/db/admin.ts`) pour
 *   l'authentification et l'écriture du journal d'audit — deux chemins qui
 *   doivent, par construction, agir avant ou hors du contexte d'organisation.
 *   Cette connexion a donc tous les droits, et c'est assumé.
 *
 *   Le danger est qu'elle devienne la seule : `src/db/admin.ts` se replie sur
 *   `DATABASE_URL` quand `DATABASE_URL_ADMIN` est absent. Les routes métier
 *   s'exécuteraient alors avec le rôle d'administration, lequel contourne la
 *   RLS — sans qu'aucune erreur ne le signale.
 */
export function comparerConnexions(): SeparationConnexions {
  const urlApp = process.env.DATABASE_URL ?? null;
  // ⚠️ Même repli que `src/db/admin.ts` : c'est ce repli qu'il s'agit de
  //   détecter, il doit donc être reproduit ici à l'identique.
  const urlAdmin = process.env.DATABASE_URL_ADMIN ?? urlApp;

  function role(url: string | null): string | null {
    if (!url) return null;
    try {
      return decodeURIComponent(new URL(url).username);
    } catch {
      return null;
    }
  }

  const roleApplicatif = role(urlApp);
  const roleAdministration = role(urlAdmin);

  return {
    roleApplicatif,
    roleAdministration,
    adminDeclare: (process.env.DATABASE_URL_ADMIN ?? "") !== "",
    indetermine: roleApplicatif === null || roleAdministration === null,
    memeRole:
      roleApplicatif !== null && roleAdministration !== null && roleApplicatif === roleAdministration,
  };
}

/** Rapport lisible, une ligne par constat. */
export function decrireRoleApplication(etat: EtatRoleBase): string[] {
  const lignes = [
    `  rôle connecté             : ${etat.role}`,
    `  superutilisateur          : ${etat.superutilisateur ? "OUI" : "non"}`,
    `  attribut BYPASSRLS        : ${etat.contourneRls ? "OUI" : "non"}`,
    `  tables hors cloisonnement : ${etat.tablesSansCloisonnement.length}`,
    `  droits de destruction     : ${etat.droitsDestruction.length}`,
  ];
  if (etat.messages.length > 0) {
    lignes.push("");
    for (const message of etat.messages) lignes.push(`  🔴 ${message}`);
  }
  return lignes;
}
