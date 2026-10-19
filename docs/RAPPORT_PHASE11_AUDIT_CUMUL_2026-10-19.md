# Geoforest — phase 11 : audit final de couverture du cumul

**Rapport :** « Geoforest — phase 11 : audit final de couverture et préparation à la revue de fusion »
**Auteur :** Agent Arena.ai (Arena.ai — Agent Mode)
**Date :** 2026-10-19
**Objet :** déterminer si le cumul `a5450492` contient réellement les changements attendus, notamment ceux de l'Agent C, et s'il est prêt pour une revue de fusion.

> **Aucune écriture n'a été faite avant l'établissement de l'état Git.** Aucun
> `reset --hard`, aucun `clean`, aucun changement de branche, aucun fichier
> supprimé. Le cumul n'a pas été modifié. `main` n'a pas été touchée.

---

## 1. Références distantes — SHA complets

Interrogées par `git ls-remote --heads origin` :

| Référence | SHA complet |
|---|---|
| `refs/heads/main` | `1c95f4c585ed8303f887089ae7450c9235523fd0` |
| `refs/heads/arena/e7725e3f-geoforest` | `a5450492ad60fbc028e278f962bc13e04b30d095` |
| `refs/heads/arena/837c5c36-geoforest` | `3c65e47e3ac5f08a06d494eb08f16ff4baa9626f` |

⚠️ **Écart avec le briefing.** Le briefing cite comme commits Agent C
`eacab9b` et `4dc4417`. La branche Agent C a reçu depuis deux commits
supplémentaires (`17fc848`, `3c65e47`) qui ne sont pas mentionnés. Toute
comparaison faite contre `4dc4417` seule manquerait les correctifs P3-01 à
P3-04. C'est `3c65e47` qui fait foi ici.

**État du checkout local.** Il est **propre** (`git status` : 0 entrée), sur
`arena/837c5c36-geoforest` à `3c65e47`. Le briefing le décrivait comme
« divergent, avec de nombreux fichiers modifiés ou non suivis » : ce n'était
plus vrai à l'ouverture de cette phase, et **rien n'a été nettoyé ni écrasé**.

---

## 2. Analyse du graphe Git

### 2.1 Ancêtre commun

```
$ git merge-base main a5450492
1c95f4c585ed8303f887089ae7450c9235523fd0
```

Les deux branches descendent de `main` à `1c95f4c`, mais **séparément**.

### 2.2 Test d'ascendance

| Commit | `git merge-base --is-ancestor <sha> a5450492` |
|---|---|
| `eacab9b` (code Agent C, phase 2) | **NON** |
| `4dc4417` (documentation Agent C) | **NON** |
| `3c65e47` (head Agent C, phase 3) | **NON** |

**Aucun commit de l'Agent C n'est ancêtre du cumul.** Le cumul compte
**94 commits** depuis `main` ; la branche Agent C en compte **7**. Le graphe du
cumul ne contient aucune mention de l'Agent C, de la branche `837c5c36`, de
`eacab9b` ni des identifiants P2-14/15/16 :

```
$ git log a5450492 | grep -iE "agent c|837c5c36|fronti[eè]re|identit[ée] op|P2-1[456]"
(aucun résultat)
```

### 2.3 Conséquence

L'inclusion ne peut donc pas être établie par le graphe. Elle a été cherchée
**dans l'arbre de fichiers**, fichier par fichier, par `git cat-file` et par
lecture du contenu — jamais par déduction à partir d'une PR ou d'un rapport.

---

## 3. Couverture effective — tableau par changement

Méthode : présence du chemin dans l'arbre (`git cat-file -e a5450492:<chemin>`),
puis lecture du contenu. « Présent » signifie que le fichier existe ; la
colonne « verdict » dit si le **comportement** y est.

