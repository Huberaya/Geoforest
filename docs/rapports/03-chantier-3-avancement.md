# Chantier 3 — point d’avancement, incrément technique 1

28 septembre 2026 · **ARCHIVE : état du premier incrément, avant finalisation**

> Cet état a été dépassé. Lire le [rapport de livraison du chantier 3](03-chantier-3.md). Les éléments NON FAIT ci-dessous étaient exacts à cet incrément, pas à la livraison finale.

Branche : `chantier-3/parcelles-geolocalisation`, issue de `a924ba8`. Le GO concerne le chantier 3 ; aucun chantier 4 commencé.

## FAIT

- Relecture ciblée du texte officiel et de la documentation GeoJSON IS, avec références, anomalies documentaires et conséquences consignées dans `docs/reglementation/03-geolocalisation-verification.md`.
- Plan architecture/produit/sécurité dans `docs/adr/003-parcelles.md`.
- Choix de fond passé par l’utilisateur : repli protecteur **sans requête cartographique externe par défaut**. Aucun abonnement, fournisseur payant ou service de tuiles activé.
- Noyau Python/PostGIS de validation Point/Polygon/MultiPolygon : dimensions et bornes, valeurs finies, anneaux, topologie, surfaces géodésiques, budgets ; pas de réparation automatique.
- Contrôle séparé de la troncature à six décimales ; avertissements sur trous, perte de validité, surface d’un point inconnue, seuil conditionnel >4 ha hors bovins et écart de surface. Aucun verdict réglementaire ni acceptation TRACES proclamée.
- Lecteurs GeoJSON et KML texte : 1 Mio, 100 features, 10 000 positions par fichier ; empreinte SHA-256 de source, propriétés reconnues séparées des propriétés ignorées ; aucune écriture en base.
- KML parsé avec defusedxml, DTD/entités/ressources réseau refusées. Altitude non utilisée en 2D, signalée explicitement. SHP/KMZ non acceptés.
- Cas non supportés signalés : notamment polygones traversant l’antiméridien ou dépassant 85° de latitude. Limite technique de surface 100 000 ha : ce n’est pas un seuil EUDR.

## TESTS EXÉCUTÉS

- **137 tests backend réussis** sur PostgreSQL 17/PostGIS réel : les 78 cas existants et 59 nouveaux cas géométriques/import.
- Ruff : réussi.
- Avertissement connu Starlette TestClient/httpx non masqué.
- Preuves : `docs/rapports/preuves-chantier-3/pytest-increment-1.txt` et `ruff-increment-1.txt`.

La sandbox d’exécution n’avait plus les dépendances, le serveur PostgreSQL ni les services de démo de la recette précédente. Le venv et PostgreSQL/PostGIS ont été réinstallés ; une base **geoforest_test** neuve et synthétique a été initialisée et migrée en **0002**, le schéma actuellement livré. Cela n’est pas une restauration des données de démo précédentes. Les anciens rapports de recette restent des preuves historiques, pas une affirmation que ces services tournent encore.

Les tests nouveaux vérifient notamment les coordonnées non finies et entiers extrêmes, structures corrompues, seuil exact 4 ha, trous, multipolygones et auto-intersections, petite surface perdue après troncature, grandes surfaces, CRS ambigu, imports JSON à clés répétées, propriétés de mauvais type, XML externe et formats non pris en charge. Toutes les coordonnées de fixtures sont synthétiques en zone océanique.

## NON FAIT — requis avant livraison du chantier 3

- Migration `0003`, référentiel parcellaire persistant, révisions et associations aux lots.
- API métier authentifiée, RLS et tests d’isolation des nouveaux objets. Les modules actuels ne sont pas exposés par une route et **ne constituent pas une frontière d’autorisation**.
- Prévisualisation transactionnelle/apply/idempotence des imports ; les lecteurs ne font que parser et borner les entrées. Ils ne prouvent pas la validité topologique tant que le contrôle PostGIS n’a pas été exécuté.
- Carte de consultation/dessin, formulaires de coordonnées, acquisition GPS et permission/refus.
- Parcelles proposées par portail fournisseur, revue et adoption explicites dans le référentiel entreprise.
- Contrôles de doublons/chevauchements entre parcelles autorisées ; aucune recherche inter-parcelles dans cet incrément.
- Recette navigateur du chantier 3, build frontend, audits actualisés, migration/restauration du nouveau modèle et guide utilisateur final.

## RISQUES / PROCHAINE ÉTAPE

Le code est un noyau technique testé, **pas une fonctionnalité parcellaire utilisable dans l’application**. Il ne faut pas annoncer la carte, le GPS ou l’import utilisateur comme livrés. L’exactitude d’un relevé terrain n’est pas démontrée par six décimales ; la validité géométrique ne démontre ni localisation réelle, ni propriété, ni légalité, ni absence de déforestation.

Prochain travail dans le **même chantier déjà autorisé** : modèle persistant/versionné et API avec RLS, puis parcours carte/portail et recette complète. Aucun push de cet incrément ; les tokens précédemment exposés ne sont pas réutilisés. Aucun GO pour le chantier 4 n’est demandé à ce stade.
