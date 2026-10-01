import "server-only";

import { statfsSync } from "node:fs";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { sql } from "drizzle-orm";

import { db } from "@/db";
import { journal } from "@/lib/observability/journal";
import { fenetre, lireJauges, noterJauges, resumeRoutes } from "@/lib/observability/metriques";
import type { Alerte, Gravite } from "./types";

/**
 * Règles d'alerte.
 *
 * ⚠️ P1-06 — ce qui est mesuré, et comment.
 *
 * Chaque règle produit une **valeur chiffrée** et un **seuil**. Aucune ne se
 * contente de « ça ne marche pas » : lorsqu'une astreinte reçoit une alerte à
 * trois heures du matin, la première question est « depuis quand et à combien ».
 * Une règle qui ne sait pas répondre fait perdre du temps au pire moment.
 *
 * Les seuils sont lisibles et modifiables par variables d'environnement : une
 * valeur enfouie dans le code finit par être prise pour une vérité, alors
 * qu'elle n'est qu'un choix d'exploitation.
 */

function nombre(nom: string, defaut: number): number {
  const brut = Number(process.env[nom]);
  return Number.isFinite(brut) && brut > 0 ? brut : defaut;
}

export const SEUILS = {
  /** Taux d'erreurs 5xx déclenchant une alerte (0,02 = 2 %). */
  TAUX_5XX: nombre("GF_ALERT_TAUX_5XX", 2) / 100,
  /** Trafic minimal pour juger un taux d'erreur : 2 % sur 2 requêtes ne veut rien dire. */
  TRAFIC_MINIMAL: nombre("GF_ALERT_TRAFIC_MIN", 10),
  /** Fenêtre de calcul du taux d'erreur, en minutes. */
  FENETRE_MINUTES: nombre("GF_ALERT_FENETRE_MIN", 5),
  /** Latence p95 au-delà de laquelle une route est jugée dégradée, en ms. */
  LATENCE_P95_MS: nombre("GF_ALERT_LATENCE_P95_MS", 2000),
  /** Occupation disque déclenchant une alerte, en pourcentage (valeur par défaut). */
  DISQUE_POURCENT: nombre("GF_ALERT_DISQUE_POURCENT", 80),
  /** Ancienneté maximale de la dernière sauvegarde, en heures. */
  SAUVEGARDE_HEURES: nombre("GF_ALERT_SAUVEGARDE_H", 25),
} as const;

/**
 * Seuil d'occupation disque, lu **à chaque appel**.
 *
 * ⚠️ Un seuil figé au chargement du module ne peut plus être ajusté sans
 *   redémarrer : l'exploitant qui veut resserrer une règle pendant un incident
 *   devrait relancer le service, c'est-à-dire aggraver la situation qu'il
 *   cherche à surveiller. Les seuils sont donc relus.
 */
export function seuilDisque(): number {
  return nombre("GF_ALERT_DISQUE_POURCENT", SEUILS.DISQUE_POURCENT);
}

export type EtatComposant = "ok" | "degrade" | "indisponible" | "non_configure";

export interface Composant {
  nom: string;
  etat: EtatComposant;
  detail: string;
  mesure: Record<string, number | string | boolean | null>;
  dureeMs: number | null;
}

async function chronometrer<T>(fn: () => Promise<T>): Promise<[T | null, number, unknown]> {
  const debut = Date.now();
  try {
    return [await fn(), Date.now() - debut, null];
  } catch (error) {
    return [null, Date.now() - debut, error];
  }
}

function detailErreur(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 200);
  return String(error).slice(0, 200);
}

/** Sonde la base : une requête triviale suffit à savoir si on peut écrire. */
export async function sonderBase(): Promise<Composant> {
  const [_r, duree, erreur] = await chronometrer(async () => {
    await db.execute(sql`select 1`);
    return true;
  });
  const ok = erreur === null;
  noterJauges("base", ok ? 1 : 0);
  return {
    nom: "base",
    etat: ok ? "ok" : "indisponible",
    detail: ok ? "Requête « select 1 » exécutée" : `Base injoignable : ${detailErreur(erreur)}`,
    mesure: { disponible: ok, latenceMs: duree },
    dureeMs: duree,
  };
}

/**
 * Sonde l'espace disque.
 *
 * ⚠️ Le disque qui compte est celui du **répertoire de travail de
 * l'application**, pas la racine : un conteneur peut monter un volume dédié
 * sur `/var/lib/…` et laisser la racine à 30 %. Mesurer le mauvais point de
 * montage donnerait une alerte verte sur un système plein.
 */
