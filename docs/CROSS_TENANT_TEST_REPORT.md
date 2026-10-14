# Cloisonnement inter-organisations — rapport de test (B-8, chantier 2)

> Numérotation : ce rapport traite le chantier « B-8 » (cross-tenant) de la mission de finalisation.
> Il est distinct de « B8 » (E2E) du tableau de `BLOCKERS_RESOLUTION_REPORT.md`.

Date : 14/10/2026 · Branche : `arena/c73246d2-geoforest` · Environnement : PostgreSQL 16.2 local (rôle applicatif
`geoforest_app`, sans `BYPASSRLS`), serveur de production (`next build` + `next start`), comptes de démonstration amorcés
par `seed:auth`.

## Verdict

**Cloisonnement des données : démontré** pour les 13 tables tenant (12 portant `organization_id`, plus `gf_organizations`), pour les 13 fichiers de routes à identifiant et pour les listes et créations de `src/app/api/v1`
qui portent un identifiant, une liste ou un lien. **Une lacune reste ouverte** : le service FastAPI n'a aucune notion
d'organisation (section « Périmètre non couvert »). Statut B-8 : **FIXED — en attente de décision sur FastAPI**
(non VERIFIED dans son ensemble).

## Ce qui a été testé

| Contrôle | Commande | Résultat |
|---|---|---|
| HTTP, routes et listes, deux sens + rôle restreint | `npm run test:cross-tenant` | **262 / 262** |
| Base de données, rôle applicatif, RLS | `npm run test:cross-tenant:rls` | **96 / 96** |
| Parcours E2E historique (non-régression) | `npm run test:e2e` | **49 / 49** |
| Backend FastAPI (2 tests documentés) | `pytest` dans `backend/` | 64 réussis, **5 XFAIL** explicites |
| Typage, lint, tests unitaires, règles EUDR | `typecheck`, `lint`, `test:unit`, `test:eudr` | 0 erreur, 162 ✅, 40/40 |

### Contrôle HTTP (`scripts/check-cross-tenant.ts`)

Deux organisations créent chacune, **par l'API**, un fournisseur, un produit, une parcelle, un dossier de diligence,
une analyse, une pièce téléversée, une expédition et un risque. La campagne est exécutée dans les deux sens (admin A
contre B, admin B contre A) et depuis un rôle restreint (lecteur A contre B). Pour chaque ressource de la victime :

- **Routes à identifiant** (lecture, modification, suppression, téléchargement, URL signée, versions, readiness,
  rattachement, détachement, traçabilité des 7 types, mise à jour de risque, export TRACES) : refus, ou réponse
  **strictement identique** à celle d'un identifiant inexistant (pas d'oracle d'existence). Aucune donnée de la victime
  dans la réponse, hors identifiant que l'attaquant a lui-même fourni.
- **Identifiant mal formé** : refus sans erreur serveur.
- **Création référençant une ressource étrangère** (parcelle, expédition, dossier, risque, analyse, rattachement dans les
  deux sens) : refus, ou création **sans aucun lien** vers la victime.
- **Organisation forgée** dans le corps, la requête (`organizationId`, `organization_id`, `tenant`) ou les en-têtes
  (`x-organization-id`, `x-tenant-id`) : ignorée.
- **Listes** (16 listes, dont tableau de bord, compteurs, journal d'audit, paramètres) : aucune donnée étrangère.
- **Intégrité** : instantané des données de la victime avant et après la campagne, comparé octet à octet.
- **Anonyme** : toutes les listes et ressources refusées (401/403) ; jeton forgé refusé (401).
- **Erreurs serveur** : aucune réponse 5xx pendant toute la campagne.

### Contrôle base de données (`scripts/check-cross-tenant-rls.ts`)

Ce contrôle prouve que la base protège **même si une route oublie son filtre**.

- Couverture : toute table portant `organization_id` (plus `gf_organizations`) a la RLS activée **et forcée**, avec au
  moins une politique, et **toute** politique est conditionnée par `current_org()`.
- Sans contexte : 0 ligne visible sur chaque table.
- Contexte B : aucune ligne de A lisible, modifiable ou supprimable ; la suppression est refusée par privilège (42501).
- Contexte B : **insertion au nom de A refusée** (42501) sur chaque table, avec une ligne réelle de A injectée en
  valeurs. Une `INSERT … SELECT` aurait lu la source à travers la RLS et n'aurait rien testé.
- Intégrité : nombre de lignes de A inchangé après les tentatives.
- Non vacueux : le test échoue si l'organisation A n'a pas de données.

## Défauts trouvés et corrigés

| # | Constat | Cause | Correctif | Preuve |
|---|---|---|---|---|
| D1 | `POST /api/v1/shipments` et `POST /api/v1/due-diligence` avec un fournisseur ou un produit **d'une autre organisation** : **HTTP 500**, erreur de base journalisée. | La clé étrangère composite `fk_gf_shipments_supplier_tenant` refusait l'insertion (la ligne étrangère est invisible sous RLS). **Aucun lien étranger n'a été créé**, mais la réponse était une erreur interne, et le journal détaillait la requête. | Vérification d'appartenance avant insertion, comme `POST /plots` : **404** « Fournisseur introuvable » / « Produit introuvable » ; **422** si l'identifiant est mal formé (`shipments` n'en contrôlait pas le format). | Campagne HTTP avant correctif : 2 contrôles réels en échec, plus le contrôle « aucune 5xx » ; après : 0. |

