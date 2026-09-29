# Chantier 2 — Préparation du backend pour Vercel

29 septembre 2026 — suite de la préparation de mise en production.

**Statut : code et configuration préparés, tests locaux réussis ; déploiement cloud non effectué.**

## Objectif et décisions

Préparer le véritable backend FastAPI pour Vercel, corriger les destinations locales de repli en environnement hébergé et adapter la gestion des connexions sans affaiblir l'isolation multi-entreprises.

Décision utilisateur respectée : **achat du domaine en fin de projet**. L'activation Clerk production et la recette humaine réelle restent donc différées. Aucun domaine, service payant ou projet cloud n'a été créé.

La préparation retient deux projets Vercel issus du même dépôt : frontend existant à la racine, backend séparé avec racine `backend`. Les secrets serveur restent réservés au backend. Cette topologie n'a pas encore été configurée dans Vercel.

## Réalisé

### 1. Packaging du backend

- Python 3.13 fixé, entrée native `app/main.py:app` existante conservée.
- `backend/vercel.json` préparé : FastAPI, région candidate UE `fra1`, durée de 60 secondes.
- Configuration validée contre le schéma JSON officiel Vercel.
- Manifeste d'exécution aligné sur les versions du verrouillage, avec les bibliothèques documentaires auparavant manquantes ; outils de test exclus.
- Exclusions des fichiers d'environnement, tests, caches et migrations dans le bundle prévu ; références géographiques et police PDF conservées.
- Dockerfile aligné sur le manifeste d'exécution. Aucune migration automatique au build ou au démarrage.

### 2. Routage frontend explicite

- `API_INTERNAL_URL` devient obligatoire en environnement Vercel ou production.
- Plus de repli silencieux vers `127.0.0.1` dans ces environnements.
- Refus des destinations HTTP, IP littérales, hôtes internes usuels, credentials, chemins et autres composants non attendus.
- Conservation intégrale du chemin `/api/*` vers le backend.
- Suppression des réécritures Keycloak en mode Clerk ; configuration explicite requise pour un proxy Keycloak hébergé.
- Le développement local garde ses destinations locales.

La compilation a réellement été testée avec une cible HTTPS fictive, puis le manifeste de routes a été vérifié. Un build hébergé sans URL d'API a été testé et **refusé comme attendu**. Les contrôles statiques ne prouvent pas la résolution DNS réelle ni l'absence de boucle par alias.

### 3. Connexions Neon et verrous

- Taille du pool, dépassement, attente, recyclage et délai de connexion configurables.
- Profil Vercel limité à deux connexions API par instance, sans dépassement. Cette limite n'est pas un plafond global Neon.
- Identités RLS conservées à portée de transaction ; ajout de timeouts SQL et d'attente de verrou également locaux à la transaction.
- Connexions de verrous de session séparées du pool API, sur la même base/rôle, avec fermeture physique via `NullPool`.
- Refus du pooling transactionnel pour les traitements qui exigent des verrous de session.
- Déclaration explicite du mode obligatoire pour une URI Neon `-pooler` ; aucune conversion automatique d'URI.
- Sélecteur `sslrootcert=certifi` pour utiliser le bundle CA livré avec le runtime, sans supposer un chemin système identique à Debian. TLS `verify-full` reste obligatoire en production.

Les tests ont notamment vérifié qu'un worker ne bloque pas un pool API réduit à une connexion, que les verrous sont libérés après exception, qu'une identité n'est pas conservée lors de la réutilisation d'une connexion et qu'une requête interrompue par timeout laisse une connexion réutilisable.

### 4. Contrôles de démarrage

Les vérifications du rôle runtime, des politiques RLS, de la migration `0007` et de PostGIS sont conservées et factorisées.

Une nouvelle protection des requêtes de production exécute également ces contrôles **sans dépendre du lifespan ASGI**. Seuls les succès sont mémorisés, au maximum 60 secondes par instance. En cas d'échec : HTTP 503 sans détails sensibles, pas d'accès métier.

`/health/live` reste un simple contrôle de vie. `/health/ready` vérifie fraîchement l'état des données ; un 200 sur le premier n'est pas une qualification de production.

## Périmètre volontairement limité sur Vercel

Le profil Vercel refuse l'activation de `DOCUMENTS_ENABLED`, `FOREST_ANALYSIS_ENABLED` et `DILIGENCE_ENABLED` tant que leurs adaptations ne sont pas qualifiées.

**Ce n'est donc pas encore un hébergement de l'application complète.** Le coffre persistant, l'antivirus, les workers géographiques et les exports de diligence restent à traiter. Ils ne sont pas supprimés du produit ni présentés comme prêts sur Vercel. Leurs comportements locaux existants ont fait l'objet d'une régression ciblée.

## Fichiers principaux

