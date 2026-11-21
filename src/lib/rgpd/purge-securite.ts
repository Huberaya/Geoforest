/**
 * Logique et garde-fous de la purge des données personnelles de sécurité
 * (`gf_sessions.ip`, `gf_sessions.user_agent`, `gf_login_attempts`).
 *
 * Ce module ne touche JAMAIS aux données métier EUDR (parcelles, dossiers DDR,
 * analyses, documents, journal d'audit), soumises à une obligation légale de
 * conservation de 5 ans (art. 12 du règlement UE 2023/1115 / art. 17.3.b RGPD).
 */

/** Au-delà de cette ancienneté, une session expirée n'a plus d'usage de sécurité. */
export const JOURS_CONSERVATION_SESSION = 90;

/** Fenêtre de limitation de débit : quelques heures suffisent, on garde une marge. */
export const JOURS_CONSERVATION_TENTATIVES = 7;

export interface RequeteSqlPurge {
  query<T = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount?: number | null }>;
}

export interface ResultatGardePurge {
  autorise: boolean;
  raisons: string[];
  url: string | null;
  estJetable: boolean;
}

export interface RapportPurgeSecurite {
  essai: boolean;
  dateReference: string;
  joursSession: number;
  joursTentatives: number;
  sessionsEligibles: number;
  tentativesEligibles: number;
  sessionsAnonymisees: number;
  tentativesSupprimees: number;
}

/**
 * Vérifie les préconditions de sécurité avant toute exécution de purge.
 *
 * - En production (`NODE_ENV=production`), la purge CLI est refusée par défaut
 *   (elle doit être lancée depuis un poste opérateur ou le workflow planifié
 *   dedie, hors runtime applicatif).
 * - Une base non déclarée jetable exige `DATABASE_URL_ADMIN` explicite (le rôle
 *   applicatif `geoforest_app` n'a aucun privilège sur `gf_sessions` ni
 *   `gf_login_attempts` depuis 026) et la confirmation datée du jour
 *   `GF_PURGE_CONFIRMEE=YYYY-MM-DD`.
 */
export function evaluerGardePurge(
  env: Record<string, string | undefined>,
  aujourdhui: string,
): ResultatGardePurge {
  const raisons: string[] = [];
  const estJetable = (env.GF_BASE_JETABLE ?? "").toLowerCase() === "oui";
  const urlAdmin = env.DATABASE_URL_ADMIN?.trim() || null;
  const urlFallback = estJetable ? env.DATABASE_URL?.trim() || null : null;
  const url = urlAdmin ?? urlFallback;

  if (env.NODE_ENV === "production") {
    raisons.push(
      "NODE_ENV=production : une purge ne s'exécute pas depuis un environnement de production.",
    );
  }

  if (!url) {
    raisons.push(
      estJetable
        ? "DATABASE_URL_ADMIN (ou DATABASE_URL en base jetable) n'est pas défini."
        : "DATABASE_URL_ADMIN est requis pour purger une base réelle (le rôle applicatif n'accède pas aux tables de sécurité).",
    );
  }

  const confirmee = env.GF_PURGE_CONFIRMEE === aujourdhui;
  if (!estJetable && !confirmee) {
    raisons.push("base non déclarée jetable.");
    raisons.push(
      `Pour purger une base réelle, fournir GF_PURGE_CONFIRMEE=${aujourdhui} (la date du jour, pour que la confirmation soit un geste et non une variable oubliée).`,
    );
    raisons.push("Lancer d'abord avec --essai pour compter sans effacer.");
  }

  return {
    autorise: raisons.length === 0,
    raisons,
    url,
    estJetable,
  };
}

/**
 * Exécute (ou simule avec `essai: true`) la purge des traces de sécurité :
 *  - anonymise `ip` et `user_agent` (`NULL`) des sessions expirées > 90 jours
 *    en conservant les lignes (nécessaires à la détection de réutilisation de
 *    famille de jetons) ;
 *  - supprime les lignes de `gf_login_attempts` de plus de 7 jours.
 */
export async function executerPurgeSecurite(
  client: RequeteSqlPurge,
  options: { essai: boolean; dateReference?: string },
): Promise<RapportPurgeSecurite> {
  const dateReference = options.dateReference ?? new Date().toISOString().slice(0, 10);

  const sessions = await client.query<{ n: string }>(
    `select count(*)::text as n from gf_sessions
      where expires_at < now() - ($1 || ' days')::interval
        and (ip is not null or user_agent is not null)`,
    [String(JOURS_CONSERVATION_SESSION)],
  );
  const sessionsEligibles = Number(sessions.rows[0]?.n ?? 0);

  const tentatives = await client.query<{ n: string }>(
    `select count(*)::text as n from gf_login_attempts
      where last_attempt_at < now() - ($1 || ' days')::interval`,
    [String(JOURS_CONSERVATION_TENTATIVES)],
  );
  const tentativesEligibles = Number(tentatives.rows[0]?.n ?? 0);

  if (options.essai) {
    return {
      essai: true,
      dateReference,
      joursSession: JOURS_CONSERVATION_SESSION,
      joursTentatives: JOURS_CONSERVATION_TENTATIVES,
      sessionsEligibles,
      tentativesEligibles,
      sessionsAnonymisees: 0,
      tentativesSupprimees: 0,
    };
  }

  const effacees = await client.query(
    `update gf_sessions set ip = null, user_agent = null
      where expires_at < now() - ($1 || ' days')::interval
        and (ip is not null or user_agent is not null)`,
    [String(JOURS_CONSERVATION_SESSION)],
  );
  const supprimees = await client.query(
    `delete from gf_login_attempts
      where last_attempt_at < now() - ($1 || ' days')::interval`,
    [String(JOURS_CONSERVATION_TENTATIVES)],
  );

  return {
    essai: false,
    dateReference,
    joursSession: JOURS_CONSERVATION_SESSION,
    joursTentatives: JOURS_CONSERVATION_TENTATIVES,
    sessionsEligibles,
    tentativesEligibles,
    sessionsAnonymisees: effacees.rowCount ?? 0,
    tentativesSupprimees: supprimees.rowCount ?? 0,
  };
}
