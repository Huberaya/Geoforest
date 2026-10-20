# Rapport : Phase 12.1 — fermeture des réserves des lots A/B

**Auteur : Agent Arena.ai (Arena.ai — Agent Mode)**
**Date : 2026-10-20**
**Branche : `integration/lot-a-b-identite-build`** (PR [#9](https://github.com/Huberaya/Geoforest/pull/9), **non fusionnée**)
**SHA de départ : `a17146957e16c4208c2e9cab0868d203649fd5fa`**
**Cumul de référence : `a5450492ad60fbc028e278f962bc13e04b30d095`**

---

## 0. Contrôle d'entrée

| Élément | Attendu | Constaté | Verdict |
|---|---|---|---|
| Branche | `integration/lot-a-b-identite-build` | idem | ✅ |
| HEAD de départ | `a17146957e16c4208c2e9cab0868d203649fd5fa` | idem (`git ls-remote` avant tout travail) | ✅ |
| Cumul `arena/e7725e3f-geoforest` | `a5450492…` | idem | ✅ inchangé |
| `main` | — | `1c95f4c585ed8303f887089ae7450c9235523fd0` | ✅ inchangée |
| `arena/837c5c36-geoforest` | — | `ca15ccb195363f27a656f0c23caebf811330b3a2` | ✅ inchangée |

Le travail a été fait dans un **worktree séparé** (`/home/user/phase121`), sur une branche locale du même nom créée au SHA exact. Le checkout principal (`/home/user/Geoforest`, `1c95f4c` + 48 modifications non attribuées) **n'a reçu aucune écriture**.

---

## 1. SHA et commits

**SHA final : `cf6f1170ae8669967f85fdd5933ecc1f06771d0b`** (avant le commit de ce rapport)

| SHA | Objet |
|---|---|
| `fcf7125b9e5b6b575159e3a9317bc1e507f4d11b` | Mission 1 — contrôle HTTP réel de l'export (422 sans identité) |
| `65c1bc16a9ef01956d3283892aac2de8b2224e13` | Mission 2 — pool tenant : plus de connexion fictive, initialisation paresseuse |
| `cf6f1170ae8669967f85fdd5933ecc1f06771d0b` | Missions 4/5 — banc du pool tenant dans `test:unit`, liste des contrôles lisible |

Le commit de ce rapport est **documentaire** : il ne contient aucun code, et son run CI est consigné dans la PR #9.

---

## 2. Fichiers modifiés et justification

**8 fichiers, +872 / −97** (`git diff --stat a171469..cf6f117`).

| Fichier | Δ | Justification |
|---|---|---|
| `scripts/check-export-identite-http.ts` | +414 (nouveau) | Mission 1 — contrôle HTTP réel de la route d'export |
| `.github/workflows/ci.yml` | +8 | exécuter ce contrôle sur la branche Neon éphémère, après réinitialisation des comptes |
| `src/db/index.ts` | +103/−? | Mission 2 — suppression de l'URL fictive, initialisation paresseuse |
| `src/db/paresseux.ts` | +90 (nouveau) | proxy de transparence partagé entre les deux pools (extrait de `admin.ts`, comportement inchangé) |
| `src/db/admin.ts` | −79 | le proxy est déplacé, pas modifié fonctionnellement |
| `scripts/check-pool-tenant.ts` | +266 (nouveau) | Mission 2 — 28 contrôles de non-régression |
| `scripts/check-pool-admin.ts` | +6/−? | Mission 4 — affichage complet de la liste (voir § 6) |
| `package.json` | +3/−1 | déclarer `test:export-identite:http` et le banc du pool tenant dans `test:unit` |

Aucun fichier métier, aucune migration, aucun schéma n'est touché par cette phase.

---

## 3. Mission 1 — test HTTP réel de l'export TypeScript

### 3.1 Pourquoi un test HTTP était nécessaire

`resoudreIdentiteExport()` est une fonction pure : 7 cas la couvrent, mais ils n'établissent **pas** qu'un client reçoit un 422. Entre la fonction et la réponse, il y a le garde d'authentification, la lecture bornée du corps, les contrôles préalables (géométrie, analyse, déforestation, producteur, dossier rattaché), la sérialisation et le statut HTTP. Un test unitaire ne peut en prouver aucun.

### 3.2 Ce que le test exerce

`scripts/check-export-identite-http.ts` passe par **HTTP**, sur un serveur `next start` réel et une base migrée. Il ne réutilise pas la fonction pure : il observe le statut, l'en-tête `content-type`, le corps JSON **et** le corps XML.

| # | Contrôle | Attendu |
|---|---|---|
| 1 | Création d'audit sans opérateur | 201, `operator_name/eori/country` **NULL** en base |
| 2 | Export JSON, identité absente | **422**, `code: OPERATOR_IDENTITY_MISSING`, `operator_identity: missing` |
| 3 | Message de refus | ne contient aucune identité de remplacement, annonce l'absence de fabrication |
| 4 | Export **XML**, identité absente | 422 + même code (le second format n'est pas un contournement) |
| 5 | Effet de bord | `draft_reference` reste NULL après un 422 |
| 6 | Dossier hérité (`XX0000000000000`) en JSON | 422, `operator_identity: legacy_placeholder` |
| 7 | Dossier hérité en XML | 422 |
| 8 | Valeur héritée après refus | inchangée en base (`XX0000000000000` / `XX`) |
| 9 | Identité fournie à l'export (JSON) | **200**, EORI présent dans la déclaration |
| 10 | Pays non déclaré | déduit de l'EORI (`FR`), jamais un `FR` par défaut |
| 11 | Audit après export réussi | identité **toujours NULL** — l'export ne réécrit pas l'audit |
| 12 | Dossier hérité + identité fournie (XML) | **200**, EORI fourni présent, valeur héritée conservée |
| 13 | Identité stockée valide | 200, `operator.reference_number.identifier` = EORI du dossier |
| 14 | Nom du dossier | 200, nom repris |
| 15 | Pays en base NULL → déclaration | `FR` déduit, base toujours `NULL` |
| 16 | **Priorité des 409** — analyse non probante | **409**, pas 422 ; pas de code d'identité |
| 17 | **Priorité des 409** — déforestation établie | 409 `blocked: true` |
| 18 | **Priorité des 409** — géométrie invalide | 409 |
| 19 | Cloisonnement | organisation étrangère → **404**, jamais 422 ni export |
| 20 | Aucune réponse 5xx | ✅ |

**Résultat local : 31 contrôles, 0 échec** (certains contrôles regroupent plusieurs assertions).

### 3.3 Infrastructure réellement utilisée

| Élément | Valeur |
|---|---|
| PostgreSQL | **16.2** (binaire embarqué `pgserver`), conteneur `/tmp`, **jamais une base réelle** |
| Migrations | `npm run db:migrate` → `0000` … `0009` + post-migrate `010` … `025`, **exit 0** |
| Contrôle RLS du migrateur | `13/13` tables protégées, 34 politiques |
| Rôles | `geoforest_app` (application, `NOBYPASSRLS`) / `postgres` (admin) |
| Comptes | `npm run seed:auth -- --reset` sur base **déclarée jetable** (`GF_BASE_JETABLE=oui`) |
| Serveur | `next start -p 3100 -H 127.0.0.1`, `NODE_ENV=production` |
| Secrets | générés **pour ce run local**, jamais commités, supprimés après (`/tmp` nettoyé) |

### 3.4 Contrôles HTTP de non-régression exécutés sur ce même serveur

Le pool tenant ayant été réécrit (mission 2), tous les parcours HTTP existants ont été rejoués sur le code final :

| Parcours | Commande | Résultat |
|---|---|---|
| Parcours de bout en bout | `npm run test:e2e` | **49/49**, exit 0 |
| Cloisonnement cross-tenant | `npm run test:cross-tenant` | **262/262**, exit 0 |
| Machine d'état DDS | `npm run test:dds-etats:http` | **39 contrôles**, exit 0 |
| Parcours fournisseur | `npm run test:fournisseur:http` | **57/57**, exit 0 |
| Contrôles de base | `npm run test:db` | exit 0, rôle conforme |
| Export / identité (nouveau) | `npm run test:export-identite:http` | **31/31**, exit 0 |

⚠️ **Incident de mesure consigné.** Un premier passage de `test:fournisseur:http` a échoué sur **1** vérification (`429` au lieu de `403`). Cause identifiée : le limiteur de cadence est **par IP** (`src/proxy.ts`), et plusieurs campagnes HTTP enchaînées depuis `127.0.0.1` avaient épuisé le quota de rafale. Après redémarrage du serveur (compteurs en mémoire remis à zéro) et réinitialisation des comptes : **57/57**. Ce n'était donc pas une régression du produit, mais un artefact de l'enchaînement local — la CI exécute chaque parcours une fois, depuis un runner neuf.

### 3.5 CI

Le contrôle est ajouté au job « Database & HTTP contracts (Neon branch) », **après** une réinitialisation des comptes de démonstration (l'enrôlement MFA d'un compte déjà utilisé empêche une seconde connexion : la mesure locale l'a confirmé, `MFA déjà enrôlé`, et c'est exactement l'ordre que suit la CI).

---

## 4. Mission 2 — `src/db/index.ts`

### 4.1 Imports et usages

`src/db/index.ts` exporte `pool` et `db` (Drizzle). Deux importateurs seulement :

- `src/lib/tenant.ts` — `withTenant()`, qui ouvre la transaction et pose `app.current_org` (RLS) ;
- `src/lib/alerting/regles.ts` — `db.execute(sql\`select 1\`)` dans un contrôle d'alerte.

`withTenant` est importé par **toutes** les routes métier via `guard` : le module est donc chargé au démarrage de chaque route, y compris pendant la collecte des pages du build.

### 4.2 Construction à l'import — mesurée, pas supposée

Avant correction, avec `DATABASE_URL` absente :

```
NODE_ENV=development
  → [db] DATABASE_URL absente : toute requête échouera (aucun identifiant par défaut).
  → import OK
  → pool.query("select 1")  →  ECONNREFUSED 127.0.0.1:1
```

`NODE_ENV=production`, sans `DATABASE_URL` :

```
  → import  →  throw « DATABASE_URL est requis en production … »
```

`NEXT_PHASE=phase-production-build`, sans `DATABASE_URL` :

```
  → import OK  →  pool.query  →  ECONNREFUSED 127.0.0.1:1
```

**Conclusion : le risque était réel, pas théorique.**

1. L'URL `postgresql://absente:absente@127.0.0.1:1/absente` **n'était pas inerte** : elle était transmise au pilote `pg`, et toute requête tentait une connexion TCP vers le port 1.
2. L'erreur rendue à l'appelant était `ECONNREFUSED 127.0.0.1:1` — un symptôme **réseau** qui **ne nomme pas** `DATABASE_URL`. C'est précisément la configuration absente masquée par une erreur trompeuse que le mandat interdit.
3. L'identité `absente:absente` est une **identité de connexion fabriquée**, de la même famille que le placeholder d'opérateur du lot A.

### 4.3 Correction minimale

- Plus aucune URL de repli, plus aucune identité fictive.
- `pool`/`db` sont construits au **premier usage** (`src/db/paresseux.ts`, partagé avec `adminPool`), jamais à l'import.
- Sans configuration, le premier usage lève : `DATABASE_URL est requis pour toute connexion à la base : aucune connexion de remplacement n'est ouverte.`
- **En production, l'import échoue immédiatement** (règle P0 conservée) : un serveur mal configuré ne démarre pas.

### 4.4 Interaction avec le build — mesurée par sonde

Une sonde temporaire (retirée immédiatement, `git status` propre vérifié) a mesuré, pendant `npm run build` :

```
[sonde] NODE_ENV=production NEXT_PHASE=phase-production-build DATABASE_URL=absente BUILD_PHASE=true
```

La collecte des pages s'exécute donc bien en `NEXT_PHASE=phase-production-build` : l'import reste autorisé au build, et l'échec fail-closed ne concerne que le **serveur de production**. `next build` sans aucune base : **exit 0**.

### 4.5 Interactions avec les tests et l'authentification

| Situation | Comportement vérifié |
|---|---|
| `test:unit` sans base | exit 0 (aucun test n'ouvre de connexion) |
| `test:db` sur base réelle | exit 0, `rôle applicatif : geoforest_app`, `superutilisateur : non`, `BYPASSRLS : non` |
| Authentification (login, MFA, sessions) | couverte par `test:e2e` (49/49) et `test:cross-tenant` (262/262) |
| Démarrage en production **sans** `DATABASE_URL` | `next start` échoue explicitement et **nomme `DATABASE_URL`** (message remonté par le contrôle de rôle de `instrumentation.ts`) |
| Démarrage en développement sans `DATABASE_URL` | démarre ; chaque requête échoue en nommant la variable |

> ⚠️ Comportement préexistant, **non modifié** : l'échec du hook d'instrumentation se manifeste en `unhandledRejection` et le processus ne sort pas de lui-même (le serveur n'écoute alors aucun port utile). Ce défaut appartient à `src/instrumentation.ts`, hors du périmètre du lot ; il est signalé en risque résiduel (§ 8).

### 4.6 Non-régression — `scripts/check-pool-tenant.ts`, 28 contrôles

| Groupe | Contrôles |
|---|---|
| Sans configuration (développement) | import sans exception · aucun pool construit · `pool` lève en nommant `DATABASE_URL` · message **sans** « absente » ni `127.0.0.1:1` · `db` lève de même · import de `withTenant` sans exception |
| Phase de build | les 5 mêmes contrôles |
| Production sans configuration | refus explicite à l'import (fail-closed) |
| Configuration fournie | aucun pool à l'import · `pool.query` fonction · méthode liée · `instanceof Pool` · `constructor` réel · prototype réel · `Object.keys` non vide · spread non vide · `'query' in pool` · `db.transaction` lié · `Object.keys(db)` non vide · **échec réel `ECONNREFUSED`** du pool · **échec réel** via `db.execute` |

Note technique : Drizzle **enveloppe** l'erreur du pilote (`code` porté par `cause`, message de surface « Failed query »). Le contrôle vérifie les deux emplacements, pour ne pas confondre une régression du pool avec un changement de forme d'erreur — ni conclure à un succès silencieux.

`adminPool` n'a pas changé de comportement : `check-pool-admin.ts` reste à **27/27**.

---

## 5. Mission 3 — audit des cinq vulnérabilités

Source : `npm audit --audit-level=high` (exit **1**), `npm audit --omit=dev` (exit **0**, `found 0 vulnerabilities`).
**Les deux sont distincts** : l'audit complet n'est pas l'audit de production.

### 5.1 Inventaire

| Paquet | Sévérité | Direct ? | Chemin d'introduction | Correctif proposé par npm |
|---|---|---|---|---|
| `braces` 3.0.3 | high | non | `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → **`braces`** | aucun (via `eslint-config-next@14.2.35`, **semver-major descendant**) |
| `micromatch` 4.0.8 | high | non | idem, une marche au-dessus | idem |
| `fast-glob` 3.3.1 | high | non | idem | idem |
| `@next/eslint-plugin-next` 16.3.8 | high | non | dépend de `fast-glob` | idem |
| `eslint-config-next` 16.3.8 | high | **oui** (devDependency) | dépend de `@next/eslint-plugin-next` | idem |

Les cinq entrées sont **une seule vulnérabilité réelle** (`braces`) propagée le long d'une chaîne de dépendances. Elles sont toutes **dev** (`"dev": true` dans `package-lock.json`).

### 5.2 Nature de la vulnérabilité

| Champ | Valeur |
|---|---|
| Avis | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) / **CVE-2026-93687** |
| Identifiant npm | 1240992 |
| Titre | braces — stack exhaustion through deeply nested patterns |
| CWE | CWE-674 (récursion non contrôlée) |
| CVSS | **7.5** (CVSS 3.1 : `AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`) — des sources tierces citent 8.7 en CVSS 4 |
| Plage affectée | `<= 3.0.3` |
| **Version corrigée** | **aucune** (`first_patched_version: null`) |
| Dernière version publiée | `braces@3.0.3` (2024-09-18) — donc **la dernière version est vulnérable** |
| En amont | `micromatch/braces` #70, ouvert, non assigné |

### 5.3 Correctif réellement applicable ? **Non**

Trois pistes ont été testées ou évaluées :

| Piste | Résultat |
|---|---|
| Monter `micromatch` | 4.0.8 est déjà la dernière ; sa dépendance est `braces: ^3.0.3` → résout 3.0.3 |
| Monter `fast-glob` | dernière = 3.3.3 ; **override testé** (`"fast-glob": "^3.3.3"`), appliqué puis `npm install` → `fast-glob` 3.3.3 installé, **audit toujours à 5 high**. Override **retiré** : il ne corrige rien et modifie le lockfile sans bénéfice. |
| Monter `eslint-config-next` | 16.3.8 est la version du projet ; `@next/eslint-plugin-next@16.4.2` (dernière) dépend **toujours** de `fast-glob@3.3.1`. Aucune version de Next ne sort de la chaîne. |
| `npm audit fix --force` | proposerait `eslint-config-next@14.2.35`, c'est-à-dire une **rétrogradation majeure** de l'outillage de lint. Refusée. |

**Aucun correctif n'existe.** Le paquet vulnérable est la dernière version publiée de sa bibliothèque.

### 5.4 Exposition mesurée

| Preuve | Résultat |
|---|---|
| `npm ls braces micromatch fast-glob --omit=dev` | **vide** — absents de l'arbre de production |
| `grep -rn "braces\|micromatch\|fast-glob" src/ backend/ scripts/` | **aucune occurrence** — aucun code applicatif ne les importe |
| Bundle serveur / client (`.next/server`, `.next/static`) | aucune trace de `braces` |
| Usage réel | `@next/eslint-plugin-next` appelle `fast-glob` pour lister les fichiers du dépôt lors du lint |
| Entrée contrôlée par un attaquant ? | **non** — les motifs proviennent de la configuration du dépôt (`eslint.config.mjs`), pas d'une requête |

Le vecteur est un motif `{a,{b,{c,…}}}` profond (≥ ~3500 niveaux). Il n'existe **aucun chemin** par lequel une requête HTTP utilisateur atteindrait `braces`.

### 5.5 Mesures de réduction et prochaine action

Mesures en place (aucune ne masque l'alerte) :

1. **le gate de production reste bloquant** : `npm audit --omit=dev --audit-level=high` → **0** vulnérabilité, exit 0 ;
2. `npm run audit:sec` reste exécuté **séparément** et sort en **1** : l'alerte est visible, non supprimée ;
3. **aucun `ignore`, aucune suppression d'avis, aucun override factice** n'a été ajouté — un override vers une version inexistante serait un mensonge de lockfile ;
4. `braces` n'est atteignable qu'au lint, sur des motifs du dépôt.

**Prochaine action requise** : surveiller la publication d'une version `braces > 3.0.3`, puis mettre à jour `micromatch` (ou forcer `braces` dès qu'une version corrigée existe), relancer `npm audit`, et vérifier que `eslint-config-next` reprend la chaîne. Échéance de revue proposée : **2026-12-02** (alignée sur les exceptions d'audit publiées par d'autres projets pour le même avis).

---

## 6. Mission 4 — réconciliation des décomptes du lot B

### 6.1 Origine de l'écart 26 / 27

Le script `scripts/check-pool-admin.ts` a été écrit puis **complété en cours de mise au point**. Le relevé à **26** correspond à un état intermédiaire, avant l'ajout du contrôle « import de `/api/metrics` sans configuration » (5ᵉ contrôle du premier groupe). Le script **committé** (`38b6dce`) contient **27** appels `check()` et le run affiche **27**. Aucun contrôle n'a disparu entre-temps : l'écart vaut exactement **+1**, et il est daté.

### 6.2 Liste exacte des 27 contrôles du lot B (`check-pool-admin.ts`)

**Groupe 1 — import sans aucune configuration (`NEXT_PHASE=phase-production-build`) — 5 contrôles**

1. import sans configuration : aucune exception
2. import sans configuration : aucun pool construit
3. accès sans configuration : échec explicite nommant `DATABASE_URL_ADMIN`
4. `dbAdmin` sans configuration : échec explicite
5. **import de `/api/metrics` sans configuration : aucune exception** ← *le contrôle ajouté après le relevé à 26*

**Groupe 2 — configuration présente : accès réel et transparence du proxy — 22 contrôles**

6. import avec configuration : aucune exception
7. aucun pool construit à l'import
8. `typeof adminPool.query === 'function'`
9. méthode liée : `adminPool.query === adminPool.query`
10. `adminPool instanceof Pool`
11. prototype réel exposé
12. constructeur réel
13. classes exposées non liées
14. `'query' in adminPool`
15. `Object.keys` non vide
16. spread non vide
17. descripteur propre lisible
18. `toString` hérité du prototype réel
19. affectation déléguée
20. propriété ajoutée visible par réflexion
21. suppression déléguée
22. `typeof dbAdmin.select === 'function'`
23. `dbAdmin.select` lié
24. `Object.keys(dbAdmin)` non vide
25. appel effectif : échec explicite (aucun succès silencieux)
26. l'échec est une erreur de connexion identifiée — `ECONNREFUSED`
27. `end()` lié et appelable

**5 + 22 = 27.** Le compteur imprimé et la liste affichée sont désormais cohérents : le parent filtrait les lignes de l'enfant sur leur indentation, après un `trim()` qui mangeait celle de la **première** ligne (décompte juste, liste incomplète). Corrigé en `trimEnd()` — c'est le seul changement de `check-pool-admin.ts` dans cette phase.

### 6.3 Autres décomptes, par catégorie

| Jeu | Local | CI | Base éphémère | Statut |
|---|---|---|---|---|
| Lot A — identité TS (`check-identite-operateur.ts`) | **22** | oui (`test:unit`) | non requise | ✅ |
| Lot A — identité Python (`pytest tests/test_operateur_identite.py`) | **27** | oui (`Install backend dependencies & test`) | non requise | ✅ |
| Lot A — **HTTP** export (`check-export-identite-http.ts`) | **31** | **oui (nouveau)** | **oui** (Neon) | ✅ (local + CI) |
| Lot B — pool admin (`check-pool-admin.ts`) | **27** | oui (`test:unit`) | non requise | ✅ |
| Lot B — **pool tenant** (`check-pool-tenant.ts`) | **28** | **oui (nouveau dans `test:unit`)** | non requise | ✅ |
| Suite backend complète | **138 passed, 5 xfailed** | oui | non requise | ✅ |
| Migrations PostgreSQL 16.2 (harnais phase 12) | **23** | — | oui (locale) + Neon | ✅ |
| Parcours HTTP existants (e2e 49, cross-tenant 262, DDS 39, fournisseur 57) | **407** | oui | oui (Neon) | ✅ |

---

## 7. Qualification finale — commandes et codes de sortie

Exécutées dans `/home/user/phase121`, sur `cf6f117` puis `65c1bc1`/`fcf7125` pour les contrôles HTTP.

| # | Contrôle | Commande | Code | Résultat |
|---|---|---|---|---|
| 1 | Typecheck | `npx tsc --noEmit` | **0** | aucune erreur |
| 2 | Lint | `npm run lint` | **0** | aucune erreur |
| 3 | Tests unitaires + bancs | `npm run test:unit` | **0** | 72/72 · 22/22 · **27/27** · **28/28** · 40/40 · 25/25 · 27/27 |
| 4 | Tests backend | `cd backend && python -m pytest -q` | **0** | **138 passed, 5 xfailed** |
| 5 | Build **sans base** | `env -u DATABASE_URL -u DATABASE_URL_ADMIN npm run build` | **0** | compilé, `/api/metrics` présent |
| 6 | Test des workflows CI | `npm run test:ci` | **0** | 4/4 |
| 7 | Audits | `npm run audit:sec` | **1** | 5 high, **toutes dev** — alerte non masquée |
| 8 | Audit production | `npm audit --omit=dev` | **0** | `found 0 vulnerabilities` |
| 9 | Dérive de schéma | `npx drizzle-kit generate` | **0** | `No schema changes, nothing to migrate` |
| 10 | Migration sur base éphémère | `npm run db:migrate` (PostgreSQL 16.2) | **0** | 0000→0009 + 010→025, RLS 13/13 |
| 11 | Contrôles de base | `npm run test:db` | **0** | rôle conforme |
| 12 | HTTP export/identité | `npm run test:export-identite:http` | **0** | **31/31** |
| 13 | HTTP existants | `test:e2e` · `test:cross-tenant` · `test:dds-etats:http` · `test:fournisseur:http` | **0** | 49/49 · 262/262 · 39 · 57/57 |
| 14 | Recherche d'identité fictive | `grep -rn "absente:absente" src/ scripts/ backend/` | — | **commentaires seulement**, aucun chemin de code |

### CI

Le run du **SHA final** est consigné dans la PR #9 (un fichier versionné ne peut pas citer le run du commit qui le contient). Les jobs attendus sont les deux du workflow `ci.yml` ; le nouveau pas `Export identity HTTP controls` doit apparaître dans « Database & HTTP contracts (Neon branch) ».

---

## 8. Limites et risques résiduels

1. **`braces` / CVE-2026-93687 — non corrigeable aujourd'hui.** Aucune version corrigée n'existe. Exposition **outillage de lint uniquement** (§ 5.4). Mesure : gate de production à 0, alerte laissée visible. Revue proposée au 2026-12-02.
2. **`src/instrumentation.ts`** : en production sans `DATABASE_URL`, l'échec du contrôle de rôle se manifeste en `unhandledRejection` et le processus **ne sort pas** de lui-même. Comportement **préexistant** (il l'était tout autant avec l'ancienne URL fictive, qui produisait `ECONNREFUSED`), non modifié ici : le corriger demande de décider du sort du processus au démarrage, ce qui dépasse ce lot. Le message, lui, nomme désormais correctement `DATABASE_URL`.
3. **`country_of_activity` par défaut `"FR"`**, `ProducerCountry: "XX"`, plancher `country_risk`/`risk_level` `STANDARD` : **inchangés**, hors périmètre (décisions produit/géographiques, lot distinct).
4. **Attribution de l'identité au producteur** (`producer.same_as_operator`) désormais conditionnée à l'existence d'un opérateur — comportement du lot A, non retouché ici.
5. **`test:fournisseur:http` est sensible à la cadence par IP** : deux campagnes consécutives depuis la même IP échouent en `429`. Constaté, expliqué, et non corrigé — la CI n'exécute chaque parcours qu'une fois.
6. **Neon** : la migration 0009 y a déjà été appliquée avec succès par les runs précédents ; **aucune nouvelle exécution n'a été demandée** localement, conformément à la consigne. Le run du SHA final la rejouera sur une branche éphémère.
7. **Les lots Agent C, GFW, SI EUDR et la qualification terrain restent hors périmètre** : aucun accès GFW, aucune certification EUDR, aucune validation terrain n'est affirmée dans ce rapport.

---

## 9. Confirmation

- **Aucune fusion** : PR #9 reste ouverte.
- **Aucun déploiement**.
- **`main` inchangée** : `1c95f4c585ed8303f887089ae7450c9235523fd0`.
- **Branches sources inchangées** : `arena/e7725e3f-geoforest` = `a5450492ad60fbc028e278f962bc13e04b30d095`, `arena/837c5c36-geoforest` = `ca15ccb195363f27a656f0c23caebf811330b3a2`.
- **Aucun force push**, aucun `reset --hard`, aucun `clean -fd`.
- **Aucune migration publiée modifiée**, aucun schéma touché dans cette phase.
- **Aucune base réelle utilisée** : PostgreSQL 16.2 éphémère en local, branche Neon éphémère en CI.
- **Aucun secret** dans le dépôt, les commits ou ce rapport ; les secrets du run local ont été générés pour l'occasion et supprimés.
- **Aucune vulnérabilité masquée** : `audit:sec` reste rouge et documenté.

**Verdict : réserves fermées sur preuves pour les missions 1, 2 et 4 ; mission 3 documentée sans correctif possible (aucune version corrigée n'existe) ; mission 5 exécutée.** Le projet Geoforest n'est **pas** terminé : Agent C, GFW, SI EUDR et qualification terrain restent ouverts.

---

**Auteur : Agent Arena.ai (Arena.ai — Agent Mode)**
**Rapport : Phase 12.1 — fermeture des réserves des lots A/B**