| # | Changement Agent C | Fichier(s) attendu(s) | Dans le cumul ? | Verdict |
|---|---|---|---|---|
| 1 | Build `/api/metrics` — connexion paresseuse au premier usage | `src/db/admin.ts` | fichier **présent**, contenu **différent** (1 707 o) | **PARTIELLEMENT REPRIS — autre approche, contraire à la contrainte** |
| 2 | Test de non-régression du build | `scripts/check-demarrage-sans-config.ts` | **absent** | **ABSENT** |
| 3 | Proxy transparent (réflexion `ownKeys`/`getPrototypeOf`) | `src/db/admin.ts` | pas de proxy du tout | **ABSENT** |
| 4 | Identité opérateur nullable (migration 0007) | `drizzle/0007_operateur_non_renseigne.sql` | **absent** (le 0007 du cumul est `0007_parcel_audit_liens`) | **ABSENT** |
| 5 | Colonnes `operator_*` sans `NOT NULL` ni défaut | `src/db/schema.ts`, `sql_models.py` | `notNull()` + `default("FR")` conservés | **ABSENT** |
| 6 | Export sans identité → **422** `OPERATOR_IDENTITY_MISSING` | `export/traces/route.ts`, `endpoints.py` | aucune occurrence du code d'erreur | **ABSENT** |
| 7 | Plus de fabrication `XX0000000000000` | `audit/parcel/route.ts`, `endpoints.py` | **toujours fabriqué** | **ABSENT — régression de condition de clôture** |
| 8 | Producteur ≠ opérateur | `traces-exporter.ts`, `traces_exporter.py` | `ProducerName: record.operator_name` conservé | **ABSENT** (le cumul neutralise le pays seulement) |
| 9 | Vue de reprise `v_parcel_audits_identite` | migration 0007 | **absente** | **ABSENT** |
| 10 | Tests d'identité (10) | `backend/tests/test_operateur_identite.py` | **absent** | **ABSENT** |
| 11 | Frontières Natural Earth 1:50m | `data/frontieres/*` (5 fichiers) | **absent** | **ABSENT** |
| 12 | Résolution pays TS | `src/lib/eudr/frontieres.ts` | **absent** | **ABSENT** |
| 13 | Résolution pays Python | `backend/app/services/frontieres.py` | **absent** | **ABSENT** |
| 14 | Points de contrôle partagés TS/Python | `data/frontieres/points-de-controle.json` | **absent** | **ABSENT** |
| 15 | Tests limites GIS + parité | `test_gis_edge_cases.py`, `check-eudr-geo-edge-cases.ts` | **absents** | **ABSENT** |
| 16 | Garde de rollback (refus d'inventer `FR`) | `0007_*.down.sql` | sans objet : migration absente | **ABSENT** |
| 17 | Reconstruction SQLite atomique | `backend/app/core/database.py` | aucune reconstruction (pas de migration) | **ABSENT** |
| 18 | Seed sans mot de passe en dur | `scripts/seed-auth.ts` | **présent et équivalent** (repli absent, refus prod, liste de mots de passe publics) | **REPRIS INDÉPENDAMMENT — équivalent** |
| 19 | `source-map-js` corrigé en production | `package.json` / lock | **1.2.2** par commit dédié | **REPRIS INDÉPENDAMMENT — équivalent** |
| 20 | Recette externe (14 cas) | `docs/RECETTE_VALIDATION_EXTERNE_2026-10-19.md` | **absent** | **ABSENT** |
| 21 | Rapport de validation et de sécurité | `docs/VALIDATION_…`, `docs/SECURITE_…` | **absents** | **ABSENT** |

**Bilan : 2 changements repris indépendamment à l'identique (18, 19), 1
partiellement et par une approche interdite (1), 18 absents.**

### 3.1 Le point 1 mérite d'être lu en détail

Le cumul corrige bien le build, mais autrement :

```ts
const BUILD_PHASE = process.env.NEXT_PHASE === "phase-production-build";
const URL_FACTICE = "postgresql://absente:absente@127.0.0.1:1/absente";

function createAdminPool(): Pool {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL;
  if (!url) {
    if (BUILD_PHASE) {
      return new Pool({ connectionString: URL_FACTICE, max: 1 });
    }
    throw new Error("DATABASE_URL_ADMIN est requis pour les opérations système.");
  }
  ...
}
export const adminPool = globalForAdmin.__geoforestAdminPool ?? createAdminPool();
```

La connexion est **toujours construite à l'import**, et l'absence de
configuration produit un pool pointant vers une URL inventée. C'est
exactement ce que la phase 2 interdisait : « interdiction d'un stockage
fictif silencieux, d'une variable secrète factice ou d'un contournement qui
masque seulement le message ».

Le build passe (la CI le confirme), mais la propriété protégée est différente :
avec l'approche Agent C, **importer** le module ne demande aucune configuration
et **utiliser** le pool échoue explicitement ; avec l'approche du cumul, un
`NEXT_PHASE` inattendu en exécution donnerait un pool silencieusement inopérant
au lieu d'une erreur.

### 3.2 Le point 7 est une condition de clôture violée

`src/app/api/v1/audit/parcel/route.ts:34` :

```ts
if (raw === null || raw === undefined) return { operator: ANONYMOUS_OPERATOR };
```

avec `ANONYMOUS_OPERATOR = { name: "Opérateur non renseigné", eori: "XX0000000000000", country: "XX" }`,
persisté dans des colonnes `NOT NULL`. Et `src/app/api/v1/export/traces/route.ts`
relit `row.operatorEori` **sans contrôle** : une déclaration peut donc être
émise avec un EORI de remplissage.

C'est littéralement le cas que la phase 2 posait comme condition de clôture :
« un dossier sans identité réelle est exporté comme complet ». **Dans le cumul,
il l'est encore.**

---

## 4. Ce qui est absent — dépendances et ordre d'intégration

Les absences ne sont pas indépendantes. Trois lots :

### Lot A — Identité de l'opérateur (bloquant pour la clôture)

Dépendances, dans l'ordre :

1. `drizzle/0007_operateur_non_renseigne.sql` **doit être renumérotée** : le
   cumul occupe déjà `0007` (`parcel_audit_liens`) et `0008`
   (`fournisseur_invitation`). Une migration Agent C arrivant en `0007`
   entrerait en collision de numéro et d'instantané. Elle doit devenir `0009`,
   avec `meta/0009_snapshot.json` et l'entrée de journal correspondante.
2. `src/db/schema.ts` : retirer `notNull()` et `default("FR")` des trois
   colonnes — **conflit direct** avec le schéma du cumul, qui les a conservés.
3. `sql_models.py` : mêmes colonnes en `TEXT` nullable + dataclass
   `Optional[str]`.
4. `_migrer_identite_operateur` dans `database.py` (reconstruction SQLite) —
   **inexistante** dans le cumul, à ajouter intégralement (version atomique).
5. Routes de création : supprimer `ANONYMOUS_OPERATOR` / `_ANONYMOUS_OPERATOR`.
6. Export : introduire le refus 422 et le code `OPERATOR_IDENTITY_MISSING`,
   **en plus** du refus 409 « déforestation post-2020 » que le cumul a ajouté
   et qu'il faut conserver.
7. Vue de reprise + `security_invoker = true` + révocation des droits
   d'écriture dans `010_row_level_security.sql`.

### Lot B — Robustesse du proxy (non bloquant, mais contredit une contrainte)

Remplacer l'URL factice par la connexion paresseuse. Touche `src/db/admin.ts`
uniquement, plus le banc `check-demarrage-sans-config.ts`. **Conflit direct** :
le cumul a un `adminPool` non-proxy, consommé par `auth/session.ts`,
`audit-log.ts`, `auth/login`, `auth/mfa`, `auth/password`. Le proxy doit rester
compatible avec ces cinq appelants — c'est précisément ce que les 22 contrôles
du banc vérifient.

### Lot C — Frontières réelles (arbitrage produit requis)

⚠️ **Ce lot n'est pas une simple réintégration.** Le cumul a fait un choix
explicite et **testé** :

```python
def resolve_country(lon, lat): return "XX", "Non déterminé", "UNKNOWN"
```

verrouillé par `backend/tests/test_satellite_checker.py` (lignes 97-106), et
documenté dans `SATELLITE_VALIDATION_REPORT.md` :

> « Cette correction **neutralise** la classification pays approximative ; elle
> ne fournit pas à elle seule une classification de remplacement. »

Réintroduire les frontières Natural Earth **inverse une décision produit
documentée** et **casse ces tests**. Ce n'est pas à un agent de trancher :
c'est un arbitrage entre « aucun pays plutôt qu'un pays faux » (cumul) et
« un pays résolu par un référentiel versionné » (Agent C).

**Recommandation :** soumettre l'arbitrage ; s'il va vers les frontières,
intégrer les 5 fichiers de `data/frontieres/`, les deux implémentations et
mettre à jour `test_satellite_checker.py` **en même temps** — sinon la suite
échoue, et la corriger en retirant l'assertion serait exactement le
« rétro-ajustement d'un attendu » interdit.

---

## 5. Preuve de CI

### 5.1 Run `39281643886` — consulté directement

| Élément | Valeur (API GitHub) |
|---|---|
| SHA du run | `a5450492ad60fbc028e278f962bc13e04b30d095` |
| Branche | `arena/e7725e3f-geoforest` |
| Événement | `push` |
| Conclusion | **success** |
| URL | https://github.com/Huberaya/Geoforest/actions/runs/39281643886 |

Deux jobs, tous deux `success` :

**`Database & HTTP contracts (Neon branch)`** — 18 étapes :
`Create ephemeral Neon branch` → `Apply migrations on the test branch` →
`Set application role password (test branch only)` → `Database controls` →
`Reset demo accounts (test branch only)` → `Build production bundle` →
`Start production server` → `End-to-end journey` → `Cross-tenant HTTP controls`
→ `Supplier journey HTTP controls` → `Stop production server` →
**`Delete ephemeral Neon branch`**. Toutes `success`.

**`Verify Frontend & Backend`** — 12 étapes : `Install backend dependencies &
test` (pytest), `Workflow regression tests`, `Typecheck`, `Lint`, `Unit tests`,
`EUDR rules tests`, `Build`. Toutes `success`.

**Ce que cela prouve, et ce que cela ne prouve pas.**

| Prouvé (statut d'étape, API) | Non prouvé |
|---|---|
| Les migrations ont été appliquées sur une branche Neon éphémère | Le **contenu** des sorties de migration |
| Les contrôles DB et HTTP ont tourné et réussi | Qu'aucun test n'a été ignoré silencieusement |
| La branche Neon a été supprimée | Le nombre exact de tests exécutés |

⚠️ **Le journal brut n'est pas consultable depuis cet environnement.**
GitHub redirige les logs vers `productionresultssa6.blob.core.windows.net`,
hors de la liste d'hôtes autorisés (`github.com`, `api.github.com`,
`codeload.github.com`). Je ne peux donc pas citer une ligne de log : ni le
nombre de migrations appliquées, ni le détail du nettoyage. Ces points sont
**rapportés par le rapport de l'Agent A, pas vérifiés par moi**, et je ne les
présente pas comme vérifiés.

### 5.2 Le SHA du run est bien celui de la branche

```
refs/heads/arena/e7725e3f-geoforest = a5450492ad60fbc028e278f962bc13e04b30d095
run 39281643886.headSha            = a5450492ad60fbc028e278f962bc13e04b30d095
```

Identiques : la CI verte porte bien sur la tête actuelle du cumul.

### 5.3 Conséquence pour un candidat d'intégration

Aucun commit n'a été créé (voir § 7). Si un commit avait été produit, la CI
verte de `a5450492` ne l'aurait **pas** validé : il aurait fallu relancer les
deux jobs sur le nouveau SHA. C'est la règle appliquée ici, et elle explique
pourquoi je n'annonce aucun état qualifié pour un état non testé.

---

## 6. Audit des réserves

### 6.1 Les cinq vulnérabilités npm élevées

Mesuré sur l'arbre du cumul (`npm audit --package-lock-only`) :

```
$ npm audit --package-lock-only            → 5 vulnérabilités
@next/eslint-plugin-next  high  >=14.3.0-canary.0
braces                    high  *
eslint-config-next        high  >=14.3.0-canary.0
fast-glob                 high  *
micromatch                high  >=0.2.0

$ npm audit --package-lock-only --omit=dev → 0 vulnérabilité
```

**Une seule cause** : `braces@3.0.3`, avis `GHSA-vfj7-8cjw-p6xm` /
`CVE-2026-93687`, `Patched versions: None`. Les quatre autres entrées sont les
paquets qui en dépendent (`eslint-config-next → @next/eslint-plugin-next →
fast-glob → micromatch → braces`), tous en **développement**.

**Aucune correction compatible n'existe.** npm propose
`eslint-config-next@14.2.35`, soit une rétrogradation de deux majeures ; elle
n'a pas été appliquée et ne doit pas l'être. **Statut : `ATTÉNUÉ — RISQUE
RÉSIDUEL`**, production à zéro.

⚠️ **Défaut relevé dans le cumul** : `audit:sec` y vaut
`npm audit --audit-level=high`, **sans `--omit=dev`**. Il inclut donc les
dépendances de développement et sort en **code 1** — vérifié :

```
$ npm run audit:sec   → EXIT=1
```

Un script nommé « sec » qui échoue sur du développement ne mesure pas la
sécurité de production. La version Agent C (`--omit=dev`) est la bonne
sémantique ; `audit:all` peut garder la portée globale.

### 6.2 Les cinq `xfail` backend

Mesuré sur l'arbre du cumul (`pytest -q`) : **111 passed, 5 xfailed**.

| Fichier | Nombre | Motif déclaré |
|---|---|---|
| `test_geospatial.py` | 3 | Routes `/api/v1/geospatial/*` **non livrées** (404) |
| `test_cross_tenant.py` | 2 | Cloisonnement **non livré** |

Tous en `strict=True` avec un motif explicite : si l'un passe, la suite
**échoue** (xpass), ce qui force à retirer le marqueur. Ce ne sont pas des
tests masqués : ce sont des fonctionnalités absentes, déclarées absentes.
**Statut : `BLOQUÉ`** pour les fonctionnalités visées, correctement signalé.

### 6.3 Construction de l'image Docker

**`NON VÉRIFIÉ`.** Aucun binaire `docker` dans cet environnement, et **aucune
étape de la CI ne construit l'image** (`grep docker .github/workflows/*.yml` :
aucun résultat). Les deux Dockerfiles existent et ont changé dans le cumul :

