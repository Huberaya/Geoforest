# Dossier de décision — Phase 13.1

**Date** : 20 octobre 2026
**Objet** : préparer trois décisions **indépendantes** — fusion de la PR #8, validation de la proposition E (frontières EUDR), réunion des conditions d'un futur déploiement.
**Nature** : audit **en lecture seule**. Aucune fusion, aucune fermeture de PR, aucun déploiement, aucune migration sur une base réelle ou hébergée, aucune modification de workflow, aucun secret lu ni exporté.
**Ce document est un livrable de travail non suivi et non commité** : la tête **distante** de la branche et de la PR #8 reste `35c5d06` (voir § 0.1 pour l'écart de référence locale).

Légende des preuves :

- 🟢 **vérifié dans cet audit** — commande exécutée, résultat cité ;
- 🟡 **consigné dans un rapport antérieur** — non rejoué ici, conformément à la consigne « ne pas recommencer la phase 13 » ;
- 🔴 **non établi / bloqué** — preuve absente, accès impossible ou non exécuté.

---

## 0. Vérification des références et écart constaté

| Référence | Valeur annoncée | Valeur observée | État |
|---|---|---|---|
| Tête de PR #8 | `35c5d0675ea292d1c851d097e8cd624cedea5267` | identique (`gh pr view 8`, `git ls-remote`) | 🟢 conforme |
| `main` | `1c95f4c585ed8303f887089ae7450c9235523fd0` | identique, local **et** distant | 🟢 conforme |
| PR #8 | ouverte, non fusionnée | `OPEN`, `MERGEABLE`, `CLEAN`, `mergedAt: null` | 🟢 conforme |
| PR #7 | non modifiée | `OPEN`, tête `ca15ccb`, `mergedAt: null` | 🟢 conforme |

### 0.1 Écart de référence — clone local, sans impact sur le contenu

Le bac à sable de cette session a été **re-cloné superficiellement sur `main`** :

- `git rev-parse HEAD` retournait `1c95f4c` alors que la branche de session pointait localement sur le même commit ;
- `git cat-file -t 35c5d06` → **objet absent** ; `git rev-parse --is-shallow-repository` → `true`, profondeur 1 ;
- seul le **distant** portait la tête correcte.

Résolution, en lecture seule : `git fetch --no-tags origin arena/569eff1a-geoforest` → `FETCH_HEAD = 35c5d06`, objet désormais présent.

**Contrôle d'intégrité du contenu** : comparaison par empreinte d'objet Git des 87 fichiers du diff avec la tête distante.

- 45 fichiers suivis : identiques ;
- 42 fichiers présents mais **non suivis** dans ce clone (le diff les voyait comme supprimés) : `git hash-object` = blob de la branche pour **42/42** ;
- total : **87/87 fichiers identiques**, aucun fichier hors branche.

**Conclusion** : l'écart est un artefact de clone (référence et index locaux), pas une divergence de contenu. Il est consigné ici parce qu'il rend le SHA local non opposable sans `fetch` préalable.

**Décision de méthode** : la référence locale obsolète (`arena/569eff1a-geoforest` → `1c95f4c`) n'a **pas** été réalignée — ni `checkout`, ni `reset`, ni `branch -f` — afin de respecter la consigne « aucune modification de branche ». La référence **faisant foi** est la branche distante et la PR #8, toutes deux à `35c5d06`. Une session ultérieure devra `git fetch` puis se placer sur la réf distante avant tout travail.

### 0.2 Limites d'accès de cet audit

1. **Journaux de job CI non téléchargeables** : `gh run view 39336649890 --log` échoue (`EOF` sur `results-receiver.actions.githubusercontent.com`). Seuls les **statuts par étape** sont disponibles — ils suffisent à établir le vert, pas à relire les sorties de tests.
2. **Historique Git incomplet** : clone superficiel (profondeur 1). Toute affirmation du type « ce fichier n'a jamais existé dans l'historique » est **hors de portée** ; seule la tête est inspectable.
3. **Sortie réseau restreinte** : `www.naturalearthdata.com` et `naciscdn.org` répondent `SSL_ERROR_SYSCALL` (port 443). Aucun téléchargement de jeu de frontières n'est possible depuis cet environnement.
4. **Journaux de la phase 13 antérieure non accessibles** : les mesures PostgreSQL 16.2 (recette 21/21, preuve R-05, identité opérateur) proviennent du rapport `docs/securisation-demarrage-2026-10-20.md` et **ne sont pas rejouables ici** sans recréer un cluster (aucun binaire `initdb`/`pg_ctl`, aucun Docker dans cet environnement).

---

## A. PR #8 — la fusion

### A.1 Références et diff cumulatif

