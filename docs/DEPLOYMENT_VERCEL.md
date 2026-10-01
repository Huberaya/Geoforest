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
| `DATABASE_URL` | Connexion **applicative** : rôle `geoforest_app`, soumis à la RLS — voir §3 | `postgresql://geoforest_app:…@ep-xyz-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require` |
| `DATABASE_URL_ADMIN` | Connexion **d'administration** : rôle propriétaire, migrations et purge uniquement | `postgresql://neondb_owner:…@ep-xyz-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require` || `NEXT_PUBLIC_APP_URL` | URL publique de l'application | `https://geoforest-trace.vercel.app` |
| `BACKEND_URL` | URL de liaison interne vers le service FastAPI | Liaison automatique via `vercel.json` |
| `GFW_API_KEY` | *(Optionnel)* Clé d'API Global Forest Watch live | `gfw_live_key_xxx` (Repli automatique sur moteur déterministe) |

---

## 3. Rôle applicatif : deux connexions, jamais une seule

⚠️ **C'est le point qui décide du cloisonnement multi-tenant.** Brancher
l'URL fournie par l'hébergeur dans `DATABASE_URL` donne une application qui
fonctionne parfaitement et qui **voit toutes les organisations** : aucune
erreur, aucun test qui échoue, rien qui alerte.

Mesuré sur Neon le 02/10/2026 : le rôle `neondb_owner` porte l'attribut
`BYPASSRLS`. Il lit les lignes d'une table en RLS **forcée**, sans politique, là
où `geoforest_app` n'en voit aucune. `force row level security` n'y change rien :
l'attribut `BYPASSRLS` existe précisément pour passer outre.

| Variable | Rôle | Qui l'emploie | Droits |
| :--- | :--- | :--- | :--- |
| `DATABASE_URL` | `geoforest_app` | le produit, à l'exécution | SELECT, INSERT, UPDATE. Ni DELETE, ni TRUNCATE, ni DDL. RLS appliquée. |
| `DATABASE_URL_ADMIN` | `neondb_owner` | migrations, amorçage, purge **et**, à l'exécution, l'authentification et le journal d'audit (`src/db/admin.ts`) | tous droits ; contourne la RLS, volontairement |

⚠️ **Les deux variables sont nécessaires en production, et ce n'est pas
facultatif.** `src/db/admin.ts` se replie sur `DATABASE_URL` quand
`DATABASE_URL_ADMIN` est absent : l'authentification s'exécuterait alors avec
le rôle restreint, qui n'atteint aucune ligne hors contexte d'organisation —
**plus personne ne pourrait se connecter**. À l'inverse, mettre la même URL
dans les deux fait tourner les routes métier avec le rôle d'administration, et
le cloisonnement disparaît. Le contrôle de démarrage refuse le service dans
les deux cas.
### Création du rôle applicatif — une fois par environnement

Le rôle est créé **sans mot de passe** par la migration
(`scripts/sql/post-migrate/010_row_level_security.sql`). Le mot de passe se
pose à la main, jamais dans un fichier versionné :

```sql
-- console SQL de l'hébergeur, avec le rôle propriétaire
alter role geoforest_app login password '<mot de passe long et aléatoire>';
```

Le générer : `openssl rand -base64 32`, ou
`node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`.

⚠️ **Historique** : le mot de passe du rôle applicatif a figuré en clair dans ce
script SQL, dans un dépôt **public**. Il est donc considéré comme connu de tous.
Sa valeur n'est pas recopiée ici : la répéter reviendrait à la publier une
seconde fois. La ligne a été supprimée du script, mais l'historique git la
conserve : la rotation est la seule réponse — pas le nettoyage de l'historique,
qui ne prouve rien.

### Vérification avant toute mise en production

```bash
DATABASE_URL=postgresql://geoforest_app:…@…/neondb?sslmode=require \
  npx tsx scripts/verifier-role.ts
```

Attendu : `✅ Rôle conforme` et code de sortie 0. Exécuté avec l'URL
d'administration, le script **échoue** : c'est le résultat voulu, il ne se
contourne pas.

Au démarrage, `src/instrumentation.ts` refait ce contrôle et **refuse de
démarrer** en production si le rôle n'est pas conforme. Issue de secours pour
redémarrer un service en incident : `GF_CONTROLE_ROLE=off` — l'avertissement
est alors écrit à chaque démarrage, et `/api/health` continue de signaler
l'anomalie dans le composant `role_base`.

---

## 4. Commandes de Build & Déploiement
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
