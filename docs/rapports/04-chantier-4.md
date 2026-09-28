# Chantier 4 — livraison du moteur géospatial mondial indicatif

**28 septembre 2026 · GeoForest Trace 0.5.0 · migration 0004**

Branche : `chantier-4/gis-sources`.

**PRÊT pour validation fonctionnelle locale dans le périmètre choisi : couverture mondiale indicative, avec exceptions explicites. Pas de qualification de production ou de conformité EUDR. Aucun chantier 5 commencé.**

Le propriétaire a choisi la couverture mondiale indicative après le pilote ivoirien. Ce rapport remplace les points d’avancement précédents, conservés comme archives.

## 1. FAIT

| Domaine | Livraison |
|---|---|
| Référentiel mondial | Natural Earth **Admin 0 Map Units, échelle 1:10 millions**, snapshot épinglé ; **246 codes ISO de pays et territoires** admis après contrôles techniques |
| Sources et licence | Octets amont, commit, empreinte, licence et attribution conservés ; domaine public selon les conditions du fournisseur ; aucun téléchargement pendant une analyse |
| Dérivation documentée | Groupement selon ISO_A2_EH, contrôle des composantes puis dissolution explicite de leurs frontières internes par PostGIS ; pas de ST_MakeValid, reprojection ou simplification |
| Exceptions | AQ / EG / UM non couverts ; 18 unités non ISO ou non rattachées sans ambiguïté listées et non affectées par supposition |
| Cohérence pays | Couverture, intersection partielle, contact/proximité d’une limite, résultat hors référentiel ; marge technique choisie explicitement par l’utilisateur |
| Versionnement | Résultat immuable attaché à organisation/fournisseur/parcelle/**révision**, acteur et date ; anciennes analyses jamais recalculées ou réécrites implicitement |
| Traçabilité | Empreinte de la parcelle, source/empreinte/version/année si connue, méthode/PostGIS, attribution/licence, marge et limites |
| Sécurité | RLS, clés composites, lecture Supplier limitée, droits d’écriture, CSRF, idempotence et audit atomique ; aucune API de verdict fourni par le client |
| Interface | Contrôle et historique dans le détail parcellaire, pagination, sources/limites, état non couvert/indisponible ; responsive testé |
| Exploitation | Migration 0004, montée depuis une 0003 peuplée, répétition, restauration isolée, documentation et OpenAPI |

Les utilisateurs Admin/Compliance Manager/Procurement peuvent lancer une comparaison. Analyst/Viewer et Supplier OIDC lisent seulement leur périmètre. Le portail par lien reste séparé : il ne donne pas accès aux historiques du référentiel entreprise.

## 2. CE QUE « MONDIAL INDICATIF » SIGNIFIE

Le terme **10m de Natural Earth signifie 10 millions d’échelle, pas dix mètres de précision**. Cette donnée cartographique ne mesure pas l’exactitude d’une parcelle, d’un capteur GPS ou d’une frontière légale.

- Source brute : `ne_10m_admin_0_map_units.geojson`, 298 unités amont.
- Commit : `f1890d9f152c896d250a77557a5751a93d494776`, tag du dépôt v5.1.2, commit daté du 13 mai 2022.
- SHA-256 amont : `57da82be755f4afccd8f3b14251bb2752f5df1395f47d2d86f817470c4a48862`.
- **Aucune année représentée universelle fournie par la source** : elle est indiquée comme non renseignée. Date de commit, de téléchargement et validité juridique ne sont pas interchangeables ; aucune actualité des frontières en 2026 n’est garantie.
- Conventions territoriales **de facto**, pas arbitrage de souveraineté ni adoption d’un point de vue juridique national.
- France FR et Guyane GF sont traitées séparément selon les unités ISO de ce référentiel. Le snapshot geoBoundaries FRA rejeté au premier incrément n’a pas été réhabilité : il s’agit d’une **autre source**.

### Exceptions visibles, jamais masquées

| Code | Pays / territoire | Motif |
|---|---|---|
| AQ | Antarctique | Étendue polaire non prise en charge par la politique technique retenue |
| EG | Égypte | Géométrie amont invalide ; refus plutôt que réparation silencieuse |
| UM | Îles mineures éloignées des États-Unis | Pas d’unité ISO rattachée sans ambiguïté dans la sélection |

Les 18 unités amont non ISO/non rattachées sont conservées dans la liste du manifeste. Cette couche seule n’est **pas une détection exhaustive des territoires disputés**. Aucune attribution forcée à un autre pays et aucune conclusion favorable par défaut.

Tous les contrôles produisent `country_verified:false`, `human_review_required:true`, `regulatory_status:NOT_ASSESSED`. « Dans le référentiel » n’est pas « pays vérifié ». « Hors du référentiel » n’est pas une preuve de fraude ou de non-conformité. La marge de proximité 0..50 000 m est un paramètre de revue, sans précision ou seuil réglementaire déduit.

Sources, décisions et limites détaillées : [qualification préalable et extension mondiale](../reglementation/04-sources-geographiques.md). Dérivation et attribution : `backend/reference/naturalearth/NOTICE.md`.

## 3. TESTS ET PREUVES

| Contrôle | Résultat | Preuve |
|---|---|---|
| Backend complet, PostgreSQL/PostGIS réels | **474 tests réussis**, 1 avertissement TestClient/httpx préexistant | [pytest final](preuves-chantier-4/pytest-final.txt) |
| Références mondiales | Chacun des **246 codes** vérifié en empreinte, structure et topologie ; exceptions explicites | [qualification](preuves-chantier-4/qualification-mondiale.json), `test_world_references.py` |
| Ruff / format | Réussis | [Ruff](preuves-chantier-4/ruff-final.txt) |
| TypeScript / ESLint | Réussis | [types](preuves-chantier-4/types-final.txt), [lint](preuves-chantier-4/lint-final.txt) |
| Build standalone 0.5.0 | Réussi | [build](preuves-chantier-4/build-final.txt) |
| Recette navigateur avec vrai OIDC/API/DB | **6 parcours réussis, aucun ignoré** | [E2E final](preuves-chantier-4/e2e-final.txt) |
| Migration 0003 peuplée → 0004 puis répétition | Réussie, données existantes inchangées | [migration](preuves-chantier-4/migration.txt) |
| Restauration finale avec résultats v1 et v2 | Six contrôles restaurés avec empreintes complètes identiques, RLS/privilèges/session vérifiés | [restauration mondiale](preuves-chantier-4/restauration-mondiale.txt) |
| Dépendances inchangées depuis l’intégration | Aucun avis connu détecté lors des scans exécutés | [npm](preuves-chantier-4/npm-audit.txt), [Python](preuves-chantier-4/pip-audit.txt) |
| Readiness | Schéma 0004 et PostGIS disponibles | [readiness](preuves-chantier-4/readiness.json) |

### Couverture de la recette

Les tests couvrent les sources absentes/altérées, budgets, clés répétées, CRS ambigus, symlinks, géométries invalides, marges non finies, frontières exactes, proximité des deux côtés, polygones traversants, multipolygones partiellement couverts, trous et indisponibilité SQL isolée par savepoint.

Les points tests globaux sont inventés, pas des exploitations identifiées. Ils contrôlent notamment FR, GF, BR, ID, CI, RU, CA et AU. Une vérification explicite distingue GF de FR selon les conventions de la source, **sans déduction de souveraineté**. Les 246 contrôles de validité ne constituent pas une validation empirique de toutes les frontières.

La recette API couvre les permissions, l’isolation tenant/fournisseur, les révisions historiques, les droits append-only, les conflits de requête et les relances concurrentes sans double résultat/audit. La source et la géométrie sont déterminées côté serveur, pas envoyées comme prétendu verdict par le navigateur.

Le parcours UI compare une géométrie inventée à CI, crée une nouvelle révision déclarée AQ et observe « non couvert », puis retrouve le résultat de la première révision inchangé. Absence d’erreur JavaScript, dialogue sans débordement horizontal à 390/360 px. Les cinq parcours précédents restent verts. Captures : [desktop](preuves-chantier-4/monde-coherence-desktop.png), [mobile](preuves-chantier-4/monde-coherence-mobile.png).

Les tests navigateur utilisent le TLS **local de recette**, pas une preuve d’accessibilité publique. Les fenêtres de renouvellement de quota (`E2E_RATE_PACE=1`) sont explicites ; les limites de l’application n’ont pas été augmentées. L’audit Python porte sur le lock complet épinglé, sans nouvelle résolution pip ; pas d’audit d’images revendiqué.

## 4. MIGRATIONS ET CONSERVATION

**0004 appliquée uniquement à des bases synthétiques locales. Aucune production modifiée.**

- `geoforest_test` : pytest jetable, migration 0004.
- `geoforest_gis_acceptance` : recette navigateur et runtime de démonstration, chaîne vierge jusqu’à 0004 et répétition.
- `geoforest_acceptance` : montée d’une ancienne base synthétique 0003 peuplée ; comptages et empreintes des anciennes parcelles/imports/snapshots conservés.
- `geoforest_world_restore_test` : restauration isolée de l’instantané final ; **4 contrôles `v1-pilot` et 2 `v2-global-indicative`**, identiques à la source. Zéro ligne visible sans contexte runtime, UPDATE/DELETE non accordés, sessions OIDC/portail restaurées révoquées.

Les snapshots source, le manifeste et le logiciel doivent être archivés **avec** la DB : le dump seul conserve le résultat mais ne fournit pas les contours nécessaires au recalcul historique. Le script de préparation est un outil de build hors ligne, à utiliser dans un checkout isolé, jamais pour réécrire un référentiel en service. Déployer atomiquement une version revue.

La migration 0004 du pilote suffit à l’extension mondiale : aucun remplacement des données historiques, aucune migration 0005. La restauration suit la procédure PostGIS contrôlée déjà documentée ; elle ne qualifie pas la reprise de l’infrastructure cible ou un RPO/RTO.

## 5. RÉSERVES ET STATUT DE SORTIE

| Statut | Élément |
|---|---|
| **PRÊT — local** | Moteur mondial indicatif, catalogue/versionnement, API/UI, historique et droits dans le périmètre documenté |
| **À FINALISER — production** | Hébergement/proxy/TLS, accès public, MFA IdP cible, Docker/CI distante, supervision, accessibilité complète, charge, sauvegardes chiffrées et reprise réelle |
| **BLOQUÉ — publication GitHub** | Chantier 4 conservé localement ; authentification sécurisée nécessaire au push, anciens tokens non réutilisés ; main inchangée |
| **RISQUE RÉGLEMENTAIRE** | Source cartographique ancienne et indicative, conventions de facto, pas de preuve de pays réel/propriété/légalité/déforestation ; aucun régime ou niveau de risque déduit du seul pays |
| **PROCHAINE VERSION** | Sources plus précises/récentes qualifiées, résolution des exceptions, gestion enrichie des zones disputées, analyses de masse et workflow de résolution de revue |
| **CHANTIER 5 NON ENGAGÉ** | Déforestation et connecteurs environnementaux sourcés nécessitent un nouveau GO |

Aucun fond tiers, traitement satellite, transmission officielle ou certification EUDR ajouté. Le portail de propositions conserve ses contrôles géométriques ; les comparaisons pays persistantes portent sur le référentiel entreprise. Pas de capacité à plusieurs millions de parcelles ou de SLA annoncé sans test de charge.

## 6. LIVRABLES

- `backend/app/geospatial/`, migration `0004_country_checks`, tests unitaires/intégration et scénario E2E.
- Sources publiques, manifeste et dérivés dans `backend/reference/naturalearth/`, préparateur `scripts/prepare-naturalearth.py`.
- Interface `CountryChecks`, historique par révision, catalogue API et OpenAPI actualisé.
- [Guide utilisateur](../GUIDE_PARCELLES.md), [API](../API.md), [exploitation](../SECURITE_ET_EXPLOITATION.md), [ADR](../adr/004-gis-sources.md), [sources](../reglementation/04-sources-geographiques.md).

**Chantier 4 terminé localement dans le périmètre mondial indicatif choisi, avec les exceptions et réserves ci-dessus. Attente du GO du propriétaire avant tout chantier 5.**
