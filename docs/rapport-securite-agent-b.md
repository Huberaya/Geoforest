# Rapport de mission — Agent B

## Sécurité et qualité des parcours : isolation inter-tenant et autorisations

| | |
|---|---|
| Dépôt | `Huberaya/Geoforest` |
| Branche de travail | `arena/569eff1a-geoforest` |
| Commit de référence | `1c95f4c585ed8303f887089ae7450c9235523fd0` (`main` au moment de l'audit) |
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
| — | RLS, permissions, FK composites, URL signées, journal scellé, suppressions logiques | — | **Déjà satisfaisants** | tests SQL + HTTP (voir §4) |

**Résultats finaux** (arbre de travail de la branche) :

| Commande | Résultat |
|---|---|
| `npm run test:unit` | **13/13** |
| `npm run test:sql` | **16/16** (3 consommation de jetons + 13 isolation/RLS) |
| `npm run test:http` | **23/23** |
| `npx tsc --noEmit` | **0 erreur** |
| `pytest -q` (backend) | **47 passed, 3 skipped** |
| `npm run build` (avec variables d'environnement) | **succès** |

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
11. **Aucun secret réel versionné.** `git grep` sur les motifs usuels ne trouve que des valeurs de démonstration (`postgres:postgres`) et le mot de passe de jeu de données `Trace!Demo2026x`, surchargeable par `SEED_DEMO_PASSWORD` (voir §5).

---

## 5. Risques non vérifiés ou résiduels

Ces points ne sont **pas** des corrections ; ils sont documentés pour la recette et la mise en production.

1. **Limitation de cadence en mémoire, par instance.** `src/lib/rate-limit.ts` tient ses fenêtres dans la mémoire du processus. Derrière plusieurs instances, chaque instance a son propre compteur : la limite globale est multipliée par le nombre d'instances. Le verrouillage de connexion, lui, est en base (`gf_login_attempts`) et reste partagé. Un stockage partagé (Redis ou table) est nécessaire pour un déploiement horizontal.
2. **`GF_TRUSTED_PROXY_HOPS` est un fait de déploiement.** Une valeur trop basse fait compter l'adresse d'un mandataire (tout le monde partage un quota) ; une valeur trop haute laisse le client choisir son adresse. La valeur par défaut (1) doit être confirmée contre l'infrastructure réelle.
3. **Pas de test HTTP sous le rôle applicatif.** Les tests HTTP utilisent PGlite en superutilisateur : ils prouvent le filtrage des routes, pas l'application de la RLS sur ces routes. La RLS est prouvée séparément en SQL. Une recette sur PostgreSQL serveur, avec `DATABASE_URL` en `geoforest_app` et `DATABASE_URL_ADMIN` distinct, reste indispensable.
4. **Backend mono-tenant.** Le jeton de service ferme l'accès, mais tout porteur voit les données de l'unique base SQLite. Il ne doit jamais être exposé à plusieurs organisations ni publié au-delà de `127.0.0.1`.
5. **CI incomplète.** Aucun test front n'est exécuté par `.github/workflows/ci.yml` ; les nouveaux tests ne sont pas branchés. De plus, `npm run build` échoue si `DATABASE_URL`/`DATABASE_URL_ADMIN` ne sont pas définis (création du pool au chargement du module `src/db/admin.ts`) — comportement préexistant, observé sans variables. Le build réussit avec des variables de test. Ces deux points sont à traiter avec l'équipe CI.
6. **Dépendance `source-map-js@1.2.1`.** `npm audit --omit=dev` signale une vulnérabilité **high** transitive (DoS par source maps indexées, `GHSA-68fv-2mgg-jv7q`). Le correctif `1.2.2` existe. Aucun chemin d'exploitation par cette application n'a été démontré (elle ne traite pas de source maps client), mais la mise à jour est recommandée.
7. **Stockage et intégrations non réels.** Le chemin « pièce absente » est testé ; S3, l'analyse antivirus, SMTP et les webhooks ne le sont pas. Les erreurs de ces intégrations peuvent avoir leurs propres fuites de détail.
8. **Mot de passe de démonstration.** `scripts/seed-auth.ts` utilise `SEED_DEMO_PASSWORD ?? "Trace!Demo2026x"`. Le mot de passe est donc public dans le dépôt ; il ne doit jamais servir hors d'un jeu de données de démonstration. Le script n'a pas été exécuté sur une base réelle pendant cette mission.
9. **Vérification de chaîne non planifiée.** `verifier_chaine_audit()` est appelée à la lecture de l'historique et par le script `verifier-chaine.ts` ; aucun contrôle périodique n'est câblé dans l'exploitation.
10. **FK composites et suppression physique.** Les clés `ON DELETE SET NULL` portent sur `(id, organization_id)` : si un `DELETE` physique était un jour autorisé, PostgreSQL mettrait les deux colonnes à `NULL`, ce que le `NOT NULL` d'`organization_id` refuserait. C'est cohérent avec l'interdiction de destruction, mais toute évolution du privilège `DELETE` doit être rouverte avec cette contrainte en tête.
11. **Rotation des secrets.** `AUTH_SECRET`, `GF_METRICS_TOKEN`, `GF_BACKEND_TOKEN` et le secret de signature des URL n'ont pas de procédure de rotation testée. Une rotation invalide toutes les sessions (ou toutes les URL) ; elle doit être planifiée.

---

## 6. Reproductibilité

```bash
# Prérequis : Node 22, dépendances installées (npm ci)
npm run test:unit     # 13/13
npm run test:sql      # 16/16
npm run test:http     # 23/23 (démarre un next dev et un socket PGlite)
npx tsc --noEmit      # 0 erreur
pytest -q             # backend : 47 passed, 3 skipped

# Build (les variables sont nécessaires, voir §5.5)
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/geoforest \
DATABASE_URL_ADMIN=postgresql://postgres:postgres@127.0.0.1:5432/geoforest \
AUTH_SECRET=secret-de-build-suffisamment-long-0123456789 \
npm run build
```

Les résultats ci-dessous ont été obtenus sur le commit de travail de la branche (`git log -1`). Les preuves d'exécution avant/après sont conservées dans `var/preuves/` (répertoire ignoré par Git) :

- `01-avant-references-croisees.log` — 500 sur DDS et lots ;
- `02-cause-racine-fk.txt` — noms des contraintes composites rejetées ;
- `03-apres-references-croisees.log` — 404 après correction ;
- `04-avant-fuite-cle-stockage.log` — 500 avec `storageKey` ;
- `05-apres-fuite-cle-stockage.log` — 500 sans détail interne.

### Inventaire des tests ajoutés

| Fichier | Tests | Objet |
|---|---|---|
| `tests/unit/public-paths.test.ts` | 2 | liste exacte des routes publiques |
| `tests/unit/rate-limit.test.ts` | 8 | lecture de `X-Forwarded-For`, validation d'adresse |
| `tests/unit/db-error.test.ts` | 3 | 503 sans fuite, distinction erreur métier / indisponibilité |
| `tests/sql/refresh-consommation.test.ts` | 3 | consommation unique, rejeu, révocation de famille |
| `tests/sql/isolation.test.ts` | 13 | RLS par table, suppression logique, FK composites, journal scellé, idempotence |
| `tests/http/isolation.test.ts` | 23 | parcours HTTP réels : 401/403/404, MFA, refresh, journal, URL signées, erreurs |
| `backend/tests/test_backend_auth.py` | 6 | jeton de service, échec fermé, CORS |

### Fichiers de production modifiés

- Authentification / proxy : `src/proxy.ts`, `src/lib/auth/public-paths.ts`, `src/lib/auth/refresh-consommation.ts`, `src/lib/auth/session.ts`, `src/app/api/v1/auth/{login,mfa}/route.ts`.
- Erreurs et cadence : `src/lib/api/db-error.ts`, `src/lib/rate-limit.ts`.
- Données : `src/app/api/v1/{audit-logs,due-diligence,shipments}/route.ts`, `src/app/api/v1/documents/[id]/download/route.ts`.
- Backend : `backend/app/core/{config,security}.py`, `backend/app/api/v1/endpoints.py`, `backend/app/main.py`, `backend/tests/*`.
- Exploitation : `docker-compose.yml`, `.env.example`, `README.md`.
- Banc d'essai : `package.json`, `package-lock.json`, `tests/*`.