export function sonderDisque(chemin?: string): Composant {
  const cible = resolve(chemin ?? process.env.GF_DISK_PATH ?? process.cwd());
  try {
    const fs = statfsSync(cible);
    const total = fs.blocks * fs.bsize;
    const libre = fs.bavail * fs.bsize;
    const utilise = total - libre;
    const pourcent = total > 0 ? Math.round((utilise / total) * 10_000) / 100 : 0;
    const seuil = seuilDisque();
    noterJauges("disque_pourcent", pourcent);
    return {
      nom: "disque",
      etat: pourcent >= seuil ? "degrade" : "ok",
      detail: `${pourcent} % occupé sur ${cible}`,
      mesure: {
        pourcent,
        seuil,
        libreOctets: libre,
        totalOctets: total,
        chemin: cible,
      },
      dureeMs: null,
    };
  } catch (error) {
    return {
      nom: "disque",
      etat: "indisponible",
      detail: `Occupation disque illisible sur ${cible} : ${detailErreur(error)}`,
      mesure: { chemin: cible },
      dureeMs: null,
    };
  }
}

/**
 * Sonde le support de stockage des pièces par un aller-retour réel.
 *
 * ⚠️ Une sonde qui se contente de regarder si le répertoire existe mentirait :
 *   le cas qui compte est celui où l'écriture échoue (disque plein, permissions
 *   retirées, compartiment révoqué). On écrit donc, on relit, on compare, on
 *   efface — comme le fait le dépôt, en plus petit.
 */
export async function sonderStockage(): Promise<Composant> {
  const debut = Date.now();
  try {
    const { stockageCourant, stockageValide } = await import("@/lib/storage");
    const stockage = stockageCourant();
    const sonde = new TextEncoder().encode(`sonde-${Date.now()}`);
    const objet = await stockage.ecrire("00000000-0000-0000-0000-000000000000", sonde, "txt");
    const relu = await stockage.lire(objet.cle);
    await stockage.supprimer(objet.cle);
    const conforme =
      relu !== null && Buffer.from(relu).toString("base64") === Buffer.from(sonde).toString("base64");
    noterJauges("stockage", conforme ? 1 : 0);
    return {
      nom: "stockage",
      etat: conforme ? "ok" : "indisponible",
      detail: conforme
        ? `Aller-retour vérifié sur « ${stockage.nom} »`
        : `Aller-retour incohérent sur « ${stockage.nom} » : le contenu relu diffère`,
      mesure: { disponible: conforme, support: stockage.nom, supportValide: stockageValide() },
      dureeMs: Date.now() - debut,
    };
  } catch (error) {
    noterJauges("stockage", 0);
    return {
      nom: "stockage",
      etat: "indisponible",
      detail: `Support des pièces inutilisable : ${detailErreur(error)}`,
      mesure: { disponible: false },
      dureeMs: Date.now() - debut,
    };
  }
}

/**
 * Sonde la fraîcheur des sauvegardes.
 *
 * ⚠️ L'absence de configuration n'est PAS une bonne nouvelle. Une sauvegarde
 *   absente et une sauvegarde non configurée produisent le même résultat
 *   opérationnel — aucune restauration possible — mais pas le même message :
 *   dire « sauvegarde absente » là où rien n'a jamais été configuré laisserait
 *   croire qu'un dispositif existe et qu'il est tombé en panne.
 */
export function sonderSauvegarde(): Composant {
  const dossier = process.env.GF_BACKUP_DIR?.trim();
  if (!dossier) {
    return {
      nom: "sauvegarde",
      etat: "non_configure",
      detail:
        "Aucun répertoire de sauvegarde déclaré (GF_BACKUP_DIR) : aucune restauration n'est possible, et rien ne surveille cette absence.",
      mesure: { configure: false, seuilHeures: SEUILS.SAUVEGARDE_HEURES },
      dureeMs: null,
    };
  }
  try {
    if (!existsSync(dossier)) {
      return {
        nom: "sauvegarde",
        etat: "indisponible",
        detail: `Répertoire de sauvegarde déclaré mais absent : ${dossier}`,
        mesure: { configure: true, existe: false },
        dureeMs: null,
      };
    }
    let plusRecent = 0;
    let nom = "";
    for (const entree of readdirSync(dossier)) {
      const p = join(dossier, entree);
      const m = statSync(p).mtimeMs;
      if (m > plusRecent) {
        plusRecent = m;
        nom = entree;
      }
    }
    if (plusRecent === 0) {
      return {
        nom: "sauvegarde",
        etat: "indisponible",
        detail: `Répertoire de sauvegarde vide : ${dossier}`,
        mesure: { configure: true, existe: true, fichiers: 0 },
        dureeMs: null,
      };
    }
    const ageHeures = Math.round(((Date.now() - plusRecent) / 3_600_000) * 100) / 100;
    noterJauges("sauvegarde_age_heures", ageHeures);
    return {
      nom: "sauvegarde",
      etat: ageHeures > SEUILS.SAUVEGARDE_HEURES ? "degrade" : "ok",
      detail:
        ageHeures > SEUILS.SAUVEGARDE_HEURES
          ? `Dernière sauvegarde vieille de ${ageHeures} h (seuil ${SEUILS.SAUVEGARDE_HEURES} h) : ${nom}`
          : `Dernière sauvegarde il y a ${ageHeures} h : ${nom}`,
      mesure: { configure: true, ageHeures, seuilHeures: SEUILS.SAUVEGARDE_HEURES, fichier: nom },
      dureeMs: null,
    };
  } catch (error) {
    return {
      nom: "sauvegarde",
      etat: "indisponible",
      detail: `Lecture du répertoire de sauvegarde impossible : ${detailErreur(error)}`,
      mesure: { configure: true },
      dureeMs: null,
    };
  }
}

