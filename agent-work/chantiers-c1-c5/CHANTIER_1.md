# CHANTIER 1 — Fondations techniques, Auth, Multi-tenant, Organisations

## Étape 1 — Analyse
Voir AUDIT_GEOFOREST_TRACE.md : l'ébauche existante comportait un backend FastAPI minimal (SQLite, 1 table d'audit) et un frontend Next.js à 1 page sans auth ni multi-tenant. Risque principal : double persistance SQLite/Postgres incohérente, zéro isolation des données.

## Étape 2 — Plan
Back-end FastAPI unifié (async SQLAlchemy 2.0 + PostgreSQL/PostGIS), authentification JWT (Argon2), RBAC 6 rôles, isolation tenant par `organization_id`, middlewares de sécurité et rate-limit. Frontend Next.js 16 (App Router) avec pages login/register, layout authentifié (sidebar), contexte Auth avec refresh automatique.

## Étape 3 — Implémentation (✅ FAIT)

### Arborescence livrée
```
geoforest-trace/
├── docker-compose.yml            # postgis + redis + minio + backend + frontend
├── package.json                  # scripts racine (npm run dev / docker:up)
├── README.md
├── CHANTIER_1.md (ce document)
├── backend/
│   ├── Dockerfile, requirements.txt, pytest.ini, alembic.ini + alembic/
│   ├── .env.example
│   └── app/
│       ├── main.py               # FastAPI + middlewares (sécurité, rate limit, logging, CORS)
│       ├── core/
│       │   ├── config.py         # Settings pydantic (toutes les var d'env)
│       │   ├── database.py       # Moteur async PG/PostGIS (fallback SQLite pour tests)
│       │   ├── security.py       # Argon2, JWT, RBAC, dépendances
│       │   └── rate_limiter.py   # Rate limit mémoire (anti brute-force login)
│       ├── middleware/
│       │   ├── security.py       # SecurityHeaders + RateLimit
│       │   └── logging.py        # Log + X-Request-ID
│       ├── models/               # Organization, User (SQLAlchemy 2.0)
│       ├── schemas/              # Pydantic (auth.py, user.py)
│       ├── services/
│       │   ├── auth_service.py   # register, login, refresh
│       │   ├── gis/gis_validator.py
│       │   └── satellite/satellite_checker.py (conservés)
│       ├── api/v1/endpoints/
│       │   ├── auth.py           # register/login/refresh/me/logout
│       │   ├── organizations.py  # GET /me, GET /stats
│       │   ├── users.py          # list/invite/get/delete (désactiver) + /me PATCH/password
│       │   └── health.py
│       └── db/seed.py            # démo auto si base vide
└── frontend/
    ├── Dockerfile, package.json, tsconfig.json, next.config.ts, postcss.config.mjs, .env.example
    └── src/
        ├── app/
        │   ├── layout.tsx + providers.tsx (AuthProvider)
        │   ├── page.tsx → /dashboard
        │   ├── auth/login, auth/register (pages publiques)
        │   ├── api/health (health frontend)
        │   └── (app)/ (groupe authentifié, sidebar + header)
        │       ├── layout.tsx (auth guard + sidebar rétractable)
        │       ├── dashboard/page.tsx (écran d'accueil)
        │       └── suppliers/products/shipments/plots/analysis/documents/risks/dds/
        │           declarations/alerts/reports/settings/audit-log (placeholders)
        ├── contexts/AuthContext.tsx
        ├── lib/api.ts (client HTTP + refresh auto JWT + persistance)
        ├── lib/eudr/types.ts
        ├── lib/parsers/index.ts (KML/GeoJSON/CSV conservé)
        └── styles/globals.css (Tailwind + composants btn/input/card/label)
```

