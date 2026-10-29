# Qualification de préproduction — 19 octobre 2026

**Dépôt** : `Huberaya/Geoforest`
**Branche de travail** : `arena/569eff1a-geoforest` → `main`
**Pull request** : [#8](https://github.com/Huberaya/Geoforest/pull/8), maintenue **ouverte et non fusionnée**
**SHA de code contrôlé** : `f1c82b5175494d28b49aff359e131a75730d0111`
**Base de comparaison approuvée** : `1c95f4c585ed8303f887089ae7450c9235523fd0` (`main`)

Ce document clôt la phase finale de qualification. Il rapporte **ce qui a été exécuté**, avec la preuve correspondante, et distingue explicitement ce qui a échoué, ce qui est bloqué par l'environnement et ce qui n'a pas été exécuté. Aucune conclusion de réussite n'est tirée d'un contrôle non exécuté.

**Ce qui n'a pas été fait, par construction** : aucune fusion de PR, aucune écriture sur `main`, aucun déploiement, aucune migration contre une base réelle, aucun accès aux secrets ou aux données de production, aucun `force push`, aucune rotation de secret ou de compte.

> **Portée du SHA.** Les contrôles de code, les suites de tests et les deux exécutions CI décrits ci-dessous portent sur `f1c82b5`. Le commit final de cette phase ajoute **ce document** et deux correctifs d'outillage découverts pendant les chantiers : la sonde de recette (`scripts/recette/postgresql-recette.sh`, défaut **V20**) et le script `test:eudr` (`package.json`, défaut **V21**). Il ne modifie aucun code applicatif. La CI est rejouée sur le SHA final ; le SHA exact et son résultat sont reportés dans la réponse de fin de phase et dans la PR #8.

---

## 1. État exact de la branche et de la pull request

### 1.1 Constat

| Élément | Valeur contrôlée | Source |
|---|---|---|
| `main` | `1c95f4c585ed8303f887089ae7450c9235523fd0` | `gh api .../branches/main` |
| Tête de la PR #8 | `f1c82b5175494d28b49aff359e131a75730d0111` | `gh pr view 8` |
| État de la PR | `OPEN`, `MERGEABLE`, `mergedAt` = jamais | `gh pr view 8 --json state,mergeable,mergedAt` |
| Commits d'avance | `ahead_by = 12`, `behind_by = 0` | `gh api .../compare/1c95f4c...f1c82b5` |
| Commits (rev-list) | 12 | `git rev-list --count 1c95f4c..HEAD` |
| Fichiers modifiés | 61 (31 ajoutés, 30 modifiés, **0 supprimé**) | `git diff --name-status` |
| Lignes | **+6946 / −614** | `git diff --shortstat` |
| Branches distantes | 19 autres branches, **aucune ne contient `f1c82b5`** | `git ls-remote` + `git branch -r --contains` |

Le graphe est **linéaire** : le premier commit de la PR (`04c9cc5`) a exactement `1c95f4c` pour parent, et les 12 commits se succèdent sans fusion ni ramification. Aucun commit n'a été réécrit : `main` est resté à `1c95f4c` pendant toute la phase.

### 1.2 Point d'attention — PR #7

Lors du dernier contrôle, la PR #7 (`arena/837c5c36-geoforest`, un autre travail) a évolué **indépendamment** : sa tête est passée de `3c65e47` à `ca15ccb` (`docs(phase 11): ...`, commit du 2026-10-19T21:37:21Z). Cette évolution n'a aucun lien avec cette session :

- la branche `arena/837c5c36-geoforest` n'a **jamais** existé dans ce dépôt local (`git branch -a` ne la liste pas) ;
- `git reflog --all` ne contient **aucune** occurrence de `837c5c36` ;
- aucune commande de cette session n'a ciblé la PR #7 ni poussé sur sa branche.

Les autres PR (#1 à #6) ont des têtes inchangées, cohérentes avec leurs branches distantes. Aucune PR n'a été fusionnée, fermée ou modifiée par cette session.

### 1.3 Relation avec le rapport de phase 3

`docs/rapport-securite-agent-b.md` cite encore, en tête, la tête `11ca162` (état antérieur) et un total de 9 commits dans son §9. Ces chiffres étaient exacts **au moment de leur rédaction**. L'écart avec les 12 commits actuels est expliqué au §2.2 ; le présent document fait foi pour l'état final.

---

## 2. Graphe Git et explication de l'écart de comptage

### 2.1 Les 12 commits (`1c95f4c..f1c82b5`)

| # | SHA | Message | Nature |
|---:|---|---|---|
| 1 | `04c9cc5` | Sécurité : isolation inter-tenant, authentification et non-régression | code + tests |
| 2 | `4f5970b` | fix(securite): fermer les fonctions d'authentification, fiabiliser la cadence, tester sous le rôle réel | code + tests |
| 3 | `8e9d570` | docs(rapport): consigner le SHA de vérification de la phase 2 | documentation |
| 4 | `465a19b` | ci: actions à jour et statut du premier passage GitHub consigné | CI + documentation |
| 5 | `56fbdac` | docs(rapport): établir la preuve avant/après de la révocation 023 | documentation |
| 6 | `bf813c4` | docs(rapport): préciser la portée des commits postérieurs à la vérification | documentation |
| 7 | `afb01e6` | docs(rapport): consigner les exécutions CI observées, sans course au SHA | documentation |
| 8 | `256acdc` | docs(rapport): chiffres du lint et liste des exécutions CI exacts | documentation |
| 9 | `9ab78e6` | fix(securite): recette PostgreSQL serveur, migrations robustes, colonnes d'authentification fermées | code + tests + documentation |
| 10 | `11ca162` | docs(rapport): phase 3 — recette serveur, V17 à V19 et statut des quatre risques | documentation |
| 11 | `b12f490` | docs(rapport): tête de branche, exécutions CI et rejeu final de la chaîne | documentation + artefact généré |
| 12 | `f1c82b5` | docs(rapport): intitulés de résultats alignés sur la phase 3 | documentation |

### 2.2 Pourquoi 9 commits dans le rapport et 12 sur GitHub

Le chiffre **9** du rapport correspond à l'état arrêté à `9ab78e6` (9e commit), au moment de la rédaction du §9. Trois commits documentaires ont été ajoutés ensuite :

| Commit ajouté | Contenu | Effet sur le code |
|---|---|---|
| `11ca162` | §8 « Phase 3 », V17–V19, statut R1–R4 | aucun |
| `b12f490` | en-tête, exécutions CI, rejeu final **+ `next-env.d.ts`** | aucun code applicatif |
| `f1c82b5` | alignement des intitulés de résultats | aucun |

**Il n'y a donc ni commit caché ni historique réécrit** : l'écart est entièrement expliqué par trois commits de documentation postérieurs au chiffre du rapport.

### 2.3 Diff réel recalculé

| Métrique | Valeur |
|---|---|
| Fichiers | 61 |
| Ajoutés / modifiés / supprimés | 31 / 30 / **0** |
| Insertions | +6946 |
| Suppressions | −614 |

Progression cumulée (fichiers / insertions / suppressions) :

| Commit | Fichiers | +/− |
|---|---:|---|
| `04c9cc5` | 34 | +2603 / −536 |
| `4f5970b` | 50 | +4782 / −607 |
| `8e9d570` | 50 | +4787 / −607 |
| `465a19b` | 50 | +4796 / −609 |
| `56fbdac` | 50 | +4802 / −609 |
| `bf813c4` | 50 | +4807 / −609 |
| `afb01e6` | 50 | +4811 / −609 |
| `256acdc` | 50 | +4812 / −609 |
| `9ab78e6` | 60 | +6400 / −612 |
| `11ca162` | 60 | +6935 / −612 |
| `b12f490` | 61 | +6946 / −614 |
| `f1c82b5` | 61 | +6946 / −614 |

### 2.4 Le 61e fichier est un artefact généré

`next-env.d.ts` a été réécrit par `npm run build` puis capturé dans `b12f490`. Le diff est de deux lignes :

```diff
-import "./.next/dev/types/routes.d.ts";
-import "./.next/dev/types/root-params.d.ts";
+import "./.next/types/routes.d.ts";
+import "./.next/types/root-params.d.ts";
```

Ce fichier est déclaré « should not be edited » par Next.js et est régénéré à chaque build ; les deux variantes pointent vers des types équivalents. Il est **conservé tel quel** : le retirer exigerait un commit supplémentaire sans effet fonctionnel, et l'historique déjà poussé n'est pas réécrit. Le compte de 61 fichiers inclut donc cet artefact ; hors artefact, le diff fonctionnel porte sur 60 fichiers.

### 2.5 Preuves d'ascendance

- `git rev-list --count 1c95f4c..HEAD` → `12`
- `gh api repos/Huberaya/Geoforest/compare/1c95f4c...f1c82b5` → `ahead_by=12`, `behind_by=0`
- `git branch -r --contains f1c82b5` → uniquement `origin/arena/569eff1a-geoforest`
- 19 autres branches distantes inventoriées ; aucune ne contient `f1c82b5`
- 13 artefacts clés (recette, scripts SQL `010/023/024`, tests, workflow, rapport) présents à `HEAD`

---

## 3. Matrice des contrôles

Statuts utilisés, sans acception supplémentaire : **RÉUSSI** (contrôle exécuté, résultat conforme), **ÉCHEC** (contrôle exécuté, résultat non conforme), **BLOQUÉ** (contrôle non exécutable dans l'environnement autorisé, avec preuve du blocage), **NON EXÉCUTÉ** (contrôle volontairement non exécuté ou hors périmètre, avec justification).

### 3.1 Chantier 1 — preuves Git

| # | Contrôle | Statut | Preuve |
|---|---|---|---|
| 1.1 | Tête de PR et `main` exactes | **RÉUSSI** | `f1c82b5…` et `1c95f4c…` ; `gh api branches/main` |
| 1.2 | PR ouverte, fusionnable, non fusionnée | **RÉUSSI** | `OPEN`, `MERGEABLE`, `mergedAt` absent |
| 1.3 | Avance/retard vs `main` | **RÉUSSI** | `ahead_by=12`, `behind_by=0` ; `rev-list --count` = 12 |
| 1.4 | Diff réel recompté | **RÉUSSI** | 61 fichiers, +6946/−614, 31 A / 30 M / 0 D |
| 1.5 | Écart 9 vs 12 expliqué | **RÉUSSI** | 3 commits documentaires postérieurs à `9ab78e6` (§2.2) |
| 1.6 | Travaux antérieurs présents | **RÉUSSI** | 13 artefacts clés contrôlés à `HEAD` |
| 1.7 | `main` et autres branches non modifiés par la session | **RÉUSSI** | `main` = `1c95f4c` ; aucune branche ne contient `f1c82b5` ; PR #7 a évolué indépendamment (§1.2) |

### 3.2 Chantier 2 — données géospatiales

| # | Contrôle | Statut | Preuve |
|---|---|---|---|
| 2.1 | Données géographiques non versionnées, `data/` ignoré | **RÉUSSI** | `.gitignore:52` = `data/` ; `git ls-files data` = 0 ; `data/frontieres/` absent |
| 2.2 | Aucune frontière dans tout l'historique | **RÉUSSI** | `git rev-list --all --objects \| grep -i fronti` = vide |
| 2.3 | Suite géospatiale backend exécutée | **RÉUSSI** | `pytest tests/test_geospatial.py -q` → exit 0, **3 skipped** (skip déclaré à la source) |
| 2.4 | Validation géospatiale avec frontières réelles | **NON EXÉCUTÉ** | Aucun test actif : les 3 tests décrivent des routes `/api/v1/geospatial/*` absentes (404) et sont marqués `pytest.mark.skip` |
| 2.5 | Pays inconnu non inventé | **RÉUSSI** | Sonde : `(0,0)` et `(-30,-20)` → `XX` / « Non déterminé » / `STANDARD` |
| 2.6 | Mode démonstration non probant | **RÉUSSI** | Sonde : `compliant=null`, `is_probative=false`, `source="simulated"` |
| 2.7 | Exactitude de l'attribution pays | **ÉCHEC** | Boîtes englobantes, premier match : Lomé (0,9 ; 8,0) → **GH** ; Arica (−70,3 ; −18,5) → **BR** (§5.1) |
| 2.8 | `npm run test:eudr` : défaut reproduit puis corrigé (**V21**) | **RÉUSSI** | Avant : exit 1, `Error: This module cannot be imported from a Client Component module` (`server-only`). Après ajout de la même condition que `test:sql`/`test:http` : exit 0, **24/24** |
| 2.9 | Suite EUDR exécutée sous la condition React Server | **RÉUSSI** | `NODE_OPTIONS=--conditions=react-server npx tsx scripts/check-eudr-rules.ts` → **24/24** |
| 2.10 | Réintroduction de données frontières | **NON EXÉCUTÉ** | Volontairement non fait : aucune provenance/licence décidée (§5.1.5), pas de réintroduction automatique |

### 3.3 Chantier 3 — recette PostgreSQL

| # | Contrôle | Statut | Preuve |
|---|---|---|---|
| 3.1 | Recette rejouée sur PostgreSQL serveur | **RÉUSSI** | exit 0 ; `version=16.2` ; 9 étapes + 6b ; **21/21** tests |
| 3.2 | Prérequis documentés | **RÉUSSI** | en-tête du script : `PG_BIN` (système ou paquet `pgserver`) |
| 3.3 | Nettoyage après succès | **RÉUSSI** | cluster arrêté, aucun répertoire `/tmp/geoforest-recette-*` |
| 3.4 | Nettoyage après échec (port occupé) | **RÉUSSI** | exit **1** ; `pg_ctl: could not start server` ; aucun répertoire résiduel |
| 3.5 | Nettoyage et code de sortie après SIGTERM | **RÉUSSI** (après correction **V20**) | exit **143**, cluster arrêté, aucun résidu ; avant correction : exit **0** malgré l'interruption (§5.2.6) |
| 3.6 | Aucun secret dans les journaux | **RÉUSSI** | 0 occurrence du mot de passe généré dans le journal de recette |
| 3.7 | Parcours HTTP complets sous `geoforest_app` sur PostgreSQL serveur | **BLOQUÉ** | Les suites HTTP tournent sous PGlite (mono-session) ; aucun accès à une base hébergée n'est autorisé dans cette phase |
| 3.8 | Recette sur base hébergée (Neon) | **BLOQUÉ** | Aucun environnement, propriétaire, rôle ni autorisation établis ; aucune base réelle touchée |

### 3.4 Chantier 4 — migrations et reprise

| # | Contrôle | Statut | Preuve |
|---|---|---|---|
| 4.1 | Base neuve : `010`, `023`, `024` et dépendances | **RÉUSSI** | exit 0 ; RLS **13/13** ; **34** politiques ; **0** fonction d'auth exécutable par `geoforest_app` ; **2** déclencheurs de journal |
| 4.2 | Reprise idempotente de `db:migrate` | **RÉUSSI** | 2e exécution exit 0, même état final |
| 4.3 | Échec de migration provoqué (base jetable) | **RÉUSSI** | `015_echec_recette.sql` injecté dans une copie de `HEAD` : exit **1**, `division by zero` |
| 4.4 | État mesuré après échec (schéma, RLS, données) | **RÉUSSI** | 14 tables métier ; RLS activée+forcée 13 ; **13** politiques ; **2** fonctions d'auth exécutables ; **0** déclencheur ; 7 migrations Drizzle ; base sans donnée |
| 4.5 | Reprise après retrait de l'échec | **RÉUSSI** | exit 0 ; **34** politiques ; **0** fonction d'auth exécutable ; **2** déclencheurs ; témoin conservé |
| 4.6 | Détection applicative d'une post-migration partielle | **ÉCHEC** | Aucune requête `pg_policies`/`pg_trigger` dans `src/` (seul un commentaire cite `024`) ; le contrôle de démarrage ne voit ni l'absence de politiques, ni les révocations manquantes |
| 4.7 | Retour arrière Drizzle | **RÉUSSI** | `db:rollback` annule `0006` ; puis **refus** (exit 1) pour `0005` faute de `.down.sql`, migration non désenregistrée |
| 4.8 | Descendantes des scripts `010` à `024` | **NON EXÉCUTÉ** | Aucun `.down.sql` pour les post-migrations ; aucune procédure de retour arrière fournie |
| 4.9 | Aucune base réelle touchée | **RÉUSSI** | Cluster `initdb` sous `/tmp/pg-qualif`, port 55435, supprimé après usage |

### 3.5 Chantier 5 — CI et risques opérationnels

| # | Contrôle | Statut | Preuve |
|---|---|---|---|
| 5.1 | Run `push` sur `f1c82b5`, toutes les étapes | **RÉUSSI** | run [`39324886085`](https://github.com/Huberaya/Geoforest/actions/runs/39324886085) : `success`, 3 jobs, toutes étapes `success` |
| 5.2 | Run `pull_request` sur `f1c82b5`, toutes les étapes | **RÉUSSI** | run [`39324894430`](https://github.com/Huberaya/Geoforest/actions/runs/39324894430) : `success`, 3 jobs, toutes étapes `success` |
| 5.3 | Audit des dépendances de production | **RÉUSSI** | `npm run audit:sec` → exit 0, **0 vulnérabilité** |
| 5.4 | Risque `braces` identifié | **RÉUSSI** | `npm run audit:dev` → exit 1, **5 high** (`braces`), `first_patched_version: None` |
| 5.5 | Autres PR non modifiées | **RÉUSSI** | #1–#6 inchangées ; #7 a évolué indépendamment, sans aucune action de cette session |
| 5.6 | Rotation des secrets et des comptes de démonstration | **NON EXÉCUTÉ** | Volontairement : aucune autorisation, aucun environnement réel (§6) |
| 5.7 | Contrôle périodique de la chaîne d'audit | **NON EXÉCUTÉ** | Opération d'exploitation à planifier (§6) |

### 3.6 Synthèse de la matrice

| Statut | Nombre |
|---|---:|
| RÉUSSI | 32 |
| ÉCHEC | 2 |
| BLOQUÉ | 2 |
| NON EXÉCUTÉ | 5 |
| **Total** | **41** |

Les deux **ÉCHEC** ne sont pas des régressions introduites par la branche : l'un porte sur une limite préexistante du moteur géospatial (`resolveCountry` par boîtes), l'autre sur l'absence de garde-fou applicatif contre une post-migration partielle. Le défaut d'outillage `test:eudr` a été reproduit, corrigé (V21) puis vérifié. Les cinq **NON EXÉCUTÉ** sont tous justifiés et listés en annexe B.

---

## 4. Résultats des tests et des deux intégrations continues

### 4.1 Suites locales

| Suite | Commande | Résultat | Preuve |
|---|---|---|---|
| TypeScript | `npm run typecheck` | 0 erreur | TSC exit 0 |
| Lint | `npm run lint` | 0 erreur, **5 avertissements** | sortie ESLint |
| Tests unitaires | `npm run test:unit` | **36/36** | exit 0 |
| Tests SQL | `npm run test:sql` | **42/42** | exit 0 |
| Contrats HTTP | `npm run test:http` | **25/25** | exit 0 |
| Build Next.js | `npm run build` | succès **sans variables d'environnement** | exit 0 |
| Backend Python | `pytest` | **55 passed, 3 skipped** | exit 0 |
| Audit production | `npm run audit:sec` | **0** vulnérabilité | exit 0 (rejoué pendant cette phase) |
| Audit développement | `npm run audit:dev` | **5 high** (`braces`) | exit 1 (attendu, voir §6) |
| Lockfile | `npm ci --dry-run` | cohérent | exit 0 |
| Règles EUDR | `npm run test:eudr` (corrigé V21) | **24/24** | exit 0 |
| Suite géospatiale backend | `pytest tests/test_geospatial.py` | 3 skipped | exit 0 |

### 4.2 Recette PostgreSQL serveur

| Élément | Résultat |
|---|---|
| Version serveur | **PostgreSQL 16.2** (binaires `pgserver` 0.1.4) |
| Cluster | jetable, `initdb` sous `/tmp`, port **55433**, `fsync=off`, `listen_addresses=127.0.0.1` |
| Rôles | `geoforest_owner` (propriétaire, `NOSUPERUSER NOBYPASSRLS CREATEROLE`), `geoforest_app` (login, sans `BYPASSRLS`) |
| Migrations base neuve | 7 migrations Drizzle + post-migrations `010/020/021/022/023/024` |
| RLS | **13/13** tables protégées, **34** politiques, `gf_sessions` et `gf_login_attempts` exclues (justifié) |
| Reprise | 2e `db:migrate` idempotent |
| Concurrence | 20 tentatives → **9 autorisées / 11 refusées** (`attempts=20`) ; l'assertion exige 9, alors que le libellé du test annonce « 10 essais » — écart de libellé, sans effet sur le contrôle |
| Cadence partagée | 2 instances, clé unique `024` respectée |
| Journal d'audit | chaîne intacte → code 0 ; falsification → code 1 |
| Tests `recette-serveur.test.ts` | **21/21** |
| Codes de sortie | succès 0 ; échec 1 ; interruption 143 (après V20) |
| Nettoyage | cluster arrêté et répertoire supprimé dans les trois cas |

### 4.3 Intégrations continues sur `f1c82b5`

| Run | Événement | SHA | Conclusion | Jobs |
|---|---|---|---|---|
| [`39324886085`](https://github.com/Huberaya/Geoforest/actions/runs/39324886085) | `push` | `f1c82b5` | `success` | 3/3 |
| [`39324894430`](https://github.com/Huberaya/Geoforest/actions/runs/39324894430) | `pull_request` | `f1c82b5` | `success` | 3/3 |

Les **étapes** de chaque job ont été contrôlées une par une (`gh api .../runs/{id}/jobs`), pas seulement le badge :

- **Frontend** : checkout, Node, `npm ci` strict, typecheck, lint, tests unitaires, build, audit production, puis étapes de clôture → toutes `success` ;
- **Backend FastAPI** : checkout, Python, installation + tests → toutes `success` ;
- **Base de données et contrats HTTP (PGlite)** : checkout, Node, `npm ci` strict, tests SQL, tests HTTP → toutes `success`.

Aucune étape `failure`, `cancelled` ou `skipped` sur ces deux runs.

### 4.4 Ce que la CI ne couvre pas

La CI **ne lance pas** : la recette PostgreSQL serveur (`scripts/recette/postgresql-recette.sh`), `npm run test:eudr`, ni la suite géospatiale (désactivée à la source). Ces contrôles ont donc été exécutés **manuellement** et sont rapportés comme tels. La CI ne remplace pas la recette serveur : elle utilise PGlite, mono-session, qui ne peut pas rejouer la concurrence réelle ni les rôles PostgreSQL.

### 4.5 Après le commit final

Le commit qui ajoute ce document et les correctifs V20/V21 déclenche deux nouveaux runs (`push` et `pull_request`) sur le SHA final. Leur conclusion est reportée dans la réponse de fin de phase ; aucun résultat n'est anticipé ici.

---

## 5. État des données géospatiales et des migrations

### 5.1 Données géospatiales

#### 5.1.1 Inventaire

| Élément attendu | Présent ? | Détail |
|---|---|---|
| `data/frontieres/` (ou équivalent) | **Non** | Répertoire absent de l'arbre de travail et de tout l'historique |
| Fichiers GeoJSON / shapefile de frontières | **Non** | `git ls-files data` = 0 ; `git rev-list --all --objects` ne contient aucune entrée « frontière » |
| `.gitignore` | **Oui** | ligne 52 : `data/` (données locales exclues du versionnement) |
| Référence code à un fichier de frontières | **Aucune** | Le moteur n'ouvre aucun fichier géographique |
| Routes backend `/api/v1/geospatial/*` | **Non** | Absentes ; les tests correspondants répondent 404 et sont marqués `skip` |
| Résolution du pays | **Oui, par boîtes** | 39 boîtes englobantes codées en dur dans `src/lib/eudr/satellite-checker.ts` |
| Hotspots de déforestation | **Oui, simulés** | 6 zones codées en dur, mode démonstration explicite |

#### 5.1.2 Comportement en l'absence de frontières

Le moteur **n'invente pas** de pays. Un point hors de toute boîte reçoit :

```
iso2 = "XX", name = "Non déterminé", risk = "STANDARD"
```

et, en mode démonstration, le résultat porte :

```
compliant = null      (aucun verdict)
is_probative = false  (non probant)
source = "simulated"
details = "Simulation : aucun scénario … Pays : Non déterminé (XX) …"
```

Le mode démonstration est signalé dans les journaux (`[GFW] mode démonstration activé : résultat simulé, non probant.`). En mode `gfw-live`, si l'API est configurée mais échoue, le moteur retourne un résultat **indisponible** et **aucun verdict** — il ne bascule pas silencieusement vers une simulation. Ces comportements ont été vérifiés par sonde et par la suite `check-eudr-rules.ts` (24/24).

#### 5.1.3 Limite démontrée : les boîtes ne sont pas des frontières

`resolveCountry` parcourt 39 rectangles et retourne le **premier** qui contient le point. Conséquences mesurées :

| Point | Pays réel | Résultat du moteur |
|---|---|---|
| `(0,9 ; 8,0)` | Togo (Lomé) | **GH** (Ghana) |
| `(−70,3 ; −18,5)` | Chili (Arica) | **BR** (Brésil) |
| `(−55,0 ; −25,5)` | Paraguay (Ciudad del Este) | **BR** (Brésil) |

Ces erreurs sont **acceptables pour une démonstration explicitement non probante**, mais elles ne le sont pas pour un usage réglementaire opposable : le pays et le niveau de risque sont des données EUDR. Aucune donnée de frontière n'a été introduite pour corriger cela : la décision de versionner un jeu de données (provenance, licence, intégrité) n'appartient pas à cette phase.

#### 5.1.4 Tests géospatiaux

`backend/tests/test_geospatial.py` contient 3 tests qui décrivent une API `/api/v1/geospatial/*` inexistante à ce SHA. Ils sont **explicitement ignorés**, pas supprimés : le fichier documente que ces tests étaient rouges sur `main` et rendaient la suite inutilisable comme garde-fou. Exécution : exit 0, **3 skipped**. La couverture géospatiale réelle est donc **nulle** ; c'est un fait rapporté, pas un succès déguisé.

#### 5.1.5 Proposition (non appliquée)

Si une résolution exacte devient nécessaire, la correction reproductible serait :

1. choisir un jeu **versionné** (par exemple Natural Earth Admin-0, domaine public), avec version, licence et empreinte SHA-256 ;
2. le placer dans un chemin **explicitement versionné** (le motif `data/` l'ignorerait aujourd'hui) ou dans un stockage externe documenté ;
3. remplacer les boîtes par un test point-dans-polygone, en conservant le repli `XX` ;
4. ajouter des tests de non-régression sur des points frontaliers (Lomé, Arica) et un test d'intégrité du fichier.

Aucune de ces étapes n'a été exécutée : elle requiert une décision explicite sur la provenance et la licence.

#### 5.1.6 Défaut V21 — `npm run test:eudr` : corrigé et vérifié

Le script publié à `f1c82b5` (`"test:eudr": "tsx scripts/check-eudr-rules.ts"`) **échouait** en exit 1 :

```
Error: This module cannot be imported from a Client Component module.
```

La chaîne d'import atteint `src/lib/observability/metriques.ts`, qui importe `server-only`. Le paquet `server-only` lève une exception hors condition `react-server`. Or les trois autres scripts de test (`test:unit`, `test:sql`, `test:http`) déclarent déjà `NODE_OPTIONS=--conditions=react-server` ; seul `test:eudr` avait été oublié. Le défaut existe sur `main` et n'est pas introduit par la branche.

**Correction appliquée** : ajout du même préfixe à `test:eudr`, sans modifier ni le script de vérification ni les règles testées. Vérification : `npm run test:eudr` → exit 0, **24/24 contrôles réussis**. Le correctif est inclus dans le commit final ; il ne change aucune règle métier et n'affaiblit aucun test.

### 5.2 Migrations et récupération

#### 5.2.1 Inventaire

| Fichier | Rôle | Vérifié |
|---|---|---|
| `drizzle/0000` → `0006` | schéma initial et évolutions | oui (7 migrations) |
| `scripts/sql/post-migrate/010_row_level_security.sql` | RLS, `current_org()`, fonctions d'auth `SECURITY DEFINER` | oui |
| `020_tracabilite_append_only.sql` | journal append-only, chaîne de condensats, suppression logique | oui |
| `021_chaine_continue.sql` | continuité de la chaîne | oui |
| `022_politiques_suppression_logique.sql` | politiques de suppression logique | oui |
| `023_fonctions_auth_revoquees.sql` | révocation de l'exécution des fonctions d'auth au rôle applicatif | oui |
| `024_cadence_cle_unique.sql` | clé unique de cadence, dédoublonnage | oui |

#### 5.2.2 Base neuve (témoin de l'état correct)

| Indicateur | Valeur |
|---|---|
| Tables métier (`gf_*`) | 14 |
| Tables avec RLS activée / forcée | 13 / 13 |
| Politiques | **34** |
| Fonctions `auth_user_by_*` exécutables par `geoforest_app` | **0** |
| Déclencheurs sur `gf_audit_logs` | 2 |
| Index sur `gf_login_attempts` | 3 (dont 2 uniques) |
| Colonnes `public` | 243 |
| Migrations Drizzle enregistrées | 7 |

#### 5.2.3 Reprise idempotente

Une seconde exécution de `db:migrate` sur la base déjà migrée sort en **exit 0**, réapplique les post-migrations sans erreur et laisse exactement le même état (34 politiques, 0 fonction d'auth exécutable, 2 déclencheurs).

#### 5.2.4 Échec provoqué — protocole

Sur une **copie** de `HEAD` (`git archive`, jamais le dépôt), un fichier `015_echec_recette.sql` a été ajouté entre `010` et `020` :

```sql
-- Injection de recette : échoue APRÈS 010 et AVANT 020.
select 1 / 0 as division_par_zero;
```

Base jetable `geoforest_echec` sur le cluster `55435`, rôle propriétaire `geoforest_owner` (sans `BYPASSRLS`). `db:migrate` sort en **exit 1** avec `🔴 Migration échouée : division by zero`.

#### 5.2.5 État après l'échec, puis après reprise

| Indicateur | Après échec | Après reprise |
|---|---:|---:|
| Migrations Drizzle enregistrées | 7 | 7 |
| Tables avec RLS activée / forcée | 13 / 13 | 13 / 13 |
| Politiques | **13** | **34** |
| Fonctions d'auth exécutables par `geoforest_app` | **2** | **0** |
| Déclencheurs sur `gf_audit_logs` | **0** | **2** |
| Colonnes `public` | 243 | 243 |

**Constat de sécurité** : une post-migration interrompue laisse la base dans un état **partiellement durci**, avec les fonctions d'authentification encore exécutables par le rôle applicatif et le journal sans déclencheur append-only. Cet état n'est pas détecté au démarrage (`src/` ne consulte ni `pg_policies` ni `pg_trigger`). La procédure d'exploitation doit donc imposer : **ne jamais servir le trafic tant que `db:migrate` n'a pas terminé en exit 0**, puis vérifier les compteurs ci-dessus.

**Reprise** : le fichier d'échec retiré, `db:migrate` sort en **exit 0** et rétablit l'état complet. Un témoin inséré dans `gf_organizations` avant la reprise est **conservé** (1 ligne, visible uniquement avec `app.current_org` posé) ; sans ce contexte, la même requête retourne 0 ligne — la RLS reste fail-closed.

#### 5.2.6 Retour arrière

| Test | Résultat |
|---|---|
| `db:rollback` sur `0006_idempotence` | exit 0, descendante appliquée, migration désenregistrée |
| `db:rollback` suivant (sur `0005_tracabilite`) | **exit 1**, refus explicite : aucune `.down.sql` pour `0005`, migration **non** désenregistrée |
| `db:migrate` après ce refus | exit 0, état complet rétabli (34 politiques, 7 migrations) |

Le refus est le comportement attendu : une descente manquante ne doit pas être traitée comme une descente sans effet. Limites :

- `010`, `020`, `021`, `022`, `023`, `024` n'ont **aucune** descendante ; aucun retour arrière de ces durcissements n'est fourni ;
- une migration Drizzle sur sept (`0005`) n'a pas de descendante ;
- `db:rollback` ne remet pas la base dans l'état d'un code antérieur : il ne défait que le schéma Drizzle, pas les post-migrations.

#### 5.2.7 Défaut V20 — code de sortie après interruption

La recette utilisait `trap nettoyer EXIT INT TERM` avec `local statut=$?`. Dans un piège de **signal**, `$?` vaut le statut de la dernière commande (souvent 0) : le script interrompu sortait donc en **exit 0** après avoir nettoyé. Le défaut a été reproduit (SIGTERM → exit 0), corrigé par des pièges séparés (`EXIT` → `$?`, `INT` → 130, `TERM` → 143) et revérifié (SIGTERM → **exit 143**, aucun résidu). Le correctif est inclus dans le commit final.

---

## 6. Risques résiduels, actions d'exploitation et validations externes

### 6.1 Risques résiduels

| ID | Risque | Gravité | Statut | Preuve / portée |
|---|---|---|---|---|
| R-01 | `braces` ≤ 3.0.3 : épuisement de pile (GHSA-vfj7-8cjw-p6xm) | élevée (outil de développement) | **Risque résiduel accepté** | `audit:dev` = 1 entrée, 5 high ; **aucun correctif amont** (`first_patched_version: None`) ; chaîne uniquement `eslint-config-next → … → braces`, absente du build de production |
| R-02 | Attribution pays par boîtes englobantes | moyenne pour un usage probant | **Non corrigé** | Lomé → GH, Arica → BR ; sans effet sur le mode démonstration (non probant), mais à corriger avant toute revendication EUDR |
| R-03 | Aucune donnée de frontière versionnée | moyenne | **Assumé** | `data/` ignoré ; proposition §5.1.5 non appliquée |
| R-04 | `npm run test:eudr` échouait tel que publié | moyenne (outillage) | **Corrigé et vérifié (V21)** | Avant : exit 1 (`server-only`) ; après : exit 0, 24/24 |
| R-05 | Post-migration partielle non détectée au démarrage | élevée si le trafic est servi | **Risque opérationnel** | État mesuré §5.2.5 ; aucune requête `pg_policies`/`pg_trigger` dans `src/` |
| R-06 | Pas de descendante pour `010`–`024` ni `0005` | moyenne | **Limite documentée** | `db:rollback` refuse au lieu de mentir ; restauration de sauvegarde requise |
| R-07 | Parcours HTTP non rejoués sous `geoforest_app` sur PostgreSQL serveur | moyenne | **BLOQUÉ** | PGlite mono-session ; recette 6b couvre l'usage légitime des fonctions d'auth |
| R-08 | Recette sur base hébergée non exécutée | moyenne | **BLOQUÉ** | Aucun accès réel autorisé ; à planifier avant mise en production |
| R-09 | 5 avertissements de lint | faible | **Connu** | Aucune erreur ; `npm run lint` exit 0 |
| R-10 | `next-env.d.ts` modifié (artefact) | faible | **Connu** | 2 lignes générées ; §2.4 |

### 6.2 Contrôles automatisés vs opérations à planifier

**Déjà automatisé et bloquant dans la CI** : typecheck, lint, tests unitaires (36), tests SQL (42), contrats HTTP (25), build, audit des dépendances de production, tests backend (55).

**À planifier hors CI** — aucune de ces actions n'a été exécutée :

1. **Rotation des secrets** : `DATABASE_URL`, `DATABASE_URL_ADMIN`, `JWT_SECRET`, clés GFW, stockage S3, selon `docs/EXPLOITATION-secrets-et-audit.md` §2, avec double écriture et période de recouvrement.
2. **Inventaire et rotation des comptes de démonstration** : `verif:comptes-demo -- --apres=AAAA-MM-JJ`, suppression ou rotation de `admin@`, `conformite@`, `auditeur@`, `lecteur@geoforest.eu`, `admin@tenant-b.test`.
3. **Contrôle périodique de la chaîne d'audit** : exécution planifiée de `verif:chaine` (une altération doit sortir en code 1) et conservation des preuves.
4. **Recette sur environnement hébergé** (Neon ou équivalent) : rôles, RLS, concurrence, restauration.
5. **Garde-fou post-migration** : ajouter une assertion `pg_policies`/`pg_trigger`/`has_function_privilege` exécutée après `db:migrate` et au démarrage, pour rendre R-05 impossible à ignorer.
6. **Réactivation de la suite géospatiale** lorsque les routes `/api/v1/geospatial/*` existeront (le script `test:eudr` est déjà corrigé, V21).

### 6.3 Validations externes requises

- revue juridique EUDR des mentions et des jeux de données (aucune revendication probante ne doit s'appuyer sur le mode démonstration) ;
- tests d'intrusion et revue de configuration de l'hébergeur ;
- validation par l'exploitant des procédures de sauvegarde/restauration et de la fenêtre de maintenance ;
- décision explicite sur la provenance et la licence d'un jeu de frontières.

---

## 7. Conclusions distinctes

### 7.1 Qualité du code

**Conforme aux contrôles exécutés, avec réserves documentées.**

La branche est linéaire, sans régression détectée : 36 tests unitaires, 42 tests SQL, 25 contrats HTTP, 55 tests backend (3 skipped), 24/24 contrôles EUDR, build sans variables, typecheck et lint sans erreur, audit de production à 0. Les durcissements `010`/`023`/`024` sont effectifs sur base neuve et la reprise est idempotente. Deux limites subsistent, sans effet sur les garanties de sécurité principales : attribution pays approximative par boîtes englobantes, et absence de garde-fou contre une post-migration partielle. Le défaut d'outillage `test:eudr` a été corrigé et vérifié (V21).

### 7.2 Qualification de préproduction

**Favorable sous conditions, pas inconditionnelle.**

La recette PostgreSQL 16.2 est verte (21/21), rejouée sur un cluster jetable, avec nettoyage vérifié en succès, en échec et sur interruption. La CI est verte sur les deux événements, étape par étape. Mais la qualification reste **partielle** sur trois points explicitement non exécutés ou bloqués : recette sur base hébergée, parcours HTTP sous rôle applicatif sur PostgreSQL serveur, et validation géospatiale avec frontières réelles. Ces points doivent être soldés avant d'annoncer une préproduction « prête ».

### 7.3 Autorisation de mise en production

**Non accordée par cette phase.**

Cette phase ne dispose ni du mandat ni des accès nécessaires pour autoriser un déploiement. Une mise en production exigerait, au minimum : la fusion de la PR #8 (autorisation distincte), l'exécution de la recette sur l'environnement cible, la rotation des secrets et des comptes de démonstration, la vérification de la chaîne d'audit en exploitation, et la correction de R-05 (garde-fou post-migration). Aucune fusion, aucun déploiement, aucune migration sur une base réelle n'a été effectué.

---

## Annexe A — preuves et artefacts

| Preuve | Emplacement |
|---|---|
| Journal de recette (succès) | `var/preuves/17-qualification-recette-serveur.log` (ignoré par Git) |
| Recette : échec et interruption | `var/preuves/18-qualification-recette-echec-et-interruption.log` |
| Migrations : base neuve, idempotence, échec, reprise, rollback | `var/preuves/19-qualification-migrations.log` |
| Géospatial : `test:eudr`, sonde, mode démonstration | `var/preuves/20-qualification-geospatial.log` |
| CI : jobs et étapes des deux runs | `var/preuves/21-qualification-ci-jobs.txt` |
| Rapport de phase 3 (contexte, V17–V19) | `docs/rapport-securite-agent-b.md` |

Commandes principales rejouées :

```bash
# Git
gh pr view 8 --json state,mergeable,mergedAt,headRefOid,baseRefOid
gh api repos/Huberaya/Geoforest/compare/1c95f4c...f1c82b5
git diff --shortstat 1c95f4c..HEAD && git diff --name-status 1c95f4c..HEAD

# Recette (cluster jetable)
PG_BIN=<pginstall>/bin RECETTE_PORT=55433 bash scripts/recette/postgresql-recette.sh

# Migrations (base jetable)
DATABASE_URL_ADMIN=<url-jetable> npm run db:migrate
DATABASE_URL_ADMIN=<url-jetable> npm run db:rollback

# Géospatial et règles EUDR
npm run test:eudr
cd backend && pytest tests/test_geospatial.py -q

# CI, étape par étape
gh api repos/Huberaya/Geoforest/actions/runs/39324886085/jobs
gh api repos/Huberaya/Geoforest/actions/runs/39324894430/jobs
```

Aucun mot de passe, jeton ou secret n'est reproduit dans ce document ni dans les journaux conservés.

## Annexe B — ce qui n'a pas été exécuté

1. Recette sur une base hébergée (Neon ou autre) — **BLOQUÉ**, aucun accès autorisé.
2. Parcours HTTP complets sous `geoforest_app` sur PostgreSQL serveur — **BLOQUÉ**, PGlite mono-session.
3. Rotation des secrets et des comptes de démonstration — **NON EXÉCUTÉ**, opération d'exploitation.
4. Contrôle périodique planifié de la chaîne d'audit — **NON EXÉCUTÉ**, à planifier.
5. Validation géospatiale avec un jeu de frontières réel — **NON EXÉCUTÉ**, aucune donnée versionnée ni décision de licence.
6. Descendantes des post-migrations `010`–`024` — **NON EXÉCUTÉ**, absentes du dépôt.
7. Fusion, déploiement, migration réelle — **NON EXÉCUTÉ**, hors mandat.
