# ADR 005 — Chantier 5 : signaux forestiers sourcés

28 septembre 2026 — GO du propriétaire reçu après livraison locale du chantier 4.

**Statut : cadrage et vérification préalable ; choix d’exploitation des rasters à confirmer. Chantier non livré.**

Branche `chantier-5/forest-signals`, créée depuis `425e29d`. Aucune modification de production, aucun push ni chantier 6 autorisé. Application 0.5.0 / schéma 0004 inchangés à ce stade.

## Objectifs et dépendances

Ajouter des observations forestières sourcées aux révisions de parcelles, sans confondre signal satellite, risque et conformité. Réutiliser l’authentification/RBAC/RLS, les géométries validées, snapshots de révision et audit. Ne pas détourner les contours Natural Earth en masque forestier ; ne pas réactiver le prototype archivé.

Vérification documentaire préalable consignée dans `docs/reglementation/05-signaux-forestiers.md`. Premier candidat : GFC v1.13 ; deuxième : JRC TMF sous réserve de qualification distincte, notamment des classes/version/licence complète. Deux adaptateurs ne signifient pas deux sources déjà activées.

## Décision d’exploitation nécessaire

Les rasters sont beaucoup plus volumineux que les contours pays : la seule tuile GFC testée annonce environ 127 Mo pour la perte, 15 Mo pour le masque, 390 Mo pour le couvert 2000. Ces mesures ne sont pas des budgets mondiaux.

Option recommandée à qualifier : **lecture serveur à la demande avec cache borné**, sources publiques autorisées, identifiants de versions/générations fixés et conservation des extraits/preuves. Les requêtes de fichiers/blocs ne transmettent pas le polygone ni le nom du fournisseur, mais le serveur distant peut déduire une zone approximative des tuiles/blocs demandés. La capacité effective de lecture partielle et les volumes doivent être testés avant activation. Pas de service payant ou Earth Engine sans autorisation distincte.

Alternative : **sources préchargées et calcul hors ligne** ; confidentialité réseau plus forte à l’analyse, au prix d’une emprise initiale limitée et d’un stockage à provisionner. Une source non installée ne doit pas être présentée comme couvrant la parcelle. Ne pas annoncer le monde entier disponible parce que le produit amont est mondial.

Aucun choix n’est présumé à partir du choix de contours mondiaux au chantier 4, qui ne portait pas sur les coûts ni les flux d’observation raster.

## Plan d’implémentation ordonné

1. **Qualification réelle des sources** : classe/grille/CRS/masque, lecture bornée et erreurs réseau, licence/version, preuve d’extrait réel et empreintes. Archiver les différences documentaires identifiées ; exclure le WMS RGB de toute mesure.
2. **Contrat commun et moteur** : états séparant présence de signal, couverture et période ; géométries non modifiées ; point = observation ponctuelle, jamais extrapolation à la surface déclarée. Méthode d’intersection documentée pour les polygones, gestion des trous/multipolygones/pixels de bord et de plusieurs tuiles. Limites de temps, mémoire, octets et nombre de pixels. Pas de rééchantillonnage silencieux des classes.
3. **Traitements bornés** : acquisition hors transaction métier longue ; permissions et snapshot vérifiés avant traitement et à la persistance ; idempotence et concurrence. Si file de travaux nécessaire, états de reprise/échec explicites et worker limité au périmètre du travail, pas de rôle bypass-RLS. N’annoncer de capacité industrielle qu’après tests.
4. **Persistance/API** : nouvelle migration 0005 si modèle validé ; analyses liées par clés composites à tenant/fournisseur/parcelle/révision, sorties append-only, provenance et extraits non publics, audit atomique. Historique conservé lors d’un changement de version amont. Aucun endpoint acceptant un faux résultat source envoyé par le navigateur.
5. **Interface** : panneau d’observations avec source, période, méthode, couverture, signal, limites et action de revue humaine. Distinguer Automatique et Manuel ; ni coche « EUDR conforme » ni score de confiance numérique inventé. Portail fournisseur par lien non élargi implicitement.
6. **Recette et exploitation** : tests unitaires/synthétiques et extraits réels distincts ; intégration API/DB/RLS, E2E mobile, migrations peuplées, répétition/restauration, conservation des preuves, OpenAPI/guides/rapport de sortie.

## Invariants scientifiques et réglementaires

- Référence après le 31/12/2020 ; années de signal documentées, pas de jour inventé.
- Ne pas assimiler couvert arboré 2000 à forêt 2020 ; ne pas assimiler classe satellite à conversion agricole prouvée.
- Pas d’analyse 2026 avec des données arrêtées en 2025.
- Sans données, hors couverture, budget dépassé, inconnu, panne et source indisponible distincts d’une absence de signal.
- Un signal sur une fraction de parcelle ne disparaît pas dans un statut global « incomplet » ; les limites du reste restent visibles.
- Pas de buffer de point transformé en parcelle fictive, ni surface satellite extrapolée depuis un point.
- Pas de comptage ×900 m² présenté comme mesure certaine ; les unités, pixels de bord et surfaces géodésiques doivent être explicites.
- `regulatory_status=NOT_ASSESSED`, revue humaine requise ; aucune émission de déclaration officielle.

## Fichiers envisagés

- `backend/app/forest/` : contrats, adaptateurs, acquisition bornée, observations, routes et éventuellement worker.
- `backend/reference/forest/` : manifestes/version/licences et petits extraits publics de qualification, pas copie mondiale des rasters dans Git.
- `backend/migrations/versions/0005_*` : seulement après validation du modèle.
- `backend/tests/test_forest_*.py`, scénario navigateur dédié, scripts de préparation/qualification contrôlés.
- Composant d’observation dans `src/components/plots/`, types API, OpenAPI et documentation.

## Critères de sortie

Au moins une source **réellement qualifiée et utilisable** dans un périmètre affiché ; aucune source simulée présentée comme opérationnelle. Une deuxième source doit avoir sa propre qualification ou rester explicitement inactive. Tests de confidentialité, panne/timeout, changement d’ETag/génération, données malformées, débordement de budget, trou raster, classe inconnue, point/petite parcelle/frontière de pixel, révisions historiques, isolation tenant/fournisseur et restauration.

Bilan FAIT/NON FAIT/PROBLÈMES/RISQUES avant validation finale du propriétaire. **Pas de chantier 6 sans nouveau GO.**
