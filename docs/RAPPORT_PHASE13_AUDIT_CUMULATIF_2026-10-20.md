# Rapport : Phase 13 — audit cumulatif de la PR #9 avant fusion

**Auteur : Agent Arena.ai (Arena.ai — Agent Mode)**
**Date : 2026-10-20**
**Dépôt : `Huberaya/Geoforest` — PR [#9](https://github.com/Huberaya/Geoforest/pull/9), laissée OUVERTE**
**Branche auditée : `integration/lot-a-b-identite-build`**
**SHA de départ : `d0551cd7321e971e51f1ea79c3094b427d982780`**
**Base : `main` = `1c95f4c585ed8303f887089ae7450c9235523fd0`**
**Cumul source Agent A : `a5450492ad60fbc028e278f962bc13e04b30d095`**

---

## 0. Objet et méthode

Cet audit ne développe aucune fonctionnalité. Il établit si le cumul proposé à `main` par la PR #9 est
cohérent, sûr, et peut être soumis à une **décision** de fusion — décision qui n'appartient pas à l'agent.

Tout a été reconstitué depuis Git, depuis une base PostgreSQL éphémère et depuis l'API GitHub. Aucun résultat
n'est repris sur déclaration : les chiffres cités ici ont été **mesurés dans cette session**, sur le SHA exact
`d0551cd`, sauf mention explicite « rapporté ».

Le travail a été fait dans un **worktree séparé** (`/home/user/phase13`). Le checkout principal
(`/home/user/Geoforest`, `1c95f4c` + **48 modifications non attribuées**) n'a reçu **aucune écriture**.

---

## 1. Branche, SHA, état du dépôt

| Élément | Attendu | Constaté | Verdict |
|---|---|---|---|
| Branche de tête | `integration/lot-a-b-identite-build` | idem | ✅ |
| SHA de tête | `d0551cd7321e971e51f1ea79c3094b427d982780` | idem (`git ls-remote` avant tout travail) | ✅ |
| Base de la PR | `main` | `1c95f4c585ed8303f887089ae7450c9235523fd0` | ✅ |
| Cumul Agent A | `a5450492ad60fbc028e278f962bc13e04b30d095` | idem, **ancêtre** de la tête | ✅ |
| PR #9 | ouverte, non fusionnée | `OPEN`, `MERGEABLE` / `CLEAN`, `mergedAt = null` | ✅ |
| Worktree d'audit | — | `/home/user/phase13`, arbre **propre**, aucun commit ajouté avant ce rapport | ✅ |

Changement d'environnement à signaler : le bac à sable a été re-provisionné entre la phase 12.1 et cet audit.
Le worktree `/home/user/phase121` n'existait plus ; les objets Git ont été re-récupérés depuis `origin`
(refspecs explicites) et **tous les SHA de référence ont été retrouvés identiques**. Il n'y a donc **aucun
écart** à signaler sur le dépôt, seulement une perte d'artefacts locaux (`/tmp`, `node_modules`), reconstruits.

---

## 2. Graphe Git et composition du cumul

### 2.1 Graphe

```
merge-base(main, HEAD) = 1c95f4c
commits main..HEAD     = 103
commits first-parent   = 18
merges                 = 5
```

Chaîne first-parent, du plus ancien au plus récent :

```
dde25c8 → cc55481 → 946e9ca → 234867f → e87bb75 → 6e58dff → 7090959 → 26350a1
        → a545049 → d20da77 → 38b6dce → e17bd9d → 7899778 → a171469
        → fcf7125 → 65c1bc1 → cf6f117 → d0551cd
```

Les cinq fusions correspondent à l'intégration, par l'Agent A, des PR 1 à 6
(`cc55481`←pr-3, `946e9ca`←pr-4, `234867f`←pr-5, `e87bb75`←pr-6, `6e58dff` = PR1/PR6).
`a545049` est **ancêtre** de la tête, `1c95f4c` est **ancêtre** de `a545049` : le cumul est strictement
additif par rapport à `main` — aucun commit de `main` n'a été réécrit ou retiré.

### 2.2 Les trois segments, et pourquoi ils ne s'additionnent pas

| Segment | Intervalle | Fichiers | Lignes |
|---|---|---|---|
| Cumul Agent A | `1c95f4c..a545049` | 124 | +15 991 / −497 |
| Phase 12 — lots A/B | `a545049..a171469` | 24 | +5 145 / −77 |
| Phase 12.1 — réserves | `a171469..d0551cd` | 9 | +1 265 / −97 |
| **Cumul total proposé à `main`** | **`1c95f4c..d0551cd`** | **140** | **+22 302 / −572** |

**La différence entre le delta de la phase 12.1 et le cumul complet est la raison d'être de cet audit.**
La phase 12.1 ne représente que **9 fichiers** (dont 393 lignes de rapport) : elle ferme des réserves sur un
cumul qui la précède. Ce que la PR propose de fusionner, c'est **140 fichiers** — l'ensemble du travail de
l'Agent A (PR 1 à 6 consolidées) **plus** les lots A/B **plus** la phase 12.1.

La somme des trois segments (124 + 24 + 9 = 157) dépasse 140 : plusieurs fichiers sont touchés par deux
segments successifs (`package.json`, `package-lock.json`, `src/db/admin.ts`, `.github/workflows/ci.yml`,
`drizzle/meta/_journal.json`…). **Un diff cumulé n'est pas la somme de ses diffs intermédiaires** ; c'est le
diff final qui fait foi, et c'est lui qui a été audité.

### 2.3 Nature des commits

| Catégorie | Nombre |
|---|---|
| `fix` | 28 |
| `test` | 16 |
| `docs` | 14 (11 `docs:` + 3 `docs(phase …)`) |
| `merge` | 5 |
| `ci` | 5 |
| `security` | 3 |
| `feat` | 1 |
| `chore` | 1 |
| sujets historiques capitalisés (non conventionnels) | 30 |
| **Total** | **103** |

Les commits **strictement documentaires** de la phase 12.1 sont `7899778`, `a171469`, `d0551cd` ; aucun ne
contient de code. Aucun commit redondant n'a été identifié : les trois commits de correction (`fcf7125`,
`65c1bc1`, `cf6f117`) portent chacun un périmètre distinct et leurs diffs ne se recouvrent pas.

