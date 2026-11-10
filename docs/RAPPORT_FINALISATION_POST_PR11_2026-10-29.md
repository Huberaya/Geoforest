# Finalisation contrôlée après PR #11 — rapport du 29/10/2026

Branche `arena/ba2f9eba-geoforest` · PR #11 (ouverte, non fusionnée) ·
périmètre : chantiers A (base/isolation), B (GFW réelle), C (CI), D (réconciliation
PR #7/#8/#10), E (livraison). Aucune fusion, aucun déploiement, aucune migration
sur base hébergée, aucun secret/rôle/droit de production modifié, **aucun push**
dans le cadre de ce rapport.

Convention : « **local** » = base PostgreSQL 16.2 jetable (`scripts/recette/serveur-local.sh`,
port 55433) et serveur Next 16.4.3 dans l'environnement d'analyse ; « **distant** » =
GitHub Actions / branche Neon éphémère / Vercel Preview. Rien de local ne vaut preuve
sur l'hébergé.

## 1. État initial

| Élément | Valeur |
|---|---|
| `main` | `1c95f4c585ed8303f887089ae7450c9235523fd0` |
| Tête distante de la branche au début de la mission | `3650c43` (code validé `94c5f14`) — CI **verte** (runs 40868384501 push, 40868455445 PR : Verify / PGlite / Neon success) ; Vercel **Preview** auto, pas de production |
| Commit poussé ensuite par le propriétaire | `5dcb235` « Run RLS, DDS state and evidence HTTP suites in ephemeral Neon CI » (`ci.yml` +19) |
| CI distante sur `5dcb235` | **rouge** : runs 40930475126 (push) et 40930485093 (PR). Seul le job « Database & HTTP contracts (Neon branch) » échoue, à l'étape « Cross-tenant database RLS controls » (job 123647241299, étape exécutée 86 s, donc jusqu'au bout) ; Verify et PGlite verts ; e2e et cross-tenant HTTP verts sur Neon juste avant |
| Journal de l'étape en échec | **non récupérable** depuis l'environnement d'analyse (`gh run view --log` → EOF ; `…/jobs/123647241299/logs` → redirection vers un stockage hors liste d'accès ; annotations API = « Process completed with exit code 1 » seulement ; 0 artefact) |

## 2. Actions exécutées et résultat

### Chantier C — CI (cause de l'échec distant non lisible → reproduction + diagnosticabilité)

1. **Reproduction locale @5dcb235 dans l'ordre exact de la CI** : e2e 49/49 → cross-tenant
   262/262 → `test:cross-tenant:rls` **99/99** (journaux `/home/user/logs/serveur-local/journaux/*repro-ci*.log`,
   `/home/user/logs/cross-tenant-rls-5dcb235…-ordre-ci.log`). L'échec distant **n'est pas reproductible**
   sur base vierge : la cause n'est ni l'ordre des suites ni le code des contrôles.
2. **Piste la plus probable (non démontrée faute de journal)** : la branche Neon éphémère est une
   copie de `NEON_PARENT_BRANCH_ID`, **schéma et données compris**. `check-cross-tenant-rls.ts`
   contrôle *toute* table de `public` portant `organization_id` (RLS activée+forcée, politiques
   `current_org()`, 0 ligne sans contexte, intégrité des comptages). Une table héritée de la parente
   (hors migrations du dépôt) ou des lignes héritées font échouer la preuve — c'est le comportement
   voulu, le contrôle **n'a pas été affaibli**. Autre piste : `DATABASE_URL` CI via pooler.
