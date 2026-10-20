import "server-only";

import type { Pool } from "pg";

/**
 * Garde-fou d'**état de sécurité du schéma** — R-05.
 *
 * ⚠️ Pourquoi ce module existe, et pourquoi il ne se contente pas de lire le
 *   registre de migrations.
 *
 *   Une interruption entre deux scripts de `scripts/sql/post-migrate/` laisse
 *   une base qui **paraît** migrée : les tables existent, l'application
 *   démarre, les routes répondent. Mesuré le 19/10/2026, après `010` et avant
 *   `020` : 13 politiques au lieu de 34, les deux fonctions
 *   `auth_user_by_*` encore exécutables par `geoforest_app`, aucun déclencheur
 *   de journal. Un registre Drizzle ne voit rien de tout cela : les
 *   post-migrations ne sont pas enregistrées.
 *
 *   Le contrôle porte donc sur l'**état réel** : RLS activée et forcée sur
 *   chaque table, jeu exact de politiques, fonctions d'authentification
 *   présentes mais non exécutables par le rôle applicatif, déclencheurs du
 *   journal, index de cadence, contrainte d'identité opérateur. Si un seul
 *   manque, le service refuse de servir.
 *
 * ⚠️ Aucun commutateur de contournement. Le contrôle du rôle a
 *   `GF_CONTROLE_ROLE=off` pour redémarrer en incident ; un schéma incomplet,
 *   lui, n'a aucune raison d'être servi.
 */

/** Tables métier soumises à la RLS par `010` (13). */
export const TABLES_PROTEGEES = [
  "gf_organizations",
  "gf_users",
  "gf_suppliers",
  "gf_products",
  "gf_shipments",
  "gf_plots",
  "gf_documents",
  "gf_document_versions",
  "gf_due_diligence_statements",
  "gf_compliance_tasks",
  "gf_audit_logs",
  "gf_idempotence",
  "parcel_audits",
] as const;

/** Tables dont `022` remplace la politique unique par quatre politiques. */
export const TABLES_POLITIQUES_QUADRUPLE = [
  "gf_suppliers",
  "gf_products",
  "gf_shipments",
  "gf_plots",
  "gf_documents",
  "gf_due_diligence_statements",
  "gf_compliance_tasks",
] as const;

const POLITIQUES_QUADRUPLE = [
  "tenant_isolation_lecture",
  "tenant_isolation_ecriture",
  "tenant_isolation_maj",
  "tenant_isolation_retrait",
] as const;

export const FONCTIONS_AUTH = [
  "auth_user_by_email(text)",
  "auth_user_by_id(uuid)",
] as const;

export const DECLENCHEURS_JOURNAL = [
  "trg_gf_audit_logs_chaine",
  "trg_gf_audit_logs_append_only",
] as const;

export const INDEX_CADENCE = "uq_gf_login_attempts_cle";
export const CONTRAINTE_IDENTITE = "parcel_audits_identite_operateur_valide";

const COLONNES_IDENTITE = ["operator_name", "operator_eori", "operator_country"] as const;

export interface ProblemeSchema {
  code: string;
  message: string;
  details?: unknown;
}

export interface EtatSchemaSecurite {
  ok: boolean;
  role: string;
  superutilisateur: boolean;
  problemes: ProblemeSchema[];
  mesures: {
    tablesProtegees: number;
    politiques: number;
    fonctionsAuthExecutables: number | null;
    declencheursJournal: number;
    indexCadence: boolean;
    contrainteIdentite: boolean;
  };
}

interface LigneTable {
  tablename: string;
  rowsecurity: boolean;
  forcerowsecurity: boolean;
}

interface LignePolitique {
  tablename: string;
  policyname: string;
}

interface LigneFonction {
  signature: string;
  executable: boolean;
  security_definer: boolean;
}

interface LigneIdentite {
  contrainte: boolean;
  name_nullable: boolean;
  eori_nullable: boolean;
  country_nullable: boolean;
  country_default: boolean;
}

interface LignePrivileges {
  table_select: boolean;
  password_hash: boolean;
  mfa_secret: boolean;
  mfa_recovery_codes: boolean;
  email: boolean;
}