### 2.4 Suppressions, réintroductions, contradictions

`git diff --name-status 1c95f4c..d0551cd` ne contient **aucune suppression** (`D`) : uniquement des ajouts
(`A`) et des modifications (`M`). En particulier, les migrations sont **toutes ajoutées** :

- `drizzle/0007_parcel_audit_liens.sql` (+ `.down.sql`)
- `drizzle/0008_fournisseur_invitation.sql` (**sans `.down.sql`** — cf. risque R2)
- `drizzle/0009_operateur_non_renseigne.sql` (+ `.down.sql`)
- `drizzle/meta/0007_snapshot.json`, `0008_snapshot.json`, `0009_snapshot.json`, `_journal.json` (étendu)

Le journal compte **10 entrées, idx 0 à 9**, sans trou ni doublon, et son `prevId` est inchangé depuis `main`
(`0004_document_mime_mismatch`). Aucune migration publiée n'a été modifiée : `0000` à `0006` sont identiques
octet pour octet à leur version sur `main` (`git diff 1c95f4c..d0551cd -- drizzle/0000* … drizzle/0006*`
est vide).

---

## 3. Synthèse du diff global

### 3.1 Répartition des 140 fichiers

| Zone | Fichiers |
|---|---|
| `drizzle/` (migrations + snapshots + journal) | 9 |
| `backend/` (Python) | 17 |
| `docs/` | 22 |
| `scripts/` (contrôles, e2e, CI, sauvegarde) | 30 |
| `src/app/` (routes et pages) | 31 |
| `src/lib/` | 14 |
| `src/db/` | 4 |
| `src/` (autres) | 3 |
| racine / configuration | 10 |

### 3.2 Modifications hors du périmètre « lots A/B »

Elles existent, elles sont **antérieures** aux lots A/B et proviennent du cumul Agent A. Elles ne sont pas
« cachées » : chacune porte un commentaire de justification dans le fichier.

