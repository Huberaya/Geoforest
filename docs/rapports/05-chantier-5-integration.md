# Chantier 5 — intégration fonctionnelle du premier connecteur

**28 septembre 2026 · application 0.6.0 · migration 0005**

Branche `chantier-5/forest-signals`. **Le connecteur GFC est intégré et recetté localement. Le chantier 5 global n’est pas clôturé : décision/qualification du second connecteur nécessaire. Aucun chantier 6.**

Ce rapport remplace l’état du premier incrément conservé dans `05-chantier-5-avancement.md`.

## FAIT

### Analyse parcellaire sourcée

- Lecture à la demande des données publiques Hansen GFC v1.13, années jusqu’à 2025, sans envoyer le polygone ou l’identité du fournisseur au serveur de données.
- Point : un pixel canonique, **jamais extrapolé à toute une parcelle**. Aux limites exactes, convention demi-ouverte est/sud ; à la limite extérieure, dernier pixel.
- Polygon/MultiPolygon : intersection d’aire strictement positive avec les pixels natifs ; trous pris en compte, cellules seulement tangentes exclues, composantes traitées sans compter deux fois une cellule. Pixels de bord signalés séparément.
- Plusieurs tuiles/fenêtres possibles, sans réparation, buffer fictif, simplification ou rééchantillonnage. Validation préalable PostGIS puis contrôle GEOS du worker.
- Distinction des signaux postérieurs à 2020, masques historiques, source absente, couverture partielle et limites techniques. Un signal déjà observé n’est pas effacé si une fenêtre suivante échoue. Une couverture partielle ne devient jamais une conclusion négative globale.
- Conservation des vrais octets de pixels sous forme comprimée, masques de sélection/bord, grille, version/génération/ETag, empreintes des plages lues et des pixels, versions logicielles, paramètres et limites.

### Isolation, budgets et sécurité

- Sous-processus dédié sans héritage des variables contenant les secrets applicatifs ; géométrie sur stdin, pas dans la ligne de commande ; sorties d’erreur natives non exposées.
- Limites Linux : mémoire virtuelle 1 Gio, CPU 30 secondes, sortie fichier 8 Mio, descripteurs 64, core dumps désactivés ; délai parent 100 secondes avec arrêt/récolte du groupe de processus.
- Au maximum 16 fenêtres de 256×256 pixels ; budget réseau **partagé pour toutes les couches/fenêtres** : 64 Mio réservés, 512 requêtes, échéance 90 secondes, plus les limites par lecteur.
- Deux analyses simultanées au maximum sur la même DB, une par organisation, par verrous de session PostgreSQL. **Pas de transaction métier ouverte pendant le réseau.** Il ne s’agit pas d’une file durable de travaux : capacité occupée = 409/429 et relance explicite.
- Contrôle de session et des permissions **à nouveau après** le calcul : une session révoquée ou un rôle supprimé pendant le travail empêche la publication et l’enregistrement.
- Historique append-only/RLS, clés composites organisation/fournisseur/parcelle/révision, idempotence et audit atomique. Les résultats du worker sont rapprochés de l’empreinte de la géométrie avant insertion.
- Historique paginé sans gros blocs de preuves ; preuves complètes sur endpoint authentifié distinct. Pas de lien public de téléchargement.
- Activation serveur explicite `FOREST_ANALYSIS_ENABLED=true`, désactivée par défaut ; confirmation des lectures publiques dans l’interface avant lancement. Les tuiles/blocs peuvent révéler une zone approximative au fournisseur de données, ce qui est indiqué à l’utilisateur.

**L’isolation en sous-processus est une isolation de ressources, pas un sandbox de sécurité OS/conteneur.** Durcissement utilisateur système, egress, conteneurs, limites globales d’hébergement et monitoring restent à qualifier pour la production.

### Interface

Panneau « Observations forestières » dans le détail d’une parcelle, pour la révision sélectionnée : lancement, source/licence/période, signal, limites, historique et téléchargement des preuves JSON. Lecture seule pour Analyst/Viewer ; Supplier OIDC limité à son fournisseur. Aucun nouvel accès offert au portail par lien.

Le mode Automatique qualifie le calcul, pas une décision de conformité. `regulatory_status=NOT_ASSESSED`, revue humaine requise ; pas de score de confiance inventé ni hectares de déforestation juridique calculés. Aucune observation de 2026 avec les données arrêtées en 2025. Pas d’évaluation de la conversion agricole ou de la dégradation au sens juridique.

## TESTS ET PREUVES

| Contrôle | Résultat |
|---|---|
| Backend complet avec PostgreSQL/PostGIS | **572 réussis**, 7 avertissements documentés |
| Navigateur, OIDC/API/DB réels | **7 réussis**, aucun ignoré ; TLS local de recette |
| Source réelle depuis le navigateur via worker serveur | Parcelle fictive analysée, preuves téléchargées, révision polaire non couverte, première révision conservée |
| Mobile | 390 et 360 px, absence de débordement horizontal du dialogue ; aucune erreur JavaScript |
| Réseau navigateur | Aucun appel direct à un fournisseur de données externe |
| Build / TypeScript / ESLint / Ruff | Réussis |
| Dépendances Python épinglées | Aucun avis connu détecté par pip-audit lors du scan ; ce n’est pas un audit natif GDAL/GEOS ou OS |
| Migration | 0004 peuplée → 0005 puis répétition, empreintes complètes des anciennes géolocalisations/contrôles inchangées |
| Restauration | **5 analyses forestières complètes identiques**, dont preuves pixels ; contrôle RLS/privilèges et révocation des sessions restaurées |

