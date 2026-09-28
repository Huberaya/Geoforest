# Chantier 4 — pilote de cohérence pays intégré

28 septembre 2026 · application **0.5.0** · schéma **0004**

**Pilote fonctionnel et recetté localement. Chantier 4 non clôturé : couverture géographique supplémentaire à définir et qualifier. Aucun chantier 5 engagé.**

Ce rapport remplace, pour l’état courant, le point d’avancement du premier incrément. Il ne transforme pas le pilote ivoirien en couverture mondiale.

## FAIT

- Comparaison accessible dans le **détail d’une parcelle**, sur la révision explicitement consultée ; marge de revue saisie par l’utilisateur, sans valeur implicite ni prétendue précision réglementaire.
- Géométrie/pays relus côté serveur depuis le snapshot autorisé. Le pays déclaré et les anciennes géolocalisations ne sont pas modifiés.
- Résultats persistés dans `country_checks`, append-only pour le runtime, avec FK composite organisation/fournisseur/parcelle/révision, acteur, date serveur et audit atomique.
- Source, année représentée, version, empreinte, attribution/licence, version de méthode/PostGIS et limites conservées avec chaque résultat.
- Historique paginé par révision ; une nouvelle révision ne récupère pas artificiellement le contrôle de l’ancienne. Consultation et comparaison des révisions historiques/archives possibles.
- Écritures réservées Admin/Compliance Manager/Procurement ; Analyst/Viewer en lecture ; Supplier OIDC en lecture de son fournisseur seulement. Portail par lien inchangé, sans accès aux historiques du référentiel entreprise.
- Relance idempotente par organisation/UUID de requête, y compris requêtes concurrentes. Une réutilisation avec une autre parcelle/révision/marge est refusée en 409. Nouvelle analyse = nouvel identifiant.
- Pays sans source : **Pays non couvert**. Source manquante, altérée ou échec de calcul : **Source indisponible**, historisée sans devenir une validation favorable.
- Tous les résultats conservent pays non vérifié, risque réglementaire non évalué et revue humaine nécessaire. Aucun appel à un service géographique externe pendant le calcul.
- OpenAPI, guide utilisateur, exploitation et README actualisés ; captures historiques des chantiers précédents préservées.

## COUVERTURE RÉELLE

**Côte d’Ivoire seulement**, contour geoBoundaries/Natural Earth représentant 2018, build 2023, téléchargé et épinglé au chantier 4. Usage : comparaison indicative avec ce contour historique, pas frontière juridiquement certifiée actuelle ni donnée cadastrale.

**France exclue** du catalogue de calcul pour les raisons documentées dans [la qualification des sources](../reglementation/04-sources-geographiques.md). Tous les autres pays restent non couverts. Aucun pays prioritaire du client n’a été déduit de son siège, de sa localisation ou des fixtures synthétiques.

La couverture complémentaire doit être définie et ses sources qualifiées avant de clôturer le chantier 4. Le moteur et le stockage sont utilisables, mais cela ne suffit pas à annoncer une fonction mondiale de vérification de pays.

## RECETTE

| Contrôle | Résultat | Preuve |
|---|---|---|
| Backend complet / PostGIS réel | **217 tests réussis**, 1 avertissement TestClient/httpx préexistant | [pytest](preuves-chantier-4/pytest-integration.txt) |
| Ruff et format | Réussis | [ruff](preuves-chantier-4/ruff-integration.txt) |
| TypeScript / lint | Réussis | [types](preuves-chantier-4/types.txt), [lint](preuves-chantier-4/lint.txt) |
| Build standalone 0.5.0 | Réussi | [build](preuves-chantier-4/build.txt) |
| Suite navigateur avec vrai OIDC/API/DB | **6 parcours réussis, aucun ignoré** | [E2E](preuves-chantier-4/e2e.txt) |
| Reprise ciblée du parcours cohérence pays | Réussie après ajustement du cadrage de la capture mobile | [E2E ciblé](preuves-chantier-4/e2e-cible.txt) |
| Migration 0003 peuplée → 0004, puis répétition | Réussie ; comptages et empreintes des anciennes données identiques | [migration](preuves-chantier-4/migration.txt) |
| Restauration isolée 0004 | Quatre contrôles restaurés à l’identique ; RLS/privilèges vérifiés, sessions révoquées | [restauration](preuves-chantier-4/restauration.txt) |
| Readiness | `0004`, PostGIS disponible | [readiness](preuves-chantier-4/readiness.json) |
| Audits de dépendances | Aucun avis connu détecté dans les scans exécutés | [npm](preuves-chantier-4/npm-audit.txt), [Python](preuves-chantier-4/pip-audit.txt) |

