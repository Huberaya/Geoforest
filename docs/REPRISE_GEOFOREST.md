# GeoForest — dossier de reprise durable

> **Document de référence pour toute reprise après interruption.** Lire ce fichier avant tout nouvel audit, toute intervention Neon/Vercel ou toute reprise de PR.
>
> **État initial établi le : 13 novembre 2026 (UTC)**  
> **Dernière mise à jour du dossier : 21 novembre 2026**  
> **Dépôt :** `Huberaya/Geoforest` · **branche de référence :** `main`  
> **HEAD de `main` vérifié :** `f5f7db4c81125ec45ddf7ea99356dde753e60d9b`  
> Les états d'infrastructure et de PR sont des instantanés datés, à recontrôler avant toute action.

## 1. Règle de reprise — ne pas repartir de zéro

Toute nouvelle session ou tout agent doit :

1. Lire ce document en entier, puis consulter les documents techniques référencés ci-dessous.
2. Vérifier le HEAD actuel de `main`, les PR ouvertes, leurs bases/têtes, les derniers checks CI et les états Neon/Vercel pertinents. **Ne pas supposer que les SHA et états datés sont encore actuels.**
3. Reprendre au premier élément explicitement marqué **OUVERT**, **BLOQUÉ** ou **À REVALIDER**. Ne pas refaire les chantiers marqués **INTÉGRÉ** sans nouveau signal de régression.
4. Conserver les preuves : SHA exact, run GitHub, résultats des jobs, branche Neon concernée, identifiant de snapshot et horodatage. Une déclaration sans preuve n'est pas une clôture.
5. Travailler selon le cycle : **diagnostiquer → corriger → tester → intégrer (via PR) → vérifier**. Produire le correctif et ses tests, pas un audit sans action.
6. Ne jamais transformer une simulation, un test local, une branche éphémère ou un snapshot créé en preuve de validation de la production.

Ce dossier est le point de reprise commun. Lorsqu'un chantier avance, le mettre à jour dans la même PR que les changements concernés ou dans une PR documentaire dédiée. Ajouter la date, les SHA, les liens de preuve et le statut. Ne jamais effacer l'historique des décisions : ajouter une nouvelle entrée datée et expliquer ce qui change.

## 2. Identité et périmètre du produit

GeoForest est un SaaS de diligence raisonnée EUDR (règlement UE 2023/1115) : collecte des fournisseurs et des parcelles géolocalisées, validation des géométries, signaux forestiers/satellite, constitution de dossiers DDR/DDS et exports destinés au parcours TRACES-NT.

Le produit couvre notamment les chaînes bois, café, cacao, huile de palme, soja, caoutchouc et bovin. Les éléments réglementaires doivent rester exacts : un export de dossier ne signifie pas qu'une déclaration a été soumise à TRACES ; une simulation satellite n'est jamais une preuve de conformité ; une donnée manquante ou une source indisponible ne doit jamais produire un verdict positif.

Architecture documentée dans `README.md` et `docs/ARCHITECTURE.md` : Next.js App Router / TypeScript, PostgreSQL + Drizzle, RLS et isolation par organisation, composants GIS/EUDR, intégrations externes. Le backend FastAPI historique n'est plus déployé et ne doit pas être réexposé sans modèle d'isolation multi-tenant.

## 3. État GitHub de référence

### 3.1 Branche principale

- Dépôt public : https://github.com/Huberaya/Geoforest
- Branche par défaut : `main`
- HEAD observé le 21/11/2026 : `f5f7db4c81125ec45ddf7ea99356dde753e60d9b` (`docs: documenter restauration Neon et limites plan Free`)
- **Ne pas pousser directement sur `main`** : toute modification passe par une branche de travail et une PR, sauf procédure exceptionnelle explicitement autorisée.

### 3.2 Intégrations structurantes sur `main`

