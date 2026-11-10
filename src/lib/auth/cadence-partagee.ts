/**
 * Fenêtre de limitation **partagée**, portée par la base.
 *
 * ⚠️ Pourquoi ce module existe, alors qu'un limiteur en mémoire est déjà là.
 *
 *   `src/lib/rate-limit.ts` compte dans la mémoire du processus. C'est un
 *   Rideau correct contre une rafale sur une instance, et **faux** dès qu'il y
 *   en a plusieurs : chaque instance repart de zéro, et l'attaquant répartit
 *   ses essais. Un déploiement horizontal transforme donc silencieusement une
 *   limite en décoration.
 *
 *   Les protections qui comptent réellement pour l'authentification — verrou
 *   de compte, fenêtre de connexion — sont déjà en base. Ce module généralise
 *   ce principe aux étapes qui n'en avaient pas : renouvellement de session,
 *   changement de mot de passe, validation du second facteur. Le compteur est
 *   alors commun à toutes les instances, et survit à un redémarrage.
 *
 * ⚠️ Ce que ce module n'est pas : une limite globale de trafic. Compter chaque
 *   requête HTTP en base coûterait un aller-retour par requête, pour un
 *   bénéfice nul sur le déni de service (la base devient le goulot). Les
 *   quotas généraux par organisation et par adresse restent donc dans le
 *   proxy, en mémoire, avec la limite documentée.
 *
 * ⚠️ Atomicité : la consommation est **une seule instruction**
 *   (`insert … on conflict (window_key) do update … returning`). PostgreSQL
 *   sérialise les écritures sur la ligne, donc deux requêtes simultanées ne
 *   peuvent pas lire le même compteur et écrire la même valeur. Cette forme
 *   évite aussi une transaction interactive : sur un serveur qui ne sert
 *   qu'une connexion à la fois (le banc d'essai PGlite), une transaction
 *   ouverte par une connexion immobilise les autres.
 *
 *   L'unicité de `window_key` est apportée par
 *   `scripts/sql/post-migrate/024_cadence_cle_unique.sql`.
 *
 * Le module ne dépend ni de `next/headers`, ni de `server-only` : il est
 * testable contre une base réelle.
 */
import { sql, type SQL } from "drizzle-orm";

/** Surface minimale attendue : un client Drizzle capable d'exécuter une requête. */
export interface BaseSql {
  execute(query: SQL): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface Consommation {
  autorise: boolean;
  /** Essais restants dans la fenêtre courante (0 quand la limite est atteinte). */
  restant: number;
  /** Secondes à attendre avant de réessayer ; 0 quand l'appel est autorisé. */
  reessayerDans: number;
  /** Nombre d'essais consommés dans la fenêtre, celui-ci compris. */
  essais: number;
}

export interface OptionsFenetre {
  /** Clé de compartiment : elle doit inclure ce que l'on veut isoler. */
  cle: string;
  /**
   * Rang du premier refus : le `max`-ième essai de la fenêtre est refusé.
   * (Sémantique historique de `registerLoginFailure`, conservée à l'identique.)
   */
  max: number;
  /** Durée de la fenêtre, en secondes. */
  fenetreSecondes: number;
}

interface LigneFenetre {
  attempts: number;
  first_attempt_at: string | Date;
  dernier: string | Date;
}

function enDate(valeur: unknown): Date {
  if (valeur instanceof Date) return valeur;
  if (typeof valeur === "string" || typeof valeur === "number") return new Date(valeur);
  return new Date(0);
}

function enNombre(valeur: unknown): number {
  const n = typeof valeur === "number" ? valeur : Number(valeur ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Consomme un essai dans la fenêtre `cle`.
 *
 * Le décompte est **partagé** : deux instances, deux processus, deux
 * redémarrages, le même compteur. Une fenêtre expirée est reprise à zéro.
 */
export async function consommerFenetre(
  base: BaseSql,
  options: OptionsFenetre,
): Promise<Consommation> {
  const { cle, max, fenetreSecondes } = options;
  if (!Number.isInteger(max) || max < 1) throw new Error("max doit être un entier ≥ 1");
  if (!Number.isFinite(fenetreSecondes) || fenetreSecondes < 1) {
    throw new Error("fenetreSecondes doit être ≥ 1");
  }

  const intervalle = sql.raw(`interval '${Math.floor(fenetreSecondes)} seconds'`);

  // ⚠️ Une seule instruction : l'incrément, la reprise de fenêtre expirée et la
  //   valeur retournée sont décidés par PostgreSQL, sur la ligne verrouillée
  //   par `on conflict`. Aucun aller-retour intermédiaire, donc aucune fenêtre
  //   pendant laquelle deux appels liraient le même compteur.
  const resultat = await base.execute(sql`
    insert into gf_login_attempts (window_key, attempts, first_attempt_at, last_attempt_at)
    values (${cle}, 1, now(), now())
    on conflict (window_key) do update
       set attempts = case
             when gf_login_attempts.last_attempt_at > now() - ${intervalle}
               then gf_login_attempts.attempts + 1
             else 1
           end,
           first_attempt_at = case
             when gf_login_attempts.last_attempt_at > now() - ${intervalle}
               then gf_login_attempts.first_attempt_at
             else now()
           end,
           last_attempt_at = now()
    returning attempts, first_attempt_at, last_attempt_at
  `);

  const ligne = resultat.rows[0] as unknown as LigneFenetre | undefined;
  if (!ligne) throw new Error("La fenêtre de cadence n'a pas été enregistrée.");

  const essais = enNombre(ligne.attempts);
  if (essais >= max) {
    const fin = enDate(ligne.first_attempt_at).getTime() + fenetreSecondes * 1000;
    const reessayerDans = Math.max(1, Math.ceil((fin - Date.now()) / 1000));
    return { autorise: false, restant: 0, reessayerDans, essais };
  }

  return { autorise: true, restant: Math.max(0, max - essais), reessayerDans: 0, essais };
}

/** Remet un compartiment à zéro — après une authentification réussie. */
export async function reinitialiserFenetre(base: BaseSql, cle: string): Promise<void> {
  await base.execute(sql`
    update gf_login_attempts
       set attempts = 0, first_attempt_at = now(), last_attempt_at = now()
     where window_key = ${cle}
  `);
}

/** Clés normalisées : un seul endroit qui décide de ce qu'on isole. */
export const clesCadence = {
  connexion: (ip: string | null, email: string) => `${ip ?? "inconnue"}|${email.trim().toLowerCase()}`,
  renouvellement: (ip: string | null) => `refresh|${ip ?? "inconnue"}`,
  secondFacteur: (ip: string | null) => `mfa|${ip ?? "inconnue"}`,
  motDePasse: (utilisateurId: string) => `password|${utilisateurId}`,
} as const;
