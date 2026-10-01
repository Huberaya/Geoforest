import "server-only";

/**
 * Mesures de service, en mémoire.
 *
 * ⚠️ P1-06 — deux limites, toutes deux assumées et signalées plutôt que cachées.
 *
 * 1. **Ces mesures sont celles d'un processus.** Elles ne comptent que les
 *    requêtes servies par cette instance. Derrière un équilibreur de charge,
 *    il faut agréger plusieurs instances : le format d'exposition est celui de
 *    Prometheus précisément pour qu'un tel agrégateur puisse être branché sans
 *    réécriture. Ce chantier fournit la sonde ; l'agrégation reste à la charge
 *    de l'exploitation (cf. `infra/`).
 *
 * 2. **Les quantiles sont approximatifs.** Calculer un p95 exact exigerait de
 *    conserver toutes les latences. On garde un échantillon borné des dernières
 *    mesures par route : suffisant pour détecter une dégradation, et annoncé
 *    comme tel — afficher « p95 = 121 ms » sans dire qu'il est estimé
 *    laisserait croire à une exactitude qu'on n'a pas.
 */

/** Nombre de latences conservées par route, pour le calcul des quantiles. */
const TAILLE_ECHANTILLON = 256;
/** Minutes conservées dans la fenêtre glissante. */
const FENETRE_MINUTES = 60;

interface Seau {
  total: number;
  echecs5xx: number;
  echecs4xx: number;
  sommeMs: number;
  maxMs: number;
}

interface MesureRoute {
  total: number;
  echecs5xx: number;
  echecs4xx: number;
  sommeMs: number;
  maxMs: number;
  latences: number[];
  curseur: number;
  /** Seaux par minute (horodatage de la minute, en secondes). */
  minutes: Map<number, Seau>;
  dernierStatut: number | null;
  derniereErreur: { ts: string; statut: number; detail?: string | null } | null;
}

const routes = new Map<string, MesureRoute>();
const jauges = new Map<string, { valeur: number; ts: string }>();
const verrous = new Map<string, number>();

const DEMARRAGE = Date.now();

function seauVide(): Seau {
  return { total: 0, echecs5xx: 0, echecs4xx: 0, sommeMs: 0, maxMs: 0 };
}

function mesureDe(cle: string): MesureRoute {
  let mesure = routes.get(cle);
  if (!mesure) {
    mesure = {
      total: 0,
      echecs5xx: 0,
      echecs4xx: 0,
      sommeMs: 0,
      maxMs: 0,
      latences: [],
      curseur: 0,
      minutes: new Map(),
      dernierStatut: null,
      derniereErreur: null,
    };
    routes.set(cle, mesure);
  }
  return mesure;
}

function minuteCourante(): number {
  return Math.floor(Date.now() / 60_000);
}

function purger(minute: number): void {
  const limite = minute - FENETRE_MINUTES;
  for (const mesure of routes.values()) {
    if (mesure.minutes.size > FENETRE_MINUTES + 5) {
      for (const cle of mesure.minutes.keys()) {
        if (cle < limite) mesure.minutes.delete(cle);
      }
    }
  }
}

export interface EvenementRequete {
  route: string;
  methode: string;
  statut: number;
  dureeMs: number;
  organisation?: string | null;
  detailErreur?: string | null;
}

/** Consigne une requête servie. */
export function enregistrerRequete(evenement: EvenementRequete): void {
  const cle = `${evenement.methode} ${evenement.route}`;
  const mesure = mesureDe(cle);

  mesure.total += 1;
  mesure.sommeMs += evenement.dureeMs;
  if (evenement.dureeMs > mesure.maxMs) mesure.maxMs = evenement.dureeMs;
  if (evenement.statut >= 500) mesure.echecs5xx += 1;
  else if (evenement.statut >= 400) mesure.echecs4xx += 1;
  mesure.dernierStatut = evenement.statut;

  // Échantillon circulaire : on écrase la plus ancienne mesure. La mémoire
  // reste bornée quoi qu'il arrive, ce qui est la seule propriété qui compte
  // ici — une fuite de mémoire dans la télémétrie mettrait le service à bas
  // pour essayer de le surveiller.
  if (mesure.latences.length < TAILLE_ECHANTILLON) {
    mesure.latences.push(evenement.dureeMs);
  } else {
    mesure.latences[mesure.curseur] = evenement.dureeMs;
    mesure.curseur = (mesure.curseur + 1) % TAILLE_ECHANTILLON;
  }

  if (evenement.statut >= 500) {
    mesure.derniereErreur = {
      ts: new Date().toISOString(),
      statut: evenement.statut,
      detail: evenement.detailErreur?.slice(0, 300) ?? null,
    };
  }

  const minute = minuteCourante();
  let seau = mesure.minutes.get(minute);
  if (!seau) {
    seau = seauVide();
    mesure.minutes.set(minute, seau);
  }
  seau.total += 1;
  seau.sommeMs += evenement.dureeMs;
  if (evenement.dureeMs > seau.maxMs) seau.maxMs = evenement.dureeMs;
  if (evenement.statut >= 500) seau.echecs5xx += 1;
  else if (evenement.statut >= 400) seau.echecs4xx += 1;

  purger(minute);
}

/**
 * Agrège les seaux d'une route sur les `minutes` dernières minutes.
 *
 * ⚠️ Le dénominateur est le nombre de requêtes réellement servies, pas le
 *   nombre de minutes écoulées : une route sans trafic n'a pas de taux
 *   d'erreur, et le déclarer à 0 % laisserait croire qu'elle est suivie.
 */