| Fichier | Changement | Justification établie |
|---|---|---|
| `vercel.json` | suppression du service FastAPI et des réécritures `/fastapi`, `/backend`, `/docs`, `/openapi.json`, `/health-py` | chantier 2 « B-8 » : le produit n'appelle plus le backend |
| `next.config.ts` | `rewrites()` renvoie `[]` (plus de proxy vers FastAPI) | « B-9 » : le navigateur ne doit pas atteindre un service exigeant un jeton serveur |
| `docker-compose.yml` | retrait du service `backend`, secrets obligatoires (`POSTGRES_PASSWORD`, `GF_APP_DB_PASSWORD`, `AUTH_SECRET`, `GF_STORAGE_SIGNING_SECRET`) | suppression des identifiants par défaut (P0) |
| `backend/Dockerfile` | `uvicorn --host 127.0.0.1` au lieu de `0.0.0.0` | empêcher une publication réseau accidentelle |
| `Dockerfile` | suppression de la `DATABASE_URL` factice de build | aucune URL ni identifiant dans l'image |
| `next-env.d.ts` | `.next/dev/types` → `.next/types` | fichier **généré** par Next ; le build le reproduit à l'identique (arbre propre après build) |

Vérifications associées : `grep` ne trouve **aucune** référence à `/fastapi`, `NEXT_PUBLIC_API_URL` ou
`BACKEND_URL` dans `src/` ni dans `scripts/`. Le retrait est donc cohérent, pas un laisser-faire.

### 3.3 Dette signalée, sans correction

Le dossier `backend/` (17 fichiers modifiés, 138 tests) reste **présent et testé en CI** alors qu'il n'est
plus déployé ni atteignable. C'est une décision antérieure (chantier 2), pas une régression de la PR. Elle est
consignée en R8.

### 3.4 Secrets

