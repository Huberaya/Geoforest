# CI — contrôles base et HTTP sur branche Neon éphémère

Chantier 2 (restes) et chantier 1 (« test:db et E2E ne sont pas dans la CI »).

## Principe

Les contrôles `test:db`, `test:e2e`, `test:cross-tenant` et `test:fournisseur:http` modifient ou réinitialisent la
base (`seed:auth -- --reset`, migrations, création de données). Ils ne s'exécutent donc **jamais** sur la base de
production. Le job `database` de `.github/workflows/ci.yml` :

1. crée une branche Neon `ci-geoforest-<run>` à partir de la branche parente désignée (`NEON_PARENT_BRANCH_ID`) ;
2. applique les migrations sur cette branche ;
3. fixe un mot de passe **aléatoire** au rôle `geoforest_app`, sur cette branche seulement ;
4. lance les contrôles, puis le serveur de production ;
5. supprime la branche dans une étape `always()`.

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
- Les secrets de test (`AUTH_SECRET`, `GF_STORAGE_SIGNING_SECRET`, mot de passe de démonstration) sont tirés au hasard à chaque run et masqués.

## Point à trancher : données copiées

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