3. **Correctif de diagnosticabilité (commit local `84211e9`, non poussé)** :
   - `scripts/ci/annoter.sh` : enveloppe des suites ; relaie chaque ligne « 🔴 » en `::error::` et la
     synthèse en `::notice::` (lisibles via `check-runs/{id}/annotations` même sans journal) ; code de
     sortie conservé ; inactif hors `GITHUB_ACTIONS=true` (testé : codes 7/0/2 conservés).
   - `.github/workflows/ci.yml` : `test:cross-tenant:rls` déplacé **après** `evidence:http` (il lit les
     lignes de tous les parcours ; non vacueux par construction) ; les 7 suites enveloppées.
   - `scripts/ci/check-workflow.test.cjs` : nouveau test (ordre des suites, un reset avant chaque
     parcours HTTP, enveloppe, RLS avant l'arrêt du serveur) → `npm run test:ci` **5/5**.
   - `scripts/check-cross-tenant-rls.ts` : le contrôle « tables tenant identifiées » imprime
     l'inventaire des tables/vues `organization_id` (pour voir les tables héritées en CI).
   - `docs/CI_NEON.md` mis à jour (ordre, annotations, effet du schéma hérité).
4. **Chaîne complète locale @84211e9, dans le nouvel ordre CI** (`/home/user/logs/chaine-ordre-ci-v2-5dcb235.log`) :
   e2e 49/49 · cross-tenant 262/262 · export-identite 33/33 · fournisseur 57/57 · dds-etats 39/39 ·
   evidence 45/45 · cross-tenant:rls 99/99 (via `annoter.sh`, `::notice … 99 contrôles réussis`).
   Portes statiques : typecheck, lint, db:check exit 0 ; unit 52/52 ; test:ci 5/5.

### Chantier A — base, rôles, isolation (local uniquement, PG 16.2)

Journal : `/home/user/logs/roles-effectifs-5dcb235….log`.

| Contrôle | Résultat local |
|---|---|
| Identité `DATABASE_URL_ADMIN` | `geoforest_owner` : super=false, **bypassrls=true**, createrole=true (nécessaire à `seed:auth --reset`) |
| Identité `DATABASE_URL` | `geoforest_app` : super=false, **bypassrls=false**, login=true |
| `SET ROLE geoforest_app` depuis l'owner | autorisé (membre avec `set=true`, `inherit=false`) ; `current_user` devient `geoforest_app` |
| Droits `DELETE` du rôle applicatif | **0** table |
| Tables RLS forcée / politiques | 13 / 34 ; `parcel_audits` sans contexte → 0 ligne |
| Fonctions `auth_user_by_*` exécutables par l'app | 0 (révoquées par `023`) |
| Migrations enregistrées | 11 (0000→0010), post-migrate 010→025 appliqués |
| Migrations 0007–0010 | 0007 liens plot/DDS (FK composites tenant, 2 index) ; 0008 invitation fournisseur (FK, index, CHECK rôle↔fournisseur, down gardé) ; 0009 identité opérateur facultative (down **refuse** s'il existe un dossier sans pays/EORI/nom, garde avant tout DDL) ; 0010 pays d'origine produit facultatif (down gardé) |
| « 25 dossiers démo sans pays » | **origine établie** : les harnais HTTP (`e2e`, `cross-tenant`, `dds-etats`, `evidence`) créent des dossiers avec `operator: {name, eori}` sans `country` ; la route stocke `null` (comportement voulu, aucun pays inventé). Après la chaîne complète : 10 dossiers, 10 sans pays, 0 sans EORI, 0 sans nom. Le seed n'en crée aucun. Conséquence : sur une base ayant servi aux suites, `0009.down` refuse — par conception. **Sur l'hébergé : nombre inconnu**, à mesurer en lecture seule (`select count(*) from parcel_audits where operator_country is null`) avant toute décision de rollback |

Ce qui **n'est pas démontré** (F3, inchangé) : identité effective des rôles, `BYPASSRLS`, appartenance
`SET ROLE`, chemin pooler/direct et ordre `migrate → deploy` **sur la base hébergée**. Aucune
connexion à l'hébergé n'a été tentée.

### Chantier B — validation GFW réelle

Journal : `/home/user/logs/gfw-tentative-5dcb235.log`. Scénarios du jeu de référence
(`scripts/satellite/reference-cases.json`) : **A** parcelle conforme (attendu `COMPLIANT`), **B** perte
après le 31/12/2020 (attendu `NON_COMPLIANT`), **E** réponse GFW vide (attendu `NO_VERDICT`) ; C et D sont
fictifs et passent hors réseau (`REJECTED`, `UNAVAILABLE`).

Prérequis pour A/B/E, **tous absents** ici : (1) `GFW_API_KEY` (non défini) ; (2) accès réseau à
`data-api.globalforestwatch.org` (curl → HTTP 000, `SSL_connect` échoue : hôte hors liste d'accès) ;
(3) **géométries réelles fournies par l'expert** (`geometry: null` dans le fichier pour A, B et E — le
script les déclare « NON EXÉCUTÉ — géométrie non fournie » même avec clé et réseau). Résultat :
`validate-reference` → exécutés 2/5, échecs 0, non exécutés 3, **exit 2**. Statut : **impossible dans
cet environnement**, rien de simulé n'est présenté comme réel. Le blocage (3) est un livrable humain
indépendant de l'infrastructure.

### Chantier D — réconciliation PR #11 vs #7 / #8 / #10

Base commune de toutes ces branches : `main` = `1c95f4c`. Matrice fichier par fichier :
`/home/user/logs/matrice-pr7-vs-head.txt`.

| PR | Tête | Relation avec HEAD | Statut |
|---|---|---|---|
| #8 `arena/569eff1a-geoforest` | `47fa862` | ancêtre de HEAD (`merge-base --is-ancestor`) | **repris intégralement / redondante** |
| #10 `integration/geoforest-p0-final-2026-10-21` | `b492d1d` | ancêtre de HEAD | **repris intégralement / redondante** |
| #7 `arena/837c5c36-geoforest` | `ca15ccb` | non contenue ; 52 fichiers : 7 identiques, 29 divergents (modifiés des deux côtés), 16 absents de HEAD | **remplacée en partie / 6 contrôles absents / collision de migration** |

Détail PR #7 :
- **Collision de migration** : #7 crée `0007_operateur_non_renseigne` ; HEAD a `0007_parcel_audit_liens` et porte le même changement en **`0009_operateur_non_renseigne`**. Le `down` de HEAD est plus strict (garde **avant** `DROP VIEW`, alors que #7 supprime la vue avant la garde). #7 **ne doit pas être fusionnée telle quelle** (deux `0007` dans le journal Drizzle).
- **Scripts de #7 absents de HEAD** (6) : `check-audit-dependances` (E2), `check-demarrage-sans-config` (P2-14), `check-eudr-geo-edge-cases`, `check-limitation-memoire` (E4.1), `check-migration-identite` (P3-02), `check-seed-securite` (P3-04) ; scripts npm `test:demarrage`, `test:gis`, `test:migration` absents. Équivalents partiels dans HEAD : `audit:sec`/`audit:dev`, `seed-gardes.ts` (refus d'amorçage), `check-gis-topology`/`check-frontieres`, `test:controles`. **À porter par contenu** (pas par fusion), à décider par le propriétaire.
- 6 documents de #7 (`docs/VALIDATION_GEOFOREST_2026-10-19.md`, `SECURITE_RISQUES_RESIDUELS…`, etc.) et 2 tests Python (`test_gfw_degraded.py`, `test_gis_edge_cases.py`) absents.
- Aucune PR n'a été fermée. Autres PR ouvertes non analysées : #6, #5, #4, #3, #1.

## 3. Fichiers modifiés et SHA

| SHA | Contenu | Statut |
|---|---|---|
| `5dcb235` | commit du propriétaire (ci.yml) | tête distante ; CI rouge |
| `84211e9` | `scripts/ci/annoter.sh` (nouveau), `.github/workflows/ci.yml`, `scripts/ci/check-workflow.test.cjs`, `scripts/check-cross-tenant-rls.ts`, `docs/CI_NEON.md` | **local, non poussé** |
| (ce rapport) | `docs/RAPPORT_FINALISATION_POST_PR11_2026-10-29.md` | local, non poussé |

## 4. Tableau des réserves

| Réf. | Réserve | État | Preuve |
|---|---|---|---|
| R4/CI | Échec distant `test:cross-tenant:rls` sur Neon @5dcb235 | **ouvert** — non reproductible localement ; cause probable : schéma/données hérités de la branche parente ; correctif de diagnosticabilité prêt, non poussé | runs 40930475126/40930485093 ; logs locaux ordre CI |
| F2 | GFW réelle A/B/E | **BLOCKED** (clé, réseau, géométries expertes) | `gfw-tentative-5dcb235.log`, exit 2 |
| F3 | Qualification base hébergée (rôles, BYPASSRLS, SET ROLE, chemin, migrate→deploy) | **ouvert** — rien tenté sur l'hébergé | — |
| R1 | PR #7 : 6 contrôles + collision 0007 | **documenté**, portage à décider | matrice |
| D0009 | Dossiers sans pays : artefacts des harnais ; nombre hébergé inconnu | **documenté** | `roles-effectifs…log` |
| F5 | Rotation mot de passe démo / comptes démo à supprimer avant prod | inchangé | `seed-auth.ts` |
| — | `/api/health` degraded hors Vercel ; limitation de débit en mémoire | inchangé | rapport précédent |
| Parent Neon | `NEON_PARENT_BRANCH_ID` : si = production, données personnelles copiées à chaque run (`docs/CI_NEON.md` § « Point à trancher ») | **décision exploitant** | — |

## 5. Blocages nécessitant une intervention humaine

1. **Journal de l'étape « Cross-tenant database RLS controls »** du run 40930475126 (ou autorisation de
   pousser `84211e9` pour obtenir les annotations au prochain run). Sans l'un des deux, la cause
   exacte reste une hypothèse.
2. **Push de `84211e9` + rapport** sur `arena/ba2f9eba-geoforest` (déclenche CI + Vercel Preview
   automatiquement — pas de production).
3. Choix de la **branche parente Neon** (sans données réelles) et confirmation qu'elle ne porte pas
   de tables `organization_id` hors migrations.
4. GFW : clé, accès réseau, géométries A/B/E.
5. Hébergé (F3) : exécution par un opérateur habilité des requêtes de qualification (lecture seule).
6. PR #7 : décision de portage des 6 contrôles.

## 6. Recommandation

- **Fusion de PR #11 : non prête** tant que la CI distante est rouge sur la tête de branche. Elle
  redevient « prête sous conditions » (F2, F3, R1 ouvertes et acceptées) si le prochain run distant
  est vert — ou si l'échec est attribué à la branche parente Neon et traité côté exploitant.
- **Migration de la base hébergée : non autorisée / non recommandée** sans F3 et sans mesure
  préalable des dossiers sans identité.
- **Déploiement de production : non** ; seul le Preview automatique existe.

## 7. Mise à jour après le push de `c35411c` (autorisé par le propriétaire)

Les deux commits locaux ont été recréés en **un seul** commit `c35411c7e255615174d991e148a76d8eb46933b8`
(l'environnement d'analyse a été reconstruit entre-temps ; contenu identique : 6 fichiers, +260/−14),
poussé en avance rapide `5dcb235..c35411c`.

### CI distante sur `c35411c` — run 42717343596 (push)

| Job | Résultat |
|---|---|
| Verify Frontend & Backend | success |
| Base de données et contrats HTTP (PGlite) | success |
| Database & HTTP contracts (Neon branch) | **failure**, étape « Cross-tenant database RLS controls » (job 129502186355) |

Les annotations ont fonctionné : e2e 49/49, cross-tenant 262/262, export-identite 33/33,
fournisseur 57/57, dds-etats 39/39, evidence 45/45 → verts sur Neon ; puis
`cross-tenant:rls` : **261 réussis, 62 échecs**. Les 10 premières annotations d'erreur :

```
documents, document_versions, document_reviews, diligence_revisions, diligence_dossiers,
diligence_decisions, country_checks, compliance_tasks, collection_revisions, audit_events :
« RLS activée et forcée, politiques toutes conditionnées par current_org() — 0/N politique(s) »
```

**Diagnostic établi** : aucune de ces tables n'existe dans les migrations du dépôt (ni dans aucune
branche de son historique). Le propriétaire a confirmé que `NEON_PARENT_BRANCH_ID` est **la branche
de production** : la branche éphémère hérite donc du schéma de production, qui contient des tables
`public.*` portant `organization_id` **étrangères à GeoForest** (autre application ou ancien schéma
partageant la même base), avec des politiques RLS qui ne reposent pas sur `current_org()`. La preuve
RLS les contrôle comme les nôtres et échoue — comportement voulu, **non affaibli**.

