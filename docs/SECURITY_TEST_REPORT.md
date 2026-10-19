# Rapport de tests de sécurité

Date : 08/10/2026 · Branche : `arena/c73246d2-geoforest`.
Périmètre : authentification, autorisations, cloisonnement multi-tenant, base de données, service
FastAPI, validation des pièces, secrets. **Ce n'est pas un test d'intrusion** : aucun audit externe
n'a été réalisé. Les résultats sont ceux des contrôles listés ci-dessous.

## 1. Synthèse

| Domaine | Contrôles | Résultat |
|---|---|---|
| Authentification et MFA | E2E-001 (5) | ✅ 5/5 |
| Autorisations par rôle | E2E-008 (9), dont 403 et 401 | ✅ 9/9 |
| Cloisonnement tenant (API) | E2E-006 (6) | ✅ 6/6 |
| Rôle PostgreSQL applicatif (RLS, BYPASSRLS, DDL) | `npm run test:db` / `verifier-role` | ✅ conforme |
| Limites de temps base (statement, idle, connexion) | `npm run test:db` / `check-sql-limits` | ✅ |
| Service FastAPI : jeton obligatoire, fermeture sans configuration | `pytest` `test_backend_auth.py` (14 cas collectés) | ✅ 14/14 |
| Refus de démarrage sans `DATABASE_URL` en production | reproduit le 08/10/2026 | ✅ |
| Validation des pièces (URL refusée, auto-validation refusée) | E2E-008 | ✅ |
| Audit des dépendances (`npm run audit:sec`) | `npm audit` | ⚠️ 6 « high » ouvertes (§6) |
| En-têtes HTTP | observation directe | ⚠️ CSP en mode report-only (§6) |

## 2. Authentification et sessions