Balayage des **lignes ajoutées** du diff cumulé (mots de passe, jetons, clés d'API, URL de connexion) :
aucun secret réel. Les occurrences trouvées sont des **espaces réservés** (`<MOT_DE_PASSE_APP>`), des
**valeurs de test** explicitement non réelles (`cle-de-test-non-reelle`, `Solide-Mot-2026!`), ou l'URL
**synthétique** utilisée par les bancs de pool (`postgresql://synthetique:synthetique@127.0.0.1:1/aucune_base`),
qui est une **entrée de test** et non un repli applicatif.

---

## 4. Tableau des risques

Gravité : **É** = élevée, **M** = moyenne, **F** = faible. Statut : **O** = ouvert (décision requise),
**D** = documenté et accepté en l'état, **P** = préexistant hors périmètre de la PR.

| # | Constat | Preuve | Gravité | Statut | Action |
|---|---|---|---|---|---|
| **R1** | **Collision de numérotation de migration avec l'Agent C.** La branche `arena/837c5c36-geoforest` (`ca15ccb`) crée elle aussi une migration `0007`, et un snapshot `meta/0007_snapshot.json`, alors que la PR #9 utilise `0007_parcel_audit_liens`, `0008`, `0009` | `git show ca15ccb:drizzle/meta/_journal.json` → idx 7 = `0007_operateur_non_renseigne` ; `git ls-tree ca15ccb drizzle/` ; merge-base = `1c95f4c` ; **26 fichiers modifiés par les deux branches** | **É** (intégration) | **O** | Décider de l'ordre : fusionner la PR #9 puis renuméroter le travail Agent C en `0010+`, ou fusionner Agent C d'abord et retirer le doublon d'identité. **Ne bloque pas la fusion de la PR #9 seule.** |
| **R2** | `0008_fournisseur_invitation` **n'a pas de migration descendante** | `ls drizzle/0008*` → un seul fichier ; `npm run db:rollback` après annulation de `0009` → « Aucune migration descendante pour 0008 », **exit 1** (mesuré) | M (exploitation) | **D** | Comportement **non silencieux** : le script refuse. Écrire la descente avant tout besoin de retour arrière, ou accepter la limitation. `0005_tracabilite` présentait déjà ce cas sur `main`. |
| **R3** | La migration `0008` **met en quarantaine** les comptes `supplier` sans fiche : `role → viewer`, `status → suspended`, sans suppression | `UPDATE` présent dans `0008` ; contrainte `ck_gf_users_lien_fournisseur` ; deux `INSERT` refusés (mesuré : supplier sans fiche, et viewer avec fiche) | M (comptes réels) | **D / O** | Décision produit avant toute exécution sur une base hébergeant de vrais comptes fournisseurs : compter les lignes concernées, prévoir leur rattachement. Sur la base éphémère de CI, l'effet est nul. |
| **R4** | **Couverture CI incomplète** pour des fonctionnalités du cumul | `ci.yml` n'appelle ni `test:dds-etats:http` (39), ni `test:evidence:http` (45), ni `test:cross-tenant:rls`, ni `verifier:pack`, ni les scripts de sauvegarde | M | **O** | Ajouter ces étapes au job « Database & HTTP contracts » (branche éphémère), ou accepter explicitement une couverture **locale** pour ces quatre contrôles. |
| **R5** | L'absence d'identité (**422**) est contrôlée **avant** l'absence de producteur (**409**) | `route.ts` : bloc identité avant `if (producerName === null)` ; le contrôle 31 couvre trois 409 (non probant, non conforme, géométrie) mais **pas** ce croisement | F | **D** | Aucun changement recommandé. Les deux réponses refusent l'export ; le cas ne concerne que des dossiers hérités. À rouvrir si un client s'appuie sur le code 409. |
| **R6** | En production **sans `DATABASE_URL`**, le message nomme bien la variable, mais le processus **ne sort pas** | `timeout 18 npx next start` → `Failed to prepare server … DATABASE_URL est requis …`, `unhandledRejection`, **EXIT=124** (mesuré sur `d0551cd`) | M (diagnostic) | **P** | Défaut de `src/instrumentation.ts`, antérieur aux lots. Décider du sort du processus au démarrage — hors PR. |
| **R7** | `country_of_activity` vaut **`"FR"` par défaut** quand le corps ne le fournit pas | `src/app/api/v1/export/traces/route.ts` | F | **P** | Décision produit déjà consignée en phase 12.1 ; non modifiée ici. |
| **R8** | Le backend FastAPI n'est **plus déployé** (Vercel, compose, rewrites) mais reste dans le dépôt et testé en CI | `vercel.json`, `next.config.ts`, `docker-compose.yml` ; aucune référence dans `src/` | F (dette) | **D** | Archiver le dossier ou le réintégrer dans un lot dédié. |
| **R9** | `next-env.d.ts` est modifié par la PR | diff `.next/dev/types` → `.next/types` | F | **D** | Fichier généré ; le build le réécrit sans différence. Aucune action. |
| **R10** | **5 avis npm `high`** en dépendances de développement | `npm audit --audit-level=high` → **5 high**, **1 seul avis** (`braces@3.0.3`, GHSA-vfj7-8cjw-p6xm / CVE-2026-93687, DoS par épuisement de pile), chaîne unique `eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces` ; **aucune version corrigée** ; `npm audit --omit=dev` → **0** | F (outillage) | **D** | Aucun correctif applicable sans mise à jour majeure. Veille à la prochaine version d'`eslint-config-next`. L'alerte **n'est pas masquée** (`audit:sec` reste rouge). |
| **R11** | Les suites HTTP sont sensibles à la **limitation de cadence par IP** du proxy | Incident 429 en phase 12.1 ; en phase 13, chaque suite a été jouée **une fois**, avec réinitialisation des comptes et redémarrage du serveur avant le parcours fournisseur | F (mesure) | **D** | Artefact d'enchaînement local ; la CI joue chaque parcours une fois depuis un runner neuf. |

Aucun de ces risques n'est un **bloqueur démontré** : aucun ne produit de perte de données, de contournement
de cloisonnement ou de refus de service dans le périmètre de la PR. Les risques R1, R3 et R4 appellent une
**décision**, pas une correction de code.

---

## 5. Migrations, sécurité, RLS et compatibilité Agent C

### 5.1 Application réelle sur une base vierge

PostgreSQL **16.2** éphémère (données synthétiques, `127.0.0.1:55432`), base `app_db` créée vide, rôle
applicatif `geoforest_app` (`login`, `nosuperuser`, **`nobypassrls`**).

```
appliquée : 0000_init … 0007_parcel_audit_liens, 0008_fournisseur_invitation, 0009_operateur_non_renseigne
sûreté    : 010, 020, 021, 022, 023, 024, 025
RLS : 13/13 de nos tables protégées · 34 politiques · exclues (justifié) : gf_sessions, gf_login_attempts
✅ Schéma à jour et cloisonnement vérifié.
```

La chaîne complète s'applique **de zéro**, sans intervention manuelle, et la vérification de cloisonnement
intégrée à `scripts/migrate.ts` est satisfaite.

### 5.2 La vue `v_parcel_audits_identite`

| Contrôle | Mesure |
|---|---|
| Option de sécurité | `reloptions = {security_invoker=true}` ✅ |
| Propriétaire | `postgres` (le rôle de migration) |
| Droits de `geoforest_app` | **SELECT** uniquement — `INSERT` refusé : `permission denied for view` |
| RLS sans contexte | **0 ligne** |
| RLS org A | **1 ligne**, classée `legacy_placeholder` |
| RLS org A vers données org B | **0 ligne** |
| `DELETE` sur `parcel_audits` par le rôle applicatif | refusé : `permission denied for table` |

Sans `security_invoker`, cette vue aurait exposé les audits de **toutes** les organisations ; c'est
précisément ce que la migration commente et ce que la mesure confirme.

### 5.3 Colonnes, contraintes, délais

| Objet | État mesuré |
|---|---|
| `parcel_audits.operator_name/_eori/_country` | `NULL` autorisé, **aucun défaut** (le `DEFAULT 'FR'` a disparu) |
| `ck_gf_users_lien_fournisseur` | présente ; refuse `supplier` sans fiche **et** `viewer` avec fiche (deux insertions rejetées) |
| `fk_gf_users_supplier_tenant` (post-migrate `023`) | présente : `(supplier_id, organization_id) → gf_suppliers(id, organization_id)` |
| `0007` — clés étrangères composites | référencent `uq_gf_plots_tenant` et `uq_gf_dds_tenant`, **vérifiées présentes** dans `0000_init` |
| `024` — délais du rôle | `statement_timeout=10s`, `idle_in_transaction_session_timeout=15s` |

### 5.4 Retour arrière — mesuré, pas supposé

| Scénario | Résultat |
|---|---|
| `0009` descendue alors qu'un dossier est sans identité | **refus explicite** : « 1 dossier(s) sans pays, 1 sans EORI, 1 sans nom… », la vue **reste en place** (garde avant tout DDL) |
| `0009` descendue avec toutes les identités complètes | succès ; vue supprimée, colonnes `NOT NULL` restaurées, `DEFAULT 'FR'` rétabli |
| Descente suivante (`0008`) | **refus** : aucune migration descendante ; `exit 1` |

### 5.5 Compatibilité avec l'Agent C

- Merge-base des deux branches : **`1c95f4c`**. La branche `arena/837c5c36-geoforest` (`ca15ccb`) **ne
  contient pas** la PR #9, et réciproquement.
- **52 fichiers** modifiés côté Agent C, **26 fichiers communs** avec la PR #9
  (dont `.github/workflows/ci.yml`, `package.json`, `package-lock.json`, `drizzle/meta/_journal.json`,
  `src/app/api/v1/audit/parcel/route.ts`, `src/app/api/v1/export/traces/route.ts`, `src/db/admin.ts`,
  `src/lib/eudr/identite-operateur.ts`).
- **Le même lot A a été implémenté deux fois** : la migration `0007_operateur_non_renseigne` de l'Agent C
  contient la même règle (colonnes facultatives, aucune réécriture, vue `v_parcel_audits_identite`) que la
  `0009` de la PR #9. Ce n'est pas une divergence de comportement, c'est une **duplication avec collision de
  numéro et de nom de snapshot**.
- Conséquence : **la PR #9 fusionne proprement dans `main`** (vérifié : `MERGEABLE` / `CLEAN`, CI verte), mais
  **le travail Agent C devra être renuméroté et dé-doublonné** avant sa propre fusion. C'est R1.

### 5.6 Sécurité applicative

- **Identité** : plus aucune fabrication (`ANONYMOUS_OPERATOR` supprimé) ; refus `422`
  `OPERATOR_IDENTITY_MISSING` ; `legacy_placeholder` reconnu **même avec un nom** ; l'identité fournie à
  l'export est validée (nom ≥ 2, EORI conforme) ; `country` stocké **`null`** et non déduit ; à l'export, le
  pays à défaut vient du **préfixe de l'EORI** (fait attaché à l'identifiant, pas valeur arbitraire).