Conséquences :
1. **F3 renforcée** : la base de production héberge des objets hors périmètre du dépôt. Leur
   protection effective vis-à-vis de `geoforest_app` (droits, politiques) est **inconnue** et doit
   être qualifiée par un opérateur habilité (lecture seule : `pg_tables`, `pg_policies`,
   `information_schema.table_privileges` pour `geoforest_app`).
2. **Données personnelles** : chaque run CI copie la production dans une branche temporaire
   (`docs/CI_NEON.md` § « Point à trancher ») — décision exploitant.
3. **Pour une CI verte sans affaiblir le contrôle** : désigner comme parente une branche Neon
   contenant uniquement le schéma issu des migrations du dépôt (option recommandée). Restreindre la
   preuve aux seules tables du dépôt serait un affaiblissement et n'est **pas** proposé.
4. Limite constatée : GitHub n'expose que 10 annotations d'erreur par étape (62 échecs ici) ; la
   liste complète nécessite le journal ou un résumé d'étape (`GITHUB_STEP_SUMMARY`) — amélioration
   possible, non réalisée.

### Vercel

Déploiement GitHub `Preview` 7668521487 pour `c35411c` : état `inactive`, « Canceled from the
Vercel Dashboard » (annulé côté Vercel, pas un échec de build). Aucun déploiement n'a été créé ni
demandé par cette mission ; l'accès API Vercel du connecteur est refusé (lecture impossible).

