# GeoForest Trace — MVP de conformité EUDR (Règlement (UE) 2023/1115)

Micro-SaaS de diligence raisonnée géospatiale : validation GIS des parcelles, détection de déforestation
post-31/12/2020 (Hansen / Global Forest Watch) et export du dossier DDS au format TRACES-NT.

```
geoforest-trace/
├── docker-compose.yml            # postgres + backend FastAPI + frontend Next.js
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

## Démarrage en une commande

```bash
docker-compose up --build
# Frontend : http://localhost:3000   —   Backend FastAPI : http://localhost:8000/docs
```

Le dashboard utilise par défaut les routes API Next.js intégrées (`/api/v1/...`, persistance PostgreSQL via Drizzle).

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
- **Hors-ligne** (défaut, tests) : moteur déterministe basé sur des hotspots documentés
  (Pará 2022, Riau 2021, Kalimantan 2024, Taï 2023, Mato Grosso 2019…) et un hash stable du centroïde.
  Une propriété `properties.simulated_loss_year` sur une Feature force une année de perte (démonstrations).

## Tests

```bash
cd backend && pip install -r requirements.txt && pytest -q     # 26 tests : conforme, non conforme 2022, formats invalides, multi-parcelles, export TRACES
```

## Endpoints

- `POST /api/v1/audit/parcel` — `{ geojson, commodity, harvest_date, operator?, declared_area_ha? }` → audit complet.
- `POST /api/v1/export/traces` — `{ audit_id, format: "xml"|"json", operator?, net_weight_kg? }` → fichier DDS.
- `GET /api/v1/audits`, `GET /api/v1/audits/{id}` — historique.
