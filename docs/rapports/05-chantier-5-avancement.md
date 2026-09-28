# Chantier 5 — premier incrément : lectures réelles et signaux forestiers

**28 septembre 2026 · chantier EN COURS, non livré fonctionnellement.**

Branche `chantier-5/forest-signals`, issue de `425e29d`. GO reçu pour le chantier 5 ; accès aux données **à la demande** choisi explicitement par le propriétaire après présentation des implications de volume et de confidentialité. Aucun GO6, abonnement payant ou push effectué.

## FAIT

### 1. Vérification préalable et plan

- Définitions EUDR, référence au 31/12/2020, distinction couvert arboré/forêt/conversion agricole/dégradation relues.
- GFC v1.13 2000–2025 : licence commerciale CC BY 4.0 et attribution, classes et limites examinées.
- JRC TMF 2025 : deuxième candidat documenté ; réserves de métadonnées/version et conditions complètes à lever avant admission.
- Plan d’architecture, fichiers, dépendances, risques et critères de sortie consignés dans [ADR 005](../adr/005-forest-signals.md).
- Note scientifique/réglementaire : [sources forestières](../reglementation/05-signaux-forestiers.md).

### 2. Première acquisition réellement exécutée

Les trois fichiers publics GFC de la tuile `10N_010W` annoncent respectivement 127 404 260 octets (perte), 15 293 782 (masque) et 390 143 175 (couvert 2000). HEAD puis lectures partielles réelles ont été exécutés, sans coordonnées de parcelle cliente ni clé externe.

Extraction d’une **fenêtre arbitraire 64×64**, pas d’une exploitation identifiée :

| Couche | Octets réservés/téléchargés lors de cette acquisition réussie |
|---|---:|
| Année de perte | 851 968 |
| Masque historique terre/eau/sans données | 393 216 |
| Couvert arboré 2000 | 1 703 936 |
| **Total** | **2 949 120, soit 2,81 Mio environ** |

Ces chiffres ne sont pas un budget garanti pour toutes les parcelles. Les trois extraits publics réels sont conservés avec leurs empreintes, URL, génération/ETag, plages lues, grille et versions logicielles dans `backend/reference/forest/gfc-2025-qualification/`. Attribution et transformations documentées dans le NOTICE associé. Aucune empreinte de fichier amont entier n’est inventée.

La grille réellement lue est **0,00025°**, les fichiers font 40 000×40 000 pixels et leurs blocs sont des bandes de **1×40 000 pixels**. Ce ne sont pas des COG supposés par défaut. Aucun rééchantillonnage ou remplacement silencieux d’une classe.

### 3. Noyau technique ajouté, non exposé

- URLs construites exclusivement pour les couches/tuiles admises du fournisseur ; ni URL client ni redirection libre.
- Version épinglée pendant la lecture par génération GCS et If-Match/ETag ; refus des réponses non partielles, tronquées, surdimensionnées, encodées ou incohérentes.
- Limites par session : 8 Mio réservés, 128 requêtes HEAD/GET au maximum, cache LRU de 16 blocs ×64 Kio ; échéance réseau et timeouts. Les réservations échouées comptent dans le budget.
- Opener virtuel Rasterio contrôlé, pas de fichiers auxiliaires ou téléchargement intégral implicite. Fenêtre de qualification limitée à 256×256 pixels, deux ouvertures maximum par fenêtre. La taille des blocs décodés est contrôlée.
- Contrôles CRS, géotransformation, dimensions, type, classes et absence de tag nodata ambigu. Une erreur remontée dans les callbacks natifs est mémorisée pour empêcher qu’un tableau de zéros de substitution soit accepté.
- Synthèse des pixels sélectionnés distinguant signaux depuis 2021, masque historique et cas non évaluables. Un signal positif hors du masque historique de terre reste visible comme incohérence à revoir, pas effacé.
- Aucun filtre de couvert 2000 ne prétend reconstruire la forêt en 2020. Pas de surface juridique, probabilité de conformité ou score inventé. Revue humaine requise ; `NOT_ASSESSED` systématique.