- **Invitation fournisseur** : jeton 256 bits (43 caractères base64url), stocké **haché**, usage unique,
  expiration 7 jours, politique de mot de passe, réponse générique sans oracle ; route publique mais
  **quota serré** (`CHEMINS_SECRETS`).
- **Pools** : aucun pool construit à l'import ; échec explicite nommant `DATABASE_URL` /
  `DATABASE_URL_ADMIN` ; proxy transparent (réflexion, `instanceof`, identité des méthodes).
- **Cloisonnement** : toutes les nouvelles routes (`readiness`, `evidence-pack`, `audits`, `invitation`)
  filtrent par `organizationId` ; contrôle HTTP cross-tenant **262/262**.
- **Aucun secret** dans le diff cumulé (balayage des lignes ajoutées).

---

## 6. Tests réellement exécutés, résultats CI, contrôles manquants

### 6.1 Exécutés dans cette session, sur le SHA exact `d0551cd`

| Contrôle | Commande | Résultat |
|---|---|---|
| Typecheck | `npm run typecheck` | **0** erreur |
| Lint | `npm run lint` | **0** |
| Tests de workflow | `npm run test:ci` | **4/4**, exit 0 |
| Tests unitaires (10 bancs) | `npm run test:unit` | exit 0 — 72/72, 22, 27, **28**, 40/40, 25, 27 |
| Tests Python | `pytest -q` (backend) | **138 passed, 5 xfailed** |
| Build sans base | `npm run build` | **0** — routes compilées, Proxy (Middleware) inclus |
| Génération Drizzle | `npx drizzle-kit generate` | « No schema changes » |
| Migrations sur base vierge | `npm run db:migrate` | 10 migrations + 7 scripts, **RLS 13/13** |
| Rôle et cloisonnement | `npm run test:db` | **0** (rôle conforme, superuser non, BYPASSRLS non, 0 table hors cloisonnement) |
| Parcours de bout en bout | `npm run test:e2e` | **49/49** |
| Cloisonnement HTTP | `npm run test:cross-tenant` | **262/262** |
| Export / identité HTTP | `npm run test:export-identite:http` | **31/31** |
| États DDS HTTP | `npm run test:dds-etats:http` | **39/39** |
| Pack de preuves HTTP | `npm run test:evidence:http` | **45/45** (3 incidents provoqués et attendus) |
| Parcours fournisseur HTTP | `npm run test:fournisseur:http` | **57/57** |
| Audit complet | `npm audit --audit-level=high` | **5 high, 1 avis**, exit 1 — **non masqué** |
| Audit production | `npm audit --omit=dev` | **0 vulnérabilité**, exit 0 |
| Démarrage production sans `DATABASE_URL` | `timeout 18 npx next start` | erreur explicite, processus **non terminé** (R6) |