export function fenetre(cle: string, minutes: number): Seau & { requetes: number } {
  const mesure = routes.get(cle);
  const limite = minuteCourante() - minutes + 1;
  const cumul = seauVide();
  if (!mesure) return { ...cumul, requetes: 0 };
  for (const [m, seau] of mesure.minutes) {
    if (m < limite) continue;
    cumul.total += seau.total;
    cumul.echecs5xx += seau.echecs5xx;
    cumul.echecs4xx += seau.echecs4xx;
    cumul.sommeMs += seau.sommeMs;
    cumul.maxMs = Math.max(cumul.maxMs, seau.maxMs);
  }
  return { ...cumul, requetes: cumul.total };
}

/** Quantile approximatif (0 à 1) d'un échantillon trié. */
function quantile(echantillon: number[], q: number): number | null {
  if (echantillon.length === 0) return null;
  const trie = [...echantillon].sort((a, b) => a - b);
  const rang = Math.min(trie.length - 1, Math.floor(q * (trie.length - 1)));
  return trie[rang];
}

export interface ResumeRoute {
  route: string;
  requetes: number;
  echecs4xx: number;
  echecs5xx: number;
  latenceMoyenneMs: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  tauxErreur5xx: number;
  dernierStatut: number | null;
  derniereErreur: { ts: string; statut: number; detail?: string | null } | null;
  /** « estimé » : les quantiles viennent d'un échantillon borné. */
  precision: "estimé";
}

export function resumeRoutes(): ResumeRoute[] {
  return [...routes.entries()]
    .map(([cle, mesure]) => ({
      route: cle,
      requetes: mesure.total,
      echecs4xx: mesure.echecs4xx,
      echecs5xx: mesure.echecs5xx,
      latenceMoyenneMs: mesure.total ? Math.round((mesure.sommeMs / mesure.total) * 100) / 100 : null,
      p95Ms: quantile(mesure.latences, 0.95),
      maxMs: mesure.total ? mesure.maxMs : null,
      tauxErreur5xx: mesure.total ? Math.round((mesure.echecs5xx / mesure.total) * 10_000) / 10_000 : 0,
      dernierStatut: mesure.dernierStatut,
      derniereErreur: mesure.derniereErreur,
      precision: "estimé" as const,
    }))
    .sort((a, b) => b.requetes - a.requetes);
}

/**
 * Valeur instantanée : état d'une dépendance, espace disque, fraîcheur d'une
 * sauvegarde.
 */
export function noterJauges(nom: string, valeur: number): void {
  jauges.set(nom, { valeur, ts: new Date().toISOString() });
}

export function lireJauges(): Record<string, { valeur: number; ts: string }> {
  return Object.fromEntries(jauges);
}

/**
 * Compteur d'occurrences (appels GFW, dépôts de pièces…).
 */
export function incrementer(nom: string, pas = 1): number {
  const suivant = (verrous.get(nom) ?? 0) + pas;
  verrous.set(nom, suivant);
  return suivant;
}

export function lireCompteurs(): Record<string, number> {
  return Object.fromEntries(verrous);
}

/** Secondes écoulées depuis le démarrage du processus. */
export function disponibiliteSecondes(): number {
  return Math.round((Date.now() - DEMARRAGE) / 1000);
}

/**
 * Exposition au format texte Prometheus.
 *
 * ⚠️ Le format est standard, mais les noms de séries sont préfixés `geoforest_`
 *   et les libellés sont **bornés** : `route` est un motif (`/api/v1/plots/:id`),
 *   jamais une URL avec ses paramètres. Exposer des identifiants dans des
 *   libellés ferait exploser le nombre de séries — c'est la panne classique
 *   d'un Prometheus mal conçu, et elle touche le supervisionnaire lui-même.
 */
export function expositionPrometheus(): string {
  const lignes: string[] = [
    `# geoforest_up — 1 si le processus répond`,
    `geoforest_up 1`,
    `# geoforest_uptime_seconds — durée de vie du processus`,
    `geoforest_uptime_seconds ${disponibiliteSecondes()}`,
    `# geoforest_http_requests_total — requêtes servies, par route et par classe de statut`,
  ];
  for (const r of resumeRoutes()) {
    const [methode, ...reste] = r.route.split(" ");
    const route = reste.join(" ");
    const etiquettes = `method="${methode}",route="${route}"`;
    lignes.push(`geoforest_http_requests_total{${etiquettes}} ${r.requetes}`);
    lignes.push(`geoforest_http_errors_5xx_total{${etiquettes}} ${r.echecs5xx}`);
    lignes.push(`geoforest_http_errors_4xx_total{${etiquettes}} ${r.echecs4xx}`);
    if (r.p95Ms !== null) {
      lignes.push(`geoforest_http_latency_p95_ms{${etiquettes}} ${r.p95Ms}`);
    }
  }
  lignes.push(`# geoforest_dependency — état des dépendances (1 = disponible)`);
  for (const [nom, j] of Object.entries(lireJauges())) {
    lignes.push(`geoforest_dependency{name="${nom}"} ${j.valeur}`);
  }
  lignes.push(`# geoforest_events_total — compteurs métier`);
  for (const [nom, valeur] of Object.entries(lireCompteurs())) {
    lignes.push(`geoforest_events_total{name="${nom}"} ${valeur}`);
  }
  return lignes.join("\n") + "\n";
}

/** Remise à zéro, pour les bancs d'essai. */
export function reinitialiser(): void {
  routes.clear();
  jauges.clear();
  verrous.clear();
}
