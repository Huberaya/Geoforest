# GeoForest Trace

> Plateforme SaaS de diligence raisonnée EUDR.

**Statut actuel : 🚧 MVP — chantiers 1 à 4 livrés; C5 implémenté et validé hors ligne. Le test réel de GFW reste à faire; l'activation live est bloquée par défaut. La migration du portail C3 vers une base persistante reste à valider. Voir les rapports des chantiers et `CHANTIER_5_RAPPORT.md`.**

## Démarrage rapide (docker-compose)

```bash
# Depuis le dossier racine
docker-compose up --build
```

- Frontend : http://localhost:3000
- Backend FastAPI (docs) : http://localhost:8000/docs
- MinIO console : http://localhost:9001  (minioadmin / minioadmin123)

### Compte de démonstration (optionnel, développement uniquement)
Aucun compte ou mot de passe de démonstration par défaut n'est livré. Pour créer un compte local, configure `DEMO_SEED_ENABLED=true`, `DEMO_ADMIN_EMAIL` et un `DEMO_ADMIN_PASSWORD` unique de 16 caractères minimum dans ton environnement de développement. Ne réutilise pas ces identifiants en production.

## Développement sans docker

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
export DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/geoforest
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## Contexte réglementaire
- Règlement (UE) 2023/1115 (EUDR), modifié par Règlement (UE) 2025/2650
- Application : **30 décembre 2026** (grandes/moyennes), **30 juin 2027** (micro/petites)
- Date butoir déforestation : **31/12/2020**
- Les analyses automatisées sont systématiquement étiquetées Automatique / Assisté / Manuel / À confirmer. **Aucune certification juridique automatisée.**

## Architecture
- **Backend** : FastAPI + PostgreSQL/PostGIS + SQLAlchemy 2.0 async + JWT
- **Frontend** : Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS + Leaflet
- **Stockage** : S3/MinIO (documents)
- **Jobs** : Redis + Celery (plus tard dans le MVP)

## Progression du MVP

Les chantiers d'exécution 3 et 4 regroupent une partie du découpage initial (fournisseurs/produits/lots, puis parcelles/géospatial). Le périmètre restant sera recalé avant son implémentation.

| Chantier d'exécution | État |
|---|---|
| 1. Fondations / Auth / Multi-tenant | ✅ Fait |
| 2. Dashboard B2B | ✅ Fait |
| 3. Fournisseurs, produits, lots & portail fournisseur | ✅ Fonctionnel et testé — migration de production à valider |
| 4. Parcelles & moteur géospatial | ✅ Fait — voir `CHANTIER_4.md` |
| 5. Dépistage de perte de couvert arboré | ✅ MVP hors ligne testé — validation GFW live encore requise; voir `CHANTIER_5_RAPPORT.md` |
| Modules restants du plan initial (documents/légalité, risque/DDR, notifications, espace fournisseur, rapports, sécurité) | À ordonner et planifier |
