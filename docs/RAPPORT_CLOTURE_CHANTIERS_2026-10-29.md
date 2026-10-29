# Clôture des chantiers GeoForest — rapport du 29 octobre 2026

> **Note de reconstitution (29/10/2026, après la rédaction initiale).** L'environnement de travail a été
> reconstruit entre la rédaction de ce rapport et sa publication : les objets Git locaux (commits
> `c9f89da`…`7632837`) et les journaux de preuve d'origine ont été perdus ; **le contenu des fichiers
> a été intégralement conservé** (43 fichiers, vérifiés identiques par diff contre `24d0374`,
> empreinte `countries-50m.json` inchangée). L'historique a été recréé commit par commit, mêmes
> périmètres et mêmes messages, et **toute la validation a été rejouée** sur la nouvelle tête de code
> **`94c5f14466da2fca895718430644b56f991ffaf7`** (toolchain réinstallée : `npm ci`, venv Python,
> PostgreSQL 16.2 via pgserver). Correspondance : `c9f89da`→`702a8bc`, `b009bce`→`b2b2244`,
> `dbf5490`→`1c2273e`, `11c92ad`→`3138e98`, `43cbf35`→`ec8a306`, `02e3224`→`94c5f14`.
> Dans la suite du document, les SHA `02e3224`/`11c92ad`/`43cbf35` désignent le contenu validé ;
> les journaux cités existent désormais sous le SHA `94c5f14` (`/home/user/logs/*-94c5f14….log` et
> `/home/user/logs/serveur-local/journaux/`). Les résultats rejoués sont **identiques** à ceux du
> tableau C (lignes 1–26), à une exception près de procédure : `test:cross-tenant:rls` exige des
> données métier créées par les suites HTTP, il a donc été rejoué après elles (99/99).