export interface ConstatsSchema {
  role: string;
  superutilisateur: boolean;
  tables: LigneTable[];
  politiques: LignePolitique[];
  fonctions: LigneFonction[];
  declencheurs: string[];
  indexCadence: boolean;
  identite: LigneIdentite;
  privileges: LignePrivileges | null;
}

function memeEnsemble(attendu: readonly string[], obtenu: readonly string[]): boolean {
  if (attendu.length !== obtenu.length) return false;
  const a = [...attendu].sort();
  const b = [...obtenu].sort();
  return a.every((valeur, index) => valeur === b[index]);
}

/**
 * Interprétation pure, séparée des requêtes pour être testable sans base.
 * Aucune donnée n'est corrigée ici : on constate, on ne répare pas.
 */
export function interpreterSchemaSecurite(constats: ConstatsSchema): EtatSchemaSecurite {
  const problemes: ProblemeSchema[] = [];
  const parTable = new Map(constats.tables.map((t) => [t.tablename, t]));

  const tablesAbsentes = TABLES_PROTEGEES.filter((t) => !parTable.has(t));
  if (tablesAbsentes.length > 0) {
    problemes.push({
      code: "tables_metier_absentes",
      message: `${tablesAbsentes.length} table(s) métier absente(s) : ${tablesAbsentes.join(", ")}.`,
      details: { tables: tablesAbsentes },
    });
  }

  const tablesSansRls = TABLES_PROTEGEES.filter((t) => {
    const ligne = parTable.get(t);
    return ligne ? !ligne.rowsecurity || !ligne.forcerowsecurity : false;
  });
  if (tablesSansRls.length > 0) {
    problemes.push({
      code: "rls_non_forcee",
      message: `${tablesSansRls.length} table(s) sans RLS activée et forcée : ${tablesSansRls.join(", ")}.`,
      details: { tables: tablesSansRls },
    });
  }

  const politiquesParTable = new Map<string, string[]>();
  for (const ligne of constats.politiques) {
    const liste = politiquesParTable.get(ligne.tablename) ?? [];
    liste.push(ligne.policyname);
    politiquesParTable.set(ligne.tablename, liste);
  }

  const politiquesManquantes: Array<{ table: string; manquantes: string[] }> = [];
  const politiquesInattendues: Array<{ table: string; inattendues: string[] }> = [];
  for (const table of TABLES_PROTEGEES) {
    const quadruple = (TABLES_POLITIQUES_QUADRUPLE as readonly string[]).includes(table);
    const attendues = quadruple ? [...POLITIQUES_QUADRUPLE] : ["tenant_isolation"];
    const presentes = politiquesParTable.get(table) ?? [];
    const manquantes = attendues.filter((p) => !presentes.includes(p));
    const inattendues = presentes.filter((p) => !attendues.includes(p));
    if (manquantes.length > 0) politiquesManquantes.push({ table, manquantes });
    if (inattendues.length > 0) politiquesInattendues.push({ table, inattendues });
  }
  if (politiquesManquantes.length > 0) {
    problemes.push({
      code: "politiques_rls_incompletes",
      message:
        `${politiquesManquantes.reduce((n, p) => n + p.manquantes.length, 0)} politique(s) RLS ` +
        `manquante(s) sur ${politiquesManquantes.length} table(s) : ` +
        politiquesManquantes.map((p) => `${p.table} (${p.manquantes.join(", ")})`).join(" ; ") +
        ". Une post-migration interrompue produit exactement cet état.",
      details: { tables: politiquesManquantes },
    });
  }
  if (politiquesInattendues.length > 0) {
    // ⚠️ Une politique supplémentaire n'est pas anodine : elle peut élargir
    //   l'accès (par exemple `using (true)`). On refuse l'inconnu.
    problemes.push({
      code: "politiques_rls_inattendues",
      message:
        `${politiquesInattendues.length} table(s) portent des politiques RLS non prévues : ` +
        politiquesInattendues.map((p) => `${p.table} (${p.inattendues.join(", ")})`).join(" ; ") +
        ". Une politique ajoutée hors migration doit être auditée avant d'être servie.",
      details: { tables: politiquesInattendues },
    });
  }

  const signatures = constats.fonctions.map((f) => f.signature);
  const fonctionsAbsentes = FONCTIONS_AUTH.filter((f) => !signatures.includes(f));
  if (fonctionsAbsentes.length > 0) {
    problemes.push({
      code: "fonctions_auth_absentes",
      message: `Fonction(s) d'authentification absente(s) : ${fonctionsAbsentes.join(", ")}.`,
      details: { fonctions: fonctionsAbsentes },
    });
  }

  const nonDefiner = constats.fonctions.filter((f) => !f.security_definer).map((f) => f.signature);
  if (nonDefiner.length > 0) {
    problemes.push({
      code: "fonctions_auth_non_definer",
      message: `Fonction(s) d'authentification non SECURITY DEFINER : ${nonDefiner.join(", ")}.`,
    });
  }

  let executables: number | null = null;
  if (!constats.superutilisateur) {
    const fautives = constats.fonctions.filter((f) => f.executable).map((f) => f.signature);
    executables = fautives.length;
    if (fautives.length > 0) {
      problemes.push({
        code: "fonctions_auth_executables",
        message:
          `Le rôle applicatif « ${constats.role} » peut encore exécuter ` +
          `${fautives.join(", ")} : la révocation de 023 n'est pas appliquée.`,
        details: { fonctions: fautives },
      });
    }
  }

  if (!memeEnsemble(DECLENCHEURS_JOURNAL, constats.declencheurs)) {
    problemes.push({
      code: "declencheurs_journal_incomplets",
      message:
        `Déclencheurs du journal attendus [${DECLENCHEURS_JOURNAL.join(", ")}], ` +
        `trouvés [${constats.declencheurs.join(", ") || "aucun"}]. 020/021 ne sont pas appliqués.`,
      details: { attendus: [...DECLENCHEURS_JOURNAL], trouves: constats.declencheurs },
    });
  }

  if (!constats.indexCadence) {
    problemes.push({
      code: "index_cadence_absent",
      message: `Index unique de cadence « ${INDEX_CADENCE} » absent : 024 n'est pas appliqué.`,
    });
  }

  if (!constats.identite.contrainte) {
    problemes.push({
      code: "contrainte_identite_absente",
      message: `Contrainte « ${CONTRAINTE_IDENTITE} » absente : 025 (identité opérateur) n'est pas appliquée.`,
    });
  }

  const colonnesNotNull = COLONNES_IDENTITE.filter((colonne) => {
    if (colonne === "operator_name") return !constats.identite.name_nullable;
    if (colonne === "operator_eori") return !constats.identite.eori_nullable;
    return !constats.identite.country_nullable;
  });
  if (colonnesNotNull.length > 0) {
    problemes.push({
      code: "identite_operateur_non_nulle",
      message:
        `Colonne(s) d'identité opérateur encore NOT NULL : ${colonnesNotNull.join(", ")}. ` +
        "Une identité absente doit pouvoir rester absente, sans valeur fictive.",
    });
  }
  if (constats.identite.country_default) {
    problemes.push({
      code: "pays_operateur_par_defaut",
      message:
        "La colonne operator_country porte encore une valeur par défaut : un pays serait " +
        "inventé pour une identité non déclarée.",
    });
  }

  if (!constats.superutilisateur && constats.privileges) {
    if (constats.privileges.table_select) {
      problemes.push({
        code: "privilege_table_gf_users",
        message:
          "Le rôle applicatif détient SELECT sur toute la table gf_users : " +
          "password_hash, mfa_secret et mfa_recovery_codes sont exposés.",
      });
    }
    const colonnesSensibles = (
      [
        ["password_hash", constats.privileges.password_hash],
        ["mfa_secret", constats.privileges.mfa_secret],
        ["mfa_recovery_codes", constats.privileges.mfa_recovery_codes],
      ] as const
    )
      .filter(([, expose]) => expose)
      .map(([nom]) => nom);
    if (colonnesSensibles.length > 0) {
      problemes.push({
        code: "colonnes_sensibles_exposees",
        message: `Le rôle applicatif peut lire les colonnes sensibles : ${colonnesSensibles.join(", ")}.`,
        details: { colonnes: colonnesSensibles },
      });
    }
    if (!constats.privileges.email) {
      problemes.push({
        code: "colonnes_auth_non_lisibles",
        message:
          "Le rôle applicatif n'a plus SELECT sur gf_users.email : l'authentification ne peut pas fonctionner.",
      });
    }
  }

  return {
    ok: problemes.length === 0,
    role: constats.role,
    superutilisateur: constats.superutilisateur,
    problemes,
    mesures: {
      tablesProtegees: constats.tables.filter((t) => t.rowsecurity && t.forcerowsecurity).length,
      politiques: constats.politiques.length,
      fonctionsAuthExecutables: executables,
      declencheursJournal: constats.declencheurs.length,
      indexCadence: constats.indexCadence,
      contrainteIdentite: constats.identite.contrainte,
    },
  };
}

