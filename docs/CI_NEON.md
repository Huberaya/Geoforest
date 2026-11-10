# CI — contrôles base et HTTP sur branche Neon éphémère

Chantier 2 (restes) et chantier 1 (« test:db et E2E ne sont pas dans la CI »).

## Principe

Les contrôles `test:db`, `test:e2e`, `test:cross-tenant`, `test:export-identite:http` et `test:fournisseur:http` modifient ou réinitialisent la
base (`seed:auth -- --reset`, migrations, création de données). Ils ne s'exécutent donc **jamais** sur la base de
production. Le job `database` de `.github/workflows/ci.yml` :

1. crée une branche Neon `ci-geoforest-<run>` à partir de la branche parente désignée (`NEON_PARENT_BRANCH_ID`) ;
2. applique les migrations sur cette branche ;
3. fixe un mot de passe **aléatoire** au rôle `geoforest_app`, sur cette branche seulement ;
4. lance les contrôles (`test:db`, `test:e2e`, `test:cross-tenant`,
   `test:export-identite:http`, `test:fournisseur:http`, `test:dds-etats:http`,
   `test:evidence:http`), avec un réamorçage des comptes de démonstration avant
   chaque parcours, puis la preuve RLS en base (`test:cross-tenant:rls`) **en
   dernier** : elle lit les lignes créées par tous les parcours précédents et
   échoue volontairement si elle est vacueuse ;
5. supprime la branche dans une étape `always()`.

Chaque suite est lancée via `scripts/ci/annoter.sh "<titre>" npm run test:…` :
le journal est inchangé, mais chaque ligne d'échec (« 🔴 ») est relayée en
annotation GitHub (`::error::`) et la synthèse finale en `::notice::`. Les
annotations sont lisibles par l'API (`check-runs/{id}/annotations`) même quand
le journal brut n'est pas téléchargeable (run 40930475126 du 29/10/2026 : échec
de la preuve RLS sans journal exploitable). Le code de sortie est conservé.
L'ordre et l'enveloppe sont vérifiés par `scripts/ci/check-workflow.test.cjs`.

## Secrets GitHub à configurer (Settings → Secrets and variables → Actions)

| Nom | Contenu |
|---|---|
| `NEON_API_KEY` | Clé d'API Neon (portée minimale possible). |
| `NEON_PROJECT_ID` | Identifiant du projet Neon (`…`, format `xxx-yyy-123456`). |
| `NEON_PARENT_BRANCH_ID` | Identifiant de la branche parente (`br-…`). |

Sans ces secrets, le job **échoue** dès la création de la branche : aucune base n'est choisie par défaut.

## Garde-fous

- `scripts/ci/neon-branche.ts` ne supprime que des branches `br-…` qu'il a lui-même créées (identifiant mémorisé pour le run).
- `seed:auth -- --reset` refuse toute base non locale, sauf si `GF_BASE_JETABLE=oui` (positionné par le job seulement).
- Les contrôles s'exécutent avec le rôle applicatif `geoforest_app` : `023` a retiré
  l'exécution des fonctions d'authentification à ce rôle, et les parcours doivent
  passer par les chemins prévus (connexion d'administration dans les routes qui
  en ont besoin) — une régression y est visible immédiatement.
- Les secrets de test (`AUTH_SECRET`, `GF_STORAGE_SIGNING_SECRET`, mot de passe de démonstration) sont tirés au hasard à chaque run et masqués.

## Point à trancher : données copiées

Une branche Neon est une copie de sa parente, **données comprises** — schéma
hérité inclus. Constaté le 09/11/2026 (runs 42717343596 et 42724931100) : la
parente désignée étant la production, la branche de CI contenait des tables
`public.*` portant `organization_id` **étrangères au dépôt** (`documents`,
`diligence_dossiers`, `audit_events`, …), avec des politiques qui ne reposent
pas sur `current_org()`. `test:cross-tenant:rls` contrôle donc **toute** table
`organization_id` de `public`, selon deux invariants, sans en ignorer aucune :

- **tables du dépôt** (schéma Drizzle `src/db/schema.ts`) : RLS activée et
  forcée, politiques toutes conditionnées par `current_org()`, 0 ligne sans
  contexte, cloisonnement A/B en lecture/écriture/suppression/insertion,
  intégrité des comptages ;
- **toute autre table** : le rôle applicatif `geoforest_app` n'y a **aucun
  privilège** (catalogue, mesuré par l'administrateur) et une lecture lui est
  **refusée** (42501, mesurée par le rôle lui-même — un `GRANT … TO PUBLIC` ou
  un héritage de rôle se voient ainsi).

Si une table étrangère est lisible par le rôle applicatif, la preuve échoue :
c'est un défaut d'isolation **entre applications** sur la base parente, à
traiter côté exploitant (`REVOKE`), jamais en assouplissant le contrôle.
L'inventaire des deux familles est imprimé en tête de section.

Une branche Neon est une copie de sa parente, **données comprises**. Si `NEON_PARENT_BRANCH_ID` désigne la branche de
production, les données personnelles de production (courriels, noms) sont copiées dans la branche de test pendant la
durée du job, puis supprimées. Il est préférable de désigner une branche parente sans donnée réelle (schéma seul, ou
données fictives). Ce choix relève de l'exploitant.

## Limites

- Le sandbox de développement ne peut pas joindre l'API Neon : la création, la migration et la suppression n'ont été
  vérifiées que contre un faux serveur qui reproduit les formes de réponse de la documentation. La première exécution
  réelle est le premier run du job `database` avec les secrets configurés.
- Une annulation brutale du job laisse en principe la branche à la suppression de l'étape `always()` ; un contrôle
  périodique des branches `ci-geoforest-*` reste à prévoir.