Les **16 nouveaux cas d’intégration API** complètent les 201 tests précédents : permissions, isolation organisation/fournisseur, historique immuable par révision, replay/conflit, requêtes concurrentes sans doublon, source indisponible, entrées strictes et CSRF. Le test de readiness restaure désormais la version réellement présente au départ et contrôle aussi le retour à l’état disponible, plutôt qu’une ancienne constante de migration.

Le parcours navigateur crée un fournisseur et un point **inventés**, calcule un résultat ivoirien indicatif, modifie le pays de la parcelle vers FR dans une nouvelle révision, observe « non couvert », puis retrouve le résultat de la première révision sans réécriture. Absence d’erreur JavaScript et de débordement dans le dialogue à 390/360 px. Les cinq parcours précédents passent également.

La recette utilise la passerelle **TLS locale**, pas une validation d’accès public ou de production. `E2E_RATE_PACE=1` laisse renouveler le quota réel du pair réseau avant les autres suites denses, sans augmenter la limite applicative. L’audit Python porte sur les versions entièrement épinglées du lock avec `--disable-pip --no-deps` ; ce n’est pas un audit d’image Docker.

Captures : [desktop](preuves-chantier-4/coherence-desktop.png) · [résultat mobile](preuves-chantier-4/coherence-mobile.png).

## MIGRATIONS ET DONNÉES

- `geoforest_test` : migration 0004 et recette pytest, fixtures jetables seulement.
- `geoforest_gis_acceptance` : nouvelle base synthétique pour la recette navigateur, toute la chaîne jusqu’à 0004 puis second `upgrade head` ; runtime de démonstration configuré sur cette base.
- `geoforest_acceptance` : ancienne recette synthétique 0003, montée à 0004 avec comparaison des comptages/empreintes des parcelles, géolocalisations, sources et snapshots ; aucune différence.
- `geoforest_gis_restore_test` : restauration séparée d’un instantané contenant quatre contrôles. Empreinte de chaque ligne complète conservée, zéro ligne visible sans contexte runtime, aucun UPDATE/DELETE autorisé à celui-ci ; sessions OIDC et portail restaurées révoquées.

Aucune base de production concernée. Aucun downgrade destructif. La restauration suit la procédure PostGIS documentée au chantier 3, avec droit d’extension temporaire révoqué et sans restauration des commentaires. Elle ne qualifie pas un RPO/RTO ou un plan de reprise réel.

## NON FAIT / RÉSERVES

- Couverture supplémentaire : **à définir et qualifier**, sans extrapoler le pilote CI à d’autres pays ni réhabiliter silencieusement le contour FR rejeté.
- Pas de réanalyse automatique, analyse de masse de lots ou workflow de résolution de la revue humaine. L’utilisateur peut produire et consulter des résultats, pas déclarer un risque EUDR négligeable.
- Pas de nouvelle comparaison persistante dans le portail de propositions ; contrôle effectué dans le référentiel entreprise. Le portail conserve ses contrôles géométriques du chantier 3.
- Pas de fond tiers, satellite, déforestation, qualification de propriété/légalité, transmission officielle ou verdict réglementaire.
- Charge à grande échelle, Docker/CI distante, accessibilité complète, proxy public, MFA IdP de production, sauvegardes chiffrées et reprise cible non qualifiés ici.
- Une frontière est une donnée politique et cartographique imparfaite. Une intersection ne prouve ni souveraineté, ni localisation réelle, ni fausse déclaration. La marge de revue est un choix technique, pas une mesure d’exactitude.

## GIT / SUITE

Travail sur `chantier-4/gis-sources`, après l’incrément `6ddc606`. Aucun push de chantier 4 dans cette étape et aucun ancien token réutilisé. `main` inchangée.

**Prochaine étape : préciser la couverture géographique utile, qualifier les sources correspondantes puis clôturer la recette du chantier 4 dans ce périmètre explicite. Aucun passage au chantier 5 sans nouveau GO.**