### `main` a avancé — PR #11 désormais en conflit

`origin/main` = `b7ac7aa` (14 commits du 04–05/11 après `1c95f4c` : protection de `main`,
`check-bout-en-bout`, `check-seed-securite`, `ci-mot-de-passe-role`, Next 16.4.5, ci.yml +251 l.).
`gh pr view 11` → `CONFLICTING` / `DIRTY`. `git merge-tree HEAD origin/main` : conflits sur
`.github/workflows/ci.yml`, `backend/tests/test_geospatial.py`, `docs/TEST_REPORT.md`,
`package.json`, `package-lock.json`. La réconciliation (fusion de `main` dans la branche, rejeu
complet des suites) est un travail distinct, **non commencé**, soumis à autorisation de push.

### Recommandation mise à jour

- **Fusion PR #11 : non prête** — (a) conflit avec `main`, (b) CI Neon rouge tant que la branche
  parente est la production, (c) F2/F3 ouvertes.
- **Migration base hébergée : non** — F3 renforcée par la découverte de tables hors périmètre.
- **Déploiement production : non.**

## 8. Réconciliation avec `main` (autorisée par le propriétaire) — commit de fusion `b09bfd9`

`origin/main` = `b7ac7aa` fusionné dans la branche (`git merge --no-ff`), **aucun contrôle retiré d'aucun côté**.