/**
 * Sonde le fournisseur satellite.
 *
 * ⚠️ L'état vient des **jauges renseignées par l'appelant réel**
 * (`satellite-checker`), pas d'une supposition : sonder Global Forest Watch
 * pour rien consommerait du quota et pourrait produire une alerte sur une
 * panne que personne n'a cherché à déclencher. Sans appel enregistré, l'état
 * est donc « non_configuré » — ce qui est déjà une information à remonter.
 */
export function sonderGfw(): Composant {
  const jauges = lireJauges();
  const appels = jauges["gfw_appels"];
  if (!appels || appels.valeur === 0) {
    return {
      nom: "gfw",
      etat: "non_configure",
      detail:
        "Aucun appel au fournisseur satellite enregistré depuis le démarrage : sa disponibilité n'est pas mesurée.",
      mesure: { appels: 0 },
      dureeMs: null,
    };
  }
  const echecs = jeValeur("gfw_echecs");
  const dernier = jeValeur("gfw_disponible");
  const tauxEchec = Math.round((echecs / Math.max(1, appels.valeur)) * 10_000) / 100;
  return {
    nom: "gfw",
    etat: dernier === 0 ? "indisponible" : tauxEchec > 50 ? "degrade" : "ok",
    detail:
      dernier === 0
        ? `Dernier appel au fournisseur satellite en échec (${echecs} échec(s) sur ${appels.valeur})`
        : `${appels.valeur} appel(s), ${echecs} échec(s) — ${tauxEchec} %`,
    mesure: { appels: appels.valeur, echecs, tauxEchec, disponible: dernier === 1 },
    dureeMs: null,
  };
}

function jeValeur(nom: string): number {
  return lireJauges()[nom]?.valeur ?? 0;
}

/** Sonde l'API elle-même, à partir des mesures de requêtes. */
export function sonderApi(): Composant {
  const resume = resumeRoutes();
  let requetes = 0;
  let echecs5xx = 0;
  let p95Max = 0;
  for (const r of resume) {
    requetes += r.requetes;
    echecs5xx += r.echecs5xx;
    if (r.p95Ms !== null && r.p95Ms > p95Max) p95Max = r.p95Ms;
  }
  const taux = requetes > 0 ? Math.round((echecs5xx / requetes) * 10_000) / 100 : 0;
  const degrade = taux >= SEUILS.TAUX_5XX * 100 || p95Max >= SEUILS.LATENCE_P95_MS;
  return {
    nom: "api",
    etat: degrade ? "degrade" : "ok",
    detail: degrade
      ? `${taux} % d'erreurs 5xx et p95 maximal de ${p95Max} ms`
      : `${requetes} requête(s), ${taux} % d'erreurs 5xx, p95 maximal ${p95Max} ms`,
    mesure: { requetes, echecs5xx, taux5xx: taux, p95MaxMs: p95Max, seuilTaux: SEUILS.TAUX_5XX * 100 },
    dureeMs: null,
  };
}

/** Interroge tous les composants. */
export async function sonderTout(): Promise<Composant[]> {
  return Promise.all([sonderBase(), sonderStockage()]).then(([base, stockage]) => [
    base,
    stockage,
    sonderDisque(),
    sonderSauvegarde(),
    sonderGfw(),
    sonderApi(),
  ]);
}

// ------------------------------------------------------------------ évaluation

interface Etat {
  etat: "déclenchée" | "résolue";
  ts: number;
}

const etats = new Map<string, Etat>();

