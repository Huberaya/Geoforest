# GeoForest Trace — chantiers 1 à 4 · v0.5.0

Socle SaaS et collecte initiale : Next.js → FastAPI → PostgreSQL/PostGIS, OIDC, organisations, fournisseurs, produits, lots, parcelles versionnées et portail sécurisé.

**Le produit ne réalise actuellement aucune analyse EUDR ni soumission réglementaire.** L'ancien prototype non qualifié est conservé dans `archive/prototype`, exclu des builds/images/exécutions. Aucune donnée historique n'est requalifiée ou supprimée.

## Livré
- Connexion Authorization Code + PKCE avec fournisseur OIDC ; Keycloak de développement fourni.
- Sessions serveur opaques, hachage du secret de session en base, cookies HttpOnly/SameSite, Secure en HTTPS ; expiration et déconnexion locale.
- Création et modification d'organisations ; appartenance multiple ; attribution/révocation de rôles.
- Rôles Admin, Compliance Manager, Procurement, Analyst, Viewer et Supplier avec périmètre obligatoire.
- Autorisation API, CSRF/Origin, limitation de débit partagée en DB, taille des requêtes limitée.
- RLS PostgreSQL avec rôle applicatif non propriétaire/non BYPASSRLS ; contexte transactionnel.
- Journal avant/après atomique et non modifiable par le rôle applicatif.
- Fournisseurs/contacts, produits multi-matières et lots ; recherche/pagination, archivage et contrôle de version.
- Import fournisseurs CSV UTF-8 vérifié, transactionnel et idempotent (100 lignes max).
- Portail mobile sans compte par lien secret à usage unique ; brouillon, transmission, revue humaine ou corrections ; propositions séparées du canonique.
- Sessions fournisseurs dédiées, expiration/révocation, RLS fournisseur et tenant, révisions soumises non modifiables par le rôle applicatif.
- Carte privée Leaflet, points/contours, coordonnées et GPS à la demande, sans fond externe.
- Import GeoJSON/KML avec aperçu, confirmation, source privée et transaction/replay ; contrôles PostGIS sans verdict réglementaire.
- Parcelles versionnées, archives, liens de lots vers une révision précise ; propositions fournisseur avec correction et adoption humaine.
- Interface desktop/mobile ; documents de légalité, analyses de déforestation/risque et déclarations restent indisponibles.

## Démarrage local avec Docker Compose

Prérequis : Docker et Compose v2, Python 3 pour générer `.env`.

```sh
python3 scripts/init-env.py   # refuse d'écraser un .env existant ; secrets locaux uniques
# Lire .env uniquement dans votre environnement privé.
docker compose up --build
```

Le service de migration s'exécute avant l'API. Aucun `push --force` de schéma au démarrage.

- Interface : http://localhost:3000
- Administration Keycloak locale : http://localhost:8080/identity/admin/
- Realm : `geoforest` ; client : `geoforest`.
- Utiliser le compte d'administration Keycloak défini dans `.env`, puis créer un utilisateur **synthétique**, avec email vérifié et mot de passe. Pas de compte démo prédéfini dans le dépôt.
- Ouvrir GeoForest, se connecter, créer une organisation.
- Pour ajouter un membre, celui-ci doit d'abord se connecter une fois (adresse email vérifiée). L'administrateur peut ensuite lui attribuer un rôle dans « Membres & accès ». Le portail fournisseur dispose d’un lien à remettre manuellement : aucun email automatique n’est envoyé.

Le navigateur utilise toujours la même origine. Next.js relaie uniquement les chemins Keycloak `realms` et `resources`. Le backend utilise `OIDC_BACKCHANNEL_ORIGIN=http://keycloak:8080` pour accéder au fournisseur sans dépendre de la résolution de `localhost` depuis le conteneur. L'issuer du jeton reste exactement celui de `OIDC_ISSUER` : aucune vérification de signature/issuer n'est désactivée.

Cette configuration Compose est **de développement**, pas de production. Les images et la CI sont fournies ; leur exécution Docker de bout en bout reste à confirmer sur l'hôte cible.

## Développement hors conteneurs

Prérequis : Node 22 (Node 20.20 a aussi été testé), Python 3.13, PostgreSQL 17 avec PostGIS, fournisseur OIDC.

1. Créer la base et les rôles séparés avec `infra/bootstrap-db.sh` ou l'équivalent DBA. Ne pas connecter l'application en superutilisateur.
2. Adapter `.env` : hôte PostgreSQL `127.0.0.1`, URLs OIDC exactes, secrets, origine frontend. `API_INTERNAL_URL=http://127.0.0.1:8000`. Si Keycloak local : `KEYCLOAK_INTERNAL_URL=http://127.0.0.1:8080`, `OIDC_BACKCHANNEL_ORIGIN=http://127.0.0.1:8080`.
3. Installer et migrer :

```sh
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.lock
# Exporter les variables .env sans les écrire dans les logs (shell de confiance uniquement).
set -a; . ./.env; set +a
.venv/bin/alembic -c backend/alembic.ini upgrade head
.venv/bin/uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8000 --no-access-log
```

Dans un autre terminal : `npm ci && npm run dev -- --hostname 0.0.0.0`.

`DATABASE_URL` est obligatoire, sans repli silencieux. `MIGRATION_DATABASE_URL` n'est nécessaire que pour les migrations ; ne pas l'injecter dans l'API en production.

## Tests

```sh
npm run lint
npm run build
npm run typecheck
npm audit --audit-level=high
```

Backend : créer une base **distincte** dont le nom finit par `_test`, initialiser les mêmes rôles/PostGIS et migrer. Fournir `DATABASE_URL` applicatif et `MIGRATION_DATABASE_URL` propriétaire pour cette base. Les fixtures refusent les noms ne finissant pas par `_test`, puis réinitialisent les données synthétiques entre tests.