### Endpoints API (tous prefix `/api/v1`)
| Méthode | Chemin | Rôle / accès |
|---|---|---|
| GET | `/health` | publique |
| GET | `/version` | publique (infos build + dates EUDR) |
| POST | `/auth/register` | publique |
| POST | `/auth/login` | publique (rate limitée 10/min/IP) |
| POST | `/auth/refresh` | publique |
| GET | `/auth/me` | authentifié |
| POST | `/auth/logout` | authentifié |
| GET | `/organizations/me` | authentifié |
| GET | `/organizations/stats` | admin/compliance |
| GET | `/users/me` | authentifié |
| PATCH | `/users/me` | authentifié (prénom, nom, tél, locale) |
| POST | `/users/me/password` | authentifié (changement MDP) |
| GET | `/users/` | admin/compliance |
| POST | `/users/invite` | admin |
| GET | `/users/{id}` | authentifié (isolation tenant) |
| DELETE | `/users/{id}` | admin (désactive, pas de suppression physique) |

### Sécurité mise en place
- Hashage **Argon2id** (passlib)
- JWT HS256 : access token 30 min, refresh token 30 j
- Rotation / refresh automatique côté client avec déconnexion forcée si refresh échoue
- **RBAC 6 rôles** : admin / compliance / procurement / analyst / viewer / supplier
- **Rate limit** : 10 tentatives login/min/IP, 300 req/min/IP global
- **Middlewares sécurité** : X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS en production
- **X-Request-ID** sur chaque réponse (traçabilité)
- Gestionnaire global d'exceptions (erreurs 500 génériques, pas de fuite de stack)
- Validation stricte Pydantic (EORI, email, taille, format date)
- Unicité email case-insensitive
- Blocage de l'auto-désactivation (admin ne peut pas se désactiver soi-même)
- Rejet de l'invitation de rôle `supplier` via le canal équipe (passera par portail dédié)
- Isolation tenant vérifiée par test et par E2E
- Tous les secrets par variable d'environnement ; `.env.example` fourni
- CORS restrictif par origine configurée
- Log structuré en dev (méthode, chemin, statut, durée, request-id)

### Compatibilité
- Le moteur DB fonctionne avec PostgreSQL/PostGIS (docker/prod) **et** SQLite/aiosqlite (tests/CI) grâce à un type UUID portable
- Extensions PostGIS créées automatiquement sous PG, ignorées sous SQLite

### Données de démonstration
Au premier démarrage (`ENVIRONMENT=development|demo`) :
- Organisation `Café Import SAS — Démo` (FR, EORI FR12345678901234)
- Admin `demo@geoforest-trace.com` / `DemoPassword2026!`
- Cette seed ne s'active que si la table `users` est vide.

### Frontend
- Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS 4
- Pages login / register avec split-screen sobre et conforme à la charte
- Layout authentifié : sidebar rétractable (14 entrées de navigation), header, footer avec profil et déconnexion
- Contexte Auth avec state, refresh auto, méthode logout, helpers `isAdmin` / `canManageUsers`
- Client HTTP : refresh automatique du JWT, persistance localStorage, redirect sur login si 401
- Pages "placeholder" pour les 14 modules (seront remplacées dans les chantiers suivants)
- Page dashboard d'accueil rappelant l'état du MVP
- Build de production réussi (20 routes)

## Étape 4 — Tests

### Tests backend — 26 tests, tous passent ✅
- **test_auth_rbac.py** (16) : inscription, login, refresh, /me, org, RBAC admin, isolation tenant, health
- **test_chantier1_completion.py** (10) : endpoint /version, en-têtes sécurité, format 422 cohérent,
  échec invitation supplier, GET/PATCH /users/me, changement de mot de passe (vérifié par reconnexion),
  échec auto-désactivation, désactivation membre, rate-limit headers

Commande :
```bash
cd backend && GFW_LIVE_ENABLED=false python -m pytest
# 26 passed
```