- Packaging : `backend/.python-version`, `.vercelignore`, `vercel.json`, `requirements.txt`, `Dockerfile`.
- Configuration/SQL : `backend/app/config.py`, `database.py`, `forest/routes.py`, `documents/processing.py`.
- Disponibilité : `backend/app/runtime_gate.py`, `readiness.py`, `main.py`.
- Routage : `src/backend-routing.ts`, `next.config.ts`.
- Tests : `test_vercel_profile.py`, `test_database_runtime.py`, `backend-routing.test.ts`.
- CI : cible API fictive explicite pour la compilation du profil Clerk production.
- [Guide de configuration et recette](../deploiement/backend-vercel.md).

## Tests exécutés

| Vérification | Résultat |
|---|---|
| Backend final ciblé : configuration, identité, fondation, sécurité, connexions, forêt/documents API | **314 réussis**, 76,94 secondes |
| Tests frontend | **77 réussis**, dont 23 de routage |
| Installation propre depuis le manifeste d'exécution | Réussie ; `pip check` sans dépendance cassée ; pytest absent |
| Smoke checks avec ce runtime propre | **10 réussis** : import ASGI, santé locale, refus API sans DB, natifs raster/géométrie, PDF, gardes Clerk développement |
| Configuration JSON Vercel | Conforme au schéma officiel récupéré pendant le chantier |
| Build frontend profil Vercel/Clerk production fictif | Réussi ; réécriture HTTPS compilée vérifiée |
| Build hébergé sans API | Refus attendu confirmé |
| Build local OIDC | Réussi |
| TypeScript, ESLint, Ruff | Réussis |
| Audit npm | 0 vulnérabilité signalée |

Les tests SQL utilisent une base **PostgreSQL 17/PostGIS locale `_test`**, créée et migrée localement. Aucun accès Neon. Les tests de protection ASGI utilisent aussi un client n'envoyant volontairement pas de lifespan.

Les tests backend sont ciblés : la suite complète de 1 043 tests du chantier précédent n'a pas été relancée ici. Aucun nouvel E2E navigateur ni contrôle responsive n'a été réalisé dans ce chantier, qui ne modifie pas les écrans. Les vérifications navigateur du chantier précédent restent historiques, pas une recette cloud nouvelle.

Avertissement restant : dépréciation du transport httpx dans le TestClient Starlette. Un ordre d'import Ruff a été corrigé. Le script de vérification du manifeste Next a été adapté à sa structure objet avant son exécution réussie ; ce n'était pas un défaut du routage applicatif.

### Mesures locales, non assimilables au bundle cloud

L'environnement d'exécution installé occupe environ **348 Mio** de `site-packages` selon `du`, et le répertoire backend environ **28,5 Mio**. Ces chiffres incluent du bytecode et des fichiers qui pourront être exclus ; ils ne sont ni une mesure de mémoire vive ni la taille du bundle Vercel final. Le respect du plafond standard de 500 MB reste à vérifier sur le vrai build Vercel.

Preuves : `docs/rapports/preuves-chantier-8/backend-vercel/`.

## Qualification cloud restant à faire

- Plan Vercel commercial, coûts, quotas, région effective et création du projet backend.
- Build cloud réel, contenu et taille de l'artefact Python, comportement des dépendances natives.
- Connexion TLS à Neon et comportement du véritable pooler ; charge, saturation et reconnexions.
- Identification du client derrière le proxy pour éviter un quota de débit partagé involontairement entre tous les utilisateurs. Ne pas faire confiance arbitrairement à `X-Forwarded-For`.
- Hôtes, cookies, protection des environnements de recette et absence de cache pour les réponses privées.
- Domaine et instance Clerk live, puis inscription, connexion et MFA humaines.
- Publication réelle sur le domaine Production, preuve du commit/alias et retour arrière.

**Attention à la prochaine publication :** une Preview Vercel sans `API_INTERNAL_URL` explicite ne compilera plus. C'est un refus de configuration intentionnel. Ne pas remettre localhost pour faire passer le build ; préparer la vraie destination backend et la recette.

## Bilan

- **PRÊT POUR REVUE :** adaptation du code, manifestes, gardes, tests locaux et guide d'exploitation.
- **À FINALISER :** build et recette cloud, TLS/pooler/charge/proxy, puis identité réelle quand le domaine sera disponible.
- **BLOQUÉ POUR LANCEMENT COMPLET :** backend non déployé, domaine/Clerk live différés, fonctions avancées non qualifiées sur Vercel.
- **RISQUE RÉGLEMENTAIRE :** aucun stockage temporaire ne doit remplacer la conservation durable des preuves documentaires ; aucune certification EUDR n'est déduite de ces tests.
- **SUITE PROPOSÉE :** préparation du coffre documentaire durable et de ses traitements, puis qualification complète avant publication.

Aucun push GitHub, déploiement/promotion Vercel, accès Neon ou souscription pendant ce chantier. La Production publique reste inchangée. Le changement préexistant de mode de `infra/bootstrap-db.sh` reste exclu.