| Élément | Valeur | Preuve |
|---|---|---|
| Tête | `35c5d0675ea292d1c851d097e8cd624cedea5267` | `gh pr view 8` 🟢 |
| Base | `main` = `1c95f4c585ed8303f887089ae7450c9235523fd0` | idem 🟢 |
| Commits | **18** | `git rev-list --count 1c95f4c..35c5d06` 🟢 |
| Fichiers | **87** | `git diff --name-only` 🟢 |
| Volume | **+10 180 / −716** | `git diff --shortstat` 🟢 |
| Auteur | `Huberaya` | `gh pr view 8` 🟢 |
| Créée le | `2026-10-19T20:59:57Z` | idem 🟢 |
| État de fusion | `MERGEABLE`, `mergeStateStatus: CLEAN`, `mergedAt: null` | idem 🟢 |

Répartition du diff par zone :

| Zone | Fichiers | Lignes |
|---|---:|---:|
| `src/lib` | 13 | +747 / −78 |
| `src/app` | 14 | +445 / −90 |
| `src/db` | 4 | +716 / −9 |
| `src/components` | 3 | +38 / −5 |
| `src/instrumentation.ts`, `src/proxy.ts` | 2 | +65 / −4 |
| `tests/unit` | 9 | +642 / −0 |
| `tests/sql` | 6 | +1 341 / −0 |
| `tests/http` | 4 | +1 234 / −0 |
| `tests/helpers` | 2 | +358 / −0 |
| `scripts/sql` (post-migrations) | 4 | +329 / −1 |
| `scripts/recette` | 2 | +703 / −0 |
| `scripts` (autres) | 4 | +315 / −4 |
| `backend/` | 8 | +292 / −11 |
| `docs` | 5 | +2 691 / −0 |
| Config (`package*.json`, `ci.yml`, `.env.example`, `docker-compose.yml`, `README`, `next-env.d.ts`) | 7 | +264 / −514 |