### Vérification E2E live (uvicorn démarré, appels HTTP réels) ✅
```
GET /health ........................................... 200
GET /version .......................................... 200 (retourne dates EUDR)
HEAD /health — en-têtes sécurité ...................... X-Content-Type-Options, X-Frame-Options,
                                                        Referrer-Policy, Permissions-Policy, X-Request-ID
POST /auth/login démo ................................. 200
GET /auth/me .......................................... données cohérentes
PATCH /users/me (prénom/nom) .......................... 200
POST /auth/register avec données invalides ............ 422 format cohérent ({detail, errors})
POST /auth/register duplicata ......................... 409
Invitation viewer (admin) ............................. 201
DELETE /users/{id} (désactivation) .................... 200
Isolation inter-org (Bob vs Alice) .................... validée
Refresh avec access token ............................. 401
Rate limit : 10 requêtes/min sur /login ............... opérationnel
```

### Frontend
- Build production : 20 routes générées sans erreur
- TypeScript strict (`tsc --noEmit`) : aucune erreur

## Étape 5 — Validation

### ✅ FAIT
- Stack de base opérationnelle (FastAPI async + PostgreSQL/PostGIS ready + Next.js 16), compatible SQLite pour tests
- Authentification JWT complète (register/login/refresh/me/logout) avec refresh automatique côté client
- Changement de mot de passe, mise à jour du profil
- Gestion des membres d'organisation (liste, invitation, désactivation)
- RBAC : 6 rôles + dépendances FastAPI par rôle
- Middlewares de sécurité et rate limit (anti brute-force)
- Gestionnaires d'erreur globaux (format cohérent, pas de fuite)
- En-têtes HTTP de sécurité + X-Request-ID
- Isolation multi-tenant par `organization_id` (vérifiée E2E)
- Layout frontend professionnel : sidebar rétractable, auth guard, routing
- Pages login/register/dashboard aboutis + 14 pages placeholder
- Docker-compose complet (PostGIS, Redis, MinIO, backend avec reload, frontend)
- Scripts npm racine pour le dev (`npm run dev` lance backend + frontend en parallèle)
- Seed démo automatique avec avertissement "À supprimer en production"
- Endpoint `/version` exposant les dates réglementaires EUDR
- 26 tests backend qui passent
- Compatibilité SQLite pour CI (pas de Postgres nécessaire pour les tests)
- Documentation README et CHANTIER_1 à jour

### ⛔ NON FAIT (dans ce chantier)
- Réinitialisation de mot de passe par email (Chantier 10 — notifications)
- Vérification d'email (colonne présente, flux non implémenté — Chantier 10)
- Audit log (table à créer au Chantier 12)
- Migration Alembic initiale (sera générée une fois le schéma stabilisé — tables créées via `metadata.create_all()` en dev)
- Taux de limitation basé sur Redis (la version MVP utilise un store mémoire ; multi-workers devront passer sur Redis)
- EU Login/OIDC (V2 — hors MVP)
- Page "Mon profil" dédiée (l'API existe, la page UI sera ajoutée au Chantier 12 Paramètres)

### 🚧 PROBLÈMES
- Un DeprecationWarning de `passlib/argon2` (non bloquant, sera remplacé par `argon2-cffi` direct en V2)
- En dev, le démarrage du backend nécessite que la base de données soit lancée en premier (géré par docker-compose)

### ⚠️ RISQUES
- **SECRET_KEY** dev-only (`change-me-in-production-…`) doit être remplacée par une valeur forte en production (le fichier `.env.example` l'indique clairement)
- Rate-limiter en mémoire : non partagé entre workers (remplacer par une implémentation Redis avant déploiement multi-processus — Chantier 14)
- Le compte démo doit être supprimé (ou `ENVIRONMENT≠development/demo`) avant mise en production — le seed s'auto-désactive hors environnements de dev

### 👉 PROCHAINE ÉTAPE
**Chantier 2 — Dashboard B2B complet** :
- KPIs réels (fournisseurs, produits, lots, parcelles, dossiers conformes/incomplets/à risque, documents expirés)
- Taux de conformité global
- Liste des alertes et prochaines échéances
- Widgets d'actions rapides
- État zéro d'onboarding quand l'organisation n'a pas encore de données
