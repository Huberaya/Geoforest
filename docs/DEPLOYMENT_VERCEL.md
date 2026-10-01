# GeoForest Trace — Guide de Déploiement Production Vercel & Neon

## 1. Architecture de Déploiement Monorepo Vercel

Le projet est configuré selon le modèle **Vercel Multi-Services** :
- **Frontend App Router** : Next.js 16 (React 19, Tailwind CSS v4, Leaflet).
- **Backend Geospatial API** : Python 3.13 FastAPI (Shapely, GeoPandas, lxml).
- **Base de Données** : PostgreSQL Neon Serverless.

---

## 2. Variables d'Environnement Requises (Vercel Dashboard)

| Variable | Description | Exemple / Valeur |
| :--- | :--- | :--- |
| `DATABASE_URL` | Chaîne de connexion PostgreSQL Neon | `postgresql://user:pass@ep-xyz.eu-central-1.aws.neon.tech/geoforest?sslmode=require` |
| `NEXT_PUBLIC_APP_URL` | URL publique de l'application | `https://geoforest-trace.vercel.app` |
| `BACKEND_URL` | URL de liaison interne vers le service FastAPI | Liaison automatique via `vercel.json` |
| `GFW_API_KEY` | *(Optionnel)* Clé d'API Global Forest Watch live | `gfw_live_key_xxx` (Repli automatique sur moteur déterministe) |

---

## 3. Commandes de Build & Déploiement

### Déploiement via CLI Vercel :
```bash
# Liaison au projet Vercel
vercel link

# Déploiement de prévisualisation
vercel

# Déploiement en production
vercel --prod
```

### Déploiement Continu via GitHub Actions :
Chaque push sur la branche `main` déclenche le pipeline CI/CD validant les tests Python (Pytest 29/29), le typage TypeScript et la compilation Next.js avant le déploiement sur Vercel.