```sh
APP_ENV=test .venv/bin/python -m pytest -c backend/pytest.ini backend/tests -q
.venv/bin/pip-audit -r backend/requirements.lock  # outil à installer séparément
```

E2E, application et fournisseur OIDC démarrés :

```sh
npx playwright install --with-deps chromium
# PUBLIC_ORIGIN, E2E_USERNAME et E2E_PASSWORD : compte synthétique uniquement.
E2E_RATE_PACE=1 npx playwright test
```

Sans identifiants, les tests OIDC/collecte sont explicitement ignorés ; ce n'est pas un succès de recette OIDC. Ne pas enregistrer de traces contenant mots de passe/cookies. `E2E_LOCAL_TLS=1` est une option réservée à la recette sandbox avec passerelle TLS locale : elle n'est ni nécessaire ni recommandée pour une recette réelle de l'infrastructure cible.

Les E2E créent des organisations fictives ; renouveler le compte/la base de recette avant d’atteindre le quota de dix organisations administrées. Ne pas exécuter ces scénarios sur des données réelles. `E2E_PROOF_DIR` permet de changer le dossier des captures du socle pour préserver les preuves historiques.

CI : `.github/workflows/ci.yml` exécute lint/build/typecheck/audit npm, migrations répétables, tests PostGIS et audit Python, builds Docker. Les identifiants CI sont exclusivement éphémères. L’exécution distante du workflow et les builds Docker ne sont pas qualifiés par la recette locale ; les branches 1/2 ont été poussées, la livraison 3 reste locale.

## Limites importantes

- MFA : production exige `ADMIN_ACR` et l'API bloque les actions Admin si la session ne porte pas cette valeur. **Le fournisseur doit réellement imposer ce niveau MFA** ; définir une chaîne de caractères ne configure pas la MFA. Recette MFA avec le fournisseur de production encore requise.
- Déconnexion : révoque la session GeoForest, pas nécessairement la session SSO chez l'IdP. Révocation/backchannel logout IdP non implémenté ; durée maximale de session 8 h par défaut, 24 h maximum.
- RLS : défense contre les erreurs de requêtes/tenant. Le serveur authentifié fixe le contexte ; elle ne prétend pas résister à une compromission complète du serveur capable d'usurper ce contexte.
- Supplier : accès OIDC en lecture à une fiche fournisseur active de son organisation. Portail sans compte distinct, limité à sa collecte et ses propositions parcellaires. Documents non livrés. Un lien volé donne accès au périmètre de collecte jusqu’à révocation/expiration : il ne prouve pas l’identité personnelle du porteur.
- Rate limiting : 120 appels API/minute et 10 débuts de login ou échanges de liens fournisseur/minute par adresse du pair réseau, en base. Derrière le proxy, plusieurs clients peuvent partager ce pair ; un limiteur par véritable client au reverse proxy de confiance reste indispensable en production.
- CSP : restrictions de sources et protections de base ; `unsafe-inline` reste nécessaire à cette version Next.js. CSP avec nonce strict à qualifier avant production.
- Sessions en base stockent uniquement le hachage du jeton navigateur ; les tables d'identité sont globales au système, les appartenances et événements sont tenantés.
- Aucun coffre de preuves documentaires, source satellite, export officiel, facturation ou assistant IA activé ; les sources d’import parcellaire sont conservées en base.

## Documentation

- `docs/adr/001-socle.md` — architecture et critères de sortie.
- `docs/SECURITE_ET_EXPLOITATION.md` — permissions, secrets, sauvegardes et recette production.
- `docs/API.md` et `docs/openapi.json` — contrats des chantiers 1 à 3.
- `docs/rapports/01-chantier-1.md` — bilan réel, preuves et réserves.
- `docs/rapports/00-audit.md` — audit initial.

- `docs/adr/002-collecte.md` — décisions du chantier 2.
- `docs/GUIDE_COLLECTE.md` — guide entreprise et fournisseur.
- `docs/rapports/02-chantier-2.md` — recette, limites et bilan de livraison.

- `docs/adr/003-parcelles.md` — architecture du module parcellaire.
- `docs/GUIDE_PARCELLES.md` — guide entreprise et fournisseur.
- `docs/reglementation/03-geolocalisation-verification.md` — références et limites.
- `docs/rapports/03-chantier-3.md` — livraison, preuves et réserves.

**Chantier 4 livré localement dans le périmètre mondial indicatif, avec exceptions documentées. Aucun chantier 5 sans nouveau GO.** Aucun PAT GitHub n'est nécessaire pour travailler et tester localement.

## Cohérence pays mondiale indicative — chantier 4

Migration **0004** requise pour l’application 0.5.0. Dans le détail d’une parcelle : comparaison et historique immuable par révision, marge de revue explicite, source/version/année/limites visibles. Aucun pays n’est déclaré vérifié.

Natural Earth 1:10 millions, snapshot épinglé, **246 codes ISO de pays et territoires**, exceptions AQ/EG/UM explicites. Donnée cartographique indicative, pas précision parcellaire ou frontière juridiquement actuelle. Pas de réparation silencieuse des données invalides ni de déduction de souveraineté. Aucune source distante appelée pendant l’analyse.

Voir `docs/rapports/04-chantier-4.md`, `docs/reglementation/04-sources-geographiques.md`, `backend/reference/naturalearth/NOTICE.md` et le guide utilisateur. Les six E2E créent quatre organisations par suite : base synthétique dédiée et quota à surveiller, sans modifier les limites de l’application.