Les deux fichiers les plus lourds sont `package-lock.json` (+109/−487, verrouillage) et `tests/sql/isolation.test.ts` (+1 341 sur l'ensemble du dossier SQL).

### A.2 Contrôles du SHA exact

**Exécutions GitHub Actions portant exactement `35c5d06`** :

| Run | Événement | Conclusion |
|---|---|---|
| [`39336642679`](https://github.com/Huberaya/Geoforest/actions/runs/39336642679) | `push` | **success** 🟢 |
| [`39336649890`](https://github.com/Huberaya/Geoforest/actions/runs/39336649890) | `pull_request` | **success** 🟢 |

**Contrôles de la PR #8** (`gh pr checks 8`, tous au SHA `35c5d06`) :

| Contrôle | Résultat | Durée |
|---|---|---:|
| Frontend (typecheck, lint, unit, build) | **pass** | 52 s |
| Base de données et contrats HTTP (PGlite) | **pass** | 1 min 17 s |
| Backend FastAPI | **pass** | 24 s |
| Vercel (prévisualisation) | **pass** | 0 s |
| Vercel Preview Comments | **pass** | 0 s |

**Étapes des trois jobs, toutes `success`** 🟢 :

- *Frontend* : `npm ci` → `typecheck` → `lint` → `test:unit` → `build` (sans base) → `audit:sec` ;
- *Base et HTTP* : `npm ci` → `test:sql` → `test:http` (PGlite, sans réseau) ;
- *Backend* : Python 3.12 → `pip install -r requirements.txt` → `pytest -q`.

> **Correction par rapport au rapport de phase 13** : celui-ci mentionnait `mergeStateStatus = UNSTABLE` en raison du contrôle Vercel `pending`. À l'heure de cet audit, **Vercel est `pass`** et l'état est **`CLEAN`**. Aucun workflow n'a été modifié pour obtenir ce résultat.

### A.3 Limites de couverture

| Point | Constat | Preuve |
|---|---|---|
| `test:eudr` absent de la CI | script présent, **jamais exécuté** par `ci.yml` | `.github/workflows/ci.yml` 🟢 |
| Recette PostgreSQL absente de la CI | `recette:postgres` n'est appelée par aucun job ; la CI utilise **PGlite**, pas PostgreSQL 16.2 | idem 🟢 |
| `audit:dev` absent de la CI | seul `audit:sec` (`--omit=dev`) est exécuté ; les 5 `high` de `braces` sont donc **invisibles en CI** | idem 🟢 |
| Aucun test sur base hébergée | ni Neon ni autre ; la CI n'a aucun secret de base | idem 🟢 |
| Aucun test de charge / performance | pas de job dédié | idem 🟢 |
| Aucun test E2E navigateur | pas de Playwright/Cypress | inventaire des dépendances 🟢 |
| La prévisualisation Vercel ne prouve rien sur les migrations | elle s'exécute sur une base distante dont l'état n'est pas contrôlé ici | contrôle Vercel `pass` ≠ test fonctionnel 🟢 |
| Nombres de tests (46 / 52 / 34, `pytest` 55 passés / 3 ignorés) | **consignés** dans le rapport de phase 13 ; non relisibles dans les journaux CI (indisponibles) | 🟡 |

### A.4 Risques par domaine

#### A.4.1 Migration

1. **Chaîne non transactionnelle entre fichiers** 🟢 — `scripts/migrate.ts` applique les migrations Drizzle, puis les scripts `scripts/sql/post-migrate/*.sql` **séquentiellement**. Chaque fichier est envoyé en une requête simple (donc atomique), mais **rien ne garantit l'atomicité de la chaîne**. Une interruption entre `010` et `020` laisse 13 politiques au lieu de 34, 0 déclencheur et 2 fonctions d'authentification exécutables (mesure du 19/10, rapport §2.1 🟡).
   *Atténuation* : `etat-schema.ts` refuse le démarrage et renvoie 503 (`schema_incomplete`) sur toute route protégée ; aucun commutateur de contournement.
2. **Migrations qui modifient des données** 🟢 — `024` dédoublonne `gf_login_attempts` (suppression de lignes) ; `025` normalise puis **efface** les identités fictives (`UPDATE` sur `parcel_audits` et `gf_products`), retire les `DEFAULT 'FR'` et rend des colonnes nullables. Ces opérations sont **irréversibles sans restauration**.
3. **Aucun script descendant pour les post-migrations** 🟢 — `.down.sql` absent pour `010` à `025`. `npm run db:rollback` ne défait que la **dernière migration Drizzle**, exige son `.down.sql`, et ne connaît pas les post-migrations (non enregistrées dans `drizzle.__drizzle_migrations`).
4. **`drizzle/0005_tracabilite.sql` n'a pas de `.down.sql`** 🟡 (rapport §4) : le retour arrière s'arrête là.
5. **Repli silencieux d'URL** 🟢 — `migrate.ts` utilise `DATABASE_URL_ADMIN ?? DATABASE_URL`. Sans la première, la migration s'exécute avec le rôle applicatif et échoue faute de DDL : l'échec est bruyant, mais le message parle de privilèges, pas de variable manquante.
6. **Contrôle de cloisonnement potentiellement vide** 🟢 — `verifierCloisonnement()` ne compte que les tables dont `tableowner = current_user`. Sur une base hébergée où le rôle de migration ne serait pas propriétaire des tables existantes, `total = 0` et le contrôle **passe sans rien vérifier**. *Atténuation* : le contrôle de démarrage `etat-schema` est indépendant du propriétaire (catalogue `pg_class` / `pg_policies`).

#### A.4.2 RLS

1. **Trois contournements structurels** 🟢 — superutilisateur, `BYPASSRLS`, propriétaire. `010` active **et force** la RLS sur 13 tables, ce qui neutralise le troisième ; les deux premiers sont contrôlés au démarrage par `controle-role.ts`.
2. **Le rôle applicatif doit être distinct du rôle d'administration** 🟢 — `comparerConnexions()` refuse (`CLEAN` uniquement si `DATABASE_URL_ADMIN` est déclaré et différent). Deux défaillances symétriques sont couvertes : même rôle (cloisonnement perdu) et admin absent (plus personne ne peut se connecter).
3. **Deux tables hors RLS, assumées** 🟢 — `gf_sessions`, `gf_login_attempts` (authentification avant contexte d'organisation). Toute autre table non protégée fait échouer la migration.
4. **Politiques attendues au nombre près** 🟢 — 34 = 6 tables × `tenant_isolation` + 7 tables × 4 politiques. Une politique **supplémentaire** est refusée (elle pourrait élargir l'accès).
5. **`GF_CONTROLE_ROLE=off`** 🟢 — contourne les contrôles de rôle, **pas** le contrôle de schéma. `/api/health` continue de signaler l'anomalie. C'est une issue d'incident, pas une configuration.

#### A.4.3 Rôles d'administration

1. **Le rôle d'administration doit contourner la RLS** 🟢 — authentification et journal d'audit s'exécutent hors contexte d'organisation (`src/db/admin.ts`). Un rôle ordinaire ferait répondre « compte inconnu » à toute connexion : panne déguisée en mauvais mot de passe. Contrôlé par `row_security_active('gf_users')` au démarrage.
2. **Le rôle applicatif ne doit détenir aucun droit de destruction** 🟢 — `DELETE`/`TRUNCATE` sont détectés et bloquants ; le contrat de traçabilité interdit la suppression.
3. **`023` ferme une fuite réelle** 🟢 — `auth_user_by_email()` / `auth_user_by_id()` sont `SECURITY DEFINER`, renvoient la ligne entière de `gf_users` (condensat, secret TOTP, codes de secours) et échappent à la RLS. `023` révoque `PUBLIC` **et** `geoforest_app`, puis vérifie dans un bloc `DO` qu'aucun grantee non prévu ne subsiste. La révocation de `PUBLIC` est ce qui rend la mesure portable : PostgreSQL accorde `EXECUTE` à `PUBLIC` par défaut.
4. **Provisionnement du mot de passe applicatif** 🟢 — le rôle est créé **sans mot de passe** par `010` ; le mot de passe se pose à la main. Le contrôle de démarrage échoue tant que ce n'est pas fait.

#### A.4.4 Authentification

1. **Contrôle de schéma sur les routes publiques** 🟢 — `login`, `mfa`, `refresh` appellent `exigerSchemaOuReponse()` et répondent 503 `schema_incomplete` avec `Retry-After: 15` ; ces routes ne passent pas par `guard()`.
2. **Cadence atomique** 🟢 — `024` crée l'index unique `uq_gf_login_attempts_cle`, qui permet `insert … on conflict do update` : deux essais simultanés ne repartent plus de zéro.
3. **Refresh à usage unique** 🟢 — consommation par un seul `UPDATE … RETURNING`, avec révocation de la famille de jetons en cas de rejeu.
4. **`AUTH_SECRET` obligatoire** 🟢 — absence, longueur < 32 caractères ou valeur de développement ⇒ refus de démarrer.
5. **Comptes de démonstration** 🟡 — `seed:auth` exige désormais `SEED_DEMO_PASSWORD` ; l'ancien mot de passe publié reste valide sur les bases où l'ancien jeu a été appliqué. `verifier-comptes-demo.ts` **constate sans corriger**. La rotation est documentée (`docs/EXPLOITATION-secrets-et-audit.md` §3) mais **n'a pas été exécutée**.
6. **Réserve R-05c** 🟡 — `logout` écrit dans le journal sans contrôle de schéma (ne sert aucune donnée).
7. **Réserve historique** 🟡 — les lignes `operator_country = 'FR'` antérieures à `025` ne permettent pas de distinguer un pays déclaré d'un ancien défaut.

### A.5 Démontré sur PostgreSQL jetable / à qualifier sur l'infrastructure hébergée

| Sujet | Démontré sur cluster jetable | Reste à qualifier sur hébergé |
|---|---|---|
| Migrations complètes | `db:migrate` exit 0, 13/13 tables, 34 politiques, 2 déclencheurs 🟡 | mêmes compteurs sur la base cible 🔴 |
| Idempotence | second `db:migrate` exit 0, état identique 🟡 | rejeu sur base hébergée 🔴 |
| Interruption | 500 partout, message « démarrage refusé », reprise → 200 🟡 | comportement de la plateforme (build, health-check, redémarrage) 🔴 |
| Rôle applicatif | recette 21/21 **sous `geoforest_app`** 🟡 | existence du rôle, mot de passe, absence de `BYPASSRLS` 🔴 |
| Rôle d'administration | contrôle `row_security_active` 🟡 | `neondb_owner` ou équivalent, réellement en `BYPASSRLS` 🔴 |
| Isolation inter-tenant | 52 tests SQL + lectures croisées vides 🟡 | mêmes lectures sur données réelles 🔴 |
| Chaîne d'audit | intacte, falsification détectée 🟡 | volume et rétention réels 🔴 |
| Sauvegarde / restauration | **non démontré** | jamais joué 🔴 |
| Performance | **non démontré** | latence, pool de connexions, cold start 🔴 |

### A.6 Verdict A — **PRÊTE SOUS RÉSERVES**

Le dossier technique **au SHA exact** est complet et vert : 18 commits, 87 fichiers, 3 jobs CI et 5 contrôles de PR tous `pass`, `mergeStateStatus: CLEAN`. Aucune régression connue, aucun test rouge, aucun contrôle en attente.

Trois réserves **empêchent de qualifier la fusion de purement technique** :

1. **Couplage fusion → déploiement.** La PR #8 produit un contrôle Vercel : un projet Vercel est donc relié au dépôt. La documentation (`docs/DEPLOYMENT_VERCEL.md` §4) affirme qu'un push sur `main` déclenche un déploiement — et **aucun workflow de déploiement n'existe dans `.github/workflows/`** : le déclenchement vient de l'intégration Git Vercel, hors dépôt, donc invisible et non séquençable depuis la CI. **Fusionner dans `main` peut donc mettre en production un code dont la migration n'a pas été jouée** ; le garde-fou refusera alors de servir (500/503), mais le service sera indisponible. La fusion n'est pas une opération neutre.
2. **Aucune validation sur base hébergée** (BLOQUÉ, rapport §4 et §7) : ni les rôles, ni les migrations, ni la RLS n'ont été observés sur Neon ou équivalent.
3. **Écarts de qualité documentés et acceptés ou non** : `audit:dev` à 5 vulnérabilités `high` (`braces`, sans correctif amont, hors artefact de production) ; aucun script descendant pour `010`–`025` ni pour `drizzle/0005`.

**Conditions de déblocage (à satisfaire ou à accepter par écrit avant la fusion)** :

- **C1** — soit qualifier une base hébergée de test, soit accepter explicitement le risque « première exécution en production » ;
- **C2** — garantir la séquence `db:migrate` (incluant `025`) **avant** le démarrage du code, avec un opérateur présent et une sauvegarde disponible ;
- **C3** — acter que `audit:dev` reste rouge et que le retour arrière repose sur une **restauration**, pas sur un `.down.sql`.

**Ce que ce verdict ne dit pas** : il ne dit pas que la fusion est sans risque d'exploitation, ni que la production est prête. Il dit que le **dossier de preuve technique** est suffisant pour qu'une décision de fusion soit prise en connaissance de cause.

---

## B. Proposition E — frontières EUDR

Document examiné : `docs/frontieres-eudr-proposition-2026-10-20.md` (155 lignes, statut **PROPOSITION — non approuvée, non implémentée**).

### B.1 Source exacte des frontières

**Aucune source n'est retenue.** La proposition liste **quatre candidates** et recommande, « à instruire, pas à appliquer », **Natural Earth — Admin 0 Countries 5.1.2**. Les trois autres sont `geoBoundaries gbOpen ADM0`, `OpenStreetMap` (extrait daté) et `GAUL / FAO-UE`.

Aucune URL d'origine n'est fournie : la section 2 exige une « URL d'origine » comme **condition** d'une intégration approuvée, ce qui confirme qu'elle n'existe pas encore.

### B.2 Présence et versionnement du fichier

| Élément | Constat | Preuve |
|---|---|---|
| Dossier `data/` | **absent** | `ls data` → *No such file or directory* 🟢 |
| `.gitignore` | `data/` ignoré (ligne 52) | `grep` 🟢 |
| Fichiers frontières dans l'arbre de tête | **aucun** (`.geojson`, `.shp`, `.gpkg`, `.topojson`, `.dbf`, `.prj`) | `find` + `git ls-tree -r 35c5d06` 🟢 |
| `SOURCE.md` | **absent** | `find -name SOURCE.md` 🟢 |
| Référence dans l'historique complet | **non vérifiable** (clone superficiel, profondeur 1) | `git rev-parse --is-shallow-repository` 🟢 |
| Dépendance point-dans-polygone | `@turf/boolean-point-in-polygon` **absent** de `package.json` | `grep turf` 🟢 |

### B.3 Empreinte SHA-256

**Aucune empreinte ne peut être calculée** : il n'existe aucun fichier à hacher, et aucun téléchargement n'est possible depuis cet environnement (`naturalearthdata.com` et `naciscdn.org` → `SSL_ERROR_SYSCALL`).

Conformément à la consigne, **aucune empreinte n'a été inventée, et aucune source n'a été substituée**. La proposition elle-même qualifie l'empreinte de **préalable bloquant** et prévoit que le script d'import devra la calculer, la comparer à la valeur publiée par la source et l'écrire dans `SOURCE.md`.

### B.4 Provenance, version, date, licence, prérequis

| Exigence | État | Détail |
|---|---|---|
| Source choisie | 🔴 non | 4 candidates, aucune approuvée |
| Version figée | 🔴 non | « 5.1.2 (à vérifier au téléchargement) » — non vérifiée |
| Date de publication | 🔴 absente | aucune date dans le document |
| URL d'origine | 🔴 absente | exigée comme condition, non fournie |
| Fichier effectivement importé | 🔴 absent | `data/` inexistant |
| SHA-256 | 🔴 absente | volontairement non renseignée ; non calculable |
| Licence | 🟡 non vérifiée | Natural Earth « domaine public », geoBoundaries « CC BY 4.0 », OSM « ODbL 1.0 », GAUL « à vérifier » — **affirmations du document**, non confrontées à une source officielle |
| Redistribution / archivage | 🔴 non tranché | dépend de la licence retenue |
| Frontières contestées | 🔴 non tranchée | politique proposée, pas décidée (Sahara occidental, Crimée, Cachemire, Taïwan, frontières fluviales) |
| Méthode point-dans-polygone | 🔴 non choisie | bibliothèque non retenue, non installée |
| Antiméridien / trous / polygones invalides | 🟡 décrits, non testés | section 4 de la proposition |
| Revue juridique | 🔴 non faite | explicitement hors périmètre |
| Décision du responsable produit | 🔴 non | « Décision demandée » en fin de document |

### B.5 Ce qui n'est pas en cause

La proposition est **cohérente avec le code** : `country_reliable` reste `false`, l'export porte `country_attribution: "approximate_bbox"`, `country_attribution = "unavailable"` est prévu en cas d'absence, et **aucun repli sur `FR`, `XX` ou le pays de l'opérateur** n'est accepté. Les six tests attendus sont pertinents (Lomé → TG, Arica → CL, Ciudad del Este → PY, Abidjan → CI, Accra → GH, (0,0) → aucun pays, polygone transfrontalier → `ambiguous`).

Le défaut mesuré reste réel : les boîtes englobantes donnent Arica → `BR`, Ciudad del Este → `BR`, Lomé → `XX` 🟡. Aucun pays n'est présenté comme fiable, donc le risque est **borné**, pas corrigé.

### B.6 Verdict B — **BLOQUÉE**

Trois verrous, dans cet ordre :

1. **La source n'est pas choisie** — quatre candidates, une recommandation, aucune décision. Choisir Natural Earth sur la seule foi de ce document reviendrait à substituer une source non approuvée.
2. **Le fichier n'existe pas** — donc ni empreinte, ni version vérifiable, ni date, ni licence opposable.
3. **Les décisions juridiques et produit ne sont pas prises** — politique de frontières contestées, licence de redistribution, revue juridique.

**Conditions de déblocage** :

- **B1** — décision écrite du responsable produit sur la source et la version ;
- **B2** — obtention du fichier exact, calcul du SHA-256, comparaison à l'empreinte publiée par la source, consignation dans `SOURCE.md` (URL, version, licence, date d'import, empreinte) ;
- **B3** — avis juridique écrit sur la licence et la redistribution, et politique explicite pour les frontières contestées ;
- **B4** — choix et versionnement de la bibliothèque point-dans-polygone, puis écriture des huit tests de non-régression.

**Aucune de ces conditions n'est remplie à ce jour.** La proposition reste **non appliquée** ; `country_reliable` doit rester `false`.

---

## C. Préparation au déploiement

### C.1 Procédure d'exploitation et ordre des migrations

**La chaîne réelle, lue dans le code** 🟢 :

1. `npm run db:migrate` → `scripts/migrate.ts` ;
2. migrations Drizzle versionnées : `drizzle/0000_init` à `drizzle/0006_idempotence` — 7 entrées de journal, 13 fichiers `.sql` dont 6 descendantes (`0005` n'en a pas) ;
3. post-migrations de sûreté, **dans l'ordre du nom**, 7 fichiers : `010_row_level_security`, `020_tracabilite_append_only`, `021_chaine_continue`, `022_politiques_suppression_logique`, `023_fonctions_auth_revoquees`, `024_cadence_cle_unique`, **`025_identite_operateur`** ;
4. vérification de cohérence du registre, puis `verifierCloisonnement()` ;
5. **seulement ensuite** : démarrage du serveur, `register()` → `exigerSchemaPret({ force: true })` → contrôles de rôle.

**Confirmation explicite** : `npm run db:migrate`, **incluant `025`**, doit précéder le démarrage du nouveau code. Dans l'ordre inverse, le garde-fou refuse le service (500 au démarrage, 503 `schema_incomplete` sur les routes). Ce n'est pas une panne : c'est le comportement attendu — mais il faut le savoir avant d'appuyer sur « déployer ».

**Écarts documentaires constatés** :

- `docs/DEPLOYMENT_VERCEL.md` **ne contient pas cet ordre** ; il ne mentionne ni `db:migrate`, ni la séquence migration → démarrage. L'ordre n'existe que dans le rapport de phase 13 (§7) 🟢 ;
- le même document affirme (§4) qu'« chaque push sur `main` déclenche le pipeline CI/CD … avant le déploiement sur Vercel ». **Aucun workflow de déploiement n'existe** (`.github/workflows/ci.yml` est le seul fichier) : la phrase décrit une intégration externe, pas ce dépôt 🟢 ;
- la même section 2 contient deux lignes de tableau fusionnées (`DATABASE_URL_ADMIN` et `NEXT_PUBLIC_APP_URL`), défaut de rendu 🟢 ;
- `docker-compose.yml` ne joue **aucune migration** au démarrage 🟢 ;
- `GF_SCHEMA_TTL_MS` n'est pas documenté dans `.env.example` 🟢.

### C.2 Précontrôles

| Domaine | Précontrôle | État | Preuve |
|---|---|---|---|
| **Rôles** | `DATABASE_URL` = rôle applicatif dédié, ni superutilisateur, ni `BYPASSRLS`, ni propriétaire | 🟡 démontré sur cluster jetable ; 🔴 non vérifié sur hébergé | recette 21/21 sous `geoforest_app` |
| | `DATABASE_URL_ADMIN` distinct, contournant la RLS | 🟡 démontré ; 🔴 non vérifié | `comparerConnexions()`, `row_security_active` |
| | `scripts/verifier-role.ts` sort en 0 | 🟢 outil présent ; 🔴 non exécuté sur l'infra cible | `docs/DEPLOYMENT_VERCEL.md` §3 |
| | Refus de démarrer en production si rôle non conforme | 🟢 code ; 🟡 testé localement | `src/instrumentation.ts` |
| **Migrations** | `db:migrate` exit 0, 13/13 tables, 34 politiques, 2 déclencheurs, contrainte `025` | 🟡 base neuve jetable ; 🔴 base cible | rapport §4 |
| | Rejeu idempotent | 🟡 | rapport §6, lignes 23–24 |
| | Détection d'un état partiel au démarrage | 🟡 démontré ; 🟢 code | rapport §2.3 |
| | `025` inclus et idempotent | 🟢 lecture du code ; 🟡 exécution | `025_identite_operateur.sql` |
| **Sauvegarde** | Sauvegarde jouée avant migration | 🔴 **aucun script**, aucune procédure exécutée | `ls scripts` : aucun `backup`/`dump` |
| | Restauration éprouvée | 🔴 **jamais jouée** | `infra/supervision/mise-en-route.md` §1 |
| | Composant `sauvegarde` actif | 🔴 `non_configure` sans `GF_BACKUP_DIR` | idem §3.2 |
| **Observabilité** | `/api/health`, `/api/ready`, `/api/metrics`, `scripts/supervise.ts` | 🟢 présents | inventaire |
| | Transports `journal-local` et `webhook` | 🟡 validés en phase P1-06 | mise-en-route §1 |
| | `sentry`, `otlp`, `pagerduty` | 🔴 **non validés**, refusés par défaut | idem |
| | Prometheus | 🔴 format produit, **jamais ingéré** | idem |
| | Rotation des journaux | 🔴 **non mise en œuvre** | idem §6 |
| | Tableau de bord | 🔴 **inexistant** | idem |
| | Astreinte | 🔴 **non établie** | idem §6 |
| **Retour arrière** | `db:rollback` | 🟢 fonctionne pour la dernière migration Drizzle, exige `.down.sql` | `scripts/rollback.ts` |
| | Descendantes `010`–`025` | 🔴 **absentes** | `ls scripts/sql/post-migrate` |
| | Descendante `drizzle/0005` | 🔴 absente | `ls drizzle` |
| | Procédure de retour arrière réelle | 🔴 **non écrite** : la docstring indique qu'en production le retour arrière est **d'abord une restauration** | `scripts/rollback.ts` |
| **Secrets** | Rotation documentée (ordre, validation, retour arrière) | 🟡 écrite, **non exécutée** | `docs/EXPLOITATION-secrets-et-audit.md` §2 |
| | Comptes de démonstration | 🟡 inventaire en lecture seule ; rotation **non faite** | §3 |
| | Intégrité du journal | 🟡 mécanisme + vérification périodique proposée (6 h), **non automatisée** | §4 |

### C.3 Ce qui est démontré, ce qui reste à faire avec autorisation

**Démontré** (cluster jetable, PostgreSQL 16.2, aucun accès réel) 🟡 :

- migrations complètes et rejouables sur base neuve ;
- RLS 13/13, 34 politiques, 2 déclencheurs, isolation croisée à zéro ligne ;
- chaîne d'audit intacte, falsification détectée ;
- cadence atomique, refresh à usage unique ;
- refus de servir sur schéma incomplet, puis reprise sans redémarrage ;
- identité opérateur : absence représentable, sentinelle refusée par contrainte, export 422.

**À faire plus tard, avec autorisation explicite** 🔴 :

1. créer/régulariser les rôles sur la base cible, poser le mot de passe applicatif, exécuter `verifier-role.ts` ;
2. jouer une **sauvegarde** et **prouver une restauration** sur une base jetable issue de la production ;
3. jouer `db:migrate` sur la base cible, avec un opérateur et une fenêtre d'intervention ;
4. vérifier `/api/ready` = 200 et les compteurs (13/13, 34, 2, contrainte) ;
5. brancher un transport d'alerte réel (`webhook` éprouvé ou PagerDuty validé), une rotation de journaux, un tableau de bord et une astreinte ;
6. répéter la recette sur l'infrastructure cible, y compris l'interruption et la reprise.

### C.4 Verdict C — **CONDITIONS PRÉALABLES NON RÉUNIES (NON PRÊTE)**

Le chemin technique est **ordonné et gardé** : la séquence `db:migrate` → démarrage est correcte, le refus de servir est démontré, les contrôles de rôle et de schéma sont en place. Mais un déploiement en production suppose quatre capacités qui **n'existent pas aujourd'hui** :

1. **aucune sauvegarde restaurable** — le produit signale `non_configure`, et aucune restauration n'a jamais été jouée ; or `024` et `025` modifient des données de façon irréversible ;
2. **aucune validation sur base hébergée** — rôles, migrations, RLS et performances y sont inconnus ;
3. **aucun retour arrière exécutable** — pas de descendantes, et la seule stratégie réaliste est la restauration, elle-même non éprouvée ;
4. **aucune chaîne d'exploitation complète** — alerte réelle non validée pour les transports autres que `journal-local`/`webhook`, pas de rotation de journaux, pas de tableau de bord, pas d'astreinte.

**Conditions de déblocage** : C1 à C3 ci-dessus (réserves de la PR), **plus** C4 — sauvegarde et restauration prouvées, **plus** C5 — transport d'alerte et astreinte opérationnels.

---

## D. Synthèse des trois verdicts

| # | Décision | Verdict | Preuve principale | Condition de déblocage |
|---|---|---|---|---|
| **A** | Fusionner la PR #8 | **PRÊTE SOUS RÉSERVES** | 18 commits, 87 fichiers, 3 jobs CI + 2 contrôles Vercel `pass`, `CLEAN` au SHA `35c5d06` | C1 base hébergée ou risque accepté ; C2 séquence migration ; C3 écarts actés |
| **B** | Valider la proposition E | **BLOQUÉE** | aucune source choisie, aucun fichier, aucune empreinte, licence non vérifiée | B1 choix source/version ; B2 fichier + SHA-256 ; B3 licence + litiges ; B4 bibliothèque + tests |
| **C** | Déployer | **NON PRÊTE** | sauvegarde/restauration jamais jouées ; base hébergée non validée ; pas de descendantes ; supervision incomplète | C1–C3 + C4 sauvegarde/restauration + C5 alerte/astreinte |

**Les trois décisions sont indépendantes** : la fusion peut être décidée sans valider E ; E peut être instruite sans déployer ; le déploiement reste bloqué même si A et B étaient tranchées.

---

## E. Ce que ce dossier n'a pas fait

- aucune fusion, aucune fermeture de PR, aucun déploiement ;
- aucune modification de branche, aucun commit, aucun push — **la tête reste `35c5d06`** ; ce document est un fichier de travail **non suivi** ;
- aucune migration sur une base réelle ou hébergée ;
- aucun secret lu, affiché ou exporté ;
- aucune modification de workflow ;
- aucune empreinte SHA-256 inventée ni source substituée ;
- aucune donnée de frontières téléchargée ou ajoutée.

**Ce dossier ne déclare pas le projet terminé, ni la proposition E validée, ni le déploiement prêt.** Il constate trois états distincts et nomme, pour chacun, la preuve manquante.

---

## F. Suivi du 2026-10-20 — intégration effective de la PR #9

Le présent addendum remplace, pour la suite, le scénario « #8 puis #9 » de la
section A : la PR #9 a été **fusionnée dans la branche de la PR #8**
(`arena/569eff1a-geoforest`) par le commit de fusion `e9114dc`, parents
`35c5d06` (#8) et `39111c1` (#9). Aucune migration n'a été appliquée sur une
base hébergée ; le déploiement reste donc soumis au verdict C.

Décisions prises pendant la résolution (19 conflits) :

| Sujet | Décision | Raison |
|---|---|---|
| `identite-operateur.ts` | module **union** : un seul classement `declared/missing/legacy_placeholder`, prédicats partagés, `resoudreIdentiteExport()` pure | les deux jeux d'appelants doivent voir la même règle ; un classement par côté cassait soit l'export, soit les contrôles |
| migrations | `0009` (Lot A) conservée ; `025` (ligne de sécurité) conservée **après** elle | drizzle s'exécute avant les scripts de sûreté ; `025` n'ajoute que ce que `0009` ne couvre pas (produits, sentinelle, contrainte) |
| sentinelle | écriture **refusée** en base (`XX0000000000000`), plus de dossier « faussement complet » ; l'état `legacy_placeholder` reste géré pour les bases non migrées | une identité fabriquée ne doit jamais pouvoir être stockée ; le contrôle HTTP vérifie le refus `23514` |
| ordre des refus d'export | géométrie (409) → identité (422) → valeur probante (409) → déforestation (409) | l'identité manquante ne doit pas être masquée par « configurez GFW » |
| `country_of_activity` | **obligatoire**, aucun repli `FR` | le pays d'activité n'est pas déductible |
| `0008` | quarantaine des comptes `supplier` sans fiche conservée, mais **préflight documenté** dans `DEPLOYMENT_VERCEL.md` §3 bis | la mesure précède la migration ; la quarantaine est réversible |
| invitation fournisseur | lectures globales (`unicité d'adresse`, recherche du compte à révoquer) via la connexion d'administration, filtre d'organisation explicite | `023` retire l'exécution des fonctions d'auth au rôle applicatif, et `gf_users` ne lui est pas lisible |

Vérifications exécutées sur PostgreSQL 16.2 local (base vierge, rôle
`geoforest_app` sans `BYPASSRLS`) : migrations 13/13 (`0000`–`0009`,
`010`, `020`–`025`), RLS 13/13 · 34 politiques, `verifier-role` conforme,
parcours e2e 49/49, cross-tenant 262/262, export identité 33/33, fournisseur
57/57, unit 52, sql 52, http 34, 9 scripts de contrôles, backend 138 passés /
3 ignorés / 2 xfailed, build sans base.

Reste **inchangé** : le verdict C (sauvegarde/restauration jamais jouées, base
hébergée non qualifiée, pas de descendantes), le verdict B (proposition E) et
les réserves A.3/A.5.