| Référence | Sujet | État vérifié | SHA sur `main` |
|---|---|---|---|
| PR #11 | Consolidation des chantiers A/B/C, frontières pays, migrations `0010`–`0013` et documentation | Fusionnée le 10/11/2026 | `cc61cfebe7c37b3540b3410ff64a00d3cfea2f59` |
| PR #19 | P0 privilèges SQL (`026_privileges_app_allowlist.sql`), RLS, ACL, fonctions `SECURITY DEFINER`, PostGIS lecture seule | Fusionnée le 12/11/2026 | `bfd872920cf032bb13335d1e49689bad4ef46e36` |
| PR #22 | Isolation des secrets Neon dans GitHub Actions (`neon-ci`, `main` uniquement) | Fusionnée le 12/11/2026 | `9f786246c3b32286285743c0c3351595aa7a0b55` |
| Backfill BBOX & réconciliation Neon | Durcissement `scripts/backfill-bbox.ts`, tests `check-backfill-bbox.test.cjs`, audit read-only Neon Production | Intégré le 13/11/2026 | `c231b7ce6e2975abb584d5d9b3678aefaacdee56` |
| Restauration snapshot Neon | Preuve de restauration de `snap-lively-mud-b1n6qm8i` et réserves plan Free dans `docs/MIGRATIONS-NEON.md` | Intégré le 13/11/2026 | `f5f7db4c81125ec45ddf7ea99356dde753e60d9b` |

### 3.3 PR et branches distantes auditées le 21/11/2026

L'audit exhaustif des **39 branches distantes** (`origin/*` hors `main` et `HEAD`) par rapport à `origin/main @ f5f7db4` est consigné dans [`docs/AUDIT_BRANCHES_2026-11-21.md`](AUDIT_BRANCHES_2026-11-21.md).

Synthèse des PR ouvertes précédemment inventoriées :

| PR / Branche | Sujet | Statut par rapport à `main @ f5f7db4` | Action recommandée |
|---|---|---|---|
| PR #23 (`docs/geoforest-reprise-2026-11-13`) | Dossier de reprise durable | Repris et actualisé dans ce document | Fusionner / remplacer par la PR du chantier A |
| PR #21 (`arena/p0-neon-backfill-guard`) | P0 backfill BBOX et réconciliation Neon | **Remplacée par `c231b7c`** (`git diff` nul sur `scripts/backfill-bbox.ts` et `scripts/ci/check-backfill-bbox.test.cjs`) | Clore sans fusion (contenu déjà sur `main`) |
| PR #15 (`arena/7b33661b-geoforest`) | Diagnostic historique de protection `main` | Obsolète (`docs/PROTECTION-MAIN.md` est plus récent sur `main`) | Clore sans fusion |
| PR #10 (`integration/geoforest-p0-final-2026-10-21`) | P0-B backend SQLite | Ancêtre strict de `main` (`+0` commit d'avance) | Clore sans fusion |
| PR #7 (`arena/837c5c36-geoforest`) | Corrections géospatiales / agents B et C | **Ne pas fusionner** (collision `drizzle/0007`) ; 5 scripts TS et 2 tests Python non présents sur `main` listés dans `AUDIT_BRANCHES_2026-11-21.md` | Portage sélectif éventuel puis clôture |
| PR #6, #5, #4, #3, #1 | Branches `forest/*`, `security/*`, `fix/*` | Ancêtres stricts de `main` ou contenus déjà repris | Vérifier via `AUDIT_BRANCHES_2026-11-21.md` puis clore |

**Attention :** aucune branche distante ni PR n'est fermée automatiquement depuis le sandbox. L'audit fournit la preuve `git` avant décision du propriétaire.

## 4. P0 sécurité — état consolidé

### 4.1 GitHub Actions : secrets Neon

**État : INTÉGRÉ dans `main` par PR #22 (`9f78624`).**

- Jobs Neon privilégiés limités au `push` sur `main` et au `workflow_dispatch` sur `main` ;
- environnement GitHub `neon-ci` utilisé pour les jobs privilégiés ;
- checkout avec `persist-credentials: false` et permissions minimales `contents: read` ;
- tests de régression dans `scripts/ci/check-workflow.test.cjs` (vérifiés verts le 21/11/2026).