Preuves : `preuves-chantier-5/pytest-integration.txt`, `e2e-integration.txt`, `{build,types,lint,ruff}-integration.txt`, `migration-0005.txt`, `restauration-0005.txt`, `pip-audit-integration.txt`. Captures : [desktop](preuves-chantier-5/forest-desktop.png), [mobile](preuves-chantier-5/forest-mobile.png).

Un essai de worker réel indépendant est conservé dans `parcelle-fictive-worker-reel.json`. Les tests API utilisent des sources synthétiques explicitement contrôlées ; la recette navigateur utilise bien les données publiques réelles, pas un faux satellite.

Les avertissements sont le TestClient/httpx déjà connu et six avertissements PendingDeprecation Rasterio/Affine. Les premières tentatives navigateur ont rencontré des dépendances système absentes, puis une mauvaise URL d’issuer dans l’IdP local réinstallé. Corrigés sans supprimer la vérification d’issuer. Un sélecteur de fermeture erroné dans le nouveau test a ensuite été corrigé ; la suite complète finale est verte. Les limites de débit restent actives ; attentes de renouvellement explicites dans la recette.

## MIGRATION ET RESTAURATION

Toutes les bases sont **synthétiques et locales** :
- `geoforest_test` : suite backend, 0005.
- `geoforest_migration5_test` : montée depuis une 0004 contenant deux snapshots de géolocalisation et deux contrôles pays ; inchangés après migration.
- `geoforest_forest_acceptance` : OIDC et navigateur, 0005, sept parcours et essais ciblés.
- `geoforest_forest_restore_test` : restauration isolée ; 5 analyses identiques. Sans contexte, runtime voit zéro résultat ; UPDATE/DELETE non accordés. Sept sessions staff et une session fournisseur révoquées, zéro session non révoquée restante.

L’empreinte SHA-256 des cinq enregistrements complets est `51a1a3c151032fcad60620839b26c74c834e122c12a652ef423f7bd2f6517420`. La procédure de restauration a retiré le droit INSERT temporaire nécessaire à `spatial_ref_sys`. Aucune production n’a été modifiée.

## SECOND CONNECTEUR : BLOCAGE RÉEL CONSTATÉ

Le JRC TMF reste **inactif**, pas simulé. Après lecture de la page officielle et de son composant de téléchargement, la distribution officielle suivante a été sondée :

`https://ies-ows.jrc.ec.europa.eu/iforce/tmf_v1/download.py?type=tile&dataset=DeforestationYear&lat=N10&lon=W10`

- HEAD : HTTP 200, fichier annoncé `JRC_TMF_DeforestationYear_INT_1982_2025_v1_AFR_ID52_N10_W10.tif`, **114 721 845 octets**.
- GET avec `Range: bytes=0-15` : **HTTP 200, pas 206**, même longueur complète ; pas d’ETag, Last-Modified ou Content-Range dans la réponse examinée.
- Le corps complet n’a pas été téléchargé. Aucun dépassement silencieux de budget, aucune présomption de lecture partielle ou d’immuabilité.

Preuve : [sonde d’accès JRC](preuves-chantier-5/jrc-access-probe.json). La page officielle signale en outre des métadonnées encore basées sur v2024. Les ressources/FAQ précisent que les années récentes peuvent être reclassées et que forêt TMF intacte n’équivaut pas automatiquement à forêt primaire EUDR.

**Choix restant :** qualifier séparément un miroir tiers avec fichiers adaptés aux lectures partielles ; ou précharger/archiver les fichiers primaires dans un stockage dimensionné ; ou accepter explicitement un premier périmètre GFC seul et reporter TMF. Aucun miroir ni changement de budget n’a été admis silencieusement.

## STATUT DE SORTIE

- **PRÊT localement :** premier connecteur GFC, moteur parcellaire, worker borné, API/RLS, interface, preuves/historique et restauration.
- **À FINALISER avant clôture globale du chantier 5 :** décision et qualification du second connecteur, ou validation explicite du périmètre à un seul connecteur.
- **À QUALIFIER pour production :** Docker/CI distante, MFA IdP cible, accès public/TLS, isolation OS/egress, charge, supervision, sauvegardes chiffrées avec RPO/RTO. Le TLS local n’est pas une preuve d’accessibilité publique.
- **RISQUE RÉGLEMENTAIRE :** indices cartographiques seulement ; usages agricoles, état 2020, dégradation juridique et données 2026 non établis par ce calcul.
- **PROCHAINE VERSION :** file durable/asynchrone, cache persistant et traitement de masse, sources complémentaires et suivi des nouvelles éditions.

Aucun chantier 6, aucun nouveau push ni déploiement de production effectué pendant cet incrément.
