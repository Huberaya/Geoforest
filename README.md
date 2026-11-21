# GeoForest Trace — MVP de conformité EUDR (Règlement (UE) 2023/1115)

Micro-SaaS de diligence raisonnée géospatiale : validation GIS des parcelles, détection de déforestation
post-31/12/2020 (Hansen / Global Forest Watch) et export du dossier DDS au format TRACES-NT.

> **Reprise du projet :** avant toute nouvelle intervention, lire [`docs/REPRISE_GEOFOREST.md`](docs/REPRISE_GEOFOREST.md). Ce dossier centralise l'état daté, les décisions, les preuves, les réserves et les prochaines actions pour éviter de recommencer les audits déjà réalisés.

```
geoforest-trace/
├── docker-compose.yml            # postgres + frontend Next.js (le service FastAPI est retiré du déploiement)
├── Dockerfile                    # image du frontend (Next.js)
├── backend/                      # API FastAPI (Python 3.11)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py
│   │   ├── core/        config.py, database.py
│   │   ├── models/      sql_models.py, schemas.py
│   │   ├── services/    gis_validator.py, satellite_checker.py, traces_exporter.py
│   │   └── api/v1/      endpoints.py
│   └── tests/test_eudr_pipeline.py
└── src/                          # frontend Next.js 16 (App Router) + miroir TypeScript de l'API
    ├── app/             page.tsx, layout.tsx, api/v1/{audit/parcel,export/traces,audits}
    ├── components/      GeoUploader.tsx, MapViewer.tsx, AuditResultCard.tsx, AuditHistory.tsx
    ├── lib/             api.ts, parsers.ts, eudr/{gis-validator,satellite-checker,traces-exporter,types}.ts
    └── db/              schema.ts (Drizzle / PostgreSQL)
```

## Démarrage local

⚠️ **Le compose ne migre rien.** Démarrer l'application avant la migration
donne un service qui refuse de servir : c'est voulu (aucun schéma implicite,
aucune donnée réputée valide sans elle).

```bash
# 1. base
docker compose up -d db

# 2. schéma, RLS et invariants (drizzle 0000–0009 puis scripts de sûreté 010–025)
DATABASE_URL_ADMIN="postgresql://postgres:${POSTGRES_PASSWORD}@localhost:5432/app_db" npm run db:migrate

# 3. mot de passe du rôle applicatif (créé sans mot de passe par la migration)
docker compose exec db psql -U postgres -d app_db \
  -c "alter role geoforest_app login password '${GF_APP_DB_PASSWORD}'"

# 4. application — http://localhost:3000 (le service FastAPI n'est plus déployé)
docker compose up --build
```

La migration doit précéder tout déploiement : voir `docs/DEPLOYMENT_VERCEL.md`
§3 bis pour l'ordre complet, la sauvegarde et le retour arrière.

Le dashboard utilise par défaut les routes API Next.js intégrées (`/api/v1/...`, persistance PostgreSQL via Drizzle).
Le navigateur n'appelle jamais de service externe : toutes les requêtes passent par les routes Next.js.

⚠️ **Le backend FastAPI est fermé par défaut.** Il exige
`BACKEND_API_TOKEN` sur toutes ses routes métier ; sans ce jeton, elles
répondent `503`. Seule la sonde `/api/v1/health` reste ouverte. Générer un
jeton :

```bash
openssl rand -base64 48
```

⚠️ Ce jeton **ne doit jamais** être exposé au navigateur. Une variable
`NEXT_PUBLIC_*` finit dans le bundle envoyé au client, donc publique. Le
dashboard ne peut donc pas appeler directement un backend distant : il faut
une route Next.js qui relaie avec le jeton côté serveur. Le client refuse
explicitement ce branchement plutôt que d'échouer en `401` à l'exécution.

En développement local uniquement, `NEXT_PUBLIC_API_URL=http://localhost:8000`
reste accepté, avec un avertissement.

⚠️ `GET /api/v1/audits` du backend est **désactivée** (`410`) : elle renvoyait
l'intégralité des dossiers de toutes les organisations. Le multi-tenant vit
dans l'application Next.js. Détail : `docs/SECURITE-BACKEND.md`.

## Règles EUDR implémentées (identiques en Python et TypeScript)

| Règle | Implémentation |
|---|---|
| Date butoir 31/12/2020 | toute perte de couvert `loss_year > 2020` ⇒ `NON_COMPLIANT` |
| Géolocalisation | surface ≥ 4 ha ⇒ polygone obligatoire ; < 4 ha ⇒ point ou polygone |
| Précision | ≥ 6 décimales sur chaque coordonnée (`INSUFFICIENT_PRECISION`) |
| Topologie | anneaux fermés, pas d'auto-intersection (Shapely / GEOS côté Python, test de segments côté TS) |
| Surface | géodésique WGS84 (pyproj `Geod` / formule sphérique + correction ellipsoïdale) |
| Benchmark pays | classification Commission (HIGH : BY, MM, KP, RU ; LOW : UE, US, CA… ; STANDARD sinon) |

## Données satellite

- **Live** : renseignez `GFW_API_KEY` → requête `umd_tree_cover_loss` sur la GFW Data API.
- **Hors-ligne** : sans `GFW_API_KEY` et sans `GFW_DEMO_MODE=true`, **aucun verdict n'est émis**
  (statut `ANALYSIS_UNAVAILABLE`). Le mode démonstration produit une simulation **non probante**
  (`SIMULATED_NON_PROBATIVE`), jamais « conforme ».
- Une propriété de Feature (ex. `simulated_loss_year`) **n'influence plus jamais le verdict** : le
  fichier déposé ne peut pas dicter sa propre conformité (cf. docs/PRODUCTION_READINESS_REPORT.md).

## Tests

```bash
cd backend && pip install -r requirements.txt && pytest -q     # 63 réussis, 3 xfail (moteur géospatial non livré)
```

## Endpoints

**Le service FastAPI n'est plus déployé** (chantier 2, « B-8 ») : son code reste dans `backend/` pour référence.
Il n'a aucune notion d'organisation : il ne doit pas être réexposé sans un modèle de cloisonnement.
Les routes décrites ci-dessous ne sont donc plus servies par l'application.

- `POST /api/v1/audit/parcel` — `{ geojson, commodity, harvest_date, operator?, declared_area_ha? }` → audit complet.
- `POST /api/v1/export/traces` — `{ audit_id, format: "xml"|"json", operator?, net_weight_kg? }` → fichier DDS.
- `GET /api/v1/audits`, `GET /api/v1/audits/{id}` — historique.