- `Dockerfile` : suppression de `ENV DATABASE_URL=…` (le build tourne donc
  sans URL, ce qui n'est possible que grâce au contournement `URL_FACTICE`) ;
- `backend/Dockerfile` : `uvicorn` lié à `127.0.0.1` au lieu de `0.0.0.0`, ce
  qui rend le service **injoignable depuis l'extérieur du conteneur** — le
  commentaire l'assume (« ne pas exposer ce conteneur »), mais un
  `HEALTHCHECK` interne reste cohérent.

Aucun de ces deux changements n'a été construit ni exécuté ici. **Statut :
`NON VÉRIFIÉ`.**

### 6.4 Recette externe GFW, SI EUDR, terrain

| Cas | Statut dans le cumul | Preuve |
|---|---|---|
| GFW | **`BLOQUÉ`** | `SATELLITE_VALIDATION_REPORT.md` : « B1 : BLOCKED_EXTERNAL. Aucune analyse GFW réelle n'a été exécutée » |
| SI EUDR | **`BLOQUÉ`** | `DDS_STATE_MACHINE_TEST_REPORT.md` : `DECLARED` « suppose un accusé du SI EUDR : intégration absente. **BLOCKED_EXTERNAL** » |
| Terrain | **`BLOQUÉ`** | `SATELLITE_VALIDATION_REPORT.md` : « Aucune validation méthodologique (vérité terrain…) n'a été faite » |

Le cumul contient un runner de cas de référence
(`scripts/satellite/validate-reference.ts`) dont le rapport donne
« exécutés 2/5 · échecs 0 · non exécutés 3, code de sortie 2 ». C'est
**honnête** (3 non exécutés, pas 5 réussis) mais ce n'est pas une validation
externe.

⚠️ Le cumul **n'a pas** le document de recette externe à 14 cas de la branche
Agent C. Rien n'y structure ce qu'il faudrait obtenir avant un GO.

### 6.5 Question juridique — date de récolte

**`BLOQUÉ`, non tranchée dans le cumul.**

Le code y traite la récolte antérieure au 31/12/2020 comme « hors champ
temporel EUDR » (`satellite-checker.ts:241`, `satellite_checker.py:161`) —
c'est-à-dire qu'il **l'exclut** du contrôle. La branche Agent C retenait
l'inverse pour le moteur live (une perte post-butoir suffit à refuser).

Deux comportements opposés coexistent donc entre les deux branches, et aucun
document du cumul ne tranche. Aucune source disponible ici (texte consolidé,
acte d'exécution, avis juridique) ne permet de décider. **Ne pas fusionner
sans arbitrage explicite : le choix a un effet direct sur le verdict.**

### 6.6 Reprise des dossiers historiques à identité fictive

**`BLOQUÉ` — et le problème s'aggrave dans le cumul.**

| Élément | Branche Agent C | Cumul `a5450492` |
|---|---|---|
| Fabrication `XX0000000000000` | supprimée | **toujours active** |
| Colonnes `NOT NULL` | levées (migration) | **conservées** |
| Vue de reprise `v_parcel_audits_identite` | présente | **absente** |
| Documentation de reprise | oui | **aucune occurrence** |
| Refus d'export sans identité | 422 | **absent** |

Le cumul **continue de produire** des dossiers à identité fictive et ne
dispose d'aucun moyen de les distinguer ni de les lister. La décision produit
reste à prendre ; elle est aujourd'hui impossible à instruire faute
d'inventaire.

---

## 7. Intégration : ce qui a été fait, et pourquoi rien n'a été poussé

### 7.1 Fusion réelle tentée, puis annulée

Une fusion de `a5450492` dans la branche Agent C a été **réellement tentée**
pour mesurer la surface de conflit, puis **annulée** (`git merge --abort`).
Aucun commit n'a été créé ; la branche est revenue exactement à `3c65e47`.

**Conflits mesurés : 14 fichiers.**

```
.github/workflows/ci.yml
README.md
backend/app/models/schemas.py
backend/app/services/gis_validator.py
backend/app/services/satellite_checker.py
backend/app/services/traces_exporter.py
drizzle/meta/0007_snapshot.json
drizzle/meta/_journal.json
package.json
scripts/seed-auth.ts
src/app/api/v1/export/traces/route.ts
src/lib/eudr/gis-validator.ts
src/lib/eudr/satellite-checker.ts
src/lib/eudr/traces-exporter.ts
```

Ces conflits ne sont pas mécaniques : ce sont **deux moteurs EUDR qui ont
corrigé les mêmes défauts différemment**. Exemples relevés dans les conflits :

| Sujet | Version Agent C | Version cumul |
|---|---|---|
| Opérateur absent à l'export | refus **422** | export avec EORI `XX0000000000000` |
| Déforestation établie à l'export | non traité | refus **409** |
| Producteur non déclaré | `name: ""`, `country: ""` | `name: operator_name`, `country: "XX"` |
| Risque pays | résolu par frontières | `UNKNOWN` systématique |
| `test:eudr` | `node --import tsx` | `tsx` |
| Migration 0007 | identité opérateur | `parcel_audit_liens` |

**Pourquoi je n'ai pas poursuivi.** Résoudre ces 14 fichiers exige de trancher
les points 6.5 et 3.2, et de choisir entre deux comportements d'export
incompatibles (409 vs 422). Ce sont des **décisions produit et juridiques**,
pas des résolutions de conflit. Un candidat produit à la hâte, non testé,
aurait donné l'apparence d'une intégration sans en avoir la garantie — et
aurait laissé une branche cassée.

### 7.2 Ce qui est prêt pour l'intégration

Le lot A (§ 4) est **prêt à être appliqué** et ne dépend d'aucun arbitrage :
migration à renuméroter `0009`, schéma nullable, `sql_models`, reconstruction
SQLite atomique, suppression des deux `ANONYMOUS_OPERATOR`, refus 422
**conservant** le 409 existant, vue de reprise `security_invoker`. Le lot B
(proxy) est prêt aussi, et vérifiable par un banc qui existe déjà.

Le lot C (frontières) **n'est pas prêt** : il dépend de l'arbitrage et casse
les tests du cumul par construction.

### 7.3 Branche isolée

⚠️ **Aucune branche isolée n'a été créée.** Cette session est liée à
`arena/837c5c36-geoforest` et ne peut créer ni pousser sur une autre branche.
Le candidat devra donc être produit sur une branche dédiée ouverte hors de
cette session, à partir de `a5450492`, en y appliquant les lots A et B.

**Aucun commit n'est qualifié par la CI au-delà de `a5450492`.** Le seul état
vert prouvé reste celui du cumul.

---

## 8. Risques encore ouverts

| # | Risque | Statut |
|---|---|---|
| 1 | Identité fictive exportée comme complète | **BLOQUÉ** — condition de clôture violée dans le cumul |
| 2 | Arbitrage pays : neutralisation vs frontières | **BLOQUÉ** — décision produit |
| 3 | Date de récolte | **BLOQUÉ** — question juridique |
| 4 | `braces <= 3.0.3` (dev) | `ATTÉNUÉ — RISQUE RÉSIDUEL` |
| 5 | `audit:sec` du cumul inclut le développement | **CORRIGEABLE** (une ligne) |
| 6 | Image Docker non construite | `NON VÉRIFIÉ` |
| 7 | GFW / SI EUDR / terrain | `BLOQUÉ` |
| 8 | 5 `xfail` (fonctionnalités absentes) | `BLOQUÉ`, signalé correctement |
| 9 | Dossiers historiques à identité fictive | **BLOQUÉ** — aucun inventaire possible |
| 10 | PostgreSQL serveur / RLS | `NON VÉRIFIÉ` côté Agent C ; le cumul l'a exercé **sur une branche Neon éphémère** — c'est une preuve réelle, dont je n'ai que le statut d'étape |

---

## 9. Verdict

### `CORRECTIONS SUPPLÉMENTAIRES NÉCESSAIRES`

Le cumul **n'est pas prêt pour une revue de fusion** en l'état. Motifs, par
ordre de gravité :

1. **Une condition de clôture est violée.** Le cumul fabrique toujours
   `XX0000000000000` et l'exporte sans contrôle : un dossier sans identité
   réelle peut être émis comme complet. Aucun commit Agent C ne le corrige, et
   aucun commit du cumul ne le corrige non plus.
2. **L'essentiel de l'Agent C est absent** : 18 changements sur 21, dont
   l'identité opérateur, les frontières, les tests de limites et la recette
   externe. Les deux seuls repris le sont indépendamment, par d'autres commits.
3. **La correction du build contourne la contrainte** posée en phase 2 (URL
   factice construite à l'import).
4. **Deux arbitrages ne sont pas tranchés** : pays résolu ou neutralisé ;
   récolte antérieure au butoir — inclus ou exclu du contrôle. Ils changent le
   verdict rendu à l'utilisateur.

**Ce qui est solide et ne doit pas être perdu.** Le cumul apporte beaucoup que
la branche Agent C n'a pas : 94 commits, contrôles DB et HTTP sur branche Neon
éphémère avec nettoyage, cloisonnement multi-tenant testé, moteur de preuves,
parcours fournisseur, neutralisation des risques pays, 111 tests backend. Ces
apports ne sont pas en cause : c'est l'absence des correctifs Agent C **dans**
ce cumul qui bloque.

**Chemin le plus court vers une revue de fusion :**

1. trancher les deux arbitrages (§ 4 lot C, § 6.5) ;
2. appliquer le lot A sur une branche issue de `a5450492`, migration en `0009` ;
3. appliquer le lot B ;
4. si l'arbitrage va vers les frontières, intégrer le lot C **avec** la mise à
   jour de `test_satellite_checker.py` ;
5. aligner `audit:sec` sur `--omit=dev`, ajouter `audit:all` ;
6. relancer les deux jobs sur le **nouveau** SHA — la CI verte de `a5450492`
   ne qualifie rien d'autre que `a5450492`.

Aucune fusion n'a été faite. `main` est intacte à `1c95f4c`. Le cumul
`a5450492` n'a pas été modifié. La branche Agent C reste à `3c65e47`, propre et
verte.

---

*Rapport « Geoforest — phase 11 : audit final de couverture et préparation à la
revue de fusion » établi par **Agent Arena.ai** (Arena.ai — Agent Mode). Aucune
PR fusionnée, `main` inchangée, aucun secret manipulé.*
