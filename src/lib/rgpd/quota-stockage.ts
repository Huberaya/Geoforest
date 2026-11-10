/**
 * Quota de stockage par organisation.
 *
 * ⚠️ Pourquoi ce n'est pas une limite commerciale.
 *
 *   Le stockage est un répertoire disque unique, cloisonné par préfixe
 *   d'organisation (`<organisation>/<2>/<sha256>.<ext>`). Sans quota, une
 *   organisation — par erreur, par script, ou par malveillance — remplit le
 *   disque et rend le service indisponible pour TOUTES les autres. Ce n'est pas
 *   un client qui dépasse son forfait : c'est une défaillance de disponibilité
 *   provoquée par un seul tenant.
 *
 *   `ORGANIZATION_STORAGE_QUOTA` n'existait nulle part avant C11. Il existe
 *   maintenant, avec une valeur par défaut utile, et il est vérifié AVANT
 *   l'écriture : contrôler après coup ne protège de rien, le fichier est déjà
 *   sur le disque.
 *
 * ⚠️ Limite assumée : ce quota compte l'usage DÉCLARÉ en base (la somme des
 *   tailles de versions de documents), pas les octets réellement présents sur
 *   le disque. Les deux diffèrent — un fichier orphelin compte sur le disque et
 *   pas en base. Compter le disque à chaque dépôt demanderait un parcours de
 *   répertoire par requête ; c'est précisément ce qu'un quota doit éviter.
 *   L'écart est rattrapé par la purge des pièces détachées (`depot.ts`).
 */

/** 20 Go par organisation et par défaut. */
export const QUOTA_OCTETS_PAR_DEFAUT = 20 * 1024 * 1024 * 1024;

/**
 * Le quota effectif, lu dans l'environnement.
 *
 * ⚠️ Une valeur illisible ou négative retombe sur le défaut plutôt que de
 *   donner un quota de zéro : une variable mal saisie ne doit pas bloquer tous
 *   les dépôts d'un client. En revanche `0` explicite est respecté — il signifie
 *   « aucun dépôt autorisé », et c'est une décision d'exploitation légitime.
 */
export function quotaStockageOctets(): number {
  const brut = process.env.ORGANIZATION_STORAGE_QUOTA;
  if (brut === undefined || brut.trim() === "") return QUOTA_OCTETS_PAR_DEFAUT;
  const valeur = Number(brut);
  if (!Number.isFinite(valeur) || valeur < 0) return QUOTA_OCTETS_PAR_DEFAUT;
  return Math.floor(valeur);
}

export interface VerdictQuota {
  /** Vrai si l'ajout ferait dépasser le quota. */
  depasse: boolean;
  utilise: number;
  ajout: number;
  quota: number;
  /** Ce qu'il reste avant la limite, jamais négatif. */
  restant: number;
}

/**
 * L'ajout tient-il dans le quota ?
 *
 * ⚠️ L'égalité est ACCEPTÉE. Refuser `utilise + ajout === quota` rendrait la
 *   limite inatteignable et le message incompréhensible : « il reste 1 Mo,
 *   votre fichier fait 1 Mo, refusé ».
 */
export function verifierQuota({
  utilise,
  ajout,
  quota,
}: {
  utilise: number;
  ajout: number;
  quota: number;
}): VerdictQuota {
  const depasse = utilise + ajout > quota;
  return {
    depasse,
    utilise,
    ajout,
    quota,
    restant: Math.max(0, quota - utilise),
  };
}

/**
 * Message destiné à l'utilisateur — en français, avec des unités lisibles.
 *
 * ⚠️ Un refus de quota qui n'annonce ni l'usage ni la limite oblige à ouvrir un
 *   ticket pour savoir quoi supprimer.
 */
export function messageQuota(verdict: VerdictQuota): string {
  const enMo = (octets: number): string => `${(octets / (1024 * 1024)).toFixed(1)} Mo`;
  return (
    `Quota de stockage de l'organisation dépassé : ${enMo(verdict.utilise)} utilisés sur ${enMo(verdict.quota)}, ` +
    `et ce dépôt ajouterait ${enMo(verdict.ajout)}. ` +
    `Supprimez des pièces jointes ou demandez un relèvement du quota à votre administrateur.`
  );
}