Les limites globales d’un travail multi-fenêtres et l’isolation CPU/mémoire du décodeur natif en processus **restent à réaliser**. Les délais applicatifs ne sont pas présentés comme un arrêt matériel garanti d’un calcul natif bloqué. Le cache actuel est en mémoire par session, pas un cache persistant partagé.

## TESTÉ

**64 tests ciblés réussis**, mélange de fixtures synthétiques explicitement identifiées et de contrôles hors ligne des extraits publics réellement acquis.

- Protocole HTTP, cache, budgets, erreurs réseau/statuts, génération/ETag, longueurs et plages.
- Véritable décodeur Rasterio sur GeoTIFF synthétiques clairsemés ; grille/classes/nodata erronés et callback réseau en échec.
- Fenêtres hors limites, empreintes et grilles des extraits réels, année 2020 distincte de 2021/2025, zéro perte distinct de sans données, masques incomplets, sélection vide et tableaux masqués refusés.
- Ruff et format validés sur les nouveaux modules/scripts/tests.
- Scan du lock Python : aucun avis connu détecté par pip-audit lors de l’exécution. **Pas d’audit des bibliothèques natives GDAL ou des images système revendiqué.**

Preuves : [tests](preuves-chantier-5/pytest-connecteur.txt), [Ruff](preuves-chantier-5/ruff-connecteur.txt), [audit Python](preuves-chantier-5/pip-audit.txt), [HEAD réel](preuves-chantier-5/acces-gfc-head.json).

Commande des tests isolés :

```sh
PYTHONPATH=backend .venv/bin/pytest \
  --confcutdir=backend/tests/forest_unit backend/tests/forest_unit -q
```

Le `confcutdir` évite le reset PostgreSQL des tests d’intégration parents : ces 64 tests ne prétendent pas exercer les routes/RLS. Les suites complètes backend/E2E des chantiers précédents **n’ont pas été rejouées pour cet incrément**. Six avertissements PendingDeprecation Rasterio/Affine sont visibles dans le journal ; ils ne sont pas masqués.

## PROBLÈMES RENCONTRÉS / DÉCISIONS

- `rasterio.open(file_like)` tentait de matérialiser le fichier entier : le garde-fou l’a refusé. Remplacé par un opener contrôlé, puis succès des lectures réelles.
- Documentation GFC « 1–20 » restée dans une phrase de la page 2025 : classes 0..25 corroborées par le catalogue versionné et les extraits réels ; codes inconnus refusés.
- Résolution nominale documentaire et grille GeoTIFF ne sont pas substituées l’une à l’autre.
- TMF : métadonnées annoncées comme encore v2024 alors que les produits sont v2025 ; pas d’admission silencieuse.

## NON FAIT / PROCHAINE ÉTAPE DU MÊME CHANTIER

1. Intersections géométriques qualifiées pour Point/Polygon/MultiPolygon, trous, petites parcelles et pixels de bord ; découpage multi-tuiles/multi-fenêtres et couverture explicite.
2. Isolation du worker, budgets agrégés, idempotence/reprise et cache/conservation des extraits propres aux analyses, avec permissions strictes.
3. Persistance des analyses par révision, nouvelle migration si nécessaire, RLS/FK/audit, endpoints autorisés et historique immuable.
4. Interface d’observations avec sources/limites et recette mobile.
5. Qualification distincte du second connecteur ; jamais présenter le candidat JRC comme déjà actif.
6. Non-régression complète, sécurité tenant/fournisseur, migrations peuplées, restauration et bilan final du chantier 5.

**Application toujours 0.5.0, schéma 0004. Aucune route/interface d’analyse forestière encore activée, aucune base métier ou production modifiée. Le chantier 5 reste ouvert sous le GO déjà reçu ; aucun chantier 6 engagé.**