Aucune fuite de données n'a été constatée sur les routes métier. D1 est un défaut de fiabilité qui exposait une
erreur interne et rendait le comportement différent entre une référence étrangère et une référence inexistante.

## Faux positifs écartés pendant la mise au point (documentés pour traçabilité)

- **Traçabilité `GET /api/v1/tracabilite/{type}/{id}`** : le contrôle initial signalait une « fuite », car la route
  renvoie `entite.id` (l'identifiant demandé). Vérification : toutes les requêtes de la route sont filtrées par
  `organizationId` (journal, versions, analyses, chaîne). La route renvoie 200 avec 0 événement pour un identifiant
  étranger, **exactement comme pour un identifiant inexistant**. Le contrôle a été corrigé pour compter cette réponse
  comme indiscernable, et pour ignorer l'écho de l'identifiant demandé. Aucune fuite réelle.
- **Test FastAPI** : la première version passait pour une mauvaise raison (liste vide, `all([])` vrai). Corrigée : le test
  crée deux analyses, puis vérifie. Avec `--runxfail`, les deux échecs sont ceux attendus, sur 12 analyses réelles.
- **Contrôle base, politiques** : le premier contrôle cherchait le nom `tenant_isolation`, périmé depuis la migration
  022 (politiques par commande). Corrigé : propriété vérifiée, et non nom.
- **Contrôle base, insertion** : la première version ne testait pas le `WITH CHECK` (source invisible depuis B). Corrigée.
- **Limite de débit** : la campagne dépassait 150 requêtes / 10 s par organisation et déclenchait des 429 sur le E2E
  suivant. Le client de test respecte maintenant une pause de 70 ms, comme un client réel. **Un 429 reste un échec
  dans le contrôle**, il n'est jamais compté comme un refus.

## Sensibilité du test (mutations)

Un test qui ne peut pas échouer ne prouve rien. Deux mutations appliquées puis annulées :

| Mutation | Attendu | Observé |
|---|---|---|
| M2 : `GET /api/v1/plots/[id]` sans filtre `organizationId` **et** RLS désactivée sur `gf_plots` | Échec de la campagne HTTP | **12 échecs** : `200` avec la parcelle de la victime, au lieu du `404` attendu |
| M3 : RLS désactivée sur `gf_plots` (routes intactes) | Échec du contrôle base | **5 échecs** : lecture, modification et insertion au nom de A acceptées depuis B |

Après chaque mutation : fichier restauré depuis Git, RLS réappliquée (`npm run db:migrate` : 13/13 tables, 34 politiques),
build refait, campagne rejouée au vert.

## Périmètre non couvert et décisions à prendre

1. **Service FastAPI (`backend/`) : aucune notion d'organisation.** Base SQLite partagée, un seul jeton
   (`GF_BACKEND_API_TOKEN`) ouvre `/api/v1/audits` et `/api/v1/export/traces` pour toutes les organisations. Le produit
   Next.js ne l'appelle pas (`next.config.ts` : aucune réécriture ; `src/lib/api.ts` le documente), mais
   `docker-compose.yml` publie son port **8000** sur l'hôte. Mesure : la liste renvoyée à une organisation qui n'a rien créé
   contenait **12 analyses** appartenant à d'autres organisations. Deux tests `xfail(strict=True)` le consignent
   (`backend/tests/test_cross_tenant.py`).
   **Décision requise** (je ne tranche pas seul, car elle touche au déploiement) :
   - (a) retirer le service du déploiement et de `docker-compose.yml` (recommandé : le produit ne l'utilise pas) ;
   - (b) ou lui ajouter un modèle d'organisation et un jeton par organisation.
   Dans les deux cas, retirer le marqueur `xfail` au moment de la correction.
2. **Exécution automatique.** Les contrôles HTTP et base exigent un serveur réel, PostgreSQL et des comptes frais
   (MFA à réenrôler : `npm run seed:auth -- --reset`). La CI actuelle n'a pas de service PostgreSQL : ces contrôles ne
   tournent donc **pas** en CI. À traiter avec le chantier 5 (ou un job dédié).
3. **Routes d'authentification** (`/api/v1/auth/*`) : publiques par conception ; hors périmètre cross-tenant. Couvertes
   par E2E-001 et `test_backend_auth.py`.
4. **Insertion de `gf_organizations`** : testée au niveau RLS (au nom de A, depuis B : refusée). Aucune route ne crée
   d'organisation par API ; elle n'est donc pas testée au niveau HTTP.
5. **`GET /api/v1/auth/logout`** : appelle `POST` (`export const GET = POST`), donc une déconnexion par simple lien.
   Ce n'est pas un cloisonnement, mais c'est une faiblesse CSRF mineure à noter (P2).

## Reproduire

```bash
# 1. Base locale : migrations + RLS + comptes (mots de passe générés, hors dépôt)
npm run db:migrate
npm run seed:auth
# 2. Serveur de production avec le rôle applicatif (DATABASE_URL = geoforest_app)
npm run build && npx next start -H 0.0.0.0 -p 3100
# 3. Contrôles (ordre : HTTP crée les données, base les vérifie)
npm run seed:auth -- --reset
E2E_BASE_URL=http://127.0.0.1:3100 npm run test:cross-tenant
npm run test:cross-tenant:rls
# 4. Backend
cd backend && pytest -q
```

Les identifiants de connexion sont lus dans l'environnement (`E2E_PASSWORD`, `DATABASE_URL`, `DATABASE_URL_ADMIN`) et ne
sont jamais affichés.