Toutes les suites HTTP ont été rejouées avec `seed:auth --reset` entre chaque campagne ; le serveur a été
redémarré avant le parcours fournisseur pour repartir d'un compteur de cadence vierge.

### 6.2 CI sur le SHA exact

| Élément | Valeur |
|---|---|
| Run | [39383525566](https://github.com/Huberaya/Geoforest/actions/runs/39383525566) |
| Événement | `pull_request` |
| SHA de tête | **`d0551cd7321e971e51f1ea79c3094b427d982780`** |
| Conclusion | **success** |
| `Verify Frontend & Backend` | success (1 min 15 s) |
| `Database & HTTP contracts (Neon branch)` | success (6 min 42 s) |

Les **24 étapes** du job base sont toutes `success`, dans cet ordre : création de la branche Neon éphémère →
migrations → mot de passe du rôle applicatif → contrôles base → réinitialisation des comptes → build →
démarrage du serveur → parcours E2E → **cross-tenant** → **export identité** → **fournisseur** → arrêt du
serveur → **suppression de la branche Neon (`if: always()`)**.

Le run est de type `pull_request` : `actions/checkout` y récupère par défaut `refs/pull/9/merge`, donc la CI
a validé le **résultat de fusion** avec `main` (`1c95f4c`), et non la seule tête de branche.

**Limite de vérification, assumée.** Le téléchargement des journaux détaillés échoue depuis l'environnement
d'audit (`EOF` sur le stockage de résultats GitHub), comme en phase 12.1. Les preuves CI sont donc au niveau
des **conclusions d'étapes**, pas des décomptes imprimés. Les décomptes cités en 6.1 sont ceux que **j'ai
mesurés localement** sur le même SHA ; aucun chiffre n'est attribué à la CI sans l'avoir lu.

### 6.3 Résultats rapportés antérieurement — vérifiés

| Run | SHA | Conclusion constatée |
|---|---|---|
| [39333719902](https://github.com/Huberaya/Geoforest/actions/runs/39333719902) | `e17bd9d` | success |
| [39335099679](https://github.com/Huberaya/Geoforest/actions/runs/39335099679) | `7899778` | success |
| [39336480529](https://github.com/Huberaya/Geoforest/actions/runs/39336480529) | `a171469` | success |
| [39383525566](https://github.com/Huberaya/Geoforest/actions/runs/39383525566) | `d0551cd` | success |

Les runs cités dans les rapports de phase 12 et 12.1 **existent** et portent bien les SHA annoncés.

### 6.4 Contrôles **non exécutés** ou non couverts

| Contrôle | État | Raison |
|---|---|---|
| `test:cross-tenant:rls` | **non exécuté** dans cet audit | exige un rôle administrateur et une base migrée ; la RLS de la vue et des tables a été vérifiée **directement en SQL** (5.2) |
| `scripts/check-sauvegarde.sh`, `restauration.sh`, `empreinte-sauvegarde.ts` | **non exécutés** | opérations de sauvegarde/restauration hors périmètre de cette PR ; non couvertes par la CI |
| Migrations Neon réelles | **non relancées** | la CI du SHA exact les a exécutées avec succès ; aucun changement ne les justifiait |
| Appels GFW réels | **non exécutés** | accès externe indisponible (hors périmètre de la PR) |
| Vérification visuelle de l'interface | **non exécutée** | hors périmètre de l'audit technique |
| Journaux CI détaillés | **inaccessibles** | `EOF` du stockage de résultats (cf. 6.2) |

---

## 7. Modifications effectuées, commits créés, fichiers concernés

**Aucune modification de code.** Aucun changement de comportement, aucune migration, aucun test ajouté ou
retiré : l'audit n'a révélé aucun bloqueur démontré, et le mandat interdit d'inventer des changements.

Le seul ajout est **ce rapport** :

| Fichier | Nature |
|---|---|
| `docs/RAPPORT_PHASE13_AUDIT_CUMULATIF_2026-10-20.md` | documentaire uniquement |

Le commit correspondant est **documentaire** ; son run CI est consigné dans la PR #9 (un fichier versionné ne
peut pas citer le run du commit qui le contient). Aucun commit de code n'a été créé, aucun commit existant
n'a été réécrit.

Outils et artefacts locaux : worktree `/home/user/phase13`, `node_modules` (non versionné), base PostgreSQL
éphémère supprimée, secrets de test générés dans `/tmp` puis effacés, aucun secret affiché ni versionné.

---

## 8. Confirmation : `main`, branches sources et production inchangées

| Élément | Avant l'audit | Après l'audit | État |
|---|---|---|---|
| `main` | `1c95f4c585ed8303f887089ae7450c9235523fd0` | idem | **inchangée** |
| `arena/e7725e3f-geoforest` (cumul Agent A) | `a5450492ad60fbc028e278f962bc13e04b30d095` | idem | **inchangée** |
| `arena/837c5c36-geoforest` (Agent C) | `ca15ccb195363f27a656f0c23caebf811330b3a2` | idem | **inchangée** |
| `agent/chantiers-c1-c5-complement` | `891c02f868e1f4d4302352ff9842dae2ce771fec` | idem | **inchangée** |
| `integration/lot-a-b-identite-build` | `d0551cd…` | `d0551cd…` + commit documentaire | **avance simple** |
| Checkout principal `/home/user/Geoforest` | `1c95f4c`, 48 modifications | idem, **aucune écriture** | **intact** |

- **Aucune fusion** : la PR #9 est restée `OPEN`, `mergedAt = null`.
- **Aucune fermeture** de PR.
- **Aucun déploiement de production** : le dernier déploiement Vercel est `7193589945`, environnement
  **`Preview`**, `production_environment = false`, SHA `d0551cd`. Aucun déploiement `Production`.
- **Aucune migration** sur une base réelle ou hébergée : uniquement PostgreSQL 16.2 **éphémère** local et la
  branche Neon **jetable** de la CI, supprimée en fin de job.
- **Aucun force push**, aucun `reset --hard`, aucun `clean -fd`.
- **Aucun secret** lu, affiché, copié ou versionné.

---

## 9. Verdict d'intégration

# ✅ PR TECHNIQUEMENT PRÊTE À UNE DÉCISION DE FUSION

Le cumul a été examiné dans son ensemble (140 fichiers, +22 302 / −572), pas seulement le delta de la
phase 12.1. Aucun bloqueur n'a été démontré : pas de perte de données, pas de contournement de cloisonnement,
pas de régression fonctionnelle mesurée. Les contrôles adaptés sont verts **localement sur le SHA exact** et
**en CI sur ce même SHA**, y compris sur les points les plus sensibles (migrations de zéro, RLS de la
nouvelle vue, refus d'écriture sur la vue, contraintes de cohérence, export 422/409, parcours fournisseur).
Les limites sont exposées ci-dessus, sans être minimisées.

**Ce verdict n'autorise aucune fusion.** Il constate un état technique ; la décision reste humaine.

### Conditions restant à satisfaire

1. **Décider de l'ordre d'intégration avec l'Agent C** (R1). La branche `ca15ccb` définit sa propre migration
   `0007` — même numéro, même nom de snapshot, même sujet que la `0009` de cette PR. Fusionner la PR #9 en
   premier, puis **renuméroter et dé-doublonner** le travail Agent C (`0010+`), ou l'inverse. Sans cette
   décision, la seconde fusion produira un conflit de journal et de snapshots.
2. **Décider du sort des comptes `supplier` sans fiche** (R3) sur toute base cible contenant de vrais
   comptes : la migration `0008` les suspend et les ramène au rôle `viewer`. Exécuter le décompte avant
   migration et prévoir leur rattachement.
3. **Décider du retour arrière** (R2) : écrire `0008_fournisseur_invitation.down.sql` avant d'en avoir
   besoin, ou accepter que `db:rollback` refuse au-delà de `0009`.
4. **Décider de la couverture CI** (R4) : intégrer `test:dds-etats:http`, `test:evidence:http`,
   `test:cross-tenant:rls` au job à base éphémère, ou acter une couverture locale pour ces contrôles.
5. **Décider des risques résiduels préexistants** : sort du processus quand le contrôle de rôle échoue au
   démarrage (R6), et défaut `country_of_activity = "FR"` (R7).
6. **Ne pas déployer** dans la même décision que la fusion : la PR ne contient ni plan de déploiement ni
   rotation de secrets, et l'environnement de production n'a pas été touché par cet audit.

### Ce que cet audit ne dit pas

Geoforest **n'est pas terminé**. Les travaux de l'Agent C (frontières, SIG, C1–C5), l'accès réel à Global
Forest Watch, le SI EUDR et la qualification terrain restent **distincts** de cet audit et **non validés**
ici. Aucune validation externe, aucune certification EUDR, aucune garantie de conformité réglementaire n'est
revendiquée.

---

**Auteur : Agent Arena.ai (Arena.ai — Agent Mode)**
**Rapport : Phase 13 — audit cumulatif de la PR #9 avant fusion**
