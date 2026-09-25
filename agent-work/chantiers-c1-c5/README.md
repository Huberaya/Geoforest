# GeoForest Trace

> Plateforme SaaS de diligence raisonnée EUDR.

**Statut actuel : 🚧 MVP — chantiers 1 à 4 livrés; C5 implémenté et validé hors ligne. Le test réel de GFW reste à faire; l'activation live est bloquée par défaut. La baseline Alembic initiale a passé un cycle upgrade/downgrade/upgrade sur PostgreSQL embarqué 18.3; son test sur branche Neon enfant reste en attente d'un accès sécurisé. Aucune écriture n'a été faite sur `production`. Voir `CHANTIER_3_MIGRATION_AUDIT_PLAN.md` et `CHANTIER_5_RAPPORT.md`.**

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
alembic upgrade head
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

## Migrations PostgreSQL

Le schéma est géré par Alembic, pas par `create_all()` au démarrage. En local, le compose exécute `alembic upgrade head` avant l'API; en exécution manuelle, lancer cette commande dans `backend/` après avoir injecté `DATABASE_URL` depuis un gestionnaire de secrets. L'API vérifie en lecture seule que la base est au head attendu et refuse de démarrer si elle ne l'est pas.

La révision initiale est préparée mais n'a pas encore été exécutée sur Neon : le test prévu se fera sur une branche enfant, jamais sur `production` sans autorisation distincte. Ne stocke pas de DSN ou de secret dans le dépôt ou le chat. Le kit de test de branche enfant est documenté dans `backend/scripts/README_NEON_CHILD_BRANCH_TEST.md`.

## Contexte réglementaire
- Règlement (UE) 2023/1115 (EUDR), modifié par Règlement (UE) 2025/2650
- Application : **30 décembre 2026** (grandes/moyennes), **30 juin 2027** (micro/petites)
- Date butoir déforestation : **31/12/2020**
- Les analyses automatisées sont systématiquement étiquetées Automatique / Assisté / Manuel / À confirmer. **Aucune certification juridique automatisée.**

## Architecture
- **Backend** : FastAPI + PostgreSQL (JSONB; GeoJSON traité côté application) + SQLAlchemy 2.0 async + JWT. PostGIS n'est pas requis par le schéma actuel.
- **Frontend** : Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS + Leaflet
- **Stockage** : S3/MinIO (documents)
- **Jobs** : Redis + Celery (plus tard dans le MVP)

## Progression du MVP

Les chantiers d'exécution 3 et 4 regroupent une partie du découpage initial (fournisseurs/produits/lots, puis parcelles/géospatial). Le périmètre restant sera recalé avant son implémentation.

| Chantier d'exécution | État |
|---|---|
| 1. Fondations / Auth / Multi-tenant | ✅ Fait |
| 2. Dashboard B2B | ✅ Fait |
| 3. Fournisseurs, produits, lots & portail fournisseur | ✅ 87 tests backend; cycle migration testé sur PostgreSQL embarqué 18.3 — test Neon enfant en attente d'un accès sécurisé |
| 4. Parcelles & moteur géospatial | ✅ Fait — voir `CHANTIER_4.md` |
| 5. Dépistage de perte de couvert arboré | ✅ MVP hors ligne testé — validation GFW live encore requise; voir `CHANTIER_5_RAPPORT.md` |
| Modules restants du plan initial (documents/légalité, risque/DDR, notifications, espace fournisseur, rapports, sécurité) | À ordonner et planifier |
