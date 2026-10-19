# GeoForest — Baseline de finalisation

Date : 08/10/2026 · Branche : `arena/c73246d2-geoforest` · Base : `main` @ `1c95f4c`.
Référence : `PRODUCTION_READINESS_REPORT.md` (NO-GO, 08/10/2026).

## 1. Architecture (constatée dans le dépôt)

- **Application** : Next.js 16 (App Router) + TypeScript. Routes `src/app/api/v1/*` (source de vérité applicative, PostgreSQL via Drizzle).
- **Authentification** : sessions JWT (`src/lib/auth/`), MFA TOTP obligatoire pour `admin` et `compliance_officer`, RBAC (`src/lib/auth/roles.ts`).
- **Base** : PostgreSQL. Rôle applicatif `geoforest_app` soumis à la RLS ; rôle d'administration séparé (`DATABASE_URL_ADMIN`). Migrations Drizzle (`drizzle/`, 0001 à 0007).
- **Moteur EUDR** : `src/lib/eudr/` (règles, satellite-checker, readiness, GIS validator). Réplique partielle en Python dans `backend/app/services/`.
- **Service FastAPI** (`backend/`) : endpoints d'audit et d'export, protégés par `GF_BACKEND_API_TOKEN` (Bearer). Persistance : SQLite (`backend/app/core/database.py`, repli `/tmp`).
- **Stockage pièces** : `src/lib/storage/` — disque local (`GF_STORAGE_DIR`) ; S3 présent dans le code, non exécuté.
- **Satellite** : Global Forest Watch (`GFW_API_KEY`, `GFW_LIVE_ENABLED`) ; mode `GFW_DEMO_MODE` (simulation non probante).
- **Observabilité** : journaux JSON (`src/lib/observability/`), `/api/health`, `/api/metrics`.

## 2. Tests existants (mesurés le 08/10/2026)

| Suite | Commande | Résultat |
|---|---|---|
| Unitaires TS | `npm run test:unit` | 158 réussis, 0 échec |
| Règles EUDR | `npm run test:eudr` | 36/36 |
| Backend | `npm run test:backend` (venv avec pytest) | 63 réussis, 3 `xfail` |
| DB | `npm run test:db` | OK (rôle, limites SQL) |
| E2E | `npm run test:e2e` (build de production) | 49/49 |
| Types / lint / build | `typecheck`, `lint`, `build` | OK |
| Dépendances | `npm run audit:sec` | exit 1 : 6 « high » (outillage `eslint-config-next`) |

## 3. Blockers B1–B9 à l'ouverture de cette passe

Voir `BLOCKERS_RESOLUTION_REPORT.md` pour le statut de chacun, avec preuves.

## 4. Environnement et limites de ce sandbox

Constaté pendant cette passe :

- **Sortie réseau restreinte** : seuls `github.com`, `codeload.github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`, `files.pythonhosted.org` sont joignables.
  - `data-api.globalforestwatch.org` et `production-api.globalforestwatch.org` : **injoignables** (HTTP 000).
  - `database.clamav.net` : **injoignable**. Pas de moteur antivirus ni de base de signatures installable.
  - Téléchargement de binaires GitHub Releases : **redirigé vers un hôte hors liste** (gitleaks non installable).
- **Docker** : démon **indisponible** ; `docker compose up` ne peut pas être exécuté ici.
- **Pas de bucket S3**, pas d'identifiants S3, pas d'infrastructure de production.
- **Pas de clé GFW** dans l'environnement.
- **Pas d'accès à TRACES NT** (aucun identifiant, aucune spécification d'API officielle n'a été obtenue).

Conséquence : les blockers dont la vérification exige ces ressources sont **BLOCKED_EXTERNAL**. Ils ne peuvent pas être résolus dans ce sandbox, quel que soit le code.

## 5. Éléments à vérifier sur infrastructure réelle

- Analyse satellite GFW réelle sur jeu de parcelles de référence (B1).
- Rotation effective des identifiants et nettoyage des environnements déployés (B2).
- Démarrage conteneurisé, migrations, restart, persistance (B3).
- Antivirus réel sur fichiers réels (B4).
- Stockage S3 réel, signed URLs, restauration (B6).
- Sauvegarde/restauration PostgreSQL et documents (RPO/RTO).
- Charge (10 à 500 utilisateurs).