/** Réinitialise la déduplication (bancs d'essai). */
export function reinitialiserEtats(): void {
  etats.clear();
}

function cooldownMs(): number {
  return nombre("GF_ALERT_COOLDOWN_S", 900) * 1000;
}

/**
 * Décide ce qu'il faut envoyer.
 *
 * ⚠️ Deux garde-fous, sans lesquels un système d'alerte devient un système de
 *   bruit — et le bruit est la manière la plus sûre de faire rater une alerte
 *   réelle :
 *
 *   · **déduplication** — une alerte déjà déclenchée n'est pas renvoyée avant
 *     la fin de son délai de garde ;
 *   · **résolution explicite** — le retour à la normale est annoncé. Sans lui,
 *     une astreinte ne sait jamais si elle peut cesser d'intervenir.
 */
export async function evaluer(): Promise<{ aEnvoyer: Alerte[]; deja: number }> {
  const maintenant = Date.now();
  const candidats: Alerte[] = [];

  // ⚠️ La base et le stockage sont **sondés ici**, pas lus dans une jauge
  //   posée par `/api/health`. Une évaluation qui dépendrait d'une sonde
  //   extérieure passerait à côté de la panne si cette sonde n'était pas
  //   passée par là — et une alerte qui ne se déclenche que si quelqu'un a
  //   d'abord regardé n'est pas une alerte.
  const [baseSon, stockageSon] = await Promise.all([sonderBase(), sonderStockage()]);
  const composants = [sonderDisque(), sonderSauvegarde(), sonderGfw(), sonderApi()];
  const alerteBase = regle("base_injoignable", baseSon.etat !== "ok", {
      gravite: "critique",
      composant: "base",
      titre: "Base de données injoignable",
      message:
        "La base ne répond pas : aucune lecture ni écriture ne peut aboutir, et le service ne peut plus tenir sa promesse de persistance.",
      action:
        "Vérifier le serveur PostgreSQL, l'espace disque et les connexions ; l'instance doit être retirée du pool d'équilibrage en attendant.",
      mesures: { disponible: baseSon.etat === "ok", latenceMs: baseSon.dureeMs },
    });
  const alerteStockage = regle("stockage_inutilisable", stockageSon.etat !== "ok", {
      gravite: "critique",
      composant: "stockage",
      titre: "Support des pièces inutilisable",
      message:
        "L'aller-retour d'écriture sur le support des pièces échoue : les dépôts de documents ne peuvent pas être honorés.",
      action: "Vérifier les permissions, l'espace disque et les identifiants du compartiment objet.",
      mesures: { disponible: stockageSon.etat === "ok", latenceMs: stockageSon.dureeMs },
    });
  for (const a of [alerteBase, alerteStockage]) if (a) candidats.push(a);

  for (const c of composants) {
    if (c.nom === "disque" && c.etat === "degrade") {
      candidats.push(
        alerte("disque_sature", {
          gravite: "majeure",
          composant: "disque",
          titre: "Espace disque saturé",
          message: c.detail,
          action: "Purger les journaux et les pièces obsolètes, puis agrandir le volume.",
          mesures: c.mesure,
        }),
      );
    }
    if (c.nom === "sauvegarde" && (c.etat === "degrade" || c.etat === "indisponible" || c.etat === "non_configure")) {
      candidats.push(
        alerte("sauvegarde_absente", {
          gravite: c.etat === "non_configure" ? "mineure" : "majeure",
          composant: "sauvegarde",
          titre:
            c.etat === "non_configure"
              ? "Aucune sauvegarde configurée"
              : "Sauvegarde absente ou trop ancienne",
          message: c.detail,
          action:
            c.etat === "non_configure"
              ? "Déclarer GF_BACKUP_DIR et planifier un pg_dump ; vérifier une restauration complète."
              : "Relancer la sauvegarde et vérifier une restauration : une sauvegarde jamais restaurée n'est pas une sauvegarde.",
          mesures: c.mesure,
        }),
      );
    }
    if (c.nom === "gfw" && (c.etat === "indisponible" || c.etat === "degrade")) {
      candidats.push(
        alerte("gfw_indisponible", {
          gravite: "majeure",
          composant: "gfw",
          titre: "Fournisseur satellite défaillant",
          message: c.detail,
          action:
            "Vérifier la clé d'API, le quota et l'état du service. Le produit doit refuser d'émettre un verdict plutôt que de le simuler.",
          mesures: c.mesure,
        }),
      );
    }
  }

  // Taux d'erreurs 5xx par route, sur la fenêtre glissante.
  for (const r of resumeRoutes()) {
    const f = fenetre(r.route, SEUILS.FENETRE_MINUTES);
    if (f.total < SEUILS.TRAFIC_MINIMAL) continue;
    const taux = f.echecs5xx / f.total;
    if (taux < SEUILS.TAUX_5XX) continue;
    candidats.push(
      alerte(`taux_5xx:${r.route}`, {
        gravite: "critique",
        composant: "api",
        titre: "Taux d'erreurs serveur anormal",
        message: `${Math.round(taux * 10_000) / 100} % de 5xx sur ${r.route} (${f.echecs5xx} sur ${f.total} requêtes, ${SEUILS.FENETRE_MINUTES} min).`,
        action: "Consulter le journal applicatif filtré sur cette route, puis la dernière erreur consignée.",
        mesures: {
          route: r.route,
          requetes: f.total,
          echecs5xx: f.echecs5xx,
          taux: Math.round(taux * 10_000) / 100,
          seuil: SEUILS.TAUX_5XX * 100,
        },
      }),
    );
  }

  // Latence : une route lente est un incident avant d'être une panne.
  for (const r of resumeRoutes()) {
    if (r.p95Ms === null || r.p95Ms < SEUILS.LATENCE_P95_MS) continue;
    candidats.push(
      alerte(`latence:${r.route}`, {
        gravite: "mineure",
        composant: "api",
        titre: "Route anormalement lente",
        message: `p95 de ${r.p95Ms} ms sur ${r.route} (seuil ${SEUILS.LATENCE_P95_MS} ms). Valeur estimée sur un échantillon borné.`,
        action: "Vérifier la charge, la base et les appels externes de cette route.",
        mesures: { route: r.route, p95Ms: r.p95Ms, seuil: SEUILS.LATENCE_P95_MS },
      }),
    );
  }

  // ------------------------------------------------------------ déduplication
  const codesActifs = new Set(candidats.map((a) => a.code));
  const aEnvoyer: Alerte[] = [];
  let deja = 0;

  for (const a of candidats) {
    const precedent = etats.get(a.code);
    if (!precedent || precedent.etat === "résolue" || maintenant - precedent.ts >= cooldownMs()) {
      etats.set(a.code, { etat: "déclenchée", ts: maintenant });
      aEnvoyer.push(a);
    } else {
      deja += 1;
    }
  }

  // Résolution : tout code déclenché qui n'est plus candidat est résolu.
  for (const [code, etat] of etats) {
    if (etat.etat === "déclenchée" && !codesActifs.has(code)) {
      etats.set(code, { etat: "résolue", ts: maintenant });
      const [titre] = code.split(":");
      aEnvoyer.push({
        code,
        gravite: "mineure",
        composant: composantDuCode(code),
        titre: `Retour à la normale — ${titre}`,
        message: "La condition d'alerte n'est plus réunie.",
        action: "Vérifier que le retour à la normale est durable avant de clore l'incident.",
        mesures: { resolue: true },
        ts: new Date().toISOString(),
        etat: "résolue",
      });
    }
  }

  return { aEnvoyer, deja };
}