type PoolLike = Pick<Pool, "query">;

/** lit l'état réel du schéma — aucune écriture, aucune réparation. */
export async function verifierSchemaSecuriteAvec(base: PoolLike): Promise<EtatSchemaSecurite> {
  try {
    const { rows: roleRows } = await base.query<{ role: string; superutilisateur: boolean }>(
      `select current_user::text as role,
              (select rolsuper from pg_roles where rolname = current_user) as superutilisateur`,
    );
    const role = roleRows[0]?.role ?? "inconnu";
    const superutilisateur = Boolean(roleRows[0]?.superutilisateur);

    // `pg_tables` n'expose pas `forcerowsecurity` : l'information vit dans
    // `pg_class.relforcerowsecurity` (vérifié sur PostgreSQL 16.2).
    const { rows: tables } = await base.query<LigneTable>(
      `select c.relname::text as tablename,
              c.relrowsecurity as rowsecurity,
              c.relforcerowsecurity as forcerowsecurity
         from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relkind = 'r'
          and c.relname = any($1::text[])`,
      [[...TABLES_PROTEGEES]],
    );

    const { rows: politiques } = await base.query<LignePolitique>(
      `select tablename, policyname
         from pg_policies
        where schemaname = 'public'
          and tablename = any($1::text[])`,
      [[...TABLES_PROTEGEES]],
    );

    const { rows: fonctions } = await base.query<LigneFonction>(
      `select p.oid::regprocedure::text as signature,
              has_function_privilege(current_user, p.oid, 'EXECUTE') as executable,
              p.prosecdef as security_definer
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname in ('auth_user_by_email', 'auth_user_by_id')`,
    );

    const { rows: declencheurs } = await base.query<{ tgname: string }>(
      `select t.tgname
         from pg_trigger t
         join pg_class c on c.oid = t.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public'
          and c.relname = 'gf_audit_logs'
          and not t.tgisinternal
        order by t.tgname`,
    );

    const { rows: indexRows } = await base.query<{ present: boolean }>(
      `select exists (
         select 1 from pg_indexes
          where schemaname = 'public'
            and tablename = 'gf_login_attempts'
            and indexname = $1
       ) as present`,
      [INDEX_CADENCE],
    );

    const { rows: identiteRows } = await base.query<LigneIdentite>(
      `select
         exists (
           select 1 from pg_constraint
            where conname = $1
              and conrelid = to_regclass('public.parcel_audits')
         ) as contrainte,
         coalesce((select not a.attnotnull from pg_attribute a
                    where a.attrelid = to_regclass('public.parcel_audits')
                      and a.attname = 'operator_name'), false) as name_nullable,
         coalesce((select not a.attnotnull from pg_attribute a
                    where a.attrelid = to_regclass('public.parcel_audits')
                      and a.attname = 'operator_eori'), false) as eori_nullable,
         coalesce((select not a.attnotnull from pg_attribute a
                    where a.attrelid = to_regclass('public.parcel_audits')
                      and a.attname = 'operator_country'), false) as country_nullable,
         coalesce((
           select exists (
             select 1 from pg_attrdef d
              join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
             where d.adrelid = to_regclass('public.parcel_audits')
               and a.attname = 'operator_country'
           )
         ), false) as country_default`,
      [CONTRAINTE_IDENTITE],
    );

    let privileges: LignePrivileges | null = null;
    if (!superutilisateur) {
      try {
        const { rows } = await base.query<LignePrivileges>(
          `select
             has_table_privilege(current_user, 'public.gf_users', 'SELECT') as table_select,
             has_column_privilege(current_user, 'public.gf_users', 'password_hash', 'SELECT') as password_hash,
             has_column_privilege(current_user, 'public.gf_users', 'mfa_secret', 'SELECT') as mfa_secret,
             has_column_privilege(current_user, 'public.gf_users', 'mfa_recovery_codes', 'SELECT') as mfa_recovery_codes,
             has_column_privilege(current_user, 'public.gf_users', 'email', 'SELECT') as email`,
        );
        privileges = rows[0] ?? null;
      } catch {
        // Table absente : les problèmes structurels sont déjà rapportés.
        privileges = null;
      }
    }

    return interpreterSchemaSecurite({
      role,
      superutilisateur,
      tables,
      politiques,
      fonctions,
      declencheurs: declencheurs.map((d) => d.tgname),
      indexCadence: Boolean(indexRows[0]?.present),
      identite: identiteRows[0] ?? {
        contrainte: false,
        name_nullable: false,
        eori_nullable: false,
        country_nullable: false,
        country_default: false,
      },
      privileges,
    });
  } catch (erreur) {
    return {
      ok: false,
      role: "inconnu",
      superutilisateur: false,
      problemes: [
        {
          code: "schema_illisible",
          // ⚠️ Aucun message brut : il contient l'hôte, le port et parfois la
          // chaîne de connexion. Seul le code SQLSTATE est conservé — il est
          // stable, non sensible, et suffit au diagnostic.
          message:
            "L'état de sécurité du schéma n'a pas pu être lu : base injoignable " +
            "ou catalogue inaccessible. Le service refuse de servir sans preuve.",
          details: /^[0-9A-Z]{5}$/.test(String((erreur as { code?: unknown })?.code ?? ""))
            ? { code: String((erreur as { code?: unknown }).code) }
            : undefined,
        },
      ],
      mesures: {
        tablesProtegees: 0,
        politiques: 0,
        fonctionsAuthExecutables: null,
        declencheursJournal: 0,
        indexCadence: false,
        contrainteIdentite: false,
      },
    };
  }
}

