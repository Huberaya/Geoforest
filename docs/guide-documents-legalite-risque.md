# Documents, légalité et risque — guide utilisateur

Version 0.7.0 · chantier 6 · données de démonstration exclusivement fictives.

## 1. Coffre documentaire

Dans **Documents**, choisir un fournisseur, renseigner le titre et, si nécessaire, le lot et la révision parcellaire. Les rattachements sont fixés à la création du document : une nouvelle version ne déplace pas une preuve vers un autre lot. Les documents généraux du fournisseur peuvent être utilisés dans ses dossiers, après vérification humaine du périmètre.

Formats : PDF passif non chiffré, JPEG ou PNG fixe ; 20 Mio par version. Les PDF avec actions, formulaires ou pièces jointes sont refusés. Le nom et le type annoncés par le navigateur ne suffisent pas : les octets sont vérifiés. L’extension téléchargée vient du format validé.

**Déposer et contrôler** réserve une version, transmet des blocs puis lance l’antivirus et le contrôle de format. Le contrôle peut prendre environ 80 secondes ; le transfert d’un gros fichier peut prendre plusieurs minutes. Une limitation de requêtes pendant un bloc déclenche jusqu’à deux reprises espacées d’une minute. La réservation expire après une heure. Le même fichier et les mêmes informations permettent une reprise idempotente dans l’écran courant ; après rechargement, recommencer crée une autre réservation. Une connexion insuffisante ou un quota atteint reste visible comme une erreur, jamais comme un dépôt réussi.

- **Dépôt à terminer** : transfert non finalisé ; après expiration, recommencer une version.
- **Contrôle en cours / indisponible** : ne pas utiliser la pièce ; réessayer le contrôle après résolution de la cause. Trois tentatives maximum.
- **Quarantaine** : aucun téléchargement ni acceptation comme preuve.
- **Contrôles techniques réussis** : téléchargement privé autorisé, mais authenticité, pertinence et légalité **non vérifiées**.

Les pièces et versions existantes ne sont pas écrasées. Le quota de recette est de 512 Mio et 2 000 versions par organisation, y compris réservations et échecs. Contacter l’administrateur plutôt que supprimer arbitrairement une preuve.

## 2. Revue documentaire

Admin et Compliance Manager peuvent accepter une version comme preuve, demander des informations ou la refuser, avec justification. **Cette justification est visible par le fournisseur concerné.** Ne pas y saisir une analyse interne confidentielle.

Une acceptation documentaire n’est ni une certification ni une conclusion EUDR. Contrôler l’émetteur, l’authenticité, les dates, le produit, le lieu et la cohérence avec les autres informations. Une pièce expirée reste conservée et consultable : sa pertinence historique doit être examinée, pas automatiquement déduite de son expiration actuelle.

## 3. Légalité par lot

Dans **Légalité & risque**, choisir un lot et les versions acceptées pertinentes. Les huit domaines couvrent les catégories de l’article 2(40), sans prétendre constituer un répertoire national qualifié. Pour chaque domaine : état, justification et référence aux textes/source/date de consultation.

La confirmation « textes locaux vérifiés » est une déclaration du réviseur : elle requiert les critères et des preuves, un pays et une période de production exacte. Ne pas la cocher sans examen des textes applicables à la zone et à la période. Une source ou une justification saisie manuellement n’est pas authentifiée par le logiciel.

## 4. Évaluation du risque

Les quatorze critères de l’article 10 sont documentés explicitement. Le résultat conserve les références de versions, les facteurs et l’empreinte du contexte. Aucun score opaque ne décide de la conformité.

Un risque « négligeable » est refusé tant que des blocages subsistent : données manquantes, légalité non qualifiée, preuves insuffisantes, critères non résolus ou actions ouvertes, notamment. Des signaux forestiers ou questions de validité peuvent être examinés humainement avec motivation et preuves ; ils restent visibles. Leur traitement ne transforme pas une observation satellite indicative en constat juridique.

Les évaluations sont historiques. Une modification du contexte ou l’ancienneté d’un an impose une nouvelle revue. « Négligeable » enregistré signifie une conclusion humaine documentée dans cet outil, **pas une déclaration aux autorités**. La validation du dossier de diligence et ses exports appartiennent au chantier suivant.

## 5. Actions correctives

Créer une action avec responsable habilité de l’organisation et échéance. Les retards sont signalés dans l’écran. La résolution exige une note et une version de preuve acceptée. Les modifications concurrentes sont refusées : actualiser plutôt qu’écraser le travail d’un autre utilisateur.

Les notifications sont conservées avec l’état `NOT_CONFIGURED` : **aucun email n’est envoyé**. Les rappels du chantier 6 sont internes à l’écran.

## 6. Portail fournisseur

Le fournisseur voit et dépose uniquement ses documents, consulte les retours de revue et peut ajouter une version en conservant les rattachements fixés par son client. Il ne choisit pas de nouveaux lots/parcelles internes. Les évaluations internes de légalité, risque et actions ne lui sont pas exposées.

Le lien sécurisé est personnel : ne pas le transférer. Fermer son accès à la fin et demander sa révocation en cas de doute.

## Limites explicites

OCR désactivé ; pas de verdict national automatique ; certifications complémentaires seulement ; aucun dépôt TRACES ni API officielle qualifiée. Le coffre local de recette et ses fichiers fictifs ne constituent pas un hébergement de production homologué. Ne déposer aucune donnée réelle avant qualification sécurité, exploitation et hébergement.