function composantDuCode(code: string): Alerte["composant"] {
  if (code.startsWith("base")) return "base";
  if (code.startsWith("stockage")) return "stockage";
  if (code.startsWith("disque")) return "disque";
  if (code.startsWith("sauvegarde")) return "sauvegarde";
  if (code.startsWith("gfw")) return "gfw";
  return "api";
}

function alerte(
  code: string,
  modele: Pick<Alerte, "gravite" | "composant" | "titre" | "message" | "action" | "mesures">,
): Alerte {
  return { code, ...modele, ts: new Date().toISOString(), etat: "déclenchée" };
}

/** Évalue une condition : renvoie l'alerte si elle est vraie, sinon rien. */
function regle(
  code: string,
  condition: boolean,
  modele: Pick<Alerte, "gravite" | "composant" | "titre" | "message" | "action" | "mesures">,
): Alerte | null {
  return condition ? alerte(code, modele) : null;
}

/** Journalise l'évaluation, pour l'exploitation. */
export function tracerEvaluation(aEnvoyer: Alerte[], deja: number): void {
  if (aEnvoyer.length > 0 || deja > 0) {
    journal.info("alertes.evaluation", {
      aEnvoyer: aEnvoyer.map((a) => a.code),
      dejaActives: deja,
    });
  }
}

/** États connus, pour la page de statut. */
export function etatsConnus(): Array<{ code: string; etat: string; ts: string }> {
  return [...etats.entries()].map(([code, e]) => ({
    code,
    etat: e.etat,
    ts: new Date(e.ts).toISOString(),
  }));
}

export type { Gravite };