Configuration d'exploitation connue (instantané du 13/11/2026) :
- secrets configurés dans l'environnement `neon-ci`, limité à `main` ;
- dépôt solo (un seul compte GitHub), ruleset réglé à **0 approbation humaine requise**.

**Réserve de gouvernance non résolue :** il n'existe pas de revue humaine indépendante. Des checks verts ne remplacent pas une seconde paire d'yeux.

### 4.2 Preuves GitHub de la PR #22

SHA testé : `9f786246c3b32286285743c0c3351595aa7a0b55`.

- CI run **43288578818** : 6/6 jobs en succès, dont `Database & HTTP contracts (Neon branch)` (https://github.com/Huberaya/Geoforest/actions/runs/43288578818).
- Backup/restore run **43288578905** : 1/1 job en succès sur branche éphémère PostgreSQL 18 (https://github.com/Huberaya/Geoforest/actions/runs/43288578905).

### 4.3 Ruleset de `main`

`docs/PROTECTION-MAIN.md` a été actualisé le 21/11/2026 :
- les 2 checks fantômes historiques (`contrôles`, `Verify Frontend & Backend`) ont été retirés (consigné dans le commit `502797c`), laissant les **4 contextes requis exacts** verrouillés par `scripts/ci/check-workflow.test.cjs` :
  - `Qualité (types, lint, règles EUDR, dépendances)`
  - `Backend (pytest)`
  - `Contrôles SQL (PostgreSQL)`
  - `Bout en bout (application démarrée, PostgreSQL)`
- le nombre d'approbations requises est à **0** (réserve de gouvernance ouverte).
- **Contrôle live restant à la main du propriétaire** : relire l'API GitHub sur le ruleset `26568220` pour confirmer l'absence de dérive depuis le 13/11/2026 (le sandbox n'a pas de jeton GitHub).

## 5. Neon — état exact et limites connues

### 5.1 Projet et branches Production (état au 13/11/2026, `docs/MIGRATIONS-NEON.md` §8)

- Projet Neon : **Geoforest Trace** · ID `sparkling-brook-79507514` · Région `aws-eu-central-1` · PostgreSQL 18 · Forfait `free_v3`.
- **Restauration de snapshot prouvée le 13/11/2026** (`snap-lively-mud-b1n6qm8i` / `geoforest-p0-security-baseline-20261113`).

| Rôle | ID Neon | Nom | Statut |
|---|---|---|---|
| **Production active / default** | `br-young-base-b1n4tbxi` | `production` | Active (`protected: false`) |
| **Ancienne Production sauvegardée** | `br-delicate-brook-b1h226a9` | `p0-restore-verify-20261113 (1)` | **À conserver** jusqu'à validation applicative Vercel et décision explicite de rétention |

Contrôles comparatifs vérifiés identiques entre les deux branches : 5 `gf_users`, 0 `gf_suppliers`, 23 `gf_plots` (0 active, 0 BBOX incomplet), 16 lignes dans `drizzle.__drizzle_migrations`, 55 tables publiques, 635 colonnes publiques, `alembic_version = 0007`, `geoforest_app` en `NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOBYPASSRLS`.

### 5.2 Réserves persistantes liées au forfait Neon Free

1. **Protection native de branche bloquée (`protected: false`)** : refus HTTP 422 sur le plan `free_v3`. Les `restricted_actions` liées à Vercel (`delete`, `delete-rw-endpoint`, `move-rw-endpoint-using-api`) ne remplacent pas une protection native complète.
2. **Sauvegardes automatiques absentes (`schedule: []`)** : les snapshots planifiés natifs sont réservés aux plans payants. Une sauvegarde externe chiffrée et testée (ou une montée de forfait) reste requise.
3. **Vérification Vercel post-restauration non confirmée dans ce sandbox** : la lecture via le connecteur Vercel a retourné `Access denied` le 21/11/2026. Confirmer `/api/ready` (`200`), `/api/health` et les parcours applicatifs sur la production raccordée à `br-young-base-b1n4tbxi`.

### 5.3 Inventaire des autres branches Neon (instantané du 13/11/2026 — à revalider avant toute suppression)

`isolation-rls-verification-20261112` (`br-still-mouse-b1sl0r6z`), `preview/arena/p0-neon-backfill-guard` (`br-shy-thunder-b1wid5co`), `preview/arena/p0-neon-rls-hardening` (`br-sweet-rain-b1kd6y5l`), `preview/arena/ba2f9eba-geoforest` (`br-polished-cherry-b1seemi6`), `preview/fix/p0-health-storage-readiness-20261111` (`br-shy-unit-b11zu261`), `vercel-dev` (`br-bold-haze-b1we6dyc`).

**Règle de suppression :** inventorier PR GitHub, déploiements Vercel et ID de branche Neon avant toute suppression. Ne jamais toucher `br-young-base-b1n4tbxi` ni `br-delicate-brook-b1h226a9` sans autorisation explicite.

## 6. Base de données, migrations et backfill — règles de sécurité

- Journal Drizzle courant : 14 migrations (`0000`–`0013`), toutes retrouvées (14/14) dans `drizzle.__drizzle_migrations` sur Production.
- **Points historiques encore ouverts (read-only)** :
  - 2 timestamps historiques supplémentaires dans `drizzle.__drizzle_migrations` (16 lignes au total) à rapprocher de l'historique Git ; **ne pas supprimer ni éditer le registre manuellement** ;
  - `public.alembic_version = 0007` (héritage backend FastAPI).
- BBOX : 23/23 parcelles conformes aux enveloppes PostGIS, 0 borne `NULL`. **Aucun backfill à lancer sur Production.**

### Interdictions persistantes sans GO explicite

Ne pas exécuter sur Neon Production :
- `npm run db:migrate`, `db:push`, `db:rollback`, ni modification manuelle de `drizzle.__drizzle_migrations` ;
- `npm run db:backfill-bbox` sans `--essai` et approbation écrite ;
- `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `GRANT`, `REVOKE`, changement de rôle, de propriétaire ou de politique RLS ;
- suppression de `br-delicate-brook-b1h226a9`, seconde restauration, reset ou changement d'endpoint.

## 7. Documents de référence

- `docs/AUDIT_BRANCHES_2026-11-21.md` — audit exhaustif des 39 branches distantes par rapport à `main @ f5f7db4` ;
- `docs/MIGRATIONS-NEON.md` — état read-only Neon Production, garde-fous BBOX, preuve de restauration et limites Free ;
- `docs/PROTECTION-MAIN.md` — ruleset GitHub `26568220`, checks requis et réserve gouvernance ;
- `docs/DECISIONS.md` — décisions durables D-001 à D-016 ;
- `docs/ARCHITECTURE.md`, `docs/EUDR_COMPLIANCE_GUIDE.md`, `docs/EVIDENCE_ENGINE_SPEC.md`, `docs/TRACES_SCOPE.md`, `docs/RGPD.md` ;
- `docs/DEPLOYMENT_VERCEL.md`, `docs/PRODUCTION_RUNBOOK.md`, `docs/CI_NEON.md`, `docs/BACKUP_RESTORE_TEST.md` ;
- `docs/SECURITE-BACKEND.md`, `docs/SECURITY_TEST_REPORT.md`, `docs/CROSS_TENANT_TEST_REPORT.md` ;
- `docs/RAPPORT_CLOTURE_CHANTIERS_2026-10-29.md`, `docs/RAPPORT_FINALISATION_POST_PR11_2026-10-29.md`, `docs/PRODUCTION_READINESS_REPORT.md` (historiques datés).

## 8. Backlog de reprise priorisé (au 21/11/2026)

### P0 — clôture exploitation & gouvernance
1. **INTÉGRÉ (`c231b7c`)** — Backfill BBOX sécurisé + réconciliation read-only migrations/BBOX Neon.
2. **INTÉGRÉ (`f5f7db4`)** — Preuve de restauration du snapshot Neon Production (`snap-lively-mud-b1n6qm8i`).
3. **FAIT (doc, chantier A)** — Mise à jour de `docs/REPRISE_GEOFOREST.md`, `docs/PROTECTION-MAIN.md` et audit des 39 branches (`docs/AUDIT_BRANCHES_2026-11-21.md`).
4. **OUVERT (externe — Vercel/GitHub)** — Vérifier Vercel Production après la bascule Neon (`br-young-base-b1n4tbxi` : `/api/ready`, `/api/health`, variables) et relire le ruleset `26568220` via API GitHub.
5. **OUVERT (forfait / infra)** — Compenser les limites Neon Free (`protected: false`, `schedule: []`) par montée de plan ou sauvegarde externe chiffrée planifiée et testée.
6. **OUVERT (gouvernance)** — Absence d'approbateur humain indépendant (dépôt solo).

### P1 — chantiers techniques code & qualification pilote
- **FAIT (code, chantier B)** — **CSP bloquante** (`src/lib/security/csp.ts`, `src/proxy.ts`, `src/app/layout.tsx`, `next.config.ts`) : nonce cryptographique par requête + `'strict-dynamic'`, retrait de `'unsafe-eval'` en production, de `unpkg.com` et de `globalforestwatch.org` côté navigateur, alignement `X-Frame-Options: DENY`, correction XSS DOM dans `MultiPlotMap.tsx` et `MapViewer.tsx`, tests unitaires (`tests/unit/csp.test.ts`) et HTTP réels (`tests/http/csp.test.ts`). Réserve restante : validation visuelle navigateur en conditions réelles de production (tuiles Esri).
- **Chantier C (code)** : automatiser la **purge RGPD** (`npm run db:purge-rgpd`, workflow/endpoint cron sécurisé) et traiter l'effacement RGPD.
- **Chantier D (code)** : fiabiliser les tests/hygiène du dépôt (parité / validation `backend/`, contrôles de sécurité/déploiement, réconciliation des contrôles utiles).
- **Preuve satellite GFW réelle (`BLOQUÉ externe`)** : géométries expertes A/B/E + `GFW_API_KEY` + exécution `scripts/satellite/validate-reference.ts`.
- **Stockage S3 & Antivirus (`OUVERT exploitation`)** : qualification d'un bucket S3 réel sur Vercel + branchement ClamAV ou décision formelle sur `NOT_SCANNED`.

### P2 — avant commercialisation
- Réconciliation historique des 2 entrées Drizzle supplémentaires et d'`alembic_version = 0007` ; décision définitive sur `backend/` ; nettoyage des branches/PR archivées.
- Validation juridique EUDR, décision commerciale TRACES-NT (préparateur vs soumission officielle), CGU, AIPD, registre sous-traitants, facturation, tests de charge et support.

**Décision commerciale :** toujours **NO-GO** tant que les preuves externes (GFW réel, S3/antivirus, sauvegarde planifiée) et juridiques ne sont pas acquises.

## 9. Protocole de mise à jour de ce dossier

À chaque jalon significatif, ajouter une entrée datée dans la section « Journal de reprise » ci-dessous et mettre à jour les tableaux concernés (SHA `main`, branche, PR, runs CI, état Neon/Vercel, changements effectués, prochaine action et blocages). Ne jamais écrire de secret, mot de passe, chaîne de connexion ou donnée personnelle.

## 10. Journal de reprise

### 2026-11-13 — consolidation P0 et point de reprise

- `main` vérifié à `9f786246c3b32286285743c0c3351595aa7a0b55`.
- PR #19 et #22 fusionnées ; PR #11 fusionnée antérieurement.
- CI run `43288578818` : 6/6 jobs succès sur le SHA de `main`.
- Backup/restore run `43288578905` : 1/1 job succès sur branche Neon éphémère.
- Projet Neon `sparkling-brook-79507514`, production `br-delicate-brook-b1h226a9`, forfait `free_v3`, `protected=false` (refus HTTP 422), `schedule: []`.
- Snapshot manuel `snap-lively-mud-b1n6qm8i` créé et relu ; restauration non encore prouvée à cet instant.
- PR #21 ouverte (`c8268bc5013476184806cbd4f691549410a78f74`) et PR #23 ouverte en brouillon (`docs/geoforest-reprise-2026-11-13`).

### 2026-11-13 (suite) — intégration backfill BBOX et preuve de restauration Neon

- `c231b7ce6e2975abb584d5d9b3678aefaacdee56` intégré sur `main` : garde-fous `scripts/backfill-bbox.ts`, tests `scripts/ci/check-backfill-bbox.test.cjs`, contrôle read-only Neon Production consigné dans `docs/MIGRATIONS-NEON.md` (14/14 migrations Drizzle, 23/23 parcelles BBOX conformes, 0 active).
- `f5f7db4c81125ec45ddf7ea99356dde753e60d9b` intégré sur `main` : restauration du snapshot `snap-lively-mud-b1n6qm8i` finalisée ; nouvelle branche Production `br-young-base-b1n4tbxi`, ancienne branche conservée `br-delicate-brook-b1h226a9` ; réserves plan Free documentées.

### 2026-11-21 — Chantier A : actualisation reprise, protection `main` et audit des branches

- `main` vérifié à `f5f7db4c81125ec45ddf7ea99356dde753e60d9b` ; branche de travail locale `feat/chantiers-abcd-stabilisation`.
- Contrôles locaux exécutés sur `main @ f5f7db4` : `typecheck`, `lint`, `db:check`, `test:ci`, `test:unit`, `test:controles`, `test:eudr`, 9 scripts `check:*`, `audit:sec` (0 vulnérabilité prod), `audit:dev` (0 high/critical, 7 moderate dev), `test:sql` (PGlite), `test:http` (PGlite) et `build` Next.js 16.4.5 — tous **PASS**. `test:backend` non exécuté faute de dépendances Python dans le sandbox ; accès Vercel refusé (`Access denied`).
- Intégration et actualisation de `docs/REPRISE_GEOFOREST.md`, ajout du lien depuis `README.md`, mise à jour de `docs/PROTECTION-MAIN.md` (retrait des 2 checks fantômes et réserve 0 approbation), et création de l'audit complet des 39 branches distantes (`docs/AUDIT_BRANCHES_2026-11-21.md`).
- Aucune opération destructive ni modification Neon/Vercel/GitHub distante effectuée.
- **Prochaine étape :** attente du GO utilisateur pour attaquer le **Chantier B (durcissement CSP)**.

### 2026-11-21 — Chantier B : durcissement CSP bloquant, nonces par requête et correction XSS cartes

- Branche locale `feat/chantiers-abcd-stabilisation` (base `main @ f5f7db4`).
- Inventaire réel des ressources navigateur : Leaflet est empaqueté localement (`unpkg.com` inutilisé), GFW est appelé côté serveur uniquement, seules les tuiles Esri (`https://server.arcgisonline.com`) sont chargées via `<img>`.
- Passage de `Content-Security-Policy-Report-Only` à `Content-Security-Policy` **bloquant** (`src/lib/security/csp.ts`, `src/proxy.ts`, `src/app/layout.tsx` en `force-dynamic`) : nonce cryptographique 128 bits par requête + `'strict-dynamic'`, retrait de `'unsafe-eval'` et `'unsafe-inline'` script en production, `connect-src 'self'`, `object-src 'none'`, `frame-src 'none'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` en production, `style-src 'self' 'unsafe-inline'` conservé et documenté pour Leaflet.
- Alignement `X-Frame-Options: DENY` dans `next.config.ts` ; remplacement de l'interpolation HTML brute dans `MultiPlotMap.tsx` (XSS stocké potentiel via nom de parcelle/fournisseur) et `MapViewer.tsx` par construction DOM (`textContent`).
- Preuves vérifiées : `tests/unit/csp.test.ts` (6 tests), `tests/http/csp.test.ts` (propagation réelle du nonce sur toutes les balises `<script>` Next.js sur serveur démarré), `check:docs` (23/23), `typecheck`, `lint`, `test:http`, `build`.
- **Prochaine étape :** attente du GO utilisateur pour attaquer le **Chantier C (automatisation purge RGPD et effacement RGPD)**.
