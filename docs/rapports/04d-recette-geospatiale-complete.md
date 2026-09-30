# Chantier 4 — recette fonctionnelle intégrée et vérification Neon

**30 septembre 2026. Exécution réelle de la recette ; pas de mise en service publique.**

## Objectif et état de sortie

À la demande du propriétaire, exécuter la recette du chantier 4 sans redemander des captures ou des informations déjà disponibles. Vérifier le moteur, l'API, le navigateur, les permissions, l'historique et la restauration, puis contrôler la connexion Neon existante sans écriture.

**Résultat : périmètre fonctionnel mondial indicatif validé en recette locale, accès runtime Neon vérifié en lecture seule. Le critère d'utilisation depuis Vercel Production reste NON SATISFAIT. Ce rapport ne clôture donc pas la livraison publique demandée.** Aucun accueil limité publié.

## Correction du diagnostic d'accès

Les identifiants runtime Neon existaient déjà dans la configuration privée préparée au chantier 8b, hors dépôt. L'affirmation précédente selon laquelle ils manquaient était incorrecte : seule la configuration `.env` du dépôt avait été inspectée. Leur utilisation est désormais vérifiée, sans révéler ni copier leurs valeurs.

- Connexion au rôle `geoforest_app`, TLS `verify-full`, transactions read-only imposées dès la connexion.
- Aucun usage du mot de passe migrateur ou administrateur sur Neon.
- Readiness de l'application : **PASS**, schéma **0007**, contrôles du rôle et des politiques RLS réussis.
- PostGIS distant **3.6.4**.
- Calculs sur points entièrement inventés CI/FR : `INSIDE_REFERENCE_INDICATIVE` ; AQ : `NOT_COVERED`. Toujours `country_verified=false`, revue humaine nécessaire.
- Aucun SELECT de données métier, INSERT, UPDATE, DELETE ou migration distante. Requêtes de catalogue système/readiness et calculs SQL sur constantes synthétiques uniquement ; transaction annulée à la fin.

Preuve : `recette-finale/neon-readonly.json`. Cette vérification n'est ni une session utilisateur ni une recette complète d'API distante. Les erreurs isolées du catalogue SQL ne peuvent pas être assimilées à un verdict réglementaire.

## Tests exécutés et résultats

| Vérification | Résultat |
|---|---:|
| Géométries, moteur, 246 références mondiales, contrôles pays API, parcelles et imports sur PostgreSQL/PostGIS locaux réels | **396 PASS** |
| Tests frontend complets | **107 PASS** |
| Audit d'artefact et garde-fous du préparateur de session de recette | **12 PASS** |
| Chromium : frontend Next + API FastAPI + PostgreSQL/PostGIS, sans simulation des réponses métier | **1 parcours PASS** |
| **Total de tests exécutés dans ce lot** | **516 PASS** |
| Build Next, TypeScript, ESLint, Ruff ciblé | PASS |
| Restauration locale séparée et comparaison d'empreintes | PASS |
| Runtime Neon / calculs read-only | PASS |

L'avertissement Starlette/TestClient/httpx préexistant demeure (un avertissement dans les 396 tests). La suite du dépôt entier n'a pas été exécutée : le total indique les suites effectivement relancées, pas une nouvelle qualification de tous les chantiers.

### Recette PostgreSQL locale et périmètre de sécurité

Installation locale PostgreSQL **17.11** et PostGIS, base neuve **geoforest_gis_final_test**, rôles migrateur/runtime sans privilèges élevés. Migrations 0001–0007 appliquées **seulement localement**. Aucun candidat 0008 appliqué dans ce lot.

Les suites contrôlent notamment les 246 empreintes/structures/topologies PostGIS, géométries invalides et extrêmes, exceptions et sources indisponibles, calculs et limites, révisions, RBAC/RLS organisation/fournisseur, idempotence, concurrence, permissions append-only, CSRF et imports. Aucun verdict ne provient du navigateur.

### Recette navigateur intégrée

Nouveau scénario reproductible dans `tests/gis-integrated/`, adapté du scénario historique du chantier 4, avec une session opaque **fictive précréée uniquement dans la DB locale dédiée**. **Il ne teste pas une connexion Clerk/OIDC réelle.** Aucune route de connexion de test ajoutée à l'application.

Parcours exécuté :

1. Accès au vrai `/espace` via le frontend Next construit ; session applicative relue par la véritable API.
2. Création via API d'une organisation et d'un fournisseur fictifs puis d'un point inventé en Côte d'Ivoire.
3. Comparaison pays avec marge explicitement renseignée ; résultat indicatif, source Natural Earth, provenance et revue humaine visibles.
4. Création d'une révision déclarée AQ, comparaison et affichage « Pays non couvert ».
5. Retour à la révision 1 : ancien résultat retrouvé, non réécrit ni remplacé par celui de la révision 2.
6. Dialogue intégré vérifié à **390 et 360 px**, capture desktop à 1440 px ; absence de débordement horizontal et d'erreur JavaScript.

Les requêtes métier ne sont pas interceptées/mockées. Le moteur, SQL, CSRF, droits et le stockage d'historique sont réels sur cette base fictive. Les contrôles unitaires 04b des erreurs et réponses tardives sont inclus dans les 107 tests frontend.

Le préparateur `scripts/seed-gis-final-e2e.py` impose APP_ENV=test, un opt-in, les deux URLs loopback et le nom exact de DB dédié, sans override query. Il refuse d'écrire le fichier de session dans le dépôt. Six tests négatifs vérifient ces refus avant tout import des fixtures DB. Fichier privé 0600, création exclusive ; session non journalisée. Après recette/restauration, les sessions locales sont révoquées et le fichier privé supprimé.