| Fichier en conflit | Résolution |
|---|---|
| `.github/workflows/ci.yml` | **Union** : structure de la branche (déclencheurs `arena/**`, `permissions: contents: read`, jobs Verify / PGlite / Neon avec annotations) + apports de `main` : `pytest --strict-markers`, `check:version`, `check:seed`, `check:docs`, contrôle « le build n'a modifié aucun fichier du produit », et les deux jobs sur service PostgreSQL 16 du runner (« Contrôles SQL » et « Bout en bout »). Pas d'`env` `DATABASE_URL` factice au niveau du workflow (le build de la branche n'en a pas besoin ; un faux `DATABASE_URL` global pourrait masquer une dépendance). Node 22 conservé (`engines ≥ 20.9`, `.nvmrc` 20 de `main` inchangé). |
| `package.json` | Scripts des deux côtés ; overrides de `main` (`zod`, `source-map-js`) ; Next et `eslint-config-next` 16.4.5 ; `js-yaml` conservé (test du workflow). |
| `package-lock.json` | Régénéré **depuis le lock de la branche** avec le `package.json` fusionné : seul changement Next 16.4.3 → 16.4.5. ⚠️ Le lock de `main` aurait fait passer PGlite 0.5.10 → 0.5.16, qui **casse** `tests/sql/isolation.test.ts` n° 29 (« Transaction was rolled back instead of committed » après un `42501` attendu) — fragilité du test à traiter avant toute montée de PGlite (réserve nouvelle). |
| `backend/tests/test_geospatial.py` | Version de `main` (skip documenté, corps des tests identiques). |
| `docs/TEST_REPORT.md` | Version de `main`, chiffres **remesurés sur le code fusionné** (exigé par `check:docs`) : 45 API + 21 pages, pytest 168 réussis / 3 ignorés / 2 xfail, 170 contrôles de règles, suites HTTP. |

Mesuré en local sur `b09bfd9` (PG 16.2 jetable, Next 16.4.5, Node 22 ; journaux `/home/user/logs/merge-*.log`, `/home/user/logs/serveur-local/journaux/*fusion-main*.log`) :

| Porte | Résultat |
|---|---|
| `test:ci` / typecheck / lint / `db:check` | 5/5 · 0 erreur · 0 erreur 0 avertissement · OK |
| `check:version` / `check:seed` / `check:docs` | 5/5 · 10/10 · 10/10 |
| pytest `--strict-markers` | 168 passed, 3 skipped, 2 xfailed |
| build · unit · controles · eudr · sql · http · audit | OK · 52/52 · 27/27 · 73/73 · 52/52 · 34/34 · 0 vulnérabilité |
| Job « Contrôles SQL » (équivalent) | check-sql-limits OK · migrate · `check:schema` sans dérive · migrate idempotent · rollback 0010 + remontée OK |
| Job « Bout en bout » (équivalent) | `ci-mot-de-passe-role` OK · `check:e2e:complet` **38/38** |
| Job Neon (équivalent, nouvel ordre) | test:db OK · e2e 49/49 · cross-tenant 262/262 · export-identite 33/33 · fournisseur 57/57 · dds-etats 39/39 · evidence 45/45 · **cross-tenant:rls 99/99** |

`git merge-tree HEAD origin/main` : plus aucun conflit. **Non poussé** : la CI distante n'a pas été exécutée sur `b09bfd9` ; le job Neon y restera rouge tant que `NEON_PARENT_BRANCH_ID` désigne la production (§ 7).

## 9. CI distante sur la fusion — `fb34da2` (push autorisé `c35411c..fb34da2`)

Commits poussés : `7869fab` (rapport § 7), **`b09bfd9`** (fusion de `main` `b7ac7aa`, deux parents), `fb34da2` (rapport § 8).
Runs : [42724931100](https://github.com/Huberaya/Geoforest/actions/runs/42724931100) (push) et 42724938461 (PR) — **5 jobs**, résultats identiques :

| Job | Résultat distant |
|---|---|
| Verify Frontend & Backend (pytest strict, test:ci, typecheck, db:check, lint, unit, contrôles, eudr, check:version/seed/docs, build, propreté du build, audit) | ✅ success |
| Base de données et contrats HTTP (PGlite) | ✅ success |
| Contrôles SQL (PostgreSQL 16 du runner) — repris de `main` | ✅ success |
| Bout en bout (application démarrée, PostgreSQL 16) — repris de `main`, 38 contrôles | ✅ success |
| Database & HTTP contracts (Neon branch) | ❌ **uniquement** à l'étape « Cross-tenant database RLS controls » : e2e 49/49, cross-tenant 262/262, export-identite 33/33, fournisseur 57/57, dds-etats 39/39, evidence 45/45 verts ; `cross-tenant:rls` **261 réussis / 62 échecs**, les mêmes tables héritées de la branche parente de production (`documents`, `document_versions`, `document_reviews`, …) qu'au § 7 |

PR #11 : `MERGEABLE` (plus de conflit), état `BLOCKED` (protection de `main` : revue requise + checks). Vercel : déploiement GitHub `Preview` 7669499859 pour `fb34da2` **success** (automatique ; aucune production).

État des décisions :
- **Fusion PR #11** : non prête tant que le job Neon est rouge. La cause est externe au code (schéma de production hérité par la branche Neon, § 7) ; elle se lève côté exploitant en désignant une branche parente Neon dédiée (schéma = migrations du dépôt, sans données réelles). F2/F3 restent des réserves acceptées ou non par le propriétaire.
- **Migration base hébergée** : non. **Déploiement production** : non.
