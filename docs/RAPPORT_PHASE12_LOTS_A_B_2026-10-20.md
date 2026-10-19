# Rapport : Phase 12 — intégration contrôlée des corrections critiques (lot A identité, lot B pool)

**Auteur : Agent Arena.ai (Arena.ai — Agent Mode)**
**Date : 2026-10-20**
**Branche de travail : `integration/lot-a-b-identite-build`** (créée à `a5450492ad60fbc028e278f962bc13e04b30d095`)
**Pull request : [#9](https://github.com/Huberaya/Geoforest/pull/9)** — base `main`, **non fusionnée**

---

## 1. Objet et périmètre

Ce rapport couvre l'intégration des deux corrections critiques identifiées en phase 11 :

- **Lot A — identité de l'opérateur** : suppression de l'identité de remplissage
  `XX0000000000000`, préservation de l'absence d'identité, refus de l'export en
  `422 OPERATOR_IDENTITY_MISSING`, distinction des identités confirmées, absentes et
  héritées, migration de schéma associée.
- **Lot B — pool `/api/metrics`** : suppression de la dépendance à une connexion
  fictive (`postgresql://absente:…`) à l'import, sans rendre le build dépendant d'une base.

**Hors périmètre, non intégré** (conformément au mandat) : frontières Natural Earth et
moteur géographique de l'Agent C, règles de risque de l'Agent C, règle de date de récolte,
arbitrage sur le désaccord entre moteurs EUDR, toute substitution d'`UNKNOWN` par un pays
ou un niveau de risque estimé.

---

## 2. Points de départ — SHAs complets

| Référence | SHA | Vérification |
|---|---|---|
| `main` (origine) | `1c95f4c585ed8303f887089ae7450c9235523fd0` | `git ls-remote` avant et après les travaux : **inchangé** |
| Cumul (origine `arena/e7725e3f-geoforest`) | `a5450492ad60fbc028e278f962bc13e04b30d095` | `git ls-remote` : **inchangé**, conforme au SHA qualifié |
| Agent C (origine `arena/837c5c36-geoforest`) | `ca15ccb195363f27a656f0c23caebf811330b3a2` | inchangé (rapport de phase 11) |
| **Base de la branche isolée** | `a5450492ad60fbc028e278f962bc13e04b30d095` | `git worktree add -b integration/lot-a-b-identite-build … a5450492` |
| **Tête de branche à la rédaction** | `e17bd9d532bd8ab9fe876c796398f4a0451341c5` | `git rev-parse HEAD` |

Le graphe n'avait pas évolué : le cumul distant était toujours à `a5450492…` au moment de
la création de la branche. Aucune condition d'arrêt « graphe dérivé » n'était remplie.

### Écart d'environnement constaté (aucune écriture)

Le checkout principal `/home/user/Geoforest` n'était **pas** à l'état laissé en phase 11 :
il est revenu à `1c95f4c…` (clone superficiel, `.git/shallow` présent) avec **48 modifications
non attribuées** (27 `M`, 21 `??`), et `ca15ccb` (poussée de la phase 11) n'y existe pas
localement.

Conformément aux consignes : **aucun `checkout`, `reset`, `clean`, ni commit n'a été fait
dans ce checkout**. L'intégralité du travail de phase 12 a été réalisée dans un worktree
séparé, `/home/user/integration-a5450492`, créé depuis `a5450492`.

---

## 3. Commits créés

```
e17bd9d532bd8ab9fe876c796398f4a0451341c5  CI locale — exécuter les bancs lot A et lot B dans test:unit
38b6dce                                   Lot B — pool privilégié : initialisation réellement paresseuse
d20da77                                   Lot A — identité de l'opérateur : ne plus fabriquer, refuser l'export sans identité
a5450492ad60fbc028e278f962bc13e04b30d095  (base, cumul inchangé)
```

Trois commits, un par lot fonctionnel puis l'outillage de CI — de sorte qu'un `git bisect`
ne traverse jamais un banc qui référence du code inexistant.

---

## 4. Fichiers modifiés

**23 fichiers, +4 634 / −77 lignes** (`git diff --stat a5450492..e17bd9d`).

### Lot A — code

| Fichier | Nature |
|---|---|
| `src/lib/eudr/identite-operateur.ts` | **nouveau** — classification et décision d'export |
| `src/app/api/v1/audit/parcel/route.ts` | suppression d'`ANONYMOUS_OPERATOR`, colonnes nullables |
| `src/app/api/v1/export/traces/route.ts` | refus 422 `OPERATOR_IDENTITY_MISSING` |
| `src/app/api/v1/audits/route.ts` | expose `operator_identity` |
| `src/lib/eudr/types.ts` | `operator_name` nullable, `country` nullable, `operator_identity` |
| `src/lib/eudr/traces-exporter.ts` | plus de pays `"FR"` inventé dans la déclaration |
| `src/db/schema.ts` | colonnes nullables, plus de `default("FR")` |
| `backend/app/services/identite_operateur.py` | **nouveau** — même classification côté Python |
| `backend/app/api/v1/endpoints.py` | suppression d'`_ANONYMOUS_OPERATOR`, 422 à l'export |
| `backend/app/models/schemas.py` | `operator_name` nullable, `country` sans défaut, `operator_identity` |
| `backend/app/models/sql_models.py` | DDL et dataclass : identité facultative |
| `backend/app/core/database.py` | migration SQLite transactionnelle + `operator_country` |
| `backend/app/services/traces_exporter.py` | plus de pays `"FR"` inventé |

### Lot A — migration

| Fichier | Nature |
|---|---|
| `drizzle/0009_operateur_non_renseigne.sql` | **nouveau** — `DROP NOT NULL`, `DROP DEFAULT`, vue de reprise |
| `drizzle/0009_operateur_non_renseigne.down.sql` | **nouveau** — descente refusée si une identité manque |
| `drizzle/meta/0009_snapshot.json` | **nouveau** — généré par `drizzle-kit generate` |
| `drizzle/meta/_journal.json` | entrée `idx: 9` ajoutée |
| `scripts/sql/post-migrate/025_vue_identite_operateur.sql` | **nouveau** — révocation des droits d'écriture sur la vue |

### Lot A — tests et vérification

| Fichier | Nature |
|---|---|
| `backend/tests/test_operateur_identite.py` | **nouveau** — 27 tests |
| `scripts/check-identite-operateur.ts` | **nouveau** — 22 contrôles |

### Lot B

| Fichier | Nature |
|---|---|
| `src/db/admin.ts` | pool paresseux, proxy transparent, plus d'URL factice |
| `scripts/check-pool-admin.ts` | **nouveau** — 27 contrôles |

### Outillage

| Fichier | Nature |
|---|---|
| `package.json` | `test:unit` exécute les deux nouveaux bancs |

Aucun autre fichier n'a été touché. `next-env.d.ts` a été vérifié après build : inchangé.

---

## 5. Lot A — décisions techniques et raisons

### 5.1 Trois états, une seule règle

`classerIdentiteOperateur(nom, eori)` renvoie `declared`, `missing` ou
`legacy_placeholder`. La même règle existe en Python (`classer_identite_operateur`) **et**
en SQL (vue `v_parcel_audits_identite`), avec le **même vocabulaire** : un dossier accepté
par l'interface et refusé par l'API rendrait la règle inutilisable, et l'écart ne se verrait
qu'en production.

- `eori` vide, absent ou fait d'espaces → `missing`.
- `eori` égal à `XX0000000000000` (**comparaison insensible à la casse** : c'est une
  sentinelle, pas un identifiant) → `legacy_placeholder`.
- EORI présent mais nom de moins de 2 caractères → `missing` (un EORI seul ne nomme
  personne).
- Sinon → `declared`, seul état exportable.

### 5.2 Création : plus aucune fabrication

`parseOperator` renvoie `null` au lieu de `ANONYMOUS_OPERATOR`. La persistance écrit
`null` dans `operator_name`, `operator_eori`, `operator_country`, `operator_address`.
Côté Python, `payload.operator or _ANONYMOUS_OPERATOR` devient `payload.operator`, et
`_ANONYMOUS_OPERATOR` est supprimé.

`same_as_operator` (producteur identique à l'opérateur) ne recopie plus une identité
inexistante : sans opérateur, le producteur reste inconnu au lieu d'hériter d'une identité
de synthèse.

### 5.3 Export : refus 422, sans écraser les 409

Le contrôle d'identité est placé **après** les refus existants (géométrie invalide,
déforestation post-2020, analyse non probante). Un test dédié verrouille cet ordre : un
dossier sans identité **et** sans analyse probante reste refusé en **409**, avec le message
historique. Le 422 est distinct :

```json
{
  "detail": "Export refusé : … Renseignez l'identité dans la requête (champ `operator`) …",
  "code": "OPERATOR_IDENTITY_MISSING",
  "operator_identity": "missing" | "legacy_placeholder"
}
```

La décision est isolée dans `resoudreIdentiteExport()` — fonction **pure**, donc exécutable
en test. La route ne fait que traduire le verdict en réponse HTTP. Une règle « pas
d'identité, pas d'export » qui ne serait vérifiable qu'en lisant le code ne serait pas une
règle.

L'identité peut être fournie **au moment de l'export** : elle complète la déclaration sans
réécrire l'audit (vérifié : `get_audit()` renvoie toujours `null` après un export réussi).
Les deux formats (JSON et XML) passent par le même contrôle ; un test couvre le XML, qui
aurait pu être un contournement.

### 5.4 Le pays n'est plus inventé

`operator.country ?? "FR"` apparaissait à trois endroits (stockage TS, payload TS,
payload Python) et `OperatorInfo.country` avait `default="FR"` côté Pydantic. Un opérateur
brésilien silencieux devenait donc « français » dans une déclaration destinée au SI EUDR.

Décision : **on stocke ce qui est déclaré**, `null` sinon ; à défaut de déclaration, le pays
est déduit du **préfixe de l'EORI**, qui est un fait attaché à l'identifiant et non une
valeur par défaut arbitraire. Cette déduction existait déjà dans le chemin d'export
(`eori.slice(0, 2)`) ; elle est désormais la seule, et documentée.

> Ce point ne tranche **aucune** question géographique sur la parcelle : `country_code`,
> `country_of_activity` et `risk_level` sont hors périmètre et inchangés (voir § 10).

### 5.5 Historique préservé

Aucun dossier hérité n'est réécrit ni supprimé :

- la valeur `XX0000000000000` reste en base, telle quelle ;
- elle est **réconnue** (`legacy_placeholder`) et signalée dans les réponses d'erreur et de
  liste (`operator_identity`) ;
- la vue de reprise la classe sans la modifier.

Réécrire cette valeur effacerait l'information « ce dossier a été créé sans identité » —
c'est précisément cette information qui permet une reprise explicite.

### 5.6 Chemins secondaires vérifiés

Recherche exhaustive de `operatorEori|operatorName|operator_eori|operator_name` dans `src/`
et `backend/app/` : les seuls producteurs de déclaration sont
`src/lib/eudr/traces-exporter.ts` (appelé uniquement par la route d'export) et
`backend/app/services/traces_exporter.py` (appelé uniquement par `export_traces`). Aucun
autre point d'écriture d'identité n'existe.

---

## 6. Migration

### 6.1 Choix de l'identifiant

Inspection préalable : `drizzle/meta/_journal.json` s'arrête à `idx 8 — 0008_fournisseur_invitation`.
`scripts/migrate.ts` applique `drizzle/*.sql` via le migrateur Drizzle, puis
`scripts/sql/post-migrate/*.sql` (010 → 024) dans l'ordre lexical, de façon idempotente, et
échoue en cas d'incohérence.

→ **Prochain identifiant réellement libre : `0009`.** Aucune migration publiée n'a été
renommée, réécrite ni écrasée. `0009` a été **généré par `drizzle-kit generate`** (pas écrit
à la main) ; les commentaires et la vue ont été ajoutés ensuite, sans toucher aux
instructions générées.

Vérification de cohérence : `npx drizzle-kit generate` relancé après coup →
**`No schema changes, nothing to migrate`** (le snapshot 0009 correspond exactement à
`src/db/schema.ts`).

### 6.2 Contenu

```sql
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_name" DROP NOT NULL;
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_eori" DROP NOT NULL;
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" DROP DEFAULT;
ALTER TABLE "parcel_audits" ALTER COLUMN "operator_country" DROP NOT NULL;
```

Plus la vue `v_parcel_audits_identite`, en **lecture seule**, avec
`security_invoker = true`.

**Pourquoi `security_invoker`** : une vue s'exécute par défaut avec les droits de son
propriétaire et **ignore la RLS** de la table sous-jacente. Sans cette option, la vue aurait
exposé les audits de toutes les organisations. Mesuré sur PostgreSQL 16.2 (§ 6.4).

**Pourquoi `025_vue_identite_operateur.sql`** : `010_row_level_security.sql` exécute
`GRANT … ON ALL TABLES`, ce qui inclut les vues et accorde à `geoforest_app` des droits
`INSERT`/`UPDATE` sur une vue non modifiable. `010` étant un script **publié**, il n'a pas
été modifié : `025`, appliqué après, révoque ces droits.
Sur une installation neuve, l'ordre 0009 (vue) → 010 (grants) → 025 (révocation) est correct.

### 6.3 Descente

`0009_operateur_non_renseigne.down.sql` **refuse** de s'appliquer tant qu'un dossier est
sans identité : réintroduire `NOT NULL` exigerait d'inventer une identité, c'est-à-dire de
recréer le défaut corrigé. Le message nomme les compteurs (sans pays / sans EORI / sans nom).

Deux corrections apportées en cours de route, toutes deux mesurées :

1. Une première version du fichier écrivait `UPDATE … SET operator_country = 'FR' WHERE … IS NULL`
   en prétendant échouer : elle réussissait en **fabriquant un pays**. Supprimée.
2. La garde a été déplacée **avant** le `DROP VIEW`. Mesuré : dans l'ordre inverse, une
   descente refusée laissait la vue détruite et les colonnes toujours facultatives — un
   état que plus aucune version du code ne sait lire.

### 6.4 Résultats réels — PostgreSQL 16.2 (base temporaire, données synthétiques)

PostgreSQL embarqué (`pgserver`, binaires 16.2), base créée pour l'occasion, **jamais une
base réelle**. Sortie : **23 contrôles passés, 0 échec**.

| Contrôle | Résultat |
|---|---|
| Installation neuve 0000 → 0009 : table présente | ✅ |
| Installation neuve : les 3 colonnes d'identité sont nullables | ✅ |
| Installation neuve : `operator_country` sans valeur par défaut | ✅ |
| Installation neuve : vue présente, `security_invoker=true` | ✅ |
| Mise à niveau depuis 0008 : état antérieur réel (`NOT NULL`, défaut `'FR'`) | ✅ |
| Mise à niveau : 1 ligne héritée avant → 1 après (**aucune perte**) | ✅ |
| Mise à niveau : dossier hérité conservé **tel quel** (`Opérateur non renseigné` / `XX0000000000000` / `XX`) | ✅ |
| Mise à niveau : les 3 colonnes deviennent nullables | ✅ |
| Mise à niveau : insertion d'un dossier **sans identité** acceptée | ✅ |
| Vue : `legacy_placeholder` et `missing` correctement distingués | ✅ |
| Vue : aucune ligne orpheline (LEFT JOIN → 0) | ✅ |
| Descente avec dossier sans identité : échoue explicitement | ✅ |
| Après cet échec : schéma inchangé **et** vue toujours présente (aucune application partielle) | ✅ |
| Descente sans identité manquante : réussit, `NOT NULL` rétabli, vue retirée, **aucune perte** | ✅ |
| RLS : avec `security_invoker`, la vue ne montre que le tenant courant (1 ligne sur 2) | ✅ |
| RLS : la table sous-jacente est bien cloisonnée | ✅ |
| Témoin : une vue **sans** `security_invoker` montre les 2 tenants → l'option est nécessaire | ✅ |

Les 17 lignes ci-dessus résument 23 assertions du harnais.

### 6.5 Migration SQLite du backend (base existante)

`CREATE TABLE IF NOT EXISTS` ne retire pas une contrainte sur une table déjà créée : une
base antérieure conservait `operator_eori NOT NULL` et n'avait pas `operator_country`.
Reconstruction de table selon la procédure officielle SQLite, avec trois précautions issues
d'échecs mesurés :

1. **transaction explicite** — `executescript()` émet un `COMMIT` implicite et rendrait le
   `ROLLBACK` inopérant (`cannot rollback - no transaction is active`, constaté) : les
   instructions sont donc passées à `execute()` une par une dans une transaction manuelle ;
2. **copie sur l'intersection** des colonnes anciennes et cibles — une colonne ancienne
   absente du nouveau schéma faisait échouer l'`INSERT` après le renommage ;
3. **comparaison du nombre de lignes** avant `DROP TABLE` — une copie partielle est un
   échec, pas un succès.

Tests (`backend/tests/test_operateur_identite.py`, 4 tests) : base ancienne migrée avec
conservation de la valeur héritée ; colonne supplémentaire absente du schéma cible tolérée ;
migration idempotente (2 exécutions) ; **échec forcé par déclencheur → base intacte,
1 ligne toujours présente, aucune table temporaire résiduelle**.

### 6.6 Migration sur PostgreSQL réel en CI

Le job CI **« Database & HTTP contracts (Neon branch) »** crée une branche Neon éphémère et
exécute `Apply migrations on the test branch` : **succès** sur le SHA `e17bd9d…`
(run [39333719902](https://github.com/Huberaya/Geoforest/actions/runs/39333719902)).
La migration 0009 s'applique donc aussi sur un PostgreSQL géré, sans intervention manuelle.

---

## 7. Lot B — décisions techniques et raisons

### 7.1 Le défaut d'origine

`next build` évalue les modules de route pendant « Collecting page data », sans base et sans
servir de requête. `src/db/admin.ts` construisait le pool au niveau du module : le build
cassait sur `/api/metrics` (importé par `route-supervision` → `auth/session` → `admin.ts`).

La correction présente dans le cumul testait `NEXT_PHASE === "phase-production-build"` et
construisait, en phase de build, un pool vers
`postgresql://absente:absente@127.0.0.1:1/absente`. Trois raisons de la retirer :

1. elle **construit quand même** un pool à l'import — la dépendance est déplacée, pas
   supprimée ;
2. elle ne tient qu'à une variable d'environnement : hors du build de Next.js, ou si la
   variable disparaît, le pool factice est construit ;
3. un module de connexion ne devrait pas dépendre d'une phase de build.

### 7.2 La correction

Importer ne fait **rien** : aucun pool, aucune lecture de configuration. Le premier accès
réel construit la connexion ; sans `DATABASE_URL_ADMIN` (ou `DATABASE_URL`), il lève
`DATABASE_URL_ADMIN est requis pour les opérations système.`

Aucune URL de repli n'existe : un pool factice ferait passer un service non configuré pour
opérationnel — exactement ce que le mandat interdit.

### 7.3 Transparence du proxy

Un `Proxy` limité à `get`/`has` n'est pas transparent. Mesuré sur la première version :
`Object.keys(adminPool)` → `[]`, `{ ...adminPool }` → `{}`, `adminPool instanceof Pool` →
`false`, `adminPool.query !== adminPool.query`.

Le proxy piège désormais `get`, `set`, `has`, `deleteProperty`, `defineProperty`, `ownKeys`,
`getOwnPropertyDescriptor` et `getPrototypeOf` :

- `getOwnPropertyDescriptor` force `configurable: true` — déclarer non configurable une
  propriété absente de la cible violerait un invariant du langage (TypeError) ;
- `getPrototypeOf` rend `instanceof Pool` vrai ;
- les **méthodes** sont liées (identité stable), mais **pas les constructeurs** : lier
  `constructor`/`Client` faisait `adminPool.constructor !== Pool` et cassait
  `new pool.Client()`. Une méthode n'a pas de `prototype`, un constructeur en a toujours un.

### 7.4 Vérification

`scripts/check-pool-admin.ts` — **27 contrôles, 0 échec**, en deux processus séparés :

- **sans aucune configuration** (et avec `NEXT_PHASE=phase-production-build`) : import sans
  exception, **aucun pool construit**, accès à `adminPool`/`dbAdmin` en échec explicite
  nommant la variable, import du module de route `/api/metrics` sans exception ;
- **avec configuration** : aucun pool à l'import, 8 contrôles de réflexion, identité des
  méthodes, `instanceof`, constructeurs non liés, écriture/suppression déléguées, puis un
  **appel effectif** vers `127.0.0.1:1` → `ECONNREFUSED` (échec explicite, jamais un succès
  silencieux) et `end()` lié.

---

## 8. Matrice de validation — commandes, codes de sortie, résultats

Toutes exécutées dans `/home/user/integration-a5450492`, sur
`e17bd9d532bd8ab9fe876c796398f4a0451341c5`.

| # | Contrôle | Commande | Code | Résultat |
|---|---|---|---|---|
| 1 | Typecheck | `npx tsc --noEmit` | **0** | aucune erreur |
| 2 | Lint | `npm run lint` | **0** | aucune erreur |
| 3 | Tests unitaires + bancs EUDR | `npm run test:unit` | **0** | 72/72, 22/22, 27/27, 40/40, 25/25, 27/27 |
| 4 | Tests backend | `cd backend && python -m pytest -q` | **0** | **138 passed, 5 xfailed** (111 + 27 nouveaux) |
| 5 | Régression identité (Python) | `pytest tests/test_operateur_identite.py -q` | **0** | 27 passed |
| 6 | Régression identité (TS) | `tsx --conditions=react-server scripts/check-identite-operateur.ts` | **0** | 22 contrôles, 0 échec |
| 7 | Pool paresseux | `tsx --conditions=react-server scripts/check-pool-admin.ts` | **0** | 27 contrôles, 0 échec |
| 8 | Build **sans base** | `env -u DATABASE_URL -u DATABASE_URL_ADMIN npm run build` | **0** | compilé ; `/api/metrics` présent dans la sortie |
| 9 | Migration 0009 — PostgreSQL 16.2 | harnais `pgserver` (§ 6.4) | **0** | 23 contrôles, 0 échec |
| 10 | Absence de dérive de schéma | `npx drizzle-kit generate` | **0** | `No schema changes, nothing to migrate` |
| 11 | Test des workflows CI | `npm run test:ci` | **0** | 4/4 |
| 12 | Audit production | `npm audit --omit=dev` | **0** | `found 0 vulnerabilities` |
| 13 | Audit global (`audit:sec`) | `npm run audit:sec` | **1** | 5 vulnérabilités *high*, **toutes dev** (voir § 10) |
| 14 | Tests de sécurité backend | `pytest tests/test_security_config.py tests/test_cross_tenant.py -q` | **0** | 6 passed, 2 xfailed |
| 15 | Recherche du placeholder | `grep -rn "XX0000000000000" src/ backend/ scripts/ drizzle/` | — | uniquement définitions/commentaires/tests ; **aucune écriture** |
| 16 | Recherche de l'URL factice | `grep -rn "absente:absente\|URL_FACTICE\|NEXT_PHASE" src/db/admin.ts` | — | **aucune occurrence hors commentaire** |

### Recherche de réapparition de l'identifiant fictif

Les occurrences restantes de `XX0000000000000` sont : la constante de classification
(3 modules), les commentaires explicatifs, les tests de régression et la vue SQL. **Aucune
n'est un point d'écriture** : aucune route, aucun service ne produit plus cette valeur.

### CI

| Élément | Valeur |
|---|---|
| Run | [39333719902](https://github.com/Huberaya/Geoforest/actions/runs/39333719902) |
| SHA | `e17bd9d532bd8ab9fe876c796398f4a0451341c5` |
| Événement | `pull_request` (une poussée sur `arena/*` ne déclenche pas la CI) |
| Conclusion | **success** |
| Job « Verify Frontend & Backend » | success — Python, `Workflow regression tests`, `Typecheck`, `Lint`, `Unit tests`, `EUDR rules tests`, `Build` |
| Job « Database & HTTP contracts (Neon branch) » | success — `Create ephemeral Neon branch`, **`Apply migrations on the test branch`**, `Database controls`, `Build production bundle`, `Start production server`, `End-to-end journey`, `Cross-tenant HTTP controls`, `Supplier journey HTTP controls` |

---

## 9. Non exécuté / bloqué

| Élément | Statut | Raison |
|---|---|---|
| Test HTTP du **422 de la route TypeScript** d'export | **NON EXÉCUTÉ** | exige un serveur Next authentifié + PostgreSQL amorcé ; la décision est testée comme fonction pure (`resoudreIdentiteExport`, 7 cas) et la route ne fait que traduire le verdict. Le 422 Python, lui, est testé en HTTP réel. |
| Tests E2E couvrant explicitement l'export sans identité | **NON EXÉCUTÉ** | le parcours E2E de la CI ne comporte pas ce cas ; ajout non réalisé faute de compte de test dédié et pour ne pas élargir le diff. |
| `npm run test:db`, `test:cross-tenant:rls`, `verifier:role` en local | **NON EXÉCUTÉ** | nécessitent le rôle `geoforest_app` et le script 010 en local ; couverts en CI par `Database controls` sur la branche Neon. |
| Pile `docker compose` complète | **NON EXÉCUTÉ** | pas de démon Docker dans l'environnement (constat de phase 11, inchangé). |
| Validation GFW / SI EUDR / terrain | **BLOQUÉ** | aucun accès externe (constat de phase 11, inchangé). Aucune affirmation de validation externe n'est faite dans ce rapport. |
| PostgreSQL de la CI : version exacte | **NON VÉRIFIÉ** | la branche Neon est éphémère et sa version n'est pas exposée dans les journaux accessibles. La migration a été validée localement sur **16.2** ; `security_invoker` exige PostgreSQL ≥ 15, et `docker-compose.yml` cible `postgres:16-alpine`. |

---

## 10. Risques résiduels (non corrigés, hors périmètre)

1. **`src/db/index.ts` conserve le motif voisin.** Le pool *tenant* est construit à l'import
   et retombe sur `postgresql://absente:absente@…` si `DATABASE_URL` manque (avec un
   `console.error` et une exception en production). Ce n'est pas le pool de `/api/metrics`,
   et le build passe sans lui — mais la classe de défaut est la même. **Non modifié** pour ne
   pas élargir le lot B sans validation.
2. **`country_of_activity` reste à `"FR"` par défaut** (route d'export TS, schéma Pydantic,
   options Python). C'est un pays **de la parcelle**, non de l'opérateur : le changer est une
   décision produit/géographique, hors périmètre.
3. **`ProducerCountry: "XX"` et `producers[].country: "XX"`** subsistent dans
   `traces_exporter.py` : identité **du producteur**, autre sujet que le lot A.
4. **`country_risk` / `risk_level` par défaut à `'STANDARD'`** dans le DDL : le « plancher
   STANDARD » signalé en phase 11 n'est pas traité ici. Il relève de l'arbitrage distinct sur
   les moteurs EUDR.
5. **Vulnérabilités npm dev** : 5 *high* (`braces` CVE-2026-93687 et sa chaîne
   `fast-glob`/`micromatch`/`eslint-config-next`), **aucune en production**, **aucun correctif
   publié**. `npm audit fix --force` imposerait une rétrogradation majeure : non appliqué.
   `npm run audit:sec` sort donc en **1**, et ce n'est **pas** un gate vert.
6. **5 tests backend `xfailed`** : préexistants, inchangés.
7. **La descente 0009 refuse tant qu'une identité manque** : c'est voulu, mais cela signifie
   qu'un retour arrière exige une reprise produit préalable. Aucun outil de reprise n'est
   fourni dans ce lot.
8. **Champ `operator_identity` ajouté aux réponses d'API** (`/api/v1/audits`,
   `/api/v1/export/traces`) : ajout compatible, mais un client qui valide strictement le
   schéma pourrait le rejeter.

---

## 11. Conformité aux consignes de chantier

- Aucun `force push`, aucun `reset --hard`, aucun `clean -fd`.
- Aucune branche source (`arena/*`), aucune migration publiée modifiée ; `0009` est un
  identifiant libre, généré par l'outil.
- Aucune migration ni aucun test sur une base réelle : PostgreSQL embarqué, base temporaire,
  données synthétiques. La CI utilise une branche Neon **éphémère** créée pour le run.
- Aucun secret, jeton, mot de passe ni donnée personnelle dans le code, les commits ou ce
  rapport. Les URL de test utilisées sont synthétiques (`synthetique:synthetique@127.0.0.1:1`).
- Aucun dossier historique réécrit ou supprimé.
- Aucune modification de `main`, **aucune fusion**, **aucun déploiement**.

---

## 12. Conclusion

Les deux corrections sont **implémentées, testées et vérifiées** sur une branche isolée :

- l'identité de l'opérateur n'est plus jamais fabriquée ; l'absence est représentée par
  `null`, les dossiers hérités sont reconnus sans être réécrits, et l'export refuse en
  **422 `OPERATOR_IDENTITY_MISSING`** sans affaiblir les 409 existants ;
- le pool privilégié ne dépend plus d'une connexion fictive à l'import, et une configuration
  absente produit une erreur explicite au lieu d'un service silencieusement inopérant.

**Verdict : `LOTS A ET B VALIDÉS LOCALEMENT ET EN CI`**, sous réserve des éléments
**NON EXÉCUTÉS** du § 9 et des risques résiduels du § 10, qui restent ouverts et ne sont
pas couverts par ce lot.

La phase reste ouverte pour l'arbitrage distinct sur les moteurs EUDR et les points du § 10.

---

**Auteur : Agent Arena.ai (Arena.ai — Agent Mode)**
**Rapport : Phase 12 — intégration contrôlée des corrections critiques (lot A identité, lot B pool)**