Vérifié par E2E-001 :
- mot de passe faux : 401, message générique ; compte inexistant : **même réponse** côté client (pas d'énumération). Côté serveur, le journal distingue `compte_inconnu` et `mot_de_passe_invalide` (`src/app/api/v1/auth/login/route.ts`) ;
- MFA obligatoire pour `admin` et `compliance_officer` (`MFA_REQUIRED_ROLES`, `src/lib/auth/roles.ts`). Les actions sensibles renvoient 403 `mfa_required` sans second facteur. L'enrôlement est obtenu par le harnais ;
- jeton d'accès forgé : 401 ;
- sans session : 401 sur les routes de données.

Mécanismes présents dans le code (`src/lib/auth/session.ts`, `src/lib/api/limits.ts`) mais **non re-testés**
pendant cet audit : verrouillage de compte, limitation de débit, expiration et rotation des sessions.

## 3. Autorisations et multi-tenant

- Rôles et permissions (`src/lib/auth/roles.ts`) : `viewer` ne crée pas de parcelle (403) ; `auditor` ne modifie pas de dossier (403) et ne valide pas de pièce (403).
- Organisation de démonstration B (`admin@tenant-b.test`, `demo-tenant-b`) : dossier, parcelle et analyse de l'organisation A renvoient **404** ; modification et rattachement refusés ; le dossier n'apparaît pas dans la liste.
- Le rattachement d'une analyse vérifie l'organisation de l'analyse **et** celle du dossier (`src/app/api/v1/due-diligence/[id]/audits/route.ts`, 404 « Analyse introuvable » hors périmètre).
- Le 404 est identique pour « inexistant » et « autre organisation » : pas de confirmation d'existence.

## 4. Base de données

- `verifier-role` (rôle `geoforest_app`) : pas superutilisateur, pas `BYPASSRLS`, 0 table hors cloisonnement, 0 droit de destruction. Sortie observée : « Rôle conforme : la RLS s'applique aux requêtes du produit ».
- Limites SQL (`src/lib/api/limits.ts`) : `statement_timeout = 10 s`, `idle_in_transaction_session_timeout = 15 s`, délai de connexion 5 s ; vérifiées côté serveur par `check-sql-limits`.
- **Correction P0-11** : l'application ne se rabat plus sur `postgres:postgres` (superutilisateur, qui contourne la RLS). En production, l'absence de `DATABASE_URL` fait échouer le chargement du module avec le message « DATABASE_URL est requis en production ». Reproduit le 08/10/2026.
- Migration 0007 (`drizzle/0007_parcel_audit_liens.sql` et `.down.sql`) : ajout de colonnes et de clés composites. Le retour arrière doit passer par `npm run db:rollback` ; il n'a pas été rejoué pendant cet audit.
- Le nombre exact de politiques RLS n'a pas été recompté ; la protection est mesurée par `verifier-role`.

## 5. Service FastAPI (`backend/`)

- **Correction P0-10** : `POST /audit/parcel`, `GET /audits`, `GET /audits/{id}`, `POST /export/traces` n'exigeaient aucune authentification.
- Désormais : `Authorization: Bearer <GF_BACKEND_API_TOKEN>`, comparé en temps constant (`hmac.compare_digest`).
  - variable absente → **503** (fermé, jamais ouvert) ;
  - en-tête absent, mauvais jeton, schéma `Basic` → **401** ;
  - jeton correct → la garde est franchie.
- `/health` reste public.
- Tests : `backend/tests/test_backend_auth.py` (14 cas collectés) ; `test_eudr_pipeline.py` passe désormais un jeton de test explicite.
- Le client TypeScript (`src/lib/api.ts`) appelle FastAPI si `NEXT_PUBLIC_API_URL` est défini. Une variable `NEXT_PUBLIC_*` est publique : si un appel navigateur porte le jeton, il est exposé. **Corrigé le 08/10/2026** : le navigateur n'appelle plus que les routes Next ; le rewrite `/fastapi/*` et `NEXT_PUBLIC_API_URL` ont été supprimés (cf. `BLOCKERS_RESOLUTION_REPORT.md`, B9).

## 6. Points ouverts

| Ref | Constat | Risque | Action proposée |
|---|---|---|---|
| S-01 | `npm audit` : **6 vulnérabilités « high »**, toutes dans la chaîne `eslint-config-next` (outil de lint, pas le runtime). `npm audit fix` proposerait `eslint-config-next@14.2.35`, **une rétrogradation incompatible avec Next 16**. | Faible pour le runtime ; l'outil de développement s'exécute à l'installation | Mettre à jour `eslint-config-next` vers une version compatible Next 16 qui corrige la chaîne. **Ne pas** appliquer `npm audit fix --force` |
| S-02 | CSP en `content-security-policy-report-only`, avec `'unsafe-inline'` et `'unsafe-eval'` | La CSP ne bloque rien aujourd'hui | Passer en CSP appliquée, retirer `unsafe-eval`, traiter les scripts inline (nonces) |
| S-03 | Un mot de passe de démonstration public figure dans le dépôt, uniquement comme valeur de refus (`scripts/seed-auth.ts`, fixture de `check-p106-regles.ts`) | Ce mot de passe est public (dépôt) | Traité comme **compromis** : ne doit servir nulle part. Rotation de tout compte qui l'aurait utilisé |
| S-04 | `docker-compose.yml`, `Dockerfile`, `.env.example` contenaient des identifiants `postgres:postgres` par défaut | Identifiants par défaut publics | **Corrigé dans le code** : variables obligatoires (`GF_APP_DB_PASSWORD` avec `:?`), application sur le rôle `geoforest_app`. **Non vérifié** : aucun `docker compose up` exécuté (blocage B3) |
| S-05 | Des identifiants par défaut (`postgres:postgres`) ont existé dans le dépôt, notamment au commit `1c95f4c`. **L'historique complet n'a pas été audité par un outil dédié** (ex. gitleaks) | Inconnu | Considérer tout identifiant ayant existé comme **compromis** ; scan d'historique et rotation (B2) |
| S-06 | Comptes de démonstration (`seed-auth`) | Comptes d'accès réels si la base est exposée | Supprimer les comptes démo avant toute mise en production |
| S-07 | Rotation des identifiants (rôle applicatif, superutilisateur, `AUTH_SECRET`, clés GFW) | — | **Non réalisable depuis l'environnement d'audit.** À faire par l'exploitant (blocage B2) |

## 7. Ce qui n'a pas été testé

- Tests d'intrusion, fuzzing, injection SQL dirigée. Les requêtes passent en grande partie par Drizzle ; des requêtes SQL brutes existent (`sql\`…\``, 15 fichiers) et n'ont pas fait l'objet d'une revue exhaustive.
- CSRF (non vérifié explicitement) ; limitation de débit, verrouillage, expiration des sessions (non re-testés).
- Sécurité du stockage S3 (non exécuté).
- Résilience sous charge.