**Branche** : `arena/ba2f9eba-geoforest` · **SHA du code validé** : `94c5f14466da2fca895718430644b56f991ffaf7` (contenu identique à `02e3224a138227e639e22b4236b17bf1c5d8711c`, cf. note ci-dessus)
**Base** : `origin/main` = `1c95f4c585ed8303f887089ae7450c9235523fd0` (inchangée depuis le début de la mission ; `origin/main` est ancêtre de la branche, fusion en avance rapide possible, aucun conflit).
**Ligne reprise** : `24d0374ae9c2d874ac9be1051f152d2a9ac8f988` (= PR #8 `arena/569eff1a-geoforest` + PR #10 + preuve de restauration), CI distante verte sur ce SHA.

Tout ce qui suit a été **exécuté**, pas déduit. Chaque ligne du tableau C renvoie à un journal dont le nom porte le SHA. Les journaux sont hors dépôt (`/home/user/logs/`, environnement de la mission) ; les commandes sont rejouables avec les deux harnais versionnés (`scripts/recette/postgresql-recette.sh`, `scripts/recette/serveur-local.sh`).

---

## A. Résultat global

| Chantier | Verdict | En une phrase |
|---|---|---|
| **A — Base, migrations, rôles effectifs, isolation** | **TERMINÉ** | `db:migrate` redevenu idempotent sur base peuplée sous propriétaire non superutilisateur ; historique Drizzle réaligné et contrôlé en CI ; toutes les migrations ont une descente, chaîne 0010→0005 déroulée et remontée ; RLS 13/13 tables, 34 politiques, cloisonnement 262/262 (HTTP) + 99/99 (SQL) ; restauration prouvée. |
| **B — Backend, API, GeoJSON, GFW fail-closed, traçabilité** | **TERMINÉ, avec une action externe ouverte** | Attribution du pays par frontières versionnées (P2-16) portée en TS et Python, risque pays jamais inventé, export TRACES honnête sur la méthode ; 73/73 règles EUDR, 168 tests Python, preuve HTTP réelle. Les cas GFW A/B/E restent **BLOQUÉS** faute de réseau et de clé — documenté, pas simulé. |
| **C — Frontend, parcours, CI, lint, typecheck, build, E2E** | **TERMINÉ** | Next.js 16.4.3 (avis critique corrigé, 0 vulnérabilité), typecheck/lint/build verts, e2e 49/49, six suites HTTP vertes contre un serveur de production neuf par suite, nouveau contrôle CI `db:check`. |

**Décision (G)** : voir en fin de document.

---

## B. Travaux effectués

Six commits au-dessus de `24d0374`, dans l'ordre :

### B.1 `c9f89da` — deux harnais hors CI réalignés (chantier C)
- **Problème** : `test:dds-etats:http` (29/39) et `test:cross-tenant:rls` (101/103) échouaient sur la ligne candidate.
- **Cause** : harnais écrits avant les lots A/B, jamais rejoués (ils ne sont pas dans la CI) : attentes périmées sur la machine à états DDS et sur les politiques 022.
- **Solution** : attentes réalignées sur le contrat courant (aucun test transformé en « réussi » par suppression : les contrôles existent toujours et passent).
- **Fichiers** : `scripts/check-dds-etats-http.ts`, `scripts/check-cross-tenant-rls.ts`.
- **Tests** : dds-etats:http 39/39, cross-tenant:rls 99/99.

### B.2 `b009bce` — Next.js 16.3.8 → 16.4.3 (chantier C)
- **Problème** : `npm run audit:sec` sortait en 1 (avis critique GHSA-2464-fhr4-w9xw sur `next`).
- **Solution** : montée de version exacte (`next`, `eslint-config-next`), `npm audit fix` → 0 vulnérabilité, y compris en développement.
- **Fichiers** : `package.json`, `package-lock.json`.
- **Tests** : toute la suite rejouée (voir C) ; les 8 avertissements Turbopack de `src/lib/storage/index.ts` sont préexistants et identiques à la baseline.

### B.3 `dbf5490` — attribution du pays par frontières versionnées, P2-16 (chantier B)
- **Problème** : `resolveCountry()`/`resolve_country()` répondaient « XX » partout (après qu'une version antérieure ait attribué Tunis à l'UE par rectangles), et l'export TRACES publiait `country_attribution: "approximate_bbox"`, une méthode qui n'existait plus. La PR #8 réservait le sujet (« empreinte du jeu de données non calculable »).
- **Cause** : jeu de données jamais réintroduit depuis la PR #7 ; la réserve d'empreinte tenait à l'absence d'accès au paquet source.
- **Solution** :
  - `data/frontieres/` repris de la PR #7 (`eacab9b`/`a26721c`) : Natural Earth 1:50m via `world-atlas@2.0.2`, table ISO numérique → alpha-2, licence ISC, `PROVENANCE.md`, 18 points de contrôle. **Empreinte vérifiée indépendamment** : `npm pack world-atlas@2.0.2` → `countries-50m.json` SHA-256 `04342cdc1e3016bc…2394`, identique au fichier du dépôt. La réserve de la PR #8 est levée. Exception `.gitignore` explicite (`data/` reste ignoré, `data/frontieres/` est une source).
  - Moteurs `src/lib/eudr/frontieres.ts` et `backend/app/services/frontieres.py` : décodage TopoJSON, point-dans-polygone pair-impair avec trous, bbox de préfiltrage ; « XX » si hors couverture, entité sans code ISO (Kosovo), NaN, référentiel illisible (`unavailable`, **jamais** d'approximation en repli) ; candidats exposés ; rattachements contestés (Crimée, Cachemire, Sahara occidental) rapportés, non endossés.
  - Moteur satellite TS et Python : `country_code` attribué, **`country_risk` reste `UNKNOWN`** (aucun benchmark officiel versionné n'est intégré — position de la PR #8 conservée, le `COUNTRY_RISK_BENCHMARK` de la PR #7 n'est pas repris) ; méthode, candidats et ambiguïté consignés dans la provenance de chaque analyse.
  - Export TRACES TS et Python : `country_attribution` = `natural-earth-50m` | `unavailable` | `legacy_unknown` (dossiers antérieurs, non rétro-qualifiés), `country_attribution_reliable: false` (1:50m n'est pas cadastral), avertissement réécrit. `GET /audits/{id}` (FastAPI) ne neutralise plus un pays attribué par frontières.
- **Fichiers** : `data/frontieres/*`, `src/lib/eudr/{frontieres,satellite-checker,traces-exporter}.ts`, `backend/app/services/{frontieres,satellite_checker,traces_exporter}.py`, `backend/app/models/schemas.py`, `backend/app/api/v1/endpoints.py`, `scripts/check-frontieres.ts` (48 contrôles, ajouté à `test:controles` donc à la CI), `backend/tests/test_frontieres.py` (26 tests), `scripts/check-eudr-rules.ts` et trois tests Python réalignés (pays attribué, risque non déduit), `.gitignore`, `package.json`.
- **Tests** : eudr 73/73, contrôles verts (48/48 frontières), pytest 168 ; **preuve HTTP réelle** : `POST /api/v1/audit/parcel` sur Abidjan → `country_code: CI`, `country_risk: UNKNOWN`, `source: unavailable`, `compliant: null`, `provenance.params.resolution_pays = natural-earth-50m` (journal `preuve-http-pays-02e3224….log`).

### B.4 `11c92ad` — cherry-pick de `7e5905b` (PR #10, documentation d'un test)
Deux lignes de commentaire dans `backend/tests/test_database_fail_closed.py` ; seul commit de la PR #10 absent de `24d0374`.

### B.5 `43cbf35` — base : rejeu de `db:migrate`, historique Drizzle, descentes (chantier A)
Trois défauts mesurés sur PostgreSQL 16.2 avec un propriétaire **NOSUPERUSER** (conditions d'un hébergeur, pas celles de la CI qui migre en superutilisateur) :
1. **`db:migrate` n'était idempotent que sur une base vide.** Le contrôle d'application de 022 endosse `geoforest_app` (`set local role`). Depuis PostgreSQL 16, le rôle CREATEROLE qui crée `geoforest_app` n'en reçoit que l'ADMIN OPTION, **sans SET** : sur base peuplée, rejeu → `permission denied to set role "geoforest_app"` (mesuré, journal `rollback-drizzle-check-11c92ad….log`). Sous un propriétaire soumis à la RLS, le même contrôle ne voyait aucune ligne et se déclarait « reporté » dans un `notice` que personne ne lisait, pendant que `migrate.ts` affichait « sûreté appliquée ». **Corrections** : 022 s'accorde `SET` (sans héritage) quand il a l'ADMIN OPTION, sinon s'arrête avec la commande à exécuter ; il distingue « non exerçable sous ce rôle » de « reporté » ; `migrate.ts` relaie les notices des scripts. La recette PostgreSQL gagne l'étape **6c** (reprise sur base peuplée, sous RLS puis avec BYPASSRLS comme en production, vérification `set/inherit = true/false` dans `pg_auth_members`) ; sans le correctif, 6c échoue (mesuré).
2. **L'historique Drizzle ne décrivait plus la base.** `gf_products.country_of_origin` avait été rendue facultative par le script 025 et dans `schema.ts`, jamais dans une migration : `drizzle-kit generate` reproduisait deux `ALTER` à chaque appel ; `drizzle-kit check` échouait sur une erreur de pilote faute de `out` dans `drizzle.config.ts`. **Corrections** : migration `0010_produit_pays_origine_facultatif` (+ descente), `out: "./drizzle"`, `scripts/ci/verifier-derive-schema.sh` = `npm run db:check` (sans base ni secret ; `drizzle-kit` préfixe `--out` de `./` et sort en code 0 après une erreur : la sortie est lue, pas seulement le code), branché dans le job `verify` de la CI après le typecheck et attendu par `check-workflow.test.cjs`. Échoue bien (exit 1) quand on retire 0010 du journal (mesuré).
3. **0005 et 0008 n'avaient pas de descente** (réserve C3 de la PR #8). Écrites avec garde : 0005 refuse dès qu'un condensat, une suppression logique ou une méthode d'analyse existe (retire d'abord politiques 022 et déclencheurs 020 qui dépendent des colonnes, en gardant RLS activée/forcée avec la politique de 010) ; 0008 refuse dès qu'un compte est rattaché ou invité et n'annule pas la quarantaine. **Mesuré** (journal `rollback-chaine-11c92ad…-arbre.log`) : chaîne 0010→0005 déroulée puis remontée sur base neuve (RLS t/t et 1 politique par table entre les deux, 34 politiques après remontée) ; sur la base démo : 0010 passe, 0009 refuse (25 dossiers sans pays), 0008 refuse (10 comptes rattachés, 2 invitations), 0005 refuse (515 lignes scellées, 25 analyses). Les scripts `post-migrate/010…025` n'ont pas de descente **par nature** (gardes idempotentes rejouées à chaque migrate ; les retirer est un abaissement de sécurité, pas un retour arrière) — consigné dans `scripts/rollback.ts`.

### B.6 `02e3224` — harnais `scripts/recette/serveur-local.sh` (chantier C)
Cluster PostgreSQL jetable + migrate + seed + une suite HTTP par serveur `next start` neuf (le compteur de cadence d'authentification est en mémoire : enchaîner les suites sur un même serveur finit en 429, mesuré ; `kill` sur `npx next start` ne tue pas `next-server`, mesuré). Secrets tirés au sort, écrits en 0600 hors dépôt, jamais affichés. Validé : start exit 0, `export-identite:http` 33/33, stop sans serveur résiduel.

---

## C. Tableau de validation

Environnement commun : sandbox Linux, Node 22.22.3, npm ci (lockfile), Python 3.11.2 (`backend/requirements.txt`), **PostgreSQL 16.2 local jetable** (pgserver) port 55433 — propriétaire `geoforest_owner` NOSUPERUSER + BYPASSRLS + CREATEDB, rôle applicatif `geoforest_app` sans BYPASSRLS (identité effective vérifiée par `test:db`) — et PGlite pour `test:sql`/`test:http`. **Aucune base Neon, aucune donnée ni secret de production.** Pas d'accès réseau à GFW ni à Neon.

| # | Contrôle | Résultat | Commande | SHA | Preuve (journal) | Explication |
|---|---|---|---|---|---|---|
| 1 | Workflow CI (régression) | **PASS** 4/4 | `npm run test:ci` | `02e3224` | `test-ci-02e3224….log` | inclut l'attente de `db:check` |
| 2 | Typecheck | **PASS** | `npm run typecheck` | `02e3224` | `typecheck-02e3224….log` | |
| 3 | Dérive schéma ↔ Drizzle | **PASS** (11 migrations) | `npm run db:check` | `02e3224` | `db-check-02e3224….log` | nouveau ; exit 1 vérifié sans 0010 |
| 4 | Lint | **PASS** | `npm run lint` | `02e3224` | `lint-02e3224….log` | |
| 5 | Unitaires | **PASS** 52/52 | `npm run test:unit` | `02e3224` | `test-unit-02e3224….log` | |
| 6 | Contrôles produit | **PASS** (dont frontières 48/48, GIS 40/40, readiness, DDS 25, pack 27) | `npm run test:controles` | `02e3224` | `test-controles-02e3224….log` | |
| 7 | Règles EUDR | **PASS** 73/73 | `npm run test:eudr` | `02e3224` | `test-eudr-02e3224….log` | **GFW simulé** (réponses fixées) — pas une intégration réelle |
| 8 | SQL (PGlite) | **PASS** 52/52 | `npm run test:sql` | `02e3224` | `test-sql-02e3224….log` | |
| 9 | HTTP (PGlite) | **PASS** 34/34 | `npm run test:http` | `02e3224` | `test-http-02e3224….log` | |
| 10 | Backend Python | **PASS** 168 passés, 3 ignorés, 2 xfail | `cd backend && python -m pytest -q` | `02e3224` | `pytest-02e3224….log` | 3 ignorés = dépendances optionnelles absentes (inchangé depuis la baseline : 141/3/2) ; 2 xfail attendus |
| 11 | Build production | **PASS** (8 warn Turbopack préexistants) | `npm run build` | `02e3224` | `build-02e3224….log` | mêmes 8 warn qu'à `24d0374` |
| 12 | Audit dépendances prod | **PASS** 0 vulnérabilité | `npm run audit:sec` | `02e3224` | `auditsec-02e3224….log` | était exit 1 à `24d0374` |
| 13 | Migration + RLS (PG 16.2) | **PASS** 11/11 migrations, 13/13 tables, 34 politiques | `npm run db:migrate` | `02e3224` | `recette-02e3224….log` §3/§5/§6c | |
| 14 | Rôle effectif applicatif | **PASS** | `npm run test:db` | `43cbf35` | sortie dans `serveur-local` start | « la RLS s'applique aux requêtes du produit » |
| 15 | Recette PostgreSQL serveur | **PASS** 21/21 + étapes 1–9 (6c incluse) | `PG_BIN=… npm run recette:postgres` | `02e3224` | `recette-02e3224….log` | propriétaire sans BYPASSRLS |
| 16 | Cloisonnement SQL (RLS) | **PASS** 99/99 | `npm run test:cross-tenant:rls` | `02e3224` | `cross-tenant-rls-02e3224….log` | |
| 17 | Preuve de restauration | **PASS** « gf_users, gf_plots et gf_documents concordent » | `scripts/ci/verifier-restauration.sh` | `02e3224` | `restauration-02e3224….log` | sur base locale (pas Neon) |
| 18 | Chaîne de retour arrière 0010→0005 | **PASS** + gardes refusent sur base peuplée | `npm run db:rollback` ×6, `db:migrate` | `11c92ad` (arbre de `43cbf35`) | `rollback-chaine-11c92ad…-arbre.log` | base neuve dédiée, détruite ensuite |
| 19 | Parcours E2E | **PASS** 49/49 | `serveur-local.sh suite e2e` | `02e3224` | `e2e-02e3224….log` | serveur `next start` 16.4.3 neuf |
| 20 | Cross-tenant HTTP | **PASS** 262/262 | `… suite cross-tenant` | `02e3224` | `cross-tenant-02e3224….log` | |
| 21 | Export identité HTTP | **PASS** 33/33 | `… suite export-identite:http` | `02e3224` | `export-identite-http-02e3224….log` | |
| 22 | Parcours fournisseur HTTP | **PASS** 57/57 | `… suite fournisseur:http` | `02e3224` | `fournisseur-http-02e3224….log` | |
| 23 | États DDS HTTP | **PASS** 39/39 | `… suite dds-etats:http` | `02e3224` | `dds-etats-http-02e3224….log` | hors CI |
| 24 | Pack de preuves HTTP | **PASS** 45/45 | `… suite evidence:http` | `02e3224` | `evidence-http-02e3224….log` | hors CI |
| 25 | Attribution pays — HTTP réel | **PASS** CI / UNKNOWN / unavailable / null | `POST /api/v1/audit/parcel` (Abidjan) | `02e3224` | `preuve-http-pays-02e3224….log` | sans `GFW_API_KEY` : fail-closed observé |
| 26 | GFW — cas de référence C, D | **PASS** 2/2 | `npx tsx --conditions=react-server scripts/satellite/validate-reference.ts` | `02e3224` | `gfw-reference-offline-02e3224….log` | C = géométrie invalide rejetée ; D = indisponibilité → `UNAVAILABLE` (tentative réelle vers l'hôte, `fetch failed`) |
| 27 | GFW — cas de référence A, B, E | **BLOCKED** | idem, avec `GFW_API_KEY` et accès réseau | `02e3224` | idem (exit 2, « non exécutés 3 ») | géométries de référence expertes, clé et réseau absents ; **non simulés** |
| 28 | CI distante sur `02e3224` | **NOT RUN** | push + GitHub Actions | — | — | rien n'a été poussé (périmètre : aucune publication sans autorisation) ; CI verte constatée sur `24d0374` |
| 29 | Job CI « database » (Neon) local | **NOT RUN** sur Neon / **PASS** équivalent local | — | — | lignes 13–24 | secrets Neon absents du sandbox ; équivalent rejoué sur PG 16.2 |

**Les 5 cas GFW historiques** : retrouvés dans `scripts/satellite/reference-cases.json` (A–E) et `docs/SATELLITE_VALIDATION_REPORT.md`. Ils n'ont jamais été exécutés contre GFW réel dans aucune des branches examinées ; cette mission ne prétend pas l'avoir fait (ligne 27).

---

## D. Sécurité et données

- **Isolation multi-organisation** : RLS activée et **forcée** sur 13/13 tables métier (`gf_sessions`, `gf_login_attempts` exclues, justifié dans 010), 34 politiques toutes conditionnées par `current_org()` ; rôle applicatif sans BYPASSRLS vérifié à l'exécution (`test:db`) ; 262 contrôles HTTP inter-tenant + 99 SQL verts. Pendant la descente 0005, les tables gardent RLS forcée et la politique 010 : à aucun moment une table n'est lisible hors périmètre (mesuré, 7 lignes `t|t|1`).
- **Identité effective des connexions** : le propriétaire local est `geoforest_owner` NOSUPERUSER (`pg_roles` vérifié) ; le droit d'endosser `geoforest_app` est désormais explicite (`set_option = true`, `inherit_option = false`) et contrôlé par la recette. Ceci reste une **base de test** : rien ici ne qualifie la base hébergée (réserve C1 de la PR #8 toujours ouverte, cf. F).
- **Fail-closed GFW** : sans clé ou sans réseau → `ANALYSIS_UNAVAILABLE`, `compliant: null`, jamais COMPLIANT (lignes 25, 26) ; réponse vide → aucun verdict (règles EUDR).
- **Pays et risque** : le pays n'est jamais inventé (XX si doute, candidats exposés, contestés non endossés) ; le risque pays n'est jamais déduit (`UNKNOWN`), l'export le dit (`country_benchmark_risk: UNKNOWN`, `country_attribution_reliable: false`). Les dossiers antérieurs ne sont pas rétro-qualifiés (`legacy_unknown`).
- **Retour arrière** : toutes les descentes qui détruiraient une information **refusent** et nomment ce qu'il faut traiter (0005, 0008, 0009, 0010). Une descente n'est pas une sauvegarde ; la restauration est prouvée séparément (ligne 17).
- **Dépendances** : 0 vulnérabilité (prod et dev) après Next 16.4.3.
- **Secrets** : aucun secret lu, affiché ni écrit dans le dépôt ; les harnais tirent les leurs au sort en 0600 hors dépôt. Aucune base, donnée ou branche de production touchée. Le mot de passe du compte de démonstration n'a **pas** été tourné (hors périmètre technique, cf. F).
- **Constats non bloquants** : `/api/health` répond `status: degraded`, `version: "inconnue"` en local (pas de `VERCEL_GIT_COMMIT_SHA`) ; la limitation de cadence est en mémoire (une instance).

---

## E. Livraison

- **Branche** : `arena/ba2f9eba-geoforest`. Tête code `94c5f14466da2fca895718430644b56f991ffaf7` ; ce rapport est un commit de documentation au-dessus (diff restreint à `docs/`).
- **Commits** (au-dessus de `24d0374`, historique reconstitué) : `702a8bc`, `b2b2244`, `1c2273e`, `3138e98` (reprise de `7e5905b`), `ec8a306`, `94c5f14`, + docs. 149 commits au-dessus de `origin/main` au total (la ligne `24d0374` incluse).
- **Compatibilité** : `origin/main` (`1c95f4c`) est ancêtre → fusion en avance rapide, **zéro conflit**. Migrations : 0010 additive et sans effet là où 025 est passé ; aucune migration existante réécrite.
- **PR** : aucune ouverte par cette mission. PR #8 (→ main) et PR #10 (→ PR #8) sont **contenues** dans cette branche ; les fusionner séparément deviendrait redondant. PR #7 (`arena/837c5c36`, Agent C) : la partie frontières est portée ici ; le reste (8 commits : `check-audit-dependances`, `check-limitation-memoire`, `check-migration-identite`, `check-seed-securite`, `database.py`) diverge de 27 k lignes et porte une migration `0007` en collision (R1 du rapport phase 13) — **non fusionnable en l'état, décision requise** (clore comme remplacée, ou reporter ces quatre contrôles dans un lot dédié).
- **CI** : non exécutée sur cette branche (non poussée). Changements de CI : une étape `db:check` dans `verify` (testée localement, sans base). Le job `database` (Neon) n'est pas modifié.
- **Risques résiduels** : (1) la CI `database` migre en superutilisateur et ne peut pas détecter les défauts de rôle corrigés en B.5 — la recette locale les couvre, la CI non ; (2) `test:dds-etats:http`, `test:evidence:http`, `test:cross-tenant:rls` restent hors CI (R4) ; (3) 8 warn Turbopack ; (4) `/api/health` degraded hors Vercel.

---

## F. Actions externes requises (par responsable)

| # | Action | Responsable | Déjà fait ici |
|---|---|---|---|
| F1 | **Autoriser le push** de `arena/ba2f9eba-geoforest` puis l'ouverture d'une PR vers `main` ; décider du sort des PR #8/#10 (redondantes) | propriétaire du dépôt | branche prête, FF sans conflit |
| F2 | **Exécuter les cas GFW A, B, E** : `GFW_API_KEY=… npx tsx --conditions=react-server scripts/satellite/validate-reference.ts` sur une machine avec accès à `data-api.globalforestwatch.org`, après fourniture des géométries de référence expertes | référent EUDR + exploitant | runner, cas C/D, procédure (`docs/SATELLITE_VALIDATION_REPORT.md`) |
| F3 | **Qualifier la base hébergée** (C1) : identité effective du rôle de migration et du rôle applicatif, `BYPASSRLS`, droit `SET ROLE geoforest_app` (la recette 6c montre quoi vérifier) ; ordre migrate → déploiement (C2) | exploitant Neon/Vercel | contrôles `test:db`, recette, `db:check` |
| F4 | **Décision PR #7** : clore comme remplacée ou porter les 4 contrôles restants dans un lot renuméroté | propriétaire + Agent C | frontières portées |
| F5 | Rotation du mot de passe de démonstration ; décision produit sur les 25 dossiers démo sans pays (impactent tout retour arrière < 0010) | exploitant / produit | gardes en place |
| F6 | Ajouter à la CI `database` les trois suites hors CI (R4), en vérifiant le comportement de cadence sur le runner | mainteneur CI | suites vertes localement |

---

## G. Décision

**PRÊT POUR REVUE ET LIVRAISON** — sous réserve, explicitement hors de portée technique de la branche : (1) exécution des cas GFW A/B/E par un tiers disposant de l'accès (F2), qui reste la seule validation d'intégration satellitaire réelle ; (2) qualification de la base hébergée avant toute migration de production (F3). Aucune de ces deux réserves n'est un défaut du code livré ; les deux sont documentées, outillées, et le code échoue fermé en leur absence.
