# Suivi des prochaines étapes

Actualisé le 30 septembre 2026 après la recette intégrée du chantier 4. Voir [audit et corrections 04b](rapports/04b-reprise-geospatial-production.md).

| Ordre | Travail | État et critère de sortie |
|---|---|---|
| 1 | 08q — préparation exploitation documentaire | Évaluateur local et procédures livrés ; collecte, notifications, installation et rotation antivirus réelles non raccordées. Pas production. |
| **2** | **Reprise du chantier 4 — moteur géospatial** | **EN COURS — priorité active.** Audit public effectué : connexion 404 et API en erreur DNS privé. Corrections UI locales livrées. Prochaine action : accès Vercel actuel, raccordement backend/Production et recette cible ; pas de nouveau sous-lot 8 implicite. |
| Gate distincte | Qualification/activation des infrastructures | Hôte, S3, alertes, sauvegardes, fournisseur et migration candidate exigent leurs qualifications et autorisations. Aucun achat ou déploiement déduit de ce suivi. |

## Chantier 4 : acquis et vérifications restantes

Référence : [rapport final local](rapports/04-chantier-4.md), qui remplace les rapports d'avancement antérieurs (pilote Côte d'Ivoire seulement). Le moteur mondial indicatif est livré localement : 246 codes, versionnement et contrôle de cohérence pays. AQ/EG/UM sont des exceptions explicites. Natural Earth 1:10 millions n'est pas une précision de dix mètres, ni un référentiel cadastral.

Suivi des vérifications (le rapport 04b précise ce qui a été inspecté localement ; **aucune recette métier de production validée**) :

1. Inventaire des routes/catalogues, de leur branche et de leur raccordement interface dans le code courant.
2. Différences entre ce code, la version réellement publiée sur Vercel **Production** et l'accès au backend. Un build ou une Preview ne remplace pas cette vérification.
3. Accès authentifié, permissions organisation/fournisseur, conservation de l'historique et sources empaquetées disponibles dans le runtime cible.
4. Scénarios couverts/non couverts/source indisponible, parcelles extrêmes, limites visibles et recette smartphone.
5. Plan de corrections sans suppression Neon, sans migration cloud supplémentaire implicite, sans dépendre de l'achat immédiat d'un domaine.

Les rapports anciens restent des preuves datées : leurs mentions de publication bloquée ou de chantiers ultérieurs non engagés ne décrivent pas automatiquement l'état présent. Celui-ci doit être inspecté, pas déduit. Aucune conclusion réglementaire favorable ne découle d'une intersection cartographique.

## Complément : accès Vercel reçu et utilisé

L'[audit authentifié 04c](rapports/04c-audit-vercel-authentifie.md) confirme Production sur le chantier 2 et accueil/comptes restés en Preview. L'accès frontend fonctionne ; le blocage restant est le backend/identité et le choix entre accueil public limité ou application complète. Aucune promotion aveugle de la Preview ancienne ni modification Neon.

## Exécution du 30 septembre — chantier 4 toujours prioritaire

[Recette 04d](rapports/04d-recette-geospatiale-complete.md) : **516 tests PASS**, navigateur réel/API/SQL locaux, restauration distincte et vérification Neon read-only réussis. Les credentials runtime Neon ont été retrouvés : ne plus les présenter comme manquants ni redemander des captures Neon. Identité Clerk disponible = développement ; pas de configuration production qualifiée. Clôture publique toujours bloquée par identité/hébergement/déploiement, pas par un besoin de nouveau développement géospatial ou un nouveau lot documentaire. Aucun accueil limité publié.
