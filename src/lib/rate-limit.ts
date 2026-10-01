/**
 * Limitation du débit — **fenêtre glissante**, en mémoire.
 *
 * ⚠️ P1-07 — mesuré avant correction : 200 requêtes envoyées en 3,4 secondes,
 * toutes honorées en 200. Aucune borne, nulle part.
 *
 * Pourquoi une fenêtre glissante et non une fenêtre fixe.
 *
 * La première implémentation compartimentait le temps : chaque tranche de
 * dix secondes comptait pour elle-même. Une rafale lancée juste avant la fin
 * d'une tranche était donc comptée deux fois moins cher qu'elle n'aurait dû :
 * 200 requêtes envoyées en 3,4 secondes passaient intégralement dès lors
 * qu'elles chevauchaient une frontière. La mesure l'a montré, avec un résultat
 * différent d'une exécution à l'autre selon l'alignement de l'horloge — ce qui
 * est la marque d'une protection illusoire.
 *
 * La méthode retenue est celle du **compteur à fenêtre glissante** : la charge
 * est estimée en pondérant la fenêtre écoulée par le temps qu'il en reste à
 * courir. Deux nombres par clé suffisent, là où un historique complet des
 * horodatages coûterait une mémoire proportionnelle au trafic. L'estimation
 * est exacte à quelques pour cent près — largement suffisant pour borner un
 * débit, et prévisible pour qui attend `Retry-After`.
 *
 * Portée et limites, dites explicitement :
 *
 *   • le compteur vit dans la mémoire du processus : **par instance**. Un
 *     redémarrage le remet à zéro, et plusieurs instances derrière un
 *     répartiteur ne se coordonnent pas. Pour une ferme de serveurs, il faut
 *     un compteur partagé (Redis, ou l'infrastructure de bord).
 *   • la limitation protège donc contre **un client trop pressé**, pas contre
 *     une attaque distribuée. C'est l'essentiel du risque mesuré ici, et cela
 *     ne prétend pas être davantage.
 *   • le nombre de clés est borné : au-delà, les plus anciennes sont écartées.
 *     Sans cela, un adversaire qui fait varier l'en-tête `X-Forwarded-For`
 *     remplirait la table — la limitation deviendrait elle-même un vecteur.
 *
 * Ce module ne dépend d'aucune API Node : il est utilisé par le middleware
 * (Edge Runtime).
 */

interface Compteur {
  /** Numéro de la fenêtre en cours. */
  periode: number;
  /** Requêtes comptées dans la fenêtre en cours. */
  courant: number;
  /** Requêtes comptées dans la fenêtre précédente. */
  precedent: number;
}

/** Un seul compartiment par clé (le numéro de fenêtre n'entre pas dans la clé). */
const compartiments = new Map<string, Compteur>();

/** Nombre maximal de clés suivies : au-delà, on purge. */
const CLES_MAX = 10_000;

export interface VerdictCadence {
  autorise: boolean;
  /** Secondes entières à attendre avant de réessayer (0 si autorisé). */
  reessayerDans: number;
  /** Requêtes encore disponibles dans la fenêtre courante. */
  restantes: number;
}

export function verifierCadence(cle: string, max: number, fenetreMs: number): VerdictCadence {
  const maintenant = Date.now();
  const periode = Math.floor(maintenant / fenetreMs);
  const nom = `${cle}@${fenetreMs}`;

  let etat = compartiments.get(nom);
  if (!etat) {
    if (compartiments.size >= CLES_MAX) purger(maintenant, fenetreMs);
    etat = { periode, courant: 0, precedent: 0 };
    compartiments.set(nom, etat);
  } else if (etat.periode !== periode) {
    // La fenêtre a tourné. La fenêtre courante devient la précédente ; si plus
    // d'une fenêtre s'est écoulée depuis la dernière requête, la précédente est
    // périmée et son poids doit tomber à zéro.
    etat.precedent = etat.periode === periode - 1 ? etat.courant : 0;
    etat.courant = 0;
    etat.periode = periode;
  }

  // Part de la fenêtre écoulée, dans [0, 1).
  const ecoule = maintenant % fenetreMs;
  const avancement = ecoule / fenetreMs;
  // Charge estimée sur les `fenetreMs` dernières millisecondes.
  const estimee = etat.precedent * (1 - avancement) + etat.courant;

  if (estimee >= max) {
    return {
      autorise: false,
      reessayerDans: attenteSecondes(etat, max, fenetreMs, ecoule),
      restantes: 0,
    };
  }

  etat.courant += 1;
  return {
    autorise: true,
    reessayerDans: 0,
    restantes: Math.max(0, Math.floor(max - estimee - 1)),
  };
}

/**
 * Temps à attendre, **en secondes entières**, avant que la charge estimée
 * repasse sous le plafond. Sans ce calcul, `Retry-After` annoncerait
 * simplement la fin de la fenêtre — parfois dix secondes d'attente pour une
 * seconde de dépassement réel.
 */
function attenteSecondes(etat: Compteur, max: number, fenetreMs: number, ecoule: number): number {
  // estimee(avancement) = precedent × (1 − avancement) + courant, décroissante.
  // On cherche le plus petit avancement tel que estimee < max.
  let attente: number;
  if (etat.precedent > 0 && max - etat.courant < etat.precedent) {
    const avancementRequis = 1 - (max - etat.courant) / etat.precedent;
    attente = Math.max(0, avancementRequis * fenetreMs - ecoule);
  } else {
    // Le plafond n'est atteint que par la fenêtre courante : il faut attendre
    // qu'elle s'achève.
    attente = fenetreMs - ecoule;
  }
  return Math.max(1, Math.ceil(attente / 1000));
}

/** Vide les compartiments périmés ; évince les plus anciens si la table reste pleine. */
function purger(maintenant: number, fenetreMs: number): void {
  for (const [nom, c] of compartiments) {
    // Deux fenêtres sans la moindre requête : la précédente est retombée à 0.
    if (maintenant - c.periode * fenetreMs >= 2 * fenetreMs) compartiments.delete(nom);
  }
  if (compartiments.size >= CLES_MAX) {
    const triees = [...compartiments.entries()].sort((a, b) => a[1].periode - b[1].periode);
    for (let i = 0; i < Math.ceil(triees.length / 4); i += 1) {
      compartiments.delete(triees[i][0]);
    }
  }
}

/** Remet les compteurs à zéro — utile aux tests, sans effet en production. */
export function reinitialiserCadence(): void {
  compartiments.clear();
}

/**
 * Adresse IP du client.
 *
 * ⚠️ `X-Forwarded-For` est un en-tête que le client peut forger si aucun
 * mandataire ne le réécrit. Il ne vaut que parce que le déploiement passe
 * derrière un répartiteur qui l'écrase — à vérifier à la mise en service.
 */
export function adresseClient(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const premiere = xff.split(",")[0]?.trim();
    if (premiere) return premiere;
  }
  return headers.get("x-real-ip")?.trim() || "inconnue";
}