export class SchemaSecuriteIncompletError extends Error {
  constructor(readonly etat: EtatSchemaSecurite) {
    super(
      "Schéma de sécurité incomplet : le service refuse de servir du trafic applicatif. " +
        etat.problemes.map((p) => p.message).join(" "),
    );
    this.name = "SchemaSecuriteIncompletError";
  }
}

let cache: { quand: number; etat: EtatSchemaSecurite } | null = null;
let enCours: Promise<EtatSchemaSecurite> | null = null;

/** Réservé aux tests : oublie le cache mémoire du processus. */
export function reinitialiserEtatSchema(): void {
  cache = null;
  enCours = null;
}

/**
 * Vérifie l'état du schéma, avec un cache court (10 s par défaut).
 *
 * Le cache évite une requête de catalogue à chaque appel de route. Il est
 * volontairement **court** : une dégradation du schéma en cours de vie du
 * processus doit être détectée sans redémarrage. `GF_SCHEMA_TTL_MS=0` force
 * une relecture à chaque appel (utilisé par les tests).
 */
export async function exigerSchemaPret(options: {
  force?: boolean;
  ttlMs?: number;
  pool?: PoolLike;
} = {}): Promise<EtatSchemaSecurite> {
  const ttl = options.ttlMs ?? Number(process.env.GF_SCHEMA_TTL_MS ?? "10000");

  if (options.pool) {
    const etat = await verifierSchemaSecuriteAvec(options.pool);
    if (!etat.ok) throw new SchemaSecuriteIncompletError(etat);
    return etat;
  }

  const maintenant = Date.now();
  if (!options.force && cache && maintenant - cache.quand <= ttl) {
    if (!cache.etat.ok) throw new SchemaSecuriteIncompletError(cache.etat);
    return cache.etat;
  }

  if (!enCours) {
    enCours = (async () => {
      const { pool } = await import("./index");
      return verifierSchemaSecuriteAvec(pool);
    })().finally(() => {
      enCours = null;
    });
  }

  const etat = await enCours;
  cache = { quand: Date.now(), etat };
  if (!etat.ok) throw new SchemaSecuriteIncompletError(etat);
  return etat;
}
