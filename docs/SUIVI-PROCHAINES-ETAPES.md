# Suivi des prochaines étapes

Actualisé le 29 septembre 2026 après le rappel explicite du propriétaire concernant le chantier 4.

| Ordre | Travail | État et critère de sortie |
|---|---|---|
| 1 | 08q — préparation exploitation documentaire | Évaluateur local et procédures livrés ; collecte, notifications, installation et rotation antivirus réelles non raccordées. Pas production. |
| **2** | **Reprise du chantier 4 — moteur géospatial** | **Prochaine reprise fonctionnelle.** Audit des écarts entre code/recette locale, backend accessible et interface Vercel Production, puis plan de corrections et recette autorisée. Ne pas le repousser implicitement au profit d'autres sous-lots 8. |
| Gate distincte | Qualification/activation des infrastructures | Hôte, S3, alertes, sauvegardes, fournisseur et migration candidate exigent leurs qualifications et autorisations. Aucun achat ou déploiement déduit de ce suivi. |

## Chantier 4 : acquis et vérifications restantes

Référence : [rapport final local](rapports/04-chantier-4.md), qui remplace les rapports d'avancement antérieurs (pilote Côte d'Ivoire seulement). Le moteur mondial indicatif est livré localement : 246 codes, versionnement et contrôle de cohérence pays. AQ/EG/UM sont des exceptions explicites. Natural Earth 1:10 millions n'est pas une précision de dix mètres, ni un référentiel cadastral.

À vérifier au prochain lot, **sans déclarer aujourd'hui ces points validés** :

1. Inventaire des routes/catalogues, de leur branche et de leur raccordement interface dans le code courant.
2. Différences entre ce code, la version réellement publiée sur Vercel **Production** et l'accès au backend. Un build ou une Preview ne remplace pas cette vérification.
3. Accès authentifié, permissions organisation/fournisseur, conservation de l'historique et sources empaquetées disponibles dans le runtime cible.
4. Scénarios couverts/non couverts/source indisponible, parcelles extrêmes, limites visibles et recette smartphone.
5. Plan de corrections sans suppression Neon, sans migration cloud supplémentaire implicite, sans dépendre de l'achat immédiat d'un domaine.

Les rapports anciens restent des preuves datées : leurs mentions de publication bloquée ou de chantiers ultérieurs non engagés ne décrivent pas automatiquement l'état présent. Celui-ci doit être inspecté, pas déduit. Aucune conclusion réglementaire favorable ne découle d'une intersection cartographique.
