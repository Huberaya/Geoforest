# Sécurisation du démarrage et levée des bloqueurs P0 — 20 octobre 2026

**Dépôt** : `Huberaya/Geoforest`
**Branche de session** : `arena/569eff1a-geoforest` → `main`
**Pull request** : [#8](https://github.com/Huberaya/Geoforest/pull/8), **ouverte et non fusionnée**
**`main`** : `1c95f4c585ed8303f887089ae7450c9235523fd0` — **inchangé**
**SHA initial de la phase** : `7ad10710f5547bf0e57450ec043ad225a4c82ec2`
**SHA de code contrôlé** : `5e896175c1a9531c7972f644ebc281da66f8da44` (14e commit de la branche)
**CI de ce SHA** : push [`39335564110`](https://github.com/Huberaya/Geoforest/actions/runs/39335564110) et PR [`39335571667`](https://github.com/Huberaya/Geoforest/actions/runs/39335571667) — **vertes, 3 jobs**

**CI des commits suivants** (documentation seule, aucun code touché) : `37af6a3` — push
[`39335889900`](https://github.com/Huberaya/Geoforest/actions/runs/39335889900) / PR
[`39335896976`](https://github.com/Huberaya/Geoforest/actions/runs/39335896976) ; `031a8af` — push
[`39336166731`](https://github.com/Huberaya/Geoforest/actions/runs/39336166731) / PR
[`39336172028`](https://github.com/Huberaya/Geoforest/actions/runs/39336172028) ; `565d156` — push
[`39336400437`](https://github.com/Huberaya/Geoforest/actions/runs/39336400437) / PR
[`39336406373`](https://github.com/Huberaya/Geoforest/actions/runs/39336406373) — **vertes, 3 jobs chacune**

> **Statut de la PR #8** : `OPEN`, `MERGEABLE`, `mergedAt: null`. Le
> `mergeStateStatus` vaut `UNSTABLE` en raison du seul contrôle
> **Vercel** de prévisualisation resté `pending` ; les trois jobs de la CI
> sont `pass`. Ce n'est pas un échec de test et cela ne doit pas être
> « corrigé » en modifiant les workflows.

> **Isolation de branche.** La session Arena est liée à la branche
> `arena/569eff1a-geoforest` ; il n'était donc pas possible d'en créer une
> seconde. Aucune branche source n'a été touchée : `main` est resté à
> `1c95f4c`, la branche de la PR #7 n'a pas été modifiée, aucune fusion ni
> aucun déploiement en production n'a été déclenché. Les commits de cette phase s'ajoutent à la
> branche de session, qui est la tête de la PR #8.

**Ce qui n'a pas été fait, par construction** : aucune fusion, aucun
déploiement en production, aucune migration contre une base réelle, aucun accès à un secret
ou à une donnée de production, aucun `force push`, aucun `reset --hard`, aucun
`clean -fd`. Toutes les bases utilisées sont des clusters PostgreSQL 16.2
temporaires, avec des données synthétiques.

---

## 1. État Git vérifié avant travaux (chantier A)

| Élément | Valeur contrôlée | Commande |
|---|---|---|
| `main` | `1c95f4c585ed8303f887089ae7450c9235523fd0` | `git rev-parse main` |
| Tête de la PR #8 | `7ad1071…` (au départ) | `gh pr view 8 --json headRefOid` |
| État PR #8 | `OPEN`, `MERGEABLE`, `mergeStateStatus=CLEAN`, `mergedAt=null` | `gh pr view 8` |
| PR #7 | `OPEN`, tête `ca15ccb…`, non fusionnée | `gh pr view 7` |
| CI de `7ad1071` | push `39329877159`, PR `39329880737` — vertes | `gh run list` |
| Branche locale | `arena/569eff1a-geoforest`, arbre initialement propre | `git status --porcelain` |
| Migrations Drizzle | `0000_init` … `0006_idempotence` (+ down, sauf `0005`) | `ls drizzle/*.sql` |
| Post-migrations | `010`, `020`, `021`, `022`, `023`, `024` | `ls scripts/sql/post-migrate/` |

Au moment de la vérification, un seul fichier était non suivi :
`src/db/etat-schema.ts`, livrable inachevé de la phase précédente, conservé et
complété — il n'a pas été supprimé ni écrasé. Aucun fichier suivi n'a été
modifié avant l'ouverture de ce chantier.

La PR #7 a évolué indépendamment pendant la session précédente ; elle n'a
jamais existé dans ce dépôt local et aucune commande de cette phase ne l'a
ciblée. `main` n'a pas bougé : le graphe reste linéaire, sans fusion.

---

## 2. R-05 — aucun service sur un schéma de sécurité incomplet

### 2.1 Le cycle réel, et la faille

L'installation suit ce chemin :

1. `npm run db:migrate` applique les migrations Drizzle **puis** les scripts
   `scripts/sql/post-migrate/*.sql` **séquentiellement** ;
2. le serveur Next.js démarre (`register()` dans `src/instrumentation.ts`) ;
3. les requêtes arrivent.

Les post-migrations ne sont **pas** englobées dans une transaction unique.
Une interruption entre `010` et `020` laisse donc une base qui *paraît*
migrée : les tables existent, les 13 tables protégées ont la RLS activée et forcée,
mais il n'y a que **13 politiques au lieu de 34**, **aucun déclencheur de
journal**, et les deux fonctions `auth_user_by_email` / `auth_user_by_id`
restent **exécutables par `geoforest_app`** parce que `023` n'a pas encore
révoqué ce droit. `verifierCloisonnement()` ne contrôlait que
`relrowsecurity` ; `instrumentation.ts` ne contrôlait que les rôles ; aucune
route ne lisait le schéma. Le service pouvait donc accepter du trafic avec un
cloisonnement amputé.

État mesuré sur PostgreSQL 16.2, après `010` et avant `020` :

```
MIGRATE_EXIT=1
tables_rls=13   politiques=13   declencheurs=0
fonctions_exec_app=2   index_cadence=0   contrainte_identite=0
```

### 2.2 Correctif

**`src/db/etat-schema.ts`** (nouveau, lecture seule — aucune réparation) :

- inventaire explicite des **13 tables protégées** ;
- jeu **exact** de politiques : `tenant_isolation` sur 6 tables, et les quatre
  politiques `tenant_isolation_lecture/ecriture/maj/retrait` sur les 7 tables
  traitées par `022` (34 au total). Une politique **supplémentaire** est
  refusée : elle peut élargir l'accès ;
- déclencheurs attendus sur `gf_audit_logs` : `trg_gf_audit_logs_chaine` et
  `trg_gf_audit_logs_append_only` ;
- index unique de cadence `uq_gf_login_attempts_cle` ;
- contrainte `parcel_audits_identite_operateur_valide` (livrée par `025`) ;
- fonctions d'authentification présentes et **non exécutables** par le rôle
  applicatif ;
- privilèges de colonnes sur `gf_users` : `email` lisible, `password_hash`,
  `mfa_secret`, `mfa_recovery_codes` interdits ;
- `interpreterSchemaSecurite()` est pure (testable sans base) ;
  `verifierSchemaSecuriteAvec(pool)` interroge le catalogue ;
  `exigerSchemaPret()` met en cache 10 s (`GF_SCHEMA_TTL_MS`, `0` = relecture
  systématique) et lève `SchemaSecuriteIncompletError` sur tout écart ;
- **aucun commutateur de contournement** : `GF_CONTROLE_ROLE=off` ne désactive
  pas ce contrôle.

**Câblage** :

| Point | Comportement |
|---|---|
| `src/instrumentation.ts` | contrôle **avant** `GF_CONTROLE_ROLE=off`, avec `force: true` ; en production, l'erreur interrompt la préparation du serveur |
| `src/lib/auth/guard.ts` | `exigerSchemaPret()` avant l'authentification de chaque route protégée → **503** `schema_incomplete` |
| `POST /api/v1/auth/login` | contrôle avant lecture du corps → **503** (le login ne passe pas par `guard()`) |
| `POST /api/v1/auth/mfa`, `POST /api/v1/auth/refresh` | même contrôle → **503** |
| `GET /api/ready` | nouveau composant `schema`, bloquant ; `ready:false` et **503** |
| `GET /api/health` | `schema` ajouté aux composants critiques ; **503** si incomplet |
| `src/lib/api/schema-error.ts` | réponse 503, code stable, `Retry-After: 15`, **aucun détail d'infrastructure** |

### 2.3 Preuve de non-service et de reprise

**Interruption réelle au milieu des post-migrations**, puis démarrage en mode
production (`next start`, code `5e89617`) :

```
MIGRATE_EXIT=1                  # 015_echec.sql injecté entre 010 et 020
politiques=13
ready_sur_schema_interrompu=500
login_sur_schema_interrompu=500
suppliers_sur_schema_interrompu=500
```

Le journal de démarrage contient :

```
🔴 Schéma de sécurité incomplet : démarrage refusé.
  🔴 [politiques_rls_incompletes] 28 politique(s) RLS manquante(s) sur 7 table(s)…
  🔴 [fonctions_auth_executables] Le rôle applicatif « geoforest_app » peut encore exécuter…
  🔴 [declencheurs_journal_incomplets] … 020/021 ne sont pas appliqués.
```

Next.js répond **500** sur toutes les routes, y compris `/api/ready` : aucune
donnée n'est servie. C'est un arrêt fail-closed, volontairement sans corps
technique. Après retrait du fichier d'échec et `npm run db:migrate` (exit 0),
le redémarrage donne `ready_apres_reprise=200`.

**Dégradation d'une instance déjà démarrée** (schéma complet, puis retrait
d'une politique, `GF_SCHEMA_TTL_MS=0`) :

```
ready_initial=200     login_faux=401
ready_degrade=503     login_degrade=503 (schema_incomplete)
ready_apres_reparation=200
```

Le corps de `/api/ready` nomme le composant `schema` indisponible et le code
`politiques_rls_incompletes` ; il ne contient ni hôte, ni port, ni chaîne de
connexion. La suite HTTP vérifie les mêmes transitions, y compris le refus de
`/api/v1/auth/login` (route hors `guard()`), avec restauration sans
redémarrage.

> **Nuance opérationnelle.** Sur une instance démarrée avec un schéma
> incomplet, Next.js renvoie **500** (la préparation du serveur échoue), pas
> 503. Le 503 est produit par le garde-fou par requête lorsque l'instance a
> démarré sainement puis que le schéma se dégrade. Les deux comportements sont
> fail-closed ; le premier est le plus fort, le second est le plus diagnosticable.

---

## 3. P0 — identité opérateur : l'absence reste l'absence

### 3.1 Constat

`POST /api/v1/audit/parcel` fabriquait, en l'absence d'opérateur :

```ts
{ name: "Opérateur non renseigné", eori: "XX0000000000000", country: "XX" }
```

Cette valeur passait `EORI_PATTERN`, était écrite dans des colonnes `NOT NULL`
(`operator_country DEFAULT 'FR'`), puis reprise par l'export TRACES. Une
déclaration pouvait donc désigner une entité inexistante, avec un EORI
inexistant et un pays inexistant. Autres chemins indirects corrigés :

- `country_of_activity` valait `"FR"` par défaut ;
- le pays du producteur retombait sur le pays de la parcelle, puis sur `"XX"` ;
- `POST /api/v1/products` écrivait `"FR"` quand le pays d'origine manquait ;
- le formulaire d'upload pré-remplissait une entreprise et un EORI fictifs ;
- `deforestation_detected_post_cutoff: !row.compliant` transformait l'absence de
  verdict (`null`) en **déforestation détectée** — corrigé en `row.compliant === false`,
  et le statut d'export devient `NO_VERDICT` au lieu de `VERIFIED_NON_COMPLIANT`.

### 3.2 Correctif livré

**`scripts/sql/post-migrate/025_identite_operateur.sql`** (nouveau, idempotent,
aucune migration publiée réécrite) :

- `operator_name`, `operator_eori`, `operator_country` deviennent **nullables** ;
  `operator_country` perd son `DEFAULT 'FR'` ;
- normalisation de la casse et des espaces, puis effacement des sentinelles
  (`XX0000000000000`, noms de remplissage, pays `XX`) — **jamais remplacées** ;
- contrainte `parcel_audits_identite_operateur_valide` : un nom de remplissage,
  un EORI `XX…`/`FR000…` ou un pays `XX` sont rejetés par le moteur ;
- même traitement pour `gf_products.country_of_origin` (défaut `FR` supprimé,
  contrainte `gf_products_country_of_origin_valide`).

**Code** :

| Fichier | Changement |
|---|---|
| `src/lib/eudr/identite-operateur.ts` | classificateur partagé `COMPLETE / ABSENTE / PARTIELLE / PLACEHOLDER`, validation EORI/pays/nom, **aucune valeur inventée** |
| `src/app/api/v1/audit/parcel/route.ts` | opérateur **facultatif** ; absent → colonnes nulles ; sentinelle → **422 `OPERATOR_IDENTITY_MISSING`** |
| `src/app/api/v1/export/traces/route.ts` | identité absente/incomplète → **422 `OPERATOR_IDENTITY_MISSING`**, contrôlée **avant** la valeur probante ; `country_of_activity` désormais **requis** (422 `COUNTRY_OF_ACTIVITY_MISSING`) ; plus de repli `"FR"` |
| `src/lib/eudr/traces-exporter.ts` | producteur sans pays → pas de nœud inventé ; pays d'activité jamais par défaut ; `NO_VERDICT` si aucun verdict |
| `src/db/schema.ts` | colonnes d'identité nullables, sans défaut |
| `src/components/GeoUploader.tsx` | formulaire vide (les exemples ne sont que des placeholders) |
| `src/components/AuditHistory.tsx` | identité absente affichée « Non renseigné » |
| `src/components/AuditResultCard.tsx` | pays d'activité saisi ; pays estimé signalé comme non fiable |

### 3.3 Preuves

**Base PostgreSQL réelle** (rôle propriétaire, transaction annulée) :

```
sentinelle XX0000000000000 → ERROR 23514, contrainte parcel_audits_identite_operateur_valide
identité absente (NULL, NULL, NULL) → INSERT 0 1
pays d'opérateur omis → operator_country IS NULL (aucun défaut)
```

**HTTP réel** (`tests/http/identite-operateur.test.ts`, 4/4) :

| Cas | Résultat observé |
|---|---|
| audit sans opérateur | `201`, colonnes `NULL` en base |
| opérateur sentinelle | `422 OPERATOR_IDENTITY_MISSING`, aucune ligne créée |
| export d'un audit sans identité | `422 OPERATOR_IDENTITY_MISSING`, avant tout autre motif |
| identité complète | valeurs persistées à l'identique ; export `409` pour la seule raison restante (analyse simulée non probante) |

**Classification** : 46 tests unitaires, dont 10 sur les identités
(`COMPLETE`, `ABSENTE`, `PARTIELLE`, `PLACEHOLDER`, EORI de remplissage,
pays `XX`, objet partiel refusé). Le sentinelle n'est plus **émis** par aucun
chemin d'exécution : les 4 occurrences restantes dans `src/` sont des
constantes de **détection** ou des commentaires.

> **Limite historique assumée.** Les lignes antérieures à `025` dont
> `operator_country = 'FR'` sans EORI ne permettent pas de distinguer un pays
> réellement déclaré de l'ancien défaut. `025` ne les efface pas (ce serait
> détruire une donnée peut-être réelle) : elles restent **non confirmées** et
> doivent être revues par l'exploitant. Les sentinelles, elles, sont effacées.

---

## 4. Validation PostgreSQL serveur et parcours applicatif (chantier D)

- **Base vierge** : `npm run db:migrate` exit 0, 13/13 tables protégées,
  34 politiques, 2 déclencheurs, contrainte `025` présente.
- **Reprise après interruption** : exit 0, même état final que la base neuve ;
  aucun doublon, aucun historique réécrit.
- **Recette serveur** (`RECETTE_PORT=55433`) : exit 0, **21/21** tests sous le
  rôle **`geoforest_app`** (et non propriétaire), RLS 13/13, 34 politiques,
  chaîne d'audit intacte, falsification détectée (code 1), cadence `024` non
  dupliquée.
- **Rôle applicatif réel** : lecture du catalogue par `geoforest_app` →
  `ok:true`, 13 tables, 34 politiques, **0 fonction d'auth exécutable**,
  2 déclencheurs, index et contrainte présents.
- **Isolation multi-tenant** : `tests/sql/isolation.test.ts` (52 tests SQL au
  total) et recette : lectures croisées à zéro ligne, écritures hors tenant
  refusées par PostgreSQL, pas ignorées.

**Limites** :

- les post-migrations `010`–`025` n'ont **pas** de script descendant ; un
  retour arrière ne peut pas les défaire proprement. `025` est idempotent et
  peut être rejoué, mais son effet (colonnes nullables, contrainte) n'est pas
  réversible sans script dédié ;
- `drizzle/0005_tracabilite.sql` n'a pas de `.down.sql` ;
- aucune validation sur base hébergée (Neon ou autre) : **BLOQUÉ**, faute
  d'environnement de test identifié et d'autorisation explicite.

---

## 5. Géospatial (chantier E)

Aucune frontière n'a été réintroduite, aucun jeu de données n'a été ajouté au
dépôt, le moteur de l'Agent C n'a pas été fusionné, et la règle juridique de
date de récolte n'a pas été touchée.

Le code continue de résoudre le pays par **boîtes englobantes**. Mesures du
20/10/2026 :

| Point | Pays retourné | Réalité |
|---|---|---|
| Lomé (1.2228, 6.1319) | `XX` « Non déterminé » | Togo |
| Arica (−70.3126, −18.4783) | `BR` Brésil | Chili |
| Ciudad del Este (−54.6111, −25.5097) | `BR` Brésil | Paraguay |
| Abidjan (−4.0083, 5.3599) | `CI` | Côte d'Ivoire |
| Accra (−0.187, 5.6037) | `GH` | Ghana |
| (0, 0) | `XX` | océan |

Conséquence : l'attribution pays n'est **pas fiable** et n'est jamais présentée
comme telle. `SatelliteCheckResult.country_reliable` vaut `false`, l'interface
affiche « Pays estimé (non fiable EUDR) » et un avertissement, et l'export
porte `country_attribution: "approximate_bbox"` /
`country_attribution_reliable: false` avec un avertissement explicite.

Une **proposition séparée**, non approuvée et non appliquée, est livrée :
[`docs/frontieres-eudr-proposition-2026-10-20.md`](./frontieres-eudr-proposition-2026-10-20.md).
Tant qu'elle n'est pas approuvée, aucune attribution EUDR ne doit être dérivée
de ces boîtes.

---

## 6. Matrice de validation (chantier F)

Statuts : **RÉUSSI** / **ÉCHEC** / **BLOQUÉ** / **NON EXÉCUTÉ**.

| # | Contrôle | Statut | Preuve |
|---:|---|---|---|
| 1 | `main` inchangé, PR #8 ouverte et non fusionnée | **RÉUSSI** | `gh pr view 8` : `OPEN`, `MERGEABLE`, `mergedAt=null` ; `main=1c95f4c` |
| 2 | Aucune branche source modifiée | **RÉUSSI** | PR #7 `ca15ccb` inchangée ; aucune commande sur sa branche |
| 3 | Arbre de travail préservé | **RÉUSSI** | fichier non suivi `etat-schema.ts` conservé et complété |
| 4 | Cycle de démarrage cartographié | **RÉUSSI** | §2.1 ; lecture de `migrate.ts`, `instrumentation.ts`, `guard.ts` |
| 5 | État réel mesuré après interruption | **RÉUSSI** | 13 politiques / 0 déclencheur / 2 fonctions exécutables |
| 6 | Garde-fou de démarrage fail-closed | **RÉUSSI** | `next start` sur schéma interrompu : 500 sur toutes les routes |
| 7 | Garde-fou par requête (503) | **RÉUSSI** | dégradation après démarrage : `/api/ready` 503, login 503 |
| 8 | Couverture des routes hors `guard()` | **RÉUSSI** | login/MFA/refresh contrôlés ; test HTTP login 503 |
| 9 | Sondes `ready`/`health` | **RÉUSSI** | composant `schema` bloquant, 503 observé |
| 10 | Reprise après réparation | **RÉUSSI** | `db:migrate` exit 0, redémarrage `ready=200` |
| 11 | Aucun succès silencieux | **RÉUSSI** | chaque écart est nommé par un code (`politiques_rls_incompletes`, etc.) |
| 12 | Sentinelle `XX0000000000000` éliminée des chemins | **RÉUSSI** | 0 émission ; occurrences restantes = détection/commentaires |
| 13 | Identité absente acceptée en base | **RÉUSSI** | `INSERT` avec `NULL` accepté sur PostgreSQL réel |
| 14 | Sentinelle refusée par le moteur | **RÉUSSI** | `ERROR 23514`, contrainte `025` |
| 15 | Audit sans opérateur | **RÉUSSI** | HTTP `201`, colonnes nulles |
| 16 | Export sans identité | **RÉUSSI** | HTTP `422 OPERATOR_IDENTITY_MISSING` |
| 17 | Export avec identité complète | **RÉUSSI** | valeurs persistées ; refus `409` pour analyse simulée |
| 18 | Aucun pays par défaut dans l'export | **RÉUSSI** | `country_of_activity` requis ; `grep` ciblé sur ce champ = 0 |
| 19 | Producteur non inventé | **RÉUSSI** | plus de repli sur le pays de la parcelle |
| 20 | Verdict `null` non transformé en déforestation | **RÉUSSI** | `deforestation_detected_post_cutoff = (compliant === false)` |
| 21 | Historique classé sans invention | **RÉUSSI (limite FR documentée)** | `025` efface les sentinelles ; `FR` historique non confirmé |
| 22 | Migration publiée non réécrite | **RÉUSSI** | `025` est un nouveau fichier ; `0000`–`024` intacts |
| 23 | Migration base vierge | **RÉUSSI** | exit 0, 34 politiques, 2 déclencheurs |
| 24 | Reprise idempotente | **RÉUSSI** | second `db:migrate` exit 0, état identique |
| 25 | Recette sous `geoforest_app` | **RÉUSSI** | 21/21, exit 0 |
| 26 | RLS et isolation | **RÉUSSI** | 52 tests SQL + recette (13/13, lectures croisées vides) |
| 27 | Journal d'audit et chaîne | **RÉUSSI** | recette : chaîne intacte, falsification détectée |
| 28 | Scripts descendants des post-migrations | **NON EXÉCUTÉ** | absents ; limite documentée §4 |
| 29 | Validation base hébergée | **BLOQUÉ** | aucun environnement de test autorisé |
| 30 | Frontières non réintroduites | **RÉUSSI** | `data/frontieres/` absent, aucun fichier `data/` suivi |
| 31 | Attribution pays non présentée comme fiable | **RÉUSSI** | `country_reliable=false`, avertissements UI/export |
| 32 | Proposition géospatiale livrée | **RÉUSSI** | `docs/frontieres-eudr-proposition-2026-10-20.md` |
| 33 | Intégration des frontières | **NON EXÉCUTÉ** | en attente d'approbation explicite |
| 34 | Règle de date de récolte inchangée | **RÉUSSI** | aucun changement dans le moteur EUDR |
| 35 | Tests unitaires | **RÉUSSI** | 46/46 |
| 36 | Tests SQL | **RÉUSSI** | 52/52 |
| 37 | Tests HTTP réels | **RÉUSSI** | 34/34 |
| 38 | `test:eudr` | **RÉUSSI** | 24/24 |
| 39 | `typecheck` / `lint` | **RÉUSSI** | 0 erreur ; 5 avertissements préexistants |
| 40 | `build` production | **RÉUSSI** | exit 0 |
| 41 | Audit dépendances de production | **RÉUSSI** | `npm audit --omit=dev` : 0 vulnérabilité |
| 42 | Audit dépendances de développement | **ÉCHEC** | 5 `high` sur `braces` (`eslint-config-next`), aucun correctif amont |
| 43 | CI sur le SHA de code | **RÉUSSI** | push `39335564110`, PR `39335571667`, 3 jobs verts |

Total : **39 RÉUSSI**, **1 ÉCHEC**, **1 BLOQUÉ**, **2 NON EXÉCUTÉ** = **43 contrôles**.

---

## 7. Risques résiduels et actions

| Réf. | Risque | État | Action |
|---|---|---|---|
| R-05a | Le garde-fou par requête met 10 s en cache ; une dégradation survenant après le démarrage peut être servie jusqu'à 10 s | **ATTÉNUÉ** | `GF_SCHEMA_TTL_MS=0` en environnement critique ; le démarrage, lui, est toujours forcé |
| R-05b | Un échec de préparation renvoie 500, sans corps JSON | **ATTÉNUÉ** | comportement fail-closed ; la sonde de disponibilité externe doit traiter 500 comme non prêt |
| R-05c | `logout` écrit dans le journal sans contrôle de schéma | **ATTÉNUÉ** | ne sert aucune donnée ; à couvrir dans un lot ultérieur |
| R-id | Les pays `FR` historiques sont indistinguables de l'ancien défaut | **NON VÉRIFIÉ** | revue de données par l'exploitant, sans écrasement automatique |
| R-géo | Attribution pays par boîtes englobantes fausse (Arica → BR) | **ATTÉNUÉ** | jamais présentée comme fiable ; proposition de frontières non approuvée |
| R-dep | `braces` 5 `high` en dépendance de développement | **ÉCHEC** | aucun correctif amont ; ne pas lancer `npm audit fix --force` (rétrograde `eslint-config-next`) |
| R-host | Aucune validation sur base hébergée | **BLOQUÉ** | fournir un environnement de test dédié et une autorisation écrite |

**Ordre de déploiement impératif** : appliquer `npm run db:migrate` (qui inclut
`025`) **avant** de démarrer le nouveau code. Dans l'ordre inverse, le
garde-fou refuse le service (500) — c'est le comportement attendu, mais il ne
faut pas le confondre avec une panne.

---

## 8. Conclusion

- **R-05 est corrigé et démontré par tests** : interruption réelle au milieu
  des post-migrations → aucune route ne sert, y compris le login ; réparation
  → redémarrage normal ; dégradation après démarrage → 503 contrôlé.
- **L'identité fictive est éliminée des chemins d'exécution** : l'absence est
  représentable, la sentinelle est refusée par le moteur, l'export incomplet
  répond `422 OPERATOR_IDENTITY_MISSING`. La seule réserve est historique
  (`FR` non confirmé), explicitement documentée.
- **La phase peut être considérée comme techniquement close** pour le code et
  les tests locaux. Elle ne l'est pas pour l'exploitation : validation sur base
  hébergée **BLOQUÉE**, proposition géospatiale **non approuvée**, et
  `npm audit --include=dev` toujours rouge sur `braces`.
- Aucune fusion, aucun déploiement en production, aucune migration sur une
  base réelle n'a été effectué. L'intégration Vercel préexistante peut créer
  une **prévisualisation** de la PR ; elle n'est pas une mise en service et
  n'a pas été promue. Toute mise en production reste soumise à une autorisation
  distincte.
