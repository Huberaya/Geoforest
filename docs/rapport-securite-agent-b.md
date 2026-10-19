# Rapport de mission — Agent B

## Sécurité et qualité des parcours : isolation inter-tenant et autorisations

| | |
|---|---|
| Dépôt | `Huberaya/Geoforest` |
| Branche de travail | `arena/569eff1a-geoforest` |
| Commit de référence | `1c95f4c585ed8303f887089ae7450c9235523fd0` (`main` au moment de l'audit) |
| Commit de vérification (phase 2) | `4f5970bff00387b0eb8e0654a15a32f9be2552b2` (parent : `04c9cc5f11fd7c455297022c3a4903ee89434aaa`) |
| Commit de vérification (phase 3) | `9ab78e645db0b0b6d5b5bb09b975acb4641c84ad` (parent : `256acdcc9bed022685db41a0581fbd1703eb32bb`) |
| Demande de fusion | [PR #8](https://github.com/Huberaya/Geoforest/pull/8) — `arena/569eff1a-geoforest` → `main`, **non fusionnée** |
| Date | 19 octobre 2026 |
| Périmètre | Next.js 16 (39 routes API), schéma PostgreSQL et politiques RLS, backend FastAPI (SQLite), scripts d'exploitation |
| Hors périmètre | hébergement, fournisseur d'identité, S3/SMTP réels, tests de charge, audit de dépendances exhaustif |

Les contraintes de la mission ont été respectées : `main` n'a pas été modifiée, aucune PR n'a été fusionnée, aucun secret ni réglage de production n'a été changé, aucune base partagée n'a été réinitialisée, aucun test destructif n'a été lancé sur des données réelles. Aucune politique de sécurité n'a été affaiblie pour faire passer un test.

---

## 1. Méthode

1. **Cartographie** : authentification (cookies, jetons, MFA), identification du tenant (session → `withTenant` → `app.current_org`), autorisations (`guard()` et matrice de permissions), accès aux données (Drizzle, RLS, clés étrangères composites), backend FastAPI.
2. **Revue des 39 routes** : recherche des routes sans garde, des `organizationId` venant du client, des erreurs recopiées telles quelles, des identifiants non contrôlés.
3. **Tests exécutés** contre une vraie base PostgreSQL embarquée (PGlite 0.5.10) et un vrai serveur Next.js (`next dev`) :
   - `tests/sql/` : politiques RLS sous le rôle applicatif `geoforest_app` ;
   - `tests/http/` : parcours HTTP réels, cookies réels, statuts et corps réels ;
   - `tests/unit/` : fonctions de sécurité isolées ;
   - `backend/tests/` : API FastAPI.
4. **Preuve avant/après** : pour chaque défaut, le comportement d'avant est établi par le code du commit de référence (`git show 1c95f4c:…`) ou par une exécution du banc d'essai avant correction, puis le même scénario est rejoué après.

### Limites de la démonstration

- Le bac à sable ne dispose ni de PostgreSQL serveur ni de Docker. Les tests HTTP utilisent PGlite via un socket TCP. **Ce socket n'authentifie pas** : le serveur Next s'y connecte en `postgres`, superutilisateur, et la RLS y est donc contournée. Les tests HTTP prouvent le **filtrage applicatif** ; la RLS est prouvée séparément, sous `geoforest_app`, par les tests SQL. Une recette sur PostgreSQL serveur reste nécessaire avant mise en production.
- PGlite ne sert qu'une connexion à la fois : les scénarios réellement concurrents (course sur un jeton) ne peuvent pas y être rejoués. Les garanties correspondantes reposent sur des instructions SQL atomiques, testées sur leur propriété d'unicité.
- Le backend FastAPI utilise SQLite et ne connaît ni utilisateur ni organisation : il est **mono-tenant par construction**. La correction consistait à le fermer, pas à inventer un cloisonnement qu'il ne peut pas porter.

---

## 2. Synthèse

| # | Défaut | Gravité | État | Test de non-régression |
|---|---|---|---|---|
| V1 | Tout `/api/v1/auth/*` déclaré public par préfixe dans le proxy | Élevée | Corrigé | `public-paths.test.ts` (2), HTTP #1 |
| V2 | Rotation du jeton de rafraîchissement non atomique (rejeu concurrent) | Élevée | Corrigé | `refresh-consommation.test.ts` (3), HTTP #12 |
| V3 | MFA : essais illimités et compteur remis à zéro avant le second facteur | Élevée | Corrigé | HTTP #11 |
| V4 | `X-Forwarded-For` lu à gauche : quotas contournables | Moyenne-élevée | Corrigé | `rate-limit.test.ts` (8) |
| V5 | 503 recopiant le message technique (hôte, port, utilisateur) | Moyenne | Corrigé | `db-error.test.ts` (3), HTTP #23 |
| V6 | Backend FastAPI sans authentification + CORS `*` avec credentials | Critique | Corrigé | `test_backend_auth.py` (6) |
| V7 | Filtre `action` du journal appliqué après `LIMIT` | Moyenne (intégrité) | Corrigé | HTTP #21 |
| V8 | Références croisées DDS/lots : 500 au lieu d'un refus lisible | Moyenne | Corrigé | HTTP #17 |
| V9 | Clé de stockage exposée dans une réponse 500 | Moyenne (fuite interne) | Corrigé | HTTP #22 |
| V10 | Fonctions `auth_user_by_email`/`auth_user_by_id` : `SECURITY DEFINER` exécutables par l'application, rendant les secrets des comptes | Critique | Corrigé | `privileges.test.ts` #6, #8 ; `connexion-applicative.test.ts` #1 |
| V11 | Compteur d'échecs de connexion non atomique (`window_key` sans unicité) | Moyenne-élevée | Corrigé | `cadence-partagee.test.ts` (6) |
| V12 | Renouvellement de session, changement de mot de passe et MFA sans limite de débit | Moyenne | Corrigé | `cadence-partagee.test.ts` (6), HTTP #24 |
| V13 | `source-map-js@1.2.1` vulnérable (`GHSA-68fv-2mgg-jv7q`) | Moyenne | Corrigé | `npm ls source-map-js`, `npm audit --omit=dev` |
| V14 | Script d'amorçage : mot de passe publié et réinitialisation des comptes existants | Élevée | Corrigé | `seed-gardes.test.ts` (8) |
| V15 | Backend : documentation interactive ouverte, CORS `allow_methods: ["*"]` | Faible-moyenne | Corrigé | `test_backend_auth.py` (8 nouveaux) |
| V16 | Le build exigeait une base configurée ; la CI n'exécutait aucun test front | Moyenne (détection) | Corrigé | `admin-pool.test.ts`, `npm run build` sans variables |
| V17 | `010` : `alter role … nobypassrls` échouait sans `BYPASSRLS` et annulait **toute** la post-migration (RLS non installée) | Élevée | Corrigé | recette serveur, étape 3 |
| V18 | Connexion d'administration soumise à la RLS : authentification cassée **silencieusement** | Élevée | Corrigé | `controle-role-admin.test.ts` (3), recette étape 6b |
| V19 | `password_hash`, `mfa_secret`, `mfa_recovery_codes` lisibles par le rôle applicatif dans son tenant | Moyenne | Corrigé | `privileges.test.ts` (colonnes), recette |
| — | RLS, permissions, FK composites, URL signées, journal scellé, suppressions logiques | — | **Déjà satisfaisants** | tests SQL + HTTP (voir §4) |

**Résultats finaux** (arbre de travail de la branche, après la phase 2) :

| Commande | Résultat |
|---|---|
| `npm run test:unit` | **36/36** |
| `npm run test:sql` | **42/42** (13 isolation/RLS, 12 privilèges, 8 connexion applicative, 6 cadence, 3 consommation de jetons) |
| `npm run test:http` | **25/25** |
| `bash scripts/recette/postgresql-recette.sh` | **9 étapes, 21 assertions** (PostgreSQL 16.2) |
| `npx tsc --noEmit` | **0 erreur** |
| `npm run lint` | **0 erreur** (9 avertissements, aucun bloquant) |
| `pytest -q` (backend) | **55 passed, 3 skipped** |
| `npm run build` (**sans aucune variable de base**) | **succès** |
| `npm run audit:sec` (dépendances de production) | **0 vulnérabilité** |

---

## 3. Vulnérabilités corrigées

### V1 — Le préfixe `/api/v1/auth/` rendait publiques des routes qui ne le sont pas

**Preuve avant.** Dans `src/proxy.ts` au commit de référence :

```ts
function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return pathname.startsWith("/api/v1/auth/");
}
```

Toute route ajoutée sous `/api/v1/auth/` échappait donc au contrôle du proxy — y compris `me` et `password`, qui exigent une session. Ces deux routes se défendaient elles-mêmes, mais la sûreté dépendait de chaque route, pas du proxy : une route ajoutée demain sans garde serait passée sans qu'aucun test ne le signale.

**Cause racine.** Liste d'exception par préfixe au lieu d'une liste exacte.

**Fichiers.** `src/proxy.ts`, `src/lib/auth/public-paths.ts` (nouveau).

**Correction.** Le module `public-paths.ts` énumère exactement les quatre étapes qui précèdent l'existence d'une session : `login`, `mfa`, `refresh`, `logout`. `isPublic()` ne consulte plus que cette liste.

**Test de non-régression.** `tests/unit/public-paths.test.ts` vérifie que les quatre chemins sont publics et que `me`, `password`, `suppliers`, etc. ne le sont pas. Le test HTTP #1 vérifie en conditions réelles que `GET /api/v1/auth/me` et `POST /api/v1/auth/password` sans session répondent **401 `unauthenticated`**.

**Résultat après.** 401 sur les routes protégées ; seules les quatre étapes de connexion restent publiques.

---

### V2 — Rotation du jeton de rafraîchissement : lecture, vérification, écriture non atomiques

**Preuve avant.** `src/lib/auth/session.ts` (commit de référence) :

```ts
const rows = await db.select().from(sessions)
  .where(eq(sessions.refreshTokenHash, hash)).limit(1);
const current = rows[0];
if (!current) return null;
if (current.revokedAt) { /* révocation de la famille */ return null; }
// … puis
await db.update(sessions).set({ revokedAt: new Date(), … }).where(eq(sessions.id, current.id));
```

Deux requêtes portant le **même** jeton passaient toutes les deux le contrôle `revokedAt` avant qu'aucune n'ait écrit : chacune pouvait recevoir une session neuve, et la détection de rejeu ne se déclenchait jamais — exactement le scénario d'un jeton volé rejoué en parallèle.

**Cause racine.** Course entre la lecture et l'écriture (read-check-write) sur une ressource à usage unique.

**Fichiers.** `src/lib/auth/refresh-consommation.ts` (nouveau), `src/lib/auth/session.ts`.

**Correction.** La consommation est une **seule** instruction `UPDATE … RETURNING`, dont le `WHERE` porte les trois conditions (jeton, non révoqué, non expiré). PostgreSQL sérialise les écritures sur la ligne : une seule requête peut la faire passer de « active » à « consommée ». La seconde ne trouve plus rien ; l'appelant détecte alors un jeton existant déjà révoqué et révoque toute la famille.

**Test de non-régression.** `tests/sql/refresh-consommation.test.ts` : consommation unique, refus d'un jeton déjà révoqué ou expiré, révocation de famille limitée à la famille concernée. Test HTTP #12 : un jeton déjà consommé est refusé (401) **et** le jeton fraîchement émis par la rotation ne fonctionne plus.

**Résultat après.** 3/3 et 23/23. La course concurrente n'a pas pu être rejouée sur PGlite (mono-connexion) ; la garantie est portée par l'atomicité de l'instruction, pas par un verrou applicatif.

---

### V3 — MFA : le second facteur pouvait être essayé sans limite

**Preuve avant.** Dans `src/app/api/v1/auth/login/route.ts`, le compteur d'échecs du compte était remis à zéro **dès que le mot de passe était correct**, avant la validation MFA :

```ts
await clearLoginFailures(windowKey);
if (mfaRequiredFor(user.role)) { … }
// et pour les rôles sans MFA :
await resetAccountFailures(user.id);
```

Or `src/app/api/v1/auth/mfa/route.ts` ne comptait pas les codes refusés. Un attaquant connaissant le mot de passe disposait donc d'un nombre illimité d'essais sur un code TOTP à six chiffres (10⁶ possibilités), et chaque nouvelle connexion remettait le verrou à zéro.

**Cause racine.** Le compteur d'échecs était lié à l'étape « mot de passe » au lieu de l'étape « session complète », et le second facteur n'alimentait pas ce compteur.

**Fichiers.** `src/app/api/v1/auth/login/route.ts`, `src/app/api/v1/auth/mfa/route.ts`.

**Correction.** Le compteur n'est plus remis à zéro avant la MFA. Un code refusé appelle `registerAccountFailure()` — au même titre qu'un mot de passe faux — et la route MFA vérifie `lockedUntil` avant tout essai. La remise à zéro a lieu après la validation complète, dans `auth/mfa` (`resetAccountFailures`) ou dans `login` pour les rôles sans MFA.

**Test de non-régression.** Test HTTP #11 : enrôlement MFA, puis cinq codes faux → 401 ; le code **valide** suivant répond **423 `account_locked`**. Ce test échouerait sur le code d'origine, où le sixième essai aurait réussi.

**Résultat après.** Verrouillage effectif au cinquième échec, avec `Retry-After` implicite par le message (minutes restantes).

---

### V4 — `X-Forwarded-For` lu à gauche : le client choisissait son propre quota

**Preuve avant.** `src/lib/rate-limit.ts` et `clientIp()` dans `session.ts` prenaient la **première** entrée de l'en-tête :

```ts
const premiere = xff.split(",")[0]?.trim();
if (premiere) return premiere;
```

Un mandataire ajoute l'adresse du pair à la **fin** de l'en-tête. La première entrée est donc celle que le client peut inventer : en changeant d'en-tête à chaque requête, un attaquant obtenait un compartiment de limitation neuf à chaque appel. Deux lectures différentes existaient de surcroît (quotas à gauche, journal à droite).

**Cause racine.** Confusion entre l'entrée fournie par le client et celle ajoutée par le mandataire ; absence de validation de forme.

**Fichiers.** `src/lib/rate-limit.ts`, `src/lib/auth/session.ts`.

**Correction.** Lecture de droite à gauche, avec `GF_TRUSTED_PROXY_HOPS` (défaut 1) pour déclarer le nombre de mandataires de confiance ; validation IPv4/IPv6, retrait des ports et crochets ; repli sur `X-Real-IP` puis `inconnue`. `clientIp()` réutilise la même fonction — une seule règle pour les quotas et le journal.

**Test de non-régression.** `tests/unit/rate-limit.test.ts` (8 tests) : `adresseClient("6.6.6.6, 198.51.100.7") === "198.51.100.7"`, deux mandataires, entrées invalides, port IPv4, IPv6 entre crochets, réglage aberrant.

**Résultat après.** 8/8. Le réglage `GF_TRUSTED_PROXY_HOPS` est documenté dans `.env.example` ; il reste un fait de déploiement à ajuster (voir §5).

---

### V5 — Les réponses 503 recopiaient le message technique de la base

**Preuve avant.** `src/lib/api/db-error.ts` :

```ts
const message = error instanceof Error ? error.message : String(error);
return NextResponse.json({ detail: "…", cause: message, retryable: true }, { status: 503 });
```

Le message d'une erreur `pg` contient l'hôte, le port, parfois l'utilisateur et le début de la chaîne de connexion. Une panne de base devenait donc une fuite d'infrastructure, et le détail technique partait aussi dans la réponse au navigateur.

**Cause racine.** La réponse HTTP était construite à partir de l'exception, sans séparation entre ce qui sert au client et ce qui sert à l'exploitant.

**Fichiers.** `src/lib/api/db-error.ts`.

**Correction.** Le corps ne contient plus que le message stable et `retryable`, avec `503` et `Retry-After: 10`. Le détail reste dans le journal applicatif (`base.injoignable`), corrélé par `requestId` ; `guard()` renvoie déjà ce `requestId` dans l'en-tête `X-Request-Id`.

**Test de non-régression.** `tests/unit/db-error.test.ts` (3 tests), dont « la réponse 503 ne divulgue ni hôte, ni port, ni message technique ». Test HTTP #23 : socket PGlite arrêté, `GET /api/v1/suppliers` → **503**, corps sans `127.0.0.1`, sans `55491`, sans `ECONNREFUSED`, sans `"cause"`.

**Résultat après.** 503 stable, aucune donnée d'infrastructure dans la réponse.

---

### V6 — Backend FastAPI : données accessibles sans authentification, CORS `*` avec credentials

**Preuve avant.** `backend/app/api/v1/endpoints.py` déclarait sans dépendance de sécurité :

- `POST /api/v1/audit/parcel` (écriture),
- `GET /api/v1/audits`, `GET /api/v1/audits/{id}` (lecture),
- `POST /api/v1/export/traces` (export de dossier).

Et `backend/app/core/config.py` :

```python
cors_origins = _env_list("CORS_ORIGINS", [..., "*"])
```

avec `allow_credentials=True` dans `main.py`. N'importe quel site pouvait donc appeler l'API avec les identifiants du navigateur, et n'importe quel client réseau pouvait lire ou écrire les dossiers sans jeton. Ce backend ne porte ni utilisateur ni organisation : aucune RLS ne pouvait le rattraper.

**Cause racine.** Service interne supposé inaccessible, sans contrôle explicite ; configuration CORS par défaut permissive.

**Fichiers.** `backend/app/core/security.py` (nouveau), `backend/app/core/config.py`, `backend/app/api/v1/endpoints.py`, `backend/app/main.py`, `backend/tests/conftest.py` (nouveau), `backend/tests/test_backend_auth.py` (nouveau), `backend/tests/test_eudr_pipeline.py`, `backend/tests/test_geospatial.py`, `docker-compose.yml`, `.env.example`, `README.md`.

**Correction.** Jeton de service `GF_BACKEND_TOKEN` en `Authorization: Bearer`, comparé en temps constant (`hmac.compare_digest`). Les quatre routes de données passent dans un routeur `router_protege` qui porte la dépendance **par construction** : une route ajoutée à ce routeur hérite de la protection. Jeton absent de la configuration → **503** (échec fermé), jeton faux → **401**. CORS : origines nommées, `*` refuse de démarrer. Le backend est lié à `127.0.0.1` dans `docker-compose.yml` ; la documentation rappelle qu'il est mono-tenant et ne doit servir qu'une organisation.

**Tests de non-régression.** `backend/tests/test_backend_auth.py` (6) : `/health` reste public, données refusées sans jeton, refusées avec un mauvais jeton, acceptées avec le bon, 503 si le jeton n'est pas configuré, `*` refusé à l'initialisation. Suite complète : **47 passed, 3 skipped**.

**Résultat après.** 401/503 sur les données, 200 avec le jeton, démarrage refusé si `CORS_ORIGINS` contient `*`.

---

### V7 — Journal d'audit : le filtre `action` était appliqué après la limite

**Preuve avant.** `src/app/api/v1/audit-logs/route.ts` :

```ts
const rows = await tx.select().from(auditLogs)
  .where(eq(auditLogs.organizationId, organizationId))
  .orderBy(desc(auditLogs.createdAt))
  .limit(limit);
const filtered = action ? rows.filter((r) => r.action === action) : rows;
```

Avec `?action=LOGIN_SUCCESS&limit=1`, la requête lisait la seule action la plus récente, puis la filtrait : si elle n'était pas de ce type, la réponse était vide alors que des lignes correspondantes existaient plus haut. Pour un outil de conformité, un journal qui « ne trouve rien » est un défaut d'intégrité, pas un détail d'affichage.

**Cause racine.** Filtrage en mémoire après pagination au lieu d'un prédicat SQL.

**Fichiers.** `src/app/api/v1/audit-logs/route.ts`.

**Correction.** Le prédicat `action` est ajouté au `WHERE` (`and(org, action)`), avant `ORDER BY` et `LIMIT`.

**Test de non-régression.** Test HTTP #21 : après plusieurs `CREATE`, `GET /api/v1/audit-logs?action=LOGIN_SUCCESS&limit=1` renvoie exactement une ligne `LOGIN_SUCCESS`.

**Résultat après.** 1 ligne, comme attendu.

---

### V8 — Références croisées DDS / lots : erreur serveur au lieu d'un refus lisible

**Preuve avant.** Test HTTP #17 exécuté avant correction :

```text
/api/v1/due-diligence → 500 « Erreur interne du serveur. »
/api/v1/shipments      → 500 « Erreur interne du serveur. »
```

Le corps ne fuitait rien (message générique + `requestId`), mais un utilisateur authentifié qui soumettait l'identifiant d'un fournisseur d'un autre tenant provoquait un **500**, c'est-à-dire un incident serveur pour une faute de saisie. La base refusait heureusement l'écriture : les clés étrangères composites `fk_gf_dds_supplier_tenant` et `fk_gf_shipments_supplier_tenant` (vérifiées par `var/preuve-fk.mts`) rejettent la paire `(supplier_id, organization_id)` incohérente. Le défaut était donc dans le statut et le bruit, pas dans l'isolation.

**Cause racine.** Les routes `due-diligence` et `shipments` validaient la **forme** UUID des références, pas leur **appartenance** au tenant ; l'erreur de contrainte remontait jusqu'au gestionnaire générique.

**Fichiers.** `src/app/api/v1/due-diligence/route.ts`, `src/app/api/v1/shipments/route.ts`.

**Correction.** Avant l'insertion, `supplierId` et `productId` sont recherchés avec `(id, organizationId)` ; absent → **404** « Fournisseur introuvable » / « Produit introuvable ». La forme invalide reste **422**. Le motif est celui déjà employé par `plots`, `risks` et `documents` : le refus ne dépend plus du seul moteur.

**Test de non-régression.** Test HTTP #17 : cinq créations référençant le tenant B → **404** ; les deux routes corrigées (dossier, lot) sont celles qui répondaient 500, les trois autres (parcelle, document, tâche) validaient déjà et le restent. Les listes de B restent inchangées et aucun détail PostgreSQL (`duplicate key`, `violates foreign key`, `insert into`) n'apparaît.

**Résultat après.** 404 sur les deux routes (journal Next : `POST … 404`), 23/23.

---

### V9 — Une pièce absente du support exposait sa clé de stockage

**Preuve avant.** Test HTTP #22 exécuté avant correction : le téléchargement d'une pièce déclarée en base mais absente du support répondait :

```json
{ "detail": "La pièce est déclarée mais introuvable sur le support : incident à traiter.",
  "storageKey": "org-a/doc-a.pdf" }
```

La clé est propre au tenant, donc pas une fuite inter-tenant, mais elle révèle l'arborescence interne du support et le nom d'objet pour un incident qui n'apprend rien d'utile à l'appelant.

**Cause racine.** Le détail d'exploitation était placé dans la réponse HTTP au lieu du journal.

**Fichiers.** `src/app/api/v1/documents/[id]/download/route.ts`.

**Correction.** La clé et la version partent dans `journal.error("stockage.piece_absente", …)` ; la réponse ne contient que le message stable, et l'en-tête `X-Request-Id` posé par `guard()` permet de relier le signalement à la ligne de journal.

**Test de non-régression.** Test HTTP #22 : téléchargement via une URL signée valide, support vide → **500**, corps sans `storageKey`, sans `org-a/doc-a.pdf`, sans `/tmp/`.

**Résultat après.** 500 sans détail interne.

---

## 3bis. Phase 2 — corrections issues de la validation exécutable

Ces sept défauts n'ont pas été trouvés par lecture : ils sont apparus en
exécutant les tests sous le **rôle applicatif réel** (`geoforest_app`), avec un
serveur PostgreSQL embarqué, puis en vérifiant chaque correctif par un test
reproductible. L'ordre de la mission a été suivi : diagnostiquer, corriger,
tester, intégrer, vérifier.

### V10 — `auth_user_by_email` / `auth_user_by_id` : les secrets des comptes étaient lisibles par l'application

**État.** Exploitable par tout code s'exécutant avec la connexion applicative (injection SQL, route oubliée, dépendance compromise). **Critique.**

**Preuve avant.** `scripts/sql/post-migrate/010_row_level_security.sql` définit :

```sql
create or replace function auth_user_by_email(email_cible text)
returns gf_users language sql security definer stable as
$$ select * from gf_users where email = email_cible $$;
```

Deux propriétés se combinent : `SECURITY DEFINER` fait exécuter la fonction
avec les droits du propriétaire (elle **échappe donc à la RLS**), et PostgreSQL
accorde `EXECUTE` à `PUBLIC` par défaut sur toute fonction créée. Depuis le rôle
applicatif, `auth_user_by_email('autre@exemple.test')` renvoyait donc la ligne
complète d'un compte d'une **autre organisation** : condensat de mot de passe,
secret TOTP, condensats des codes de secours.

Mesure : le test `privileges` n° 6 a été rejoué **sans** la migration `023` ;
il échoue (`Missing expected rejection` — l'appel aboutit au lieu d'être refusé
en `42501`), soit 9/10, et repasse à 10/10 dès que `023` est présente. Journal :
`var/preuves/11-avant-023-fonctions-auth.log`.

**Cause racine.** Une fonction privilégiée exposée à un rôle qui n'en a pas
besoin. Aucune route ne l'appelle : l'authentification passe par la connexion
d'administration (`src/db/admin.ts`), précisément parce qu'elle a lieu avant
qu'une organisation ne soit connue.

**Fichiers.** `scripts/sql/post-migrate/023_fonctions_auth_revoquees.sql`
(nouveau) ; `tests/sql/privileges.test.ts` ; `tests/sql/connexion-applicative.test.ts`.

**Correction.** `REVOKE ALL` sur les deux fonctions, pour `PUBLIC` **et** pour
`geoforest_app`, avec un bloc de contrôle qui vérifie que le propriétaire les
exécute encore (sinon la connexion serait cassée) et qu'aucun rôle non prévu ne
les détient. `CREATE OR REPLACE FUNCTION` conserve les privilèges existants :
rejouer `010` ne rouvre pas l'accès.

**Test exact.** `npm run test:sql`, fichier `tests/sql/privileges.test.ts` :
« les fonctions d'authentification ne sont pas exécutables par l'application »
(attente de l'erreur `42501`), « les secrets des comptes ne sont pas lisibles
depuis le rôle applicatif ». `tests/sql/connexion-applicative.test.ts` vérifie
que la connexion réelle se présente bien comme `geoforest_app`.

**Résultat après.** `privileges` **10/10**, `connexion-applicative` **8/8**,
`test:sql` **40/40** — sur le commit de vérification `4f5970bff00387b0eb8e0654a15a32f9be2552b2`.

**Risque résiduel.** Une base existante doit avoir reçu la migration `023` : le
déploiement doit exécuter `scripts/sql/post-migrate/` dans l'ordre. Si une
fonction était un jour supprimée puis recréée à la main, son `ACL` serait
réinitialisé ; le test de privilèges le détecterait.

---

### V11 — Le compteur d'échecs de connexion n'était pas atomique

**État.** Limite contournable entre instances ; **moyenne-élevée**.

**Preuve avant.** `gf_login_attempts.window_key` n'avait **aucune contrainte
d'unicité**. `registerLoginFailure` lisait la ligne, calculait, puis écrivait :
deux requêtes simultanées (ou deux instances) pouvaient insérer deux lignes pour
la même clé, chacune repartant de zéro. Le verrouillage arrivait plus tard que
prévu, voire jamais si les essais retombaient sur des lignes différentes.

**Cause racine.** Comptage en deux temps sur une ressource qui exige une
écriture atomique ; absence de la contrainte qui aurait rendu le comptage
atomique possible.

**Fichiers.** `scripts/sql/post-migrate/024_cadence_cle_unique.sql` (nouveau),
`src/lib/auth/cadence-partagee.ts` (nouveau), `src/lib/auth/session.ts`.

**Correction.** `024` dédoublonne les clés existantes en **cumulant** les
compteurs (jamais en les allégeant), puis crée `uq_gf_login_attempts_cle`.
`cadence-partagee.ts` consomme la fenêtre par une **seule** instruction
`insert … on conflict (window_key) do update … returning`, sans transaction
interactive ni verrou applicatif. Une première version utilisait
`pg_advisory_xact_lock` : elle immobilisait la connexion unique du banc et a été
abandonnée, précisément parce que ce défaut aurait été invisible en production
mono-instance.

**Test exact.** `tests/sql/cadence-partagee.test.ts`, six tests : compteur
partagé entre deux instances, cloisonnement des compartiments (mot de passe,
renouvellement, second facteur), expiration de fenêtre, **une seule ligne par
clé**, remise à zéro après succès, absence du mot de passe en clair. La
sémantique « le `max`-ième essai est refusé » y est écrite noir sur blanc, pour
qu'un futur changement ne passe pas inaperçu.

**Résultat après.** **6/6** ; `test:sql` **40/40**.

**Risque résiduel.** Le banc PGlite ne sert qu'une connexion : la course réelle
n'a pas pu être rejouée. La garantie repose sur l'atomicité de l'instruction et
sur l'index unique, pas sur un verrou applicatif — une recette sur PostgreSQL
serveur reste souhaitable.

---

### V12 — Renouvellement, changement de mot de passe et MFA sans limite de débit

**État.** Surface d'énumération et de force brute ; **moyenne**.

**Preuve avant.** Seule la connexion était limitée (et en mémoire du proxy).
`/api/v1/auth/refresh` acceptait un flot illimité de jetons, `/auth/password`
autant d'essais de mot de passe courant, `/auth/mfa` autant de codes à six
chiffres — alors que la fenêtre de verrouillage MFA ne couvrait que les échecs
enregistrés après un mot de passe correct.

**Cause racine.** Limiteur unique (connexion) au lieu d'un limiteur par action
sensible, et stockage en mémoire de processus au lieu d'un stockage partagé.

**Fichiers.** `src/lib/auth/cadence-partagee.ts`,
`src/app/api/v1/auth/{refresh,password,mfa}/route.ts`,
`src/lib/auth/session.ts`.

**Correction.** Trois compartiments nommés
(`clesCadence.{motDePasse,renouvellement,secondFacteur}`) : renouvellement
**60/min par adresse**, changement de mot de passe **10/15 min par
utilisateur**, second facteur **60/min par adresse**. Chaque refus répond
**429** avec `Retry-After`, et la fenêtre survit au redémarrage puisqu'elle est
en base. `registerLoginFailure`/`clearLoginFailures` passent par le même
module : un seul mécanisme, un seul endroit à auditer.

**Test exact.** `tests/sql/cadence-partagee.test.ts` ; test HTTP #24 « le
renouvellement de session est limité par adresse, en base » (le `429` apparaît
après la fenêtre, et la base le porte).

**Résultat après.** **25/25** en HTTP ; **40/40** en SQL.

**Risque résiduel.** Le banc HTTP ne peut pas exercer `/auth/password` : la
route ouvre une connexion d'administration pendant qu'une transaction de tenant
est ouverte, ce qui **immobilise la connexion unique de PGlite** (300 s). Le
défaut a été vérifié **contre la version d'origine de la route**
(`git show 04c9cc5:…`) : même blocage, donc défaut du banc et non de la
correction (`var/probe-password.mts`, `var/preuves/06`). Cette route est
couverte par les tests SQL de cadence ; sa vérification HTTP complète demande un
PostgreSQL serveur.

---

### V13 — `source-map-js@1.2.1` : vulnérabilité transitive

**État.** Avis `GHSA-68fv-2mgg-jv7q` (high, déni de service par source maps
indexées) ; **moyenne** dans ce contexte.

**Preuve avant.** `npm audit` signalait `source-map-js@1.2.1` dans l'arbre de
production, tiré par la chaîne de `next`.

**Cause racine.** Version transitive non contrainte ; le correctif `1.2.2`
existait déjà.

**Fichiers.** `package.json` (`overrides.source-map-js = "1.2.2"`),
`package-lock.json`.

**Correction.** Surcharge ciblée sur la seule dépendance concernée — aucune mise
à jour générale, aucun lockfile supprimé. `package-lock.json` régénéré par
`npm install --package-lock-only` puis installé, et **vérifié** :
`npm ls source-map-js` retourne `1.2.2 deduped`.

**Test exact.** `npm ls source-map-js` ; `npm run audit:sec`.

**Résultat après.** Une seule version, `1.2.2`, dans tout l'arbre ;
**0 vulnérabilité de production**.

**Risque résiduel.** Voir §5.12 : un avis **sur un outil de développement**
(`braces`, sans version corrigée) subsiste ; il n'est pas dans l'arbre de
production.

---

### V14 — Script d'amorçage : mot de passe publié et réinitialisation silencieuse

**État.** Un mot de passe présent dans le dépôt, appliqué par défaut et capable
d'écraser des comptes réels ; **élevée**.

**Preuve avant.** `scripts/seed-auth.ts` créait cinq comptes, dont un
administrateur, avec `SEED_DEMO_PASSWORD ?? "Trace!Demo2026x"` — valeur publique
dans l'historique du dépôt. Le script mettait aussi à jour le mot de passe des
comptes **déjà existants**, remettait leur MFA à zéro et les réactivait : lancé
contre une base partagée, il remplaçait des identifiants réels par un secret
public, sans rien demander.

**Cause racine.** Valeur par défaut secrète dans le code, et absence de garde
sur la cible (environnement, hôte, existence des comptes).

**Fichiers.** `scripts/seed-gardes.ts` (nouveau), `scripts/seed-auth.ts`,
`scripts/check-p106-regles.ts`, `tests/unit/seed-gardes.test.ts`.

**Correction.** Cinq gardes, dans un module sans base donc testable : mot de
passe **obligatoire**, jamais affiché, refusé s'il est le mot de passe publié ou
trop court (12 caractères) ; refus en production ; base non locale refusée sauf
`SEED_AUTORISE_HOTE_DISTANT=oui` ; réinitialisation des comptes existants
seulement avec `SEED_REINITIALISER=oui`. Le jeu de démonstration locale reste
possible. Le script de contrôle `check-p106-regles.ts` n'emploie plus la valeur
publiée.

**Test exact.** `tests/unit/seed-gardes.test.ts`, huit tests, dont « le mot de
passe publié dans le dépôt est refusé », « la production est refusée même avec
un mot de passe valide », « une base non locale est refusée sans autorisation
explicite », « la réinitialisation exige un drapeau dédié » et « toutes les
raisons de refus sont renvoyées ensemble ».

**Résultat après.** **8/8** ; `test:unit` **22/22**.

**Risque résiduel.** Les bases ayant déjà reçu l'ancien jeu de données peuvent
contenir des comptes ouverts avec le mot de passe public : **ils doivent être
réinitialisés** (le script ne les touche plus sans `SEED_REINITIALISER=oui`).
Aucun script n'a été exécuté contre une base réelle pendant cette mission.

---

### V15 — Backend FastAPI : documentation ouverte et CORS trop large

**État.** Exposition d'information et surface inutile ; **faible-moyenne**.

**Preuve avant.** `/docs`, `/redoc` et `/openapi.json` étaient servis à tout
le monde, et `allow_methods=["*"]` laissait le navigateur envoyer `PUT`,
`DELETE` et `PATCH` avec credentials jusqu'au routeur (qui répondait 405, mais
la requête était partie).

**Cause racine.** Valeurs par défaut de cadre applicatif non revues : la
documentation est un confort de développement, pas une route de production.

**Fichiers.** `backend/app/core/config.py`, `backend/app/main.py`,
`backend/tests/test_backend_auth.py`, `.env.example`, `README.md`.

**Correction.** Documentation fermée par défaut, rouverte par
`GF_BACKEND_DOCS=on` ; méthodes limitées à `GET`, `POST`, `OPTIONS` ; en-têtes
limités à `Authorization` et `Content-Type`. Les origines CORS restent nommées
et `*` reste refusé au démarrage.

**Test exact.** Huit tests ajoutés : documentation absente par défaut (404 sur
les trois chemins) et ouvrable par configuration ; `PUT`/`DELETE`/`PATCH` → 405
avec `Allow` ; route inconnue sans trace technique ; erreur de jeton sans
détail ; préflight refusé pour une origine non déclarée et accepté pour
l'origine déclarée, sans `DELETE`/`PUT` annoncés ; `/health` n'expose aucune
donnée.

**Résultat après.** `pytest -q` : **55 passed, 3 skipped**.

**Risque résiduel.** Aucun identifié. `GF_BACKEND_DOCS=on` reste une décision
d'exploitation, à ne pas poser en production.

---

### V16 — Le build exigeait une base configurée ; la CI ne testait pas le front

**État.** Défaut de détection, pas d'exposition directe ; **moyenne**.

**Preuve avant.** `src/db/admin.ts` construisait son pool au chargement du
module et levait si `DATABASE_URL_ADMIN`/`DATABASE_URL` manquaient. Next évalue
les modules de route au build : `npm run build` échouait sur une machine sans
base. La parade employée jusqu'ici — fournir une URL factice — transformait un
échec de configuration en réussite trompeuse. Par ailleurs,
`.github/workflows/ci.yml` n'exécutait que `pytest` et `npm run build` : ni
typage, ni lint, ni tests unitaires, ni tests SQL, ni tests HTTP.

**Cause racine.** Effet de bord à l'import dans un module de configuration, et
workflow réduit au minimum historique.

**Fichiers.** `src/db/admin.ts`, `tests/unit/admin-pool.test.ts` (nouveau),
`.github/workflows/ci.yml`, `package.json`.

**Correction.** Le pool devient `PoolAdministration` : il se construit sans se
connecter et ne vérifie sa configuration qu'à la **première requête**, en
conservant le message d'erreur d'origine. Le build réussit donc **sans aucune
variable**, ce que la CI exploite désormais sans poser de valeur factice. Le
workflow exécute `npm ci` strict, `typecheck`, `lint`, `test:unit`, `build`,
`test:sql`, `test:http`, `pytest` et `audit:sec` (production), en trois tâches
indépendantes.

**Test exact.** `tests/unit/admin-pool.test.ts` : sans URL, l'import réussit et
la première requête est refusée avec le message applicatif attendu (y compris à
travers l'emballage de Drizzle). Vérification manuelle :
`env -u DATABASE_URL -u DATABASE_URL_ADMIN npm run build` → **succès**.

**Résultat après.** `test:unit` **22/22** ; build sans variables **exit 0**.

**Risque résiduel.** Cf. §5.11 (avis outillage) et §5.5 (la CI n'a pas encore
tourné sur GitHub au moment de la rédaction ; elle est vérifiée localement,
commande par commande).

---

## 4. Contrôles déjà satisfaisants (vérifiés, non modifiés)

Ces points étaient déjà corrects au commit de référence. Ils ont été **testés** pour établir qu'ils le restent, sans être réécrits.

1. **RLS active et fail-closed.** Toutes les tables portant `organization_id` sont couvertes par des politiques `USING`/`WITH CHECK` avec `FORCE ROW LEVEL SECURITY` ; le rôle applicatif `geoforest_app` est `NOSUPERUSER NOBYPASSRLS`. Sans contexte de tenant, aucune ligne n'est visible. Preuve : `tests/sql/isolation.test.ts` (13/13), dont « sans contexte de tenant, aucune ligne n'est visible » et « un contexte pointant vers une organisation inconnue ne voit rien ».
2. **Tenant dérivé de la session, jamais du client.** `guard()` calcule `organizationId` à partir de `session.user.organizationId` et ouvre `withTenant()` (`set_config('app.current_org', …, true)`). Un `organizationId` en paramètre, en en-tête ou dans le corps n'est jamais lu. Preuve : test HTTP #16 (paramètres et en-têtes d'organisation ignorés) ; recherche `searchParams.get("organi…")` sans résultat.
3. **Autorisations côté serveur.** `guard(permission)` exige la permission avant toute lecture de corps. Un lecteur reçoit **403** sur les écritures et sur le journal, y compris en appelant l'API directement. Preuve : tests HTTP #6, #19 ; matrice de `src/lib/auth/roles.ts`.
4. **Clés étrangères composites inter-tenant.** `fk_gf_*_tenant` sur parcelles, documents, dossiers, lots et tâches : une référence croisée est rejetée par le moteur (`23503`). Preuve : `tests/sql/isolation.test.ts` (test dédié) et `var/preuve-fk.mts` (deux contraintes nommées).
5. **Suppression logique et journal scellé.** Le rôle applicatif n'a pas le privilège `DELETE` ; `gf_marquer_suppression()` ne marque que la ligne du tenant courant ; les déclencheurs `020`/`021` refusent `UPDATE`/`DELETE` sur le journal et scellent chaque ligne par un condensat chaîné. Preuve : tests SQL « la suppression physique est refusée au rôle applicatif », « la suppression logique ne marque que la ligne du tenant courant », « le journal d'audit est scellé à l'insertion et non modifiable » (erreur `42501`), `verifier_chaine_audit()` sans anomalie.
6. **URL signées liées au document, à la version, à l'organisation et à l'expiration.** Une signature émise pour le document A appliquée au document B répond **403** ; la même URL présentée par une session de B est refusée par l'organisation inscrite dans la signature ; sans signature, **403**. Preuve : test HTTP #20.
7. **Mots de passe et sessions.** Hachage scrypt, `DUMMY_HASH` pour égaliser le temps de réponse sur un compte inconnu, verrouillage de compte, cookies `HttpOnly; SameSite=Lax; Secure` en production, TOTP à fenêtre ±1 et codes de secours à usage unique. Preuve : revue de `src/lib/auth/{password,totp,session}.ts` ; tests HTTP #10 (compte suspendu), #11 (verrouillage MFA), #12 (rejeu de refresh).
8. **Idempotence cloisonnée.** `gf_idempotence` a une contrainte unique `(organization_id, portee, cle)` et une politique RLS ; une clé de A ne peut pas lire la réponse de B. Preuve : tests SQL dédiés.
9. **Erreurs sans secrets.** `guard()` renvoie `{ detail, requestId }` pour les 500, `{ error: { code, message } }` pour les 401/403, et des statuts distincts (400 corps illisible, 413 trop gros, 422 valeur, 423 verrou, 429 cadence, 503 persistance). Preuve : tests HTTP #9, #23 ; `tests/unit/db-error.test.ts`.
10. **Supervision protégée.** `/api/metrics` et `/api/observability/alertes` exigent `GF_METRICS_TOKEN` (comparaison de condensats en temps constant), et le contrôle est refait dans la route, pas seulement dans le proxy.
11. **Privilèges effectifs du rôle applicatif.** Vérifiés par interrogation du
    catalogue sous la connexion applicative elle-même : `geoforest_app` est
    `NOSUPERUSER NOBYPASSRLS`, ne détient ni `DELETE` ni `TRUNCATE` sur les
    tables métier, n'a pas le droit de créer dans `public`, et la RLS est
    **forcée** sur toutes les tables portant `organization_id`. Preuve :
    `tests/sql/privileges.test.ts` (10/10) et
    `tests/sql/connexion-applicative.test.ts` (8/8), qui se connectent au
    serveur PGlite par un relais TCP appliquant `SET ROLE geoforest_app`.
12. **Aucun secret réel versionné.** `git grep` sur les motifs usuels ne trouve que des valeurs de démonstration (`postgres:postgres`) et le mot de passe de jeu de données `Trace!Demo2026x` — désormais **refusé** par
le script d'amorçage, qui exige une valeur fournie explicitement (voir §5.8).

---

## 5. Risques non vérifiés ou résiduels

Ces points ne sont **pas** des corrections ; ils sont documentés pour la recette et la mise en production.

1. **Limitation de cadence : partagée pour les actions sensibles, en mémoire ailleurs.** La connexion, le renouvellement, le changement de mot de passe et le second facteur passent désormais par `gf_login_attempts` (fenêtre en base, partagée entre instances, cf. V11/V12). Les autres routes (journal, exports, etc.) utilisent encore `src/lib/rate-limit.ts`, dont les fenêtres vivent dans la mémoire du processus : la limite y est multipliée par le nombre d'instances. Un stockage partagé reste nécessaire pour un déploiement horizontal complet.
2. **`GF_TRUSTED_PROXY_HOPS` est un fait de déploiement.** Une valeur trop basse fait compter l'adresse d'un mandataire (tout le monde partage un quota) ; une valeur trop haute laisse le client choisir son adresse. La valeur par défaut (1) doit être confirmée contre l'infrastructure réelle.
3. **Pas de test HTTP sous le rôle applicatif — limite mesurée, pas supposée.** PGlite n'ouvre qu'**une session** PostgreSQL : un `SET ROLE` posé par une connexion s'applique à toutes les autres, ce qui casse la connexion d'administration dont dépend l'authentification (401 `compte_inconnu`). Le harnais HTTP ne peut donc pas tourner sous `geoforest_app` ; cette limite est écrite en tête de `tests/http/harness.ts` et les preuves sont conservées (`var/preuves/06`, `07`). Les privilèges et la RLS sont prouvés **séparément**, sous le rôle réel, par `tests/sql/*` **et désormais sur PostgreSQL serveur** (`scripts/recette/`, 21 assertions). Ce qui reste non prouvé : le parcours HTTP de bout en bout sous `geoforest_app` et la recette sur l'hébergeur réel.
4. **Backend mono-tenant.** Le jeton de service ferme l'accès, mais tout porteur voit les données de l'unique base SQLite. Il ne doit jamais être exposé à plusieurs organisations ni publié au-delà de `127.0.0.1`.
5. **CI : vérifiée sur GitHub.** Le workflow exécute typage, lint, tests unitaires, build, tests SQL, tests HTTP, `pytest` et l'audit des dépendances de production, sans aucune variable factice (V16). Il a été observé **vert** sur les SHA successifs de la branche, y compris `9ab78e6` en `push` et en `pull_request` (PR #8), trois tâches à chaque fois. Il ne couvre en revanche **pas** la recette PostgreSQL serveur : elle demande un cluster, donc un service externe que la CI n'a pas.
6. **Dépendances : production assainie, outillage à surveiller.** `source-map-js` est forcé en `1.2.2` (V13) et `npm audit --omit=dev` ne signale **plus aucune vulnérabilité**. En revanche, `npm audit` complet signale `braces@3.0.3` (chaîne `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch`), avis **high** `GHSA-vfj7-8cjw-p6xm` publié le 18/09/2026. Recontrôlé le 19/10/2026 : plage `<= 3.0.3`, **`first_patched_version: null`** — aucune version corrigée n'existe, et 3.0.3 est la dernière publiée. Dépendance de **développement** uniquement, jamais chargée en production ; les motifs analysés viennent de la configuration, pas d'une entrée utilisateur. `audit:sec` contrôle la production à 0 ; `audit:dev` **échoue** volontairement et reste le signal de suivi (voir R2, § 10.2).
7. **Stockage et intégrations non réels.** Le chemin « pièce absente » est testé ; S3, l'analyse antivirus, SMTP et les webhooks ne le sont pas. Les erreurs de ces intégrations peuvent avoir leurs propres fuites de détail.
8. **Comptes de démonstration déjà créés.** Le script refuse désormais de s'exécuter sans mot de passe fourni, en production, sur une base distante non autorisée, et ne réinitialise les comptes existants que sur `SEED_REINITIALISER=oui` (V14). Le mot de passe historique reste toutefois **public** : toute base qui l'a reçu doit voir ces comptes réinitialisés ou supprimés. L'inventaire est désormais outillé (`npm run verif:comptes-demo`, lecture seule, testé) et la procédure écrite (`docs/EXPLOITATION-secrets-et-audit.md` § 3). **L'inventaire des bases concernées n'est pas établi et aucune rotation n'a été exécutée** : voir R3, § 10.3.
9. **Vérification de chaîne non planifiée.** `verifier_chaine_audit()` est appelée à la lecture de l'historique et par le script `verifier-chaine.ts` ; aucun contrôle périodique n'est câblé dans l'exploitation.
10. **FK composites et suppression physique.** Les clés `ON DELETE SET NULL` portent sur `(id, organization_id)` : si un `DELETE` physique était un jour autorisé, PostgreSQL mettrait les deux colonnes à `NULL`, ce que le `NOT NULL` d'`organization_id` refuserait. C'est cohérent avec l'interdiction de destruction, mais toute évolution du privilège `DELETE` doit être rouverte avec cette contrainte en tête.
11. **Avis `braces` sans correctif.** Décrit au §5.6 : dépendance de développement, aucune version corrigée publiée. À revoir quand `braces` ou `fast-glob` publieront une version corrigée ; `npm run audit:dev` le signalera.
12. **Rotation des secrets.** `AUTH_SECRET`, `GF_METRICS_TOKEN`, `GF_BACKEND_TOKEN` et le secret de signature des URL n'ont pas de procédure de rotation *testée*. La procédure est désormais écrite et complète (`docs/EXPLOITATION-secrets-et-audit.md` § 2), y compris l'ordre, la validation et le retour arrière ; elle n'a pas été exécutée. Une rotation invalide toutes les sessions (ou toutes les URL) ; il n'existe pas de période de recouvrement à deux secrets.
13. **`DATABASE_URL_ADMIN` doit porter `BYPASSRLS`.** L'authentification et l'écriture du journal d'audit s'exécutent hors contexte d'organisation : sur une base à RLS forcée, ce rôle doit contourner la RLS (c'est le cas de `neondb_owner` sur Neon, et c'était déjà le cas en pratique). Ce qui change depuis la phase 3 : le serveur **refuse de démarrer** sans cet attribut (V18) au lieu d'échouer plus tard en « compte inconnu ». Toute nouvelle cible d'hébergement doit en tenir compte, et `verifier-chaine.ts` doit tourner avec le même type de rôle.

---

## 6. Reproductibilité

Tout s'exécute **sans base externe, sans conteneur, sans secret** : les tests
SQL et HTTP utilisent PGlite (PostgreSQL embarqué en WASM) et le build n'exige
plus aucune variable.

```bash
npm ci                 # lockfile strict (vérifié : npm ci --dry-run, exit 0)
npm run test:unit      # 36/36
npm run test:sql       # 42/42   (PGlite, rôles réels)
npm run test:http      # 25/25   (démarre next dev + un socket PGlite)
PG_BIN=… bash scripts/recette/postgresql-recette.sh   # PostgreSQL 16.2 jetable
npm run typecheck      # 0 erreur
npm run lint           # 0 erreur
npm run build          # succès, SANS variable de base (V16)
npm run audit:sec      # 0 vulnérabilité de production
npm run audit:dev      # échoue : avis braces, outillage, sans correctif (§5.6)
cd backend && pytest -q  # 55 passed, 3 skipped
```

Ces commandes sont exactement celles du workflow `.github/workflows/ci.yml`
(§7), à une différence près : en local, `npm ci` a été remplacé par `npm
install --ignore-scripts` pour ne pas reconstruire `node_modules` à chaque
essai ; l'installation stricte a été validée séparément.

Les sorties sont conservées dans `var/preuves/` (répertoire ignoré par Git) :

- `01-avant-references-croisees.log` — 500 sur DDS et lots ;
- `02-cause-racine-fk.txt` — noms des contraintes composites rejetées ;
- `03-apres-references-croisees.log` — 404 après correction ;
- `04-avant-fuite-cle-stockage.log` — 500 avec `storageKey` ;
- `05-apres-fuite-cle-stockage.log` — 500 sans détail interne ;
- `06-limite-role-global-pglite.log` — 401 `compte_inconnu` après `SET ROLE`
  dans le harnais HTTP : la session unique de PGlite, mesurée ;
- `07-session-unique-pglite.txt` — la même limite, établie sur le pilote seul ;
- `08-phase2-suites.log` — suites unitaires, SQL et HTTP sur le SHA final ;
- `09-phase2-backend-build-audit.log` — `pytest`, build sans variables, audits ;
- `10-phase2-avis-braces.txt` — avis `GHSA-vfj7-8cjw-p6xm`, sans correctif ;
- `11-avant-023-fonctions-auth.log` — `privileges` 9/10 sans `023` : la fonction
  d'authentification reste exécutable par le rôle applicatif (V10) ;
- `12-recette-postgresql-serveur.log` — les 9 étapes de la recette serveur ;
- `13-phase3-unitaire-lint.log`, `14-phase3-sql-http.log` — suites sur le SHA final ;
- `15-phase3-build-audit.log` — build sans variables, `audit:sec`, `audit:dev`.

### Inventaire des tests

| Fichier | Tests | Objet | Phase |
|---|---|---|---|
| `tests/unit/public-paths.test.ts` | 2 | liste exacte des routes publiques | 1 |
| `tests/unit/rate-limit.test.ts` | 8 | `X-Forwarded-For`, validation d'adresse | 1 |
| `tests/unit/db-error.test.ts` | 3 | 503 sans fuite, erreur métier / indisponibilité | 1 |
| `tests/unit/seed-gardes.test.ts` | 8 | refus de l'amorçage (mot de passe, production, hôte, réinitialisation) | 2 |
| `tests/unit/admin-pool.test.ts` | 1 | pool d'administration différé : build sans base | 2 |
| `tests/unit/routes-garde.test.ts` | 5 | inventaire des 39 routes : aucune sans garde déclarée | 3 |
| `tests/unit/controle-role-admin.test.ts` | 3 | rôle d'administration soumis à la RLS refusé au démarrage | 3 |
| `tests/unit/comptes-demo.test.ts` | 6 | règle d'alerte de l'inventaire des comptes de démonstration | 3 |
| `tests/sql/refresh-consommation.test.ts` | 3 | consommation unique, rejeu, révocation de famille | 1 |
| `tests/sql/isolation.test.ts` | 13 | RLS par table, suppression logique, FK composites, journal scellé, idempotence | 1 |
| `tests/sql/privileges.test.ts` | 12 | privilèges effectifs, RLS forcée, RPC révoquées, surcharges, `SECURITY DEFINER`, colonnes de secret | 2-3 |
| `tests/sql/connexion-applicative.test.ts` | 8 | connexion réelle sous `geoforest_app`, échec fermé, écritures croisées | 2 |
| `tests/sql/cadence-partagee.test.ts` | 6 | fenêtre partagée, atomicité, expiration, unicité de clé | 2 |
| `tests/http/isolation.test.ts` | 25 | parcours HTTP réels : 401/403/404, MFA, refresh, journal, URL signées, cadence, base coupée | 1-2 |
| `backend/tests/test_backend_auth.py` | 14 | jeton de service, échec fermé, CORS, documentation, méthodes, erreurs | 1-2 |
| `tests/helpers/relais-role.ts` | — | relais TCP qui applique `SET ROLE` sur la connexion PGlite | 2 |
| `scripts/recette/recette-serveur.test.ts` | 21 | **PostgreSQL serveur** : rôles, RLS, secrets, journal, cadence concurrente | 3 |

Total en CI : **36 tests unitaires + 42 tests SQL + 25 tests HTTP + 55 tests
backend**. Hors CI (demande un serveur PostgreSQL) : **21 assertions de recette**,
plus les 9 étapes du script d'orchestration.

### Fichiers modifiés

- **Authentification / proxy (phase 1)** : `src/proxy.ts`,
  `src/lib/auth/{public-paths,refresh-consommation,session}.ts`,
  `src/app/api/v1/auth/{login,mfa}/route.ts`.
- **Authentification / cadence (phase 2)** : `src/lib/auth/cadence-partagee.ts`
  (nouveau), `src/lib/auth/session.ts`,
  `src/app/api/v1/auth/{refresh,password,mfa}/route.ts`.
- **Erreurs et cadence (phase 1)** : `src/lib/api/db-error.ts`,
  `src/lib/rate-limit.ts`.
- **Données** : `src/app/api/v1/{audit-logs,due-diligence,shipments}/route.ts`,
  `src/app/api/v1/documents/[id]/download/route.ts`.
- **Base et exploitation** : `src/db/admin.ts`,
  `scripts/sql/post-migrate/{023_fonctions_auth_revoquees,024_cadence_cle_unique}.sql`
  (nouveaux), `scripts/seed-gardes.ts` (nouveau), `scripts/seed-auth.ts`,
  `scripts/check-p106-regles.ts`.
- **Backend** : `backend/app/core/config.py`, `backend/app/main.py`,
  `backend/tests/test_backend_auth.py`, `backend/app/api/v1/endpoints.py`,
  `backend/app/core/security.py`.
- **Recette et exploitation (phase 3)** :
  `scripts/recette/postgresql-recette.sh` et
  `scripts/recette/recette-serveur.test.ts` (nouveaux),
  `scripts/verifier-comptes-demo.ts` (nouveau), `scripts/verifier-chaine.ts`
  (exposé en script), `scripts/sql/post-migrate/010_row_level_security.sql`
  (V17, V19), `src/db/controle-role.ts` et `src/instrumentation.ts` (V18),
  `tests/sql/privileges.test.ts`.
- **Intégration** : `.github/workflows/ci.yml`, `package.json`,
  `package-lock.json`, `.env.example`, `README.md`, `docker-compose.yml`,
  `docs/EXPLOITATION-secrets-et-audit.md` (nouveau).
- **Banc d'essai** : `tests/**` et `scripts/recette/**` (voir tableau ci-dessus).

---

## 7. Intégration continue

`.github/workflows/ci.yml` a été réécrit **sans retirer aucun déclencheur** :
`push` et `pull_request` sur `main`, et `workflow_dispatch`, sont conservés.
`arena/**` est ajouté aux deux filtres pour que les branches de travail — dont
celle-ci — soient vérifiées avant toute fusion ; une demande de fusion depuis
`security/**` ou `forest/**` vers `main` reste couverte par le filtre `main`, et
ces chantiers gardent leur propre workflow sur leur branche (aucun fichier de
leur branche n'est modifié par ce travail).

| Tâche | Contenu | Pourquoi séparée |
|---|---|---|
| `frontend` | `npm ci` strict, `typecheck`, `lint`, `test:unit`, `build`, `audit:sec` | échec de typage ou de build visible sans attendre la base |
| `base-et-http` | `npm ci` strict, `test:sql`, `test:http` | contrats de données et HTTP, sans serveur externe (PGlite) |
| `backend` | `pytest -q` | indépendance du front |

Trois principes ont guidé l'écriture :

1. **Aucune valeur factice.** Pas de `DATABASE_URL` de complaisance : le build
   doit réussir sans, et il réussit (V16). Si un jour il échoue faute de
   configuration, la CI doit le dire.
2. **Aucun secret requis.** Les tests SQL et HTTP tournent sur PGlite ; le
   backend tests pose son propre jeton factice dans `backend/tests/conftest.py`.
   Le workflow n'a donc besoin d'aucun secret de dépôt.
3. **`npm ci` strict**, sans le `|| npm install` d'avant : un lockfile
   désynchronisé doit échouer, pas être contourné.

---

## 8. Phase 3 — intégration, recette PostgreSQL serveur, levée des risques

Cette phase répond à une exigence précise : **ne rien déclarer résolu sur la
foi d'une intention, d'un script préparé ou d'un test exécuté ailleurs que dans
l'environnement qu'il prétend valider**. Chaque affirmation ci-dessous est
accompagnée de la commande exacte, du résultat observé, du SHA testé et de la
preuve conservée.

### 8.1 Chantier A — état Git réel et demande de fusion

**État : terminé.**

**Constat initial, et un écart à signaler.** L'espace de travail de cette
session avait été reconstitué à partir de `1c95f4c` : l'arbre de travail
contenait bien les 24 fichiers non suivis annoncés, mais les huit commits de
la branche n'étaient pas présents localement, et `HEAD` pointait sur la base.
La vérification a établi, fichier par fichier, que **les 221 fichiers suivis
de `256acdc` étaient identiques, octet pour octet, à l'arbre local**
(`git hash-object` comparé à `git rev-parse FETCH_HEAD:<fichier>` : 221
identiques, 0 absent, 0 différent). Aucune modification étrangère, aucun
fichier inconnu, aucune perte n'a donc été introduite par le réalignement
(`git reset --soft` + `git read-tree`, sans `--hard`, sans perte de fichier).
`HEAD` a ensuite été replacé sur le SHA distant réel.

| Vérification | Résultat |
|---|---|
| Dépôt | `https://github.com/Huberaya/Geoforest.git` |
| Branche courante | `arena/569eff1a-geoforest` |
| `HEAD` au départ de la phase 3 | `256acdcc9bed022685db41a0581fbd1703eb32bb` (confirmé par `git ls-remote`) |
| `origin/main` | `1c95f4c585ed8303f887089ae7450c9235523fd0` — **inchangée** |
| Modifications locales / fichiers non suivis / conflits | aucun (`git status --porcelain -uall` vide) |
| Graphe | 8 commits sur `1c95f4c`, linéaire, aucun merge |
| Diff cumulatif à l'ouverture de la phase 3 | 50 fichiers, +4812 / −609 (24 ajouts, 0 suppression) |
| Diff cumulatif après la phase 3 (PR #8) | **60 fichiers, +6400 / −612** (31 ajouts, 0 suppression), 9 commits |
| `data/frontieres/` | **absent** — et ignoré (`data/` est dans `.gitignore`) ; aucune donnée géographique versionnée dans ce diff |
| Secrets dans le diff | recherche par motifs (`api_key`, `secret`, `password`, `token`, `AKIA…`, `ghp_…`, `sk-…`, clés privées) : uniquement des noms de variables, des libellés de test et de la documentation. Aucune valeur exploitable |
| Fichiers binaires ou générés | aucun ; plus gros ajout : le rapport lui-même (798 lignes) |
| Conflits | aucun |

**Cause racine de l'écart.** L'état de session avait été reconstitué sans les
objets Git de la branche ; rien n'indique une modification du contenu. La
preuve par empreintes, plutôt que par confiance dans le récit, est ce qui
permet de l'affirmer.

**Demande de fusion.** Aucune PR n'existait pour cette branche (les six PR
existantes concernent les chantiers `forest/**` et `security/**`, avec d'autres
branches sources). La PR **[#8](https://github.com/Huberaya/Geoforest/pull/8)**
a été créée : `arena/569eff1a-geoforest` → `main`, état `OPEN`,
`MERGEABLE`. Elle n'a **pas** été fusionnée, et aucun déploiement n'a été
déclenché par sa création.

### 8.2 Chantier B — audit de V10 et des fonctions privilégiées

**État : terminé.**

**Signatures et surcharges.** L'inventaire du catalogue sur la base de recette
donne exactement deux fonctions `auth_user_by_*`, sans surcharge :

```sql
select p.proname, pg_get_function_identity_arguments(p.oid) as args
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'auth\_user\_by\_%';
-- auth_user_by_email | p_email text
-- auth_user_by_id    | p_id uuid
```

Un test le verrouille : **une surcharge ajoutée plus tard** — par exemple
`auth_user_by_email(text, uuid)` — hériterait de `EXECUTE` pour `PUBLIC` par
défaut (PostgreSQL l'accorde à toute fonction créée) et échapperait au
`REVOKE`, qui porte sur une signature. Le test énumère l'inventaire complet,
puis vérifie qu'aucune de ces fonctions n'est exécutable par `geoforest_app`.

**Propriétaire, `SECURITY DEFINER`, ACL effectives** (base de recette, après
migration) :

| Fonction | `SECURITY DEFINER` | ACL |
|---|---|---|
| `auth_user_by_email(text)` | oui | `geoforest_owner=X` seulement |
| `auth_user_by_id(uuid)` | oui | `geoforest_owner=X` seulement |
| `gf_marquer_suppression(regclass, uuid, text)` | oui | `geoforest_owner`, `geoforest_app` |
| `current_org()` | non | `PUBLIC`, `geoforest_owner`, `geoforest_app` |
| `verifier_chaine_audit(uuid)` | non | `PUBLIC`, `geoforest_owner`, `geoforest_app` |
| `gf_audit_chainer()`, `gf_audit_empreinte()`, `gf_audit_refuser_modification()` | non | défaut (`PUBLIC`) |

Deux constats en découlent, tous deux vérifiés par test :

1. **Aucune autre fonction `SECURITY DEFINER` n'est exécutable par le rôle
   applicatif** que `gf_marquer_suppression`, qui revérifie elle-même le tenant
   (`022`). C'est désormais un test — une nouvelle fonction privilégiée
   accordée par mégarde fera échouer la suite.
2. **Les privilèges par défaut** (`alter default privileges … grant select,
   insert, update on tables`) ne s'appliquent qu'aux **tables**, jamais aux
   fonctions : une fonction créée plus tard n'est donc pas accordée
   automatiquement à l'application. C'est ce qui a rendu le défaut V10
   durablement invisible.

**Défaut supplémentaire trouvé par la recette — V19.** Le `GRANT SELECT` de
`010` portait sur la **table** `gf_users`, donc sur toutes ses colonnes. La RLS
limitait les lignes, pas les colonnes : sous le rôle applicatif et dans le
contexte d'un tenant, `select password_hash, mfa_secret from gf_users` était
autorisé. C'est la même donnée que celle exposée par V10, à l'échelle d'un
tenant au lieu de tous — sans aucun usage légitime : **toutes** les lectures de
`gf_users` du dépôt passent par `dbAdmin` (vérifié : chaque `from(users)`
importe `dbAdmin as db`).

**Correction (V19).** Le privilège de table est retiré et remplacé par une
liste explicite de colonnes non sensibles :

```sql
revoke select on gf_users from geoforest_app;
grant select (id, organization_id, email, name, role, status,
              created_at, updated_at, password_updated_at, token_version,
              last_login_at, failed_logins, locked_until)
  on gf_users to geoforest_app;
```

Conséquence assumée : `select * from gf_users` échoue désormais sous ce rôle,
et une colonne ajoutée demain n'est pas lisible par accident. Les tests
vérifient les trois refus (`password_hash`, `mfa_secret`, `mfa_recovery_codes`,
`select *`) **et** que les colonnes lisibles le restent.

**Usages légitimes préservés.** Le propriétaire conserve `EXECUTE` sur les deux
fonctions (test de privilège), et l'appel réel est vérifié par la recette
(étape 6b), avec l'attribut que la production lui connaît.

### 8.3 Chantier C — recette sur PostgreSQL serveur isolé

**État : terminé** — c'est le contrôle qui manquait aux phases précédentes.

**Environnement, et pourquoi il est sûr.** Aucun PostgreSQL serveur n'était
installé dans l'espace de travail ; un binaire PostgreSQL 16.2 a été obtenu par
le paquet Python `pgserver` (binaires officiels, 11 Mo, installés **hors** du
dépôt). Le script `scripts/recette/postgresql-recette.sh` crée ensuite :

- un **cluster neuf** dans un répertoire temporaire, sur un port dédié,
  `initdb --auth=trust`, écoute sur `127.0.0.1` seulement ;
- une base `geoforest_recette` dont le propriétaire, `geoforest_owner`, est
  `NOSUPERUSER NOBYPASSRLS` — donc **soumis à `force row level security`**,
  cas plus exigeant que la production ;
- des mots de passe **tirés au sort à chaque exécution** (`openssl rand`),
  jamais affichés, jamais écrits dans le dépôt ;
- des données **synthétiques** uniquement ;
- **destruction complète** du cluster en fin d'exécution, y compris en cas
  d'échec (`trap … EXIT`).

Aucune base réelle, partagée ou de production n'a été contactée. Aucune
migration n'a été appliquée ailleurs que sur ce cluster jetable.

**Résultats — `bash scripts/recette/postgresql-recette.sh` (PostgreSQL 16.2)**

| Étape | Contenu | Résultat |
|---|---|---|
| 1–2 | cluster, rôles, base | `geoforest_app : login=true, bypassrls=false, super=false` |
| 3 | migrations sur base neuve, propriétaire sans `BYPASSRLS` | 7 migrations + 6 scripts de sûreté, `RLS : 13/13`, 34 politiques |
| 4 | mot de passe du rôle applicatif posé par l'exploitant | ok |
| 5 | reprise de la migration | schéma déjà à jour ; **aucune réouverture** des fonctions d'authentification |
| 6 | `recette-serveur.test.ts` | **21/21** |
| 6b | usage légitime de l'authentification | `auth_user_by_email` et `auth_user_by_id` répondent au propriétaire |
| 7 | `024` sur base déjà migrée avec doublons | **1 ligne, 5 essais** (compteurs cumulés) |
| 8 | intégrité du journal | chaîne intacte → code 0 ; ligne falsifiée par superutilisateur → **détectée**, code 1 |
| 9 | inventaire des comptes de démonstration | avant rotation → signalé (code 1) ; après → code 0 |

Les 21 assertions de l'étape 6 couvrent, **sous le rôle applicatif réel et sur
un serveur qui a de vraies sessions concurrentes** : rôle et attributs
effectifs, RLS activée **et forcée** sur les 13 tables à `organization_id`,
absence de `DELETE`/`TRUNCATE`, refus de `CREATE`, échec fermé hors contexte,
cloisonnement par contexte, non-persistance du contexte hors transaction,
écriture et modification croisées refusées, clé étrangère composite (`23503`),
fonctions d'authentification inaccessibles, colonnes de secret inaccessibles,
`select *` refusé, colonnes non sensibles lisibles, journal scellé et
`verifier_chaine_audit` sans anomalie, marquage de suppression limité au
tenant, index unique réel, doublon refusé (`23505`), **20 appels simultanés sur
8 connexions → 9 autorisés / 11 refusés, une seule ligne, compteur à 20**,
compteur partagé entre deux instances, expiration de fenêtre et remise à zéro.

**Deux défauts trouvés par cette recette, et corrigés.**

**V17 — la post-migration entière échouait sur un rôle de migration ordinaire.**
`010_row_level_security.sql` exécutait sans condition :

```sql
execute 'alter role geoforest_app nobypassrls';
```

Or PostgreSQL exige, pour changer cet attribut, que **l'auteur** de la commande
porte lui-même `BYPASSRLS` ou soit superutilisateur. Mesuré sur 16.2 :

```
ERROR:  permission denied to alter role
DETAIL:  Only roles with the BYPASSRLS attribute may change the BYPASSRLS attribute.
```

L'instruction échouait donc **même quand le rôle applicatif n'avait déjà pas
l'attribut**, c'est-à-dire quand il n'y avait rien à corriger. Le script
s'exécutant en une seule transaction, l'échec annulait **toute** la
post-migration : schéma migré, **RLS non installée**, politiques absentes,
et pour seul signal un `exit 1`. Sur un PostgreSQL auto-hébergé avec un rôle
propriétaire ordinaire, le cloisonnement n'aurait jamais été posé.

*Correction :* l'ordre n'est exécuté que si l'attribut est réellement présent,
puis l'invariant est **vérifié** et son échec est franc (`raise exception`).
La garantie est identique — `geoforest_app` ne peut pas rester `BYPASSRLS` —
l'exigence de privilège disparaît.

**V18 — l'authentification échouait silencieusement.** Sur cette même base,
`auth_user_by_email('b@exemple.test')` rendait **zéro ligne** : le propriétaire
sans `BYPASSRLS` est soumis à la RLS forcée, y compris à l'intérieur d'une
fonction `SECURITY DEFINER`. La connexion aurait répondu « compte inconnu »,
et l'incident aurait été diagnostiqué comme un mauvais mot de passe. Rien au
démarrage ne signalait que `DATABASE_URL_ADMIN` ne pouvait pas lire hors
contexte.

*Correction :* `verifierRoleAdministration()` mesure
`row_security_active('gf_users')` sur la connexion d'administration et
`src/instrumentation.ts` refuse le démarrage en production si la RLS s'y
applique. Le message nomme la cause et la correction. Testé par
`tests/unit/controle-role-admin.test.ts` (3 cas) et par la recette
(étape 6b), qui vérifie les deux côtés : sans l'attribut, la RLS s'applique
bien ; avec, l'authentification fonctionne.

**Limites de cette recette, explicitement.**

- Elle tourne sur **PostgreSQL 16.2 local**, pas sur l'infrastructure
  d'hébergement (Neon). Les versions et les rôles de l'hébergeur restent à
  confirmer par une recette sur une branche éphémère de l'environnement réel.
- Le chemin HTTP complet (`next dev` + rôle applicatif) n'a pas été rejoué sur
  serveur : le banc HTTP reste sur PGlite et superutilisateur. Ce qui est
  prouvé sur serveur, c'est l'**accès aux données** sous le rôle réel, pas le
  parcours HTTP de bout en bout sous ce rôle.
- La restauration après échec de migration n'est **pas** démontrée : `023` et
  `024` n'ont pas de script descendant (`024` en aurait un : supprimer l'index,
  ce qui rouvrirait le défaut ; il n'est délibérément pas fourni). Ce qui est
  démontré, c'est la **reprise** (rejeu idempotent) et le refus franc en cas
  d'incohérence.

### 8.4 Chantier D — autres correctifs

**D1 — authentification et sessions. État : terminé.**

Un test structurel (`tests/unit/routes-garde.test.ts`, 5 cas) parcourt les
**39 routes API** et exige que chacune soit, soit déclarée publique avec sa
justification, soit protégée par `guard()` ou `getSession()` visibles dans le
fichier. Il vérifie en outre que la liste publique du test correspond
exactement à celle du proxy, qu'aucune route publique n'interroge une table
métier, et que les routes d'écriture portent toutes une garde (13 routes).
C'est la réponse structurelle au défaut V1 : les tests HTTP prouvent des
parcours, celui-ci prouve l'**inventaire**.

**D2 — amorçage des comptes. État : terminé côté code ; opérations non
exécutées.** Voir `docs/EXPLOITATION-secrets-et-audit.md` §3 et le risque R3
ci-dessous.

**D3 — dépendances. État : production assainie, outillage en risque résiduel
documenté.** `source-map-js` est verrouillé en `1.2.2` (surcharge ciblée,
`npm ls source-map-js` → `1.2.2 deduped`) ; `npm run audit:sec` (production,
`--omit=dev --audit-level=high`) → **0 vulnérabilité**. `npm run audit:dev`
échoue sur `braces` (voir R2). Aucun audit ne permet de conclure que les
dépendances de développement sont sans risque : c'est écrit tel quel.

**D4 — documentation et CORS. État : terminé.** `/docs`, `/redoc` et
`/openapi.json` répondent **404** par défaut (test), et s'ouvrent par
`GF_BACKEND_DOCS=on`. CORS : méthodes limitées à `GET, POST, OPTIONS`,
en-têtes à `Authorization, Content-Type`, origine `*` refusée au démarrage ;
préflight accepté pour l'origine déclarée, refusé pour une autre. Ces tests
n'élargissent aucun droit : ils constatent la restriction.

### 8.5 Chantier E — validations sur le SHA réellement testé

**État : terminé.**

Commandes exactes et résultats, sur `9ab78e645db0b0b6d5b5bb09b975acb4641c84ad` :

| Commande | Résultat | Preuve |
|---|---|---|
| `npm ci` (lockfile strict) | exit 0 | `var/preuves/…` |
| `npm run typecheck` | 0 erreur | `13-phase3-unitaire-lint.log` |
| `npm run lint` | 0 erreur, 5 avertissements | idem |
| `npm run test:unit` | **36/36** | idem |
| `npm run test:sql` | **42/42** | `14-phase3-sql-http.log` |
| `npm run test:http` | **25/25** | idem |
| `npm run build` **sans variable de base** | succès | `15-phase3-build-audit.log` |
| `npm run audit:sec` | 0 vulnérabilité (production) | idem |
| `npm run audit:dev` | **échec attendu** : 5 avis `braces` (outillage) | idem |
| `pytest -q` | 55 passed, 3 skipped | idem |
| `bash scripts/recette/postgresql-recette.sh` | 9 étapes, 21 assertions | `12-recette-postgresql-serveur.log` |

Aucune de ces commandes n'est enrobée de `|| true` ni d'un `--force`. Aucun
test n'a été modifié pour passer : les deux adaptations de tests de cette phase
(`privileges.test.ts`) **renforcent** l'assertion — elles remplacent un contrôle
de lignes par un contrôle de colonnes, après que la correction a rendu la
lecture impossible.

## 9. Vérification sur le SHA final

**Commit de vérification : `9ab78e645db0b0b6d5b5bb09b975acb4641c84ad`**
(parent `256acdcc9bed022685db41a0581fbd1703eb32bb`, base
`1c95f4c585ed8303f887089ae7450c9235523fd0`).

| Commande | Résultat | Où |
|---|---|---|
| `npm ci` (lockfile strict) | exit 0 | local, Node 22.22.3 |
| `npm run typecheck` | 0 erreur | local |
| `npm run lint` | 0 erreur, 5 avertissements | local |
| `npm run test:unit` | **36/36** | local |
| `npm run test:sql` | **42/42** | local, PGlite 0.5.10 |
| `npm run test:http` | **25/25** | local, `next dev` |
| `npm run build` **sans variable de base** | succès | local |
| `npm run audit:sec` | 0 vulnérabilité de production | local |
| `npm run audit:dev` | échec **attendu** (avis `braces`, outillage) | local |
| `pytest -q` | 55 passed, 3 skipped | local, Python 3.12 |
| `bash scripts/recette/postgresql-recette.sh` | **9 étapes, 21 assertions** | local, PostgreSQL 16.2 jetable |

**CI GitHub sur ce SHA** — deux exécutions, toutes deux vertes, trois tâches
`frontend`, `base-et-http`, `backend` en succès :

| Exécution | Événement | Commit | Conclusion |
|---|---|---|---|
| [39323921383](https://github.com/Huberaya/Geoforest/actions/runs/39323921383) | `push` | `9ab78e6` | succès |
| [39323950729](https://github.com/Huberaya/Geoforest/actions/runs/39323950729) | `pull_request` (PR #8) | `9ab78e6` | succès |

**Tête de branche au moment de la rédaction :**
`11ca162e7fc9fe2cb4d1ba10e7b49bd2fdebf1b7` (documentation seule) — CI observée
**verte** sur ce SHA exact, en `push` (exécution `39324238184`) et en
`pull_request` (exécution `39324246330`), trois tâches en succès. La chaîne
complète a par ailleurs été rejouée sur cet arbre : `typecheck` 0, `lint` 0
erreur, `test:unit` 36/36, `test:sql` 42/42, `test:http` 25/25, `build` sans
variables, `audit:sec` 0, `audit:dev` en échec attendu, `pytest` 55, recette
serveur 9/9.

**Commits postérieurs.** Le présent rapport est mis à jour par un commit qui ne
modifie **que ce fichier** : l'arbre du code, des migrations, des tests et des
scripts de recette reste exactement celui de `9ab78e6`. La PR #8 porte cet
arbre.

**Ce qui distingue, sans ambiguïté** :

1. **corrections présentes dans le code** — V1 à V19, fichiers listés au § 10.1 ;
2. **tests locaux réellement exécutés** — tableau ci-dessus, sur ce SHA ;
3. **tests CI réussis sur le SHA final** — les deux exécutions ci-dessus ;
4. **tests sur PostgreSQL serveur réellement exécutés** — recette § 8.3, sur un
   cluster **jetable et isolé**, pas sur l'infrastructure d'hébergement ;
5. **validations non exécutées** — recette sur Neon, rotation des secrets,
   planification de la vérification du journal, rotation des comptes de
   démonstration (§ 10.2) ;
6. **changements appliqués à une base réelle** — **aucun**. Aucune base
   partagée ou de production n'a été ouverte, migrée ou modifiée.

**Ce qui n'a pas été fait, et ne le sera pas sans autorisation** : aucun commit
sur `main`, aucune fusion de PR, aucun déploiement, aucune modification de
secret ni de réglage de production, aucune base partagée réinitialisée, aucun
test destructif sur des données réelles.

---

## 10. Phase 3 — levée des quatre risques résiduels

Statuts imposés, et employés sans nuance : `CORRIGÉ ET VÉRIFIÉ`,
`ATTÉNUÉ — RISQUE RÉSIDUEL`, `NON VÉRIFIÉ`, `BLOQUÉ`.

### 10.1 R1 — PGlite, rôle applicatif et validation PostgreSQL serveur

**État : `CORRIGÉ ET VÉRIFIÉ` pour la validation serveur ; la limite PGlite
reste un fait documenté.**

**État initial.** Les phases précédentes prouvaient la RLS sous `geoforest_app`
avec PGlite, et documentaient que le banc HTTP ne pouvait pas tourner sous ce
rôle. Ce document disait qu'une recette serveur restait nécessaire ; elle
n'existait pas.

**Cause.** PGlite n'ouvre **qu'une session** PostgreSQL : `SET ROLE` y est
global, ce qui casse la connexion d'administration dont l'authentification a
besoin. Aucun serveur PostgreSQL n'était disponible dans l'environnement de
travail, et rien n'avait été préparé pour en obtenir un.

**Correction / mesure.** Un PostgreSQL 16.2 réel est désormais utilisé, sur un
cluster jetable, avec les **rôles réels** et des données synthétiques
(`scripts/recette/`). Les 21 assertions s'exécutent sous `geoforest_app`, et
les scénarios concurrents sont réels (8 connexions).

**Fichiers.** `scripts/recette/postgresql-recette.sh`,
`scripts/recette/recette-serveur.test.ts`, `package.json`
(`recette:postgres`).

**Commande exacte.**
```bash
PG_BIN=/tmp/gfvenv2/lib/python3.11/site-packages/pgserver/pginstall/bin \
  bash scripts/recette/postgresql-recette.sh
```
**Résultat observé.** `✅ Recette PostgreSQL serveur terminée sans échec.` —
9 étapes, 21/21 assertions, exit 0. Journal : `var/preuves/12-…` (le journal de
la dernière exécution est régénéré à chaque lancement ; il est ignoré par Git).

**SHA testé.** `9ab78e6` (arbre du code identique à la tête de la PR).

**Preuve consultable.** `var/preuves/12-recette-postgresql-serveur.log`
(ignoré par Git) et la sortie reproductible de la commande.

**Risque résiduel.** La recette n'a pas été jouée sur l'infrastructure
d'hébergement (Neon) : versions, rôles et paramètres de l'hébergeur restent à
confirmer. Le chemin HTTP complet sous `geoforest_app` n'est pas rejoué non
plus — seule la couche d'accès aux données l'est.

**Pour lever le blocage restant.** Exécuter la même recette contre une branche
éphémère de l'environnement réel, avec `DATABASE_URL_ADMIN` fourni par
l'exploitation. Ce qui exige un accès absent aujourd'hui — d'où le statut
« vérifié pour le serveur isolé, non vérifié pour l'hébergeur ».

### 10.2 R2 — `braces` / GHSA-vfj7-8cjw-p6xm

**État : `ATTÉNUÉ — RISQUE RÉSIDUEL`.**

**État initial.** `npm audit` complet signalait `braces@3.0.3` (avis *high*
publié le 18/09/2026), via `eslint-config-next` → `@next/eslint-plugin-next` →
`fast-glob` → `micromatch` → `braces`.

**Recontrôle au 19/10/2026** (`api.github.com/advisories/GHSA-vfj7-8cjw-p6xm`) :
plage vulnérable `<= 3.0.3`, `first_patched_version: null` — **aucune version
corrigée n'existe**, et `3.0.3` est la dernière publiée. Il n'y a donc rien à
mettre à jour : toute « correction » par changement de version serait une
invention, et un `npm audit fix --force` rétrograderait `eslint-config-next`
(breaking change) pour un avis qui ne serait pas corrigé pour autant.

**Mesures prises.**
- `npm run audit:sec` = `npm audit --omit=dev --audit-level=high` : **0
  vulnérabilité de production** (exigence maintenue).
- `npm run audit:dev` = `npm audit --audit-level=high` : **échoue** (5 avis,
  `braces` et ses porteurs). Échec conservé, non masqué, non exclu par un
  `allowlist` : c'est le signal de suivi.
- Le chemin est **hors production** : `eslint-config-next` est une dépendance
  de développement, jamais chargée par l'application déployée.
- **Exposition résiduelle** : `braces` analyse des motifs de glob. Les motifs
  viennent de la configuration ESLint et du dépôt, pas d'une entrée
  utilisateur ; un attaquant devrait déjà contrôler le dépôt ou la CI pour
  atteindre la condition de déclenchement. L'impact est une exhaustion de pile
  dans le processus de lint.

**Commandes exactes et résultats.**
```
npm run audit:sec  → found 0 vulnerabilities            (exit 0)
npm run audit:dev  → 5 high severity vulnerabilities    (exit 1, attendu)
npm ls braces      → braces@3.0.3 via micromatch@4.0.8 via fast-glob@3.3.1
```
Preuve : `var/preuves/15-phase3-build-audit.log`, `var/preuves/10-phase2-avis-braces.txt`.

**Risque résiduel.** Un avis *high* subsiste dans l'outillage. Il n'est pas
caché : il est visible dans `audit:dev`, documenté ici, et rappelé au § 5.6.

**Décision de suivi.** Recontrôler à chaque montée de version de `next` /
`eslint-config-next` ; passer à `braces` corrigé dès qu'une version sort. Aucun
contournement du contrôle n'est mis en place, et **il n'est pas affirmé que
les dépendances de développement sont sans risque**.

### 10.3 R3 — comptes de démonstration et ancien mot de passe public

**État : `ATTÉNUÉ — RISQUE RÉSIDUEL`** (code corrigé et vérifié ; remédiation
des données **non exécutée**, faute d'autorisation et d'inventaire).

**État initial.** Cinq comptes — dont un administrateur — créés par
`scripts/seed-auth.ts` avec un mot de passe écrit dans le dépôt, et réinitialisés
silencieusement à chaque exécution.

**Correction (vérifiée).** `scripts/seed-gardes.ts`, 8 tests : mot de passe
obligatoire et jamais affiché, refus de la valeur publiée, longueur minimale,
refus en production, refus d'une base non locale sans autorisation explicite,
réinitialisation seulement sur `SEED_REINITIALISER=oui`, cumul des motifs de
refus.

**Ce qui manquait : l'inventaire et la vérification post-opération.** Ajout de
`scripts/verifier-comptes-demo.ts` (`npm run verif:comptes-demo`) — **lecture
seule**, aucun secret affiché : organisation, rôle, statut, date du dernier
changement de mot de passe, MFA. `--apres=AAAA-MM-JJ` signale les comptes
actifs dont le mot de passe n'a pas été changé depuis et sort en code 1.
Testé par `tests/unit/comptes-demo.test.ts` (6 cas) **et** par la recette
serveur (étape 9 : signalé avant rotation, silencieux après).

**Procédure de rotation.** `docs/EXPLOITATION-secrets-et-audit.md` § 3 :
inventaire, réinitialisation explicite ou désactivation, vérification
post-opération, et ce qui ne peut pas être affirmé.

**Commandes exactes.**
```
npm run test:unit                       → 36/36 (dont comptes-demo 6/6)
npm run verif:comptes-demo              → inventaire, code 0
npm run verif:comptes-demo -- --apres=… → code 1 tant qu'un compte reste à traiter
```
Recette, étape 9 : `compte non tourné : signalé (code 1)` puis
`compte tourné : plus signalé (code 0)`.

**SHA testé.** `9ab78e6`.

**Risque résiduel.** L'inventaire des bases ayant exécuté l'ancien script
**n'est pas établi**, et aucune base réelle n'a été ouverte. Les comptes
peuvent donc encore exister, actifs, avec le mot de passe public. Le risque
reste **ouvert** jusqu'à ce que l'exploitation exécute l'inventaire et la
rotation sur chaque environnement.

**Pour lever le blocage.** Autorisation d'accès aux environnements concernés,
puis : `npm run verif:comptes-demo` → rotation → `--apres=` → code 0. Aucune
de ces actions n'a été tentée sans autorisation.

### 10.4 R4 — limitation de débit, rotation des secrets, chaîne d'audit

**État : `CORRIGÉ ET VÉRIFIÉ` pour la limitation persistante et la détection
d'altération ; `ATTÉNUÉ — RISQUE RÉSIDUEL` pour la planification et la
rotation opérationnelle.**

**a) Limitation — inventaire et correction.** Les quatre actions qui
consomment un secret sont comptées **en base** et donc partagées entre
instances et persistantes : connexion (IP + e-mail), second facteur (60/min/IP),
changement de mot de passe (10/15 min/utilisateur), renouvellement (60/min/IP).
Les quotas génériques par IP et par organisation restent en mémoire,
**volontairement** : compter chaque requête en base ferait de la base le goulot
d'un déni de service. Cette distinction est écrite dans
`docs/EXPLOITATION-secrets-et-audit.md` § 1 et dans l'en-tête de
`cadence-partagee.ts`.

**Tests de seuil, de fenêtre et de concurrence** : `cadence-partagee` (6, sous
PGlite) **et** la recette serveur — 20 appels simultanés sur 8 connexions →
9 autorisés, 11 refusés avec `Retry-After` positif, **une seule ligne**,
compteur à 20 ; compteur partagé entre deux instances distinctes ; expiration
de fenêtre ; remise à zéro. C'est la première fois que la concurrence est
réellement exercée : PGlite ne le permettait pas.

**b) Rotation des secrets — documentée, non exécutée.** Procédure complète
(périmètre des cinq secrets, ordre, validation, retour arrière, prévention de
divulgation, ce qui n'est pas implémenté) dans
`docs/EXPLOITATION-secrets-et-audit.md` § 2. **Aucune valeur n'y figure, et
aucune rotation n'a été faite** : elle exige un accès aux environnements réels.

**c) Chaîne d'audit — détection démontrée, planification non déployée.**
`npm run verif:chaine` (existant, désormais exposé comme script) parcourt
chaque organisation, recalcule les condensats et sort en **code 1** à la
première anomalie. La recette serveur le prouve dans les deux sens : chaîne
intacte → code 0 (avec vérification qu'au moins une ligne a été lue, sinon le
résultat serait vide et donc non concluant) ; ligne falsifiée par un
**superutilisateur** (déclencheurs désactivés) → **détectée**, code 1.
La procédure périodique (cron, conservation de l'ancre hors base, consigne
d'alerte « ne pas réparer ») est écrite au § 4 du document d'exploitation,
mais **aucune tâche planifiée n'est déployée** : la cible dépend de
l'infrastructure, et le contrôle exige un rôle qui contourne la RLS.

**Un défaut trouvé précisément là** : lors du premier essai, le vérificateur
concluait « chaîne intacte » en ayant lu **zéro ligne**, parce que la connexion
d'administration était soumise à la RLS (V18). C'est ce qui a conduit au
contrôle de démarrage : sans lui, l'outil de contrôle d'intégrité aurait lui
aussi menti silencieusement.

**Commande exacte.** `npm run verif:chaine` (ou `--org=<uuid> --json`), avec
`DATABASE_URL_ADMIN` d'un rôle `BYPASSRLS`.

**Risque résiduel.** Aucune planification déployée, aucune alerte branchée sur
un canal réel, ancre non exportée automatiquement. La détection existe et est
prouvée ; sa **périodicité** reste à installer.

### 10.5 Tableau de clôture des risques

| Risque | Statut | Ce qui est prouvé | Ce qui reste à faire |
|---|---|---|---|
| R1 — PGlite / PostgreSQL serveur | `CORRIGÉ ET VÉRIFIÉ` (serveur isolé) | 21 assertions sous rôle réel, concurrence réelle, migrations, RLS, secrets, journal | recette sur l'hébergeur (Neon) |
| R2 — `braces` | `ATTÉNUÉ — RISQUE RÉSIDUEL` | production à 0 vulnérabilité ; échec `audit:dev` visible et documenté | recontrôle à chaque montée de version |
| R3 — comptes de démonstration | `ATTÉNUÉ — RISQUE RÉSIDUEL` | seed refusant 8 cas ; inventaire en lecture seule testé | inventaire et rotation sur chaque environnement réel |
| R4 — débit / secrets / audit | `CORRIGÉ ET VÉRIFIÉ` (code) · `ATTÉNUÉ` (exploitation) | fenêtres en base et concurrence ; altération détectée ; procédures écrites | planifier le contrôle, exécuter la rotation |

**Le chantier n'est donc pas « entièrement sécurisé »** au sens opérationnel :
trois actions de remédiation dépendent d'un accès ou d'une autorisation qui
n'était pas disponible. La clôture porte sur les corrections de code, vérifiées
et rejouées sur le SHA final.