### Restauration et historique

Dump de la DB synthétique restauré dans la base distincte **geoforest_gis_restore_test**, sans écraser la source. Comparaison avant révocation des sessions :

| Table | Lignes comparées | Empreintes identiques |
|---|---:|---|
| plots | 1 | oui |
| plot_geolocations | 2 | oui |
| country_checks | 2 | oui |
| audit_events | 6 | oui |

Readiness runtime, invisibilité sans contexte et interdiction UPDATE/DELETE sur `country_checks` vérifiées sur les deux bases. Sessions synthétiques révoquées dans les deux bases après comparaison. Aucun rétablissement de service métier ni promotion des données restaurées.

Le premier comparateur avait supposé à tort une colonne `id` pour `plot_geolocations`. Il a été corrigé pour trier les représentations complètes des lignes ; la restauration n'a pas été refaite ni la table modifiée pour masquer cette erreur. Preuve finale : `restore-local.json`.

Ceci n'est pas une qualification de sauvegarde hors site ou de RPO/RTO. Les dumps locaux dans le cache et les services de recette sont éphémères ; tous les serveurs lancés pour la recette ont été arrêtés.

## Blocage public actuel — précis, sans nouvelle demande de captures

La relecture authentifiée Vercel confirme que Production reste sur `a924ba8` (chantier 2). Aucun déploiement ni alias modifié dans ce lot.

Les paramètres Clerk privés retrouvés sont de type **test/développement**. La requête de lecture de l'instance via l'API de gestion Clerk a répondu 403 ; cela ne prouve pas à lui seul l'invalidité des clés pour tous les endpoints. Aucune configuration Clerk live qualifiée n'est disponible ici.

Le backend prévu pour Vercel refuse explicitement les identités de développement sur une base distante. Supprimer ce refus pour connecter les clés test à Neon ne constitue pas une fin de chantier acceptable. La configuration production prévue exige par ailleurs le domaine propre différé par le propriétaire. Aucune activation de domaine, conversion d'instance, clé inventée, faux compte ou contournement de MFA n'a été effectué.

Le déploiement Vercel observé mentionne Hobby : les conditions d'un lancement commercial restent à qualifier, sans achat/abonnement implicite.

**Le runtime Neon n'est plus un bloqueur d'accès. Le chemin critique restant est la configuration d'identité de production autorisée, puis le déploiement du backend, la réécriture frontend et la recette authentifiée du site public.** Les précédents constats sur le routage privé ne sont pas présentés comme résolus par cette recette locale.

## Livrables, dépendances et reproduction

- `scripts/seed-gis-final-e2e.py` et ses tests de refus.
- `tests/gis-integrated/{playwright.config.ts,country-checks.spec.ts}`.
- Preuves dans `docs/rapports/preuves-chantier-4/recette-finale/`, captures intégrées, audits et manifeste SHA-256.
- Suivi actualisé, rectification du diagnostic d'accès dans le rapport 04c.
- Dépendances métier inchangées ; installation à partir de `backend/requirements.lock` et `package-lock.json`. Outils navigateur/Ruff locaux seulement.

Pour rejouer : provisionner explicitement la DB locale dédiée et ses rôles, migrer localement jusqu'à 0007, définir les deux URLs locales ainsi que APP_ENV=test/AUTH_PROVIDER=oidc/VERCEL=0. Exécuter les six suites backend listées dans `backend-tests.txt` et le code de recette ci-dessous. Ne jamais transmettre une URL Neon à pytest : les fixtures réinitialisent leurs bases de test.

```sh
npm run test:unit
npm run typecheck
npm run lint
.venv/bin/pytest --confcutdir=tests/geospatial_artifact tests/geospatial_artifact -q
# Après configuration locale explicite et lancement API :8000 + Next :3000 :
GIS_FINAL_LOCAL_TEST=1 GIS_FINAL_SESSION_FILE=/chemin/prive/session.json \
  .venv/bin/python scripts/seed-gis-final-e2e.py
GIS_FINAL_SESSION_FILE=/chemin/prive/session.json \
  npx playwright test --config tests/gis-integrated/playwright.config.ts
```

Révoquer les sessions de la fixture et supprimer son fichier après recette ; ne pas laisser ces services exposés. Les mots de passe privés de Neon/Clerk ne figurent pas dans les preuves et ne sont pas envoyés au frontend. La modification préexistante de `infra/bootstrap-db.sh` est exclue du commit.

## Bilan

- **PRÊT — recette fonctionnelle :** moteur mondial indicatif, données, permissions, historique, UI intégrée/mobile et restauration locale vérifiés.
- **PRÊT — accès DB existante :** runtime Neon et calculs read-only vérifiés, aucune migration requise pour le chantier 4.
- **À FINALISER :** qualification/déploiement runtime et parcours public authentifié.
- **BLOQUÉ — clôture publique complète :** identité production/configuration de domaine et hébergement admissibles non prêts ; aucun accueil limité publié à la place.
- **RISQUE RÉGLEMENTAIRE :** contrôles indicatifs uniquement, source historique de facto à l'échelle 1:10 millions, aucune preuve d'authenticité de parcelle, de légalité ou de conformité EUDR.
- **PROCHAINE ACTION :** lever les prérequis d'identité et publier le backend/frontend autorisés, puis obtenir les preuves publiques qui manquent ; ne pas annoncer le chantier déployé sur la seule base des tests locaux.
