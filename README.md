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
Pour brancher le dashboard sur le backend FastAPI : `NEXT_PUBLIC_API_URL=http://localhost:8000`.

## Règles EUDR implémentées (identiques en Python et TypeScript)

| Règle | Implémentation |
|---|---|
| Date butoir 31/12/2020 | toute perte de couvert `loss_year > 2020` ⇒ `NON_COMPLIANT` |
| Géolocalisation | surface **strictement supérieure** à 4 ha ⇒ polygone obligatoire ; ≤ 4 ha ⇒ point ou polygone |
| Précision | ≥ 6 décimales sur chaque coordonnée (`INSUFFICIENT_PRECISION`) |
| Topologie | anneaux fermés, pas d'auto-intersection, **pas de trous**, **pas de franchissement de l'antiméridien** |
| Surface | ellipsoïdale WGS84 — pyproj `Geod` côté Python, sphère **authalique** côté TS (même résultat à 10⁻⁷ près) |
| Attribution du pays | frontières réelles **Natural Earth 1:50m** versionnées (`data/frontieres/`) ; un point hors couverture est rendu `XX` — jamais le pays voisin |
| Benchmark pays | table **interne non vérifiée** (aucune source/version/date Commission) ; un risque « faible » n'est jamais retenu au niveau de l'audit (plancher STANDARD) |
| Identité de l'opérateur | **facultative** : `null` signifie « non renseignée ». Aucune valeur de remplissage (ni `XX0000000000000`, ni pays `FR` par défaut). Sans identité, l'export de déclaration est **refusé** |

> ⚠️ Les deux validateurs appliquent les mêmes règles, mais aucune de ces règles
> n'a été confrontée au système d'information EUDR réel : l'accès au serveur
> ACCEPTANCE n'est pas disponible. Les messages de refus ne valent pas décision
> réglementaire.

## Données satellite

- **Live** : renseignez `GFW_API_KEY` → requête `umd_tree_cover_loss` sur la GFW Data API.
- **Simulation** (jamais par défaut) : `GFW_DEMO_MODE=true` active un moteur déterministe fondé
  sur des hotspots documentés (Pará 2022, Riau 2021, Kalimantan 2024, Taï 2023, Mato Grosso 2019…)
  et un hash stable du centroïde. Le résultat est `source = "simulated"`, **sans verdict**.
- **Ni l'un ni l'autre** (cas par défaut) : `source = "unavailable"`, **aucun verdict**. Il n'existe
  pas de repli silencieux de la panne vers la simulation.

⚠️ Une propriété du fichier déposé (par exemple `properties.simulated_loss_year`) **ne peut pas**
influencer le résultat : ce serait une voie de blanchiment d'une parcelle déforestée. Le test
`npm run test:eudr` le vérifie.

⚠️ Aucun appel réel à Global Forest Watch n'a été validé : les tests simulent la réponse du
fournisseur (y compris ses réponses malformées). Le comportement du logiciel est testé ; la
disponibilité, la couverture et la qualité des données GFW ne le sont pas.

## Tests

```bash
# Backend : 117 tests + 3 xfail (endpoints géospatiaux absents)
cd backend && pip install -r requirements.txt && pytest -q

# Frontend : 110 contrôles (règles EUDR, cas limites géospatiaux, topologie
# différentielle, démarrage sans base de données)
npm run test:gis

# Build de production — s'exécute SANS base, comme chez l'hébergeur
npm run build
```

## Endpoints

- `POST /api/v1/audit/parcel` — `{ geojson, commodity, harvest_date, operator?, declared_area_ha? }` → audit complet.
- `POST /api/v1/export/traces` — `{ audit_id, format: "xml"|"json", operator?, net_weight_kg? }` → fichier DDS.
- `GET /api/v1/audits`, `GET /api/v1/audits/{id}` — historique.
