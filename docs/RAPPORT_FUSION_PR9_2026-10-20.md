# Rapport — intégration de la PR #9 dans la branche de la PR #8

**Date** : 2026-10-20
**Branche** : `arena/569eff1a-geoforest` — tête `215ebfc`
**Pull request** : #8 (« Sécurité, isolation inter-tenant et lot A/B : identité opérateur, invitations fournisseur, build Neon »)
**PR intégrée** : #9 `integration/lot-a-b-identite-build` (`39111c1`), fermée comme **intégrée**

---

## 1. Objet

Réunir deux lignes de travail issues de la même base (`1c95f4c`) :

- la **ligne de sécurité** (PR #8, `35c5d06`) : authentification, RLS, cadence,
  garde-fou de schéma, recette PostgreSQL serveur, CI à trois jobs ;
- la **ligne lot A / lot B** (PR #9, `39111c1`) : identité opérateur sans
  fiction, invitations fournisseur, pools d'administration/tenant paresseux,
  migrations `0007`–`0009` et scripts `023`–`025`.

La fusion a été faite **dans la branche de la PR #8**, pas sur `main` : les
migrations de la PR #9 doivent précéder tout déploiement, et Vercel déploie au
push sans migrer.

Commit de fusion : **`e9114dc`**, parents `35c5d06` (PR #8) et `39111c1` (PR #9).
Aucun squash, aucun commit réécrit : les deux historiques restent lisibles.

**Volume de la branche depuis `main`** : 203 fichiers, **+32 979 / −1 189**.

---

## 2. Déroulement

| Étape | Résultat |
|---|---|
| Audit préalable des deux branches | base commune `1c95f4c`, contenu vérifié par empreintes (239/239 identiques) |
| Fusion `--no-ff` de `origin/integration/lot-a-b-identite-build` | **19 conflits** (dont 8 après première résolution), 77 fichiers ajoutés automatiquement |
| Résolution | aucun marqueur `<<<<<<<` / `>>>>>>>` dans les sources ; `git diff --diff-filter=U` vide |
| Vérifications locales | PostgreSQL 16.2 vierge, rôle `geoforest_app` sans `BYPASSRLS` |
| Correctifs révélés par l'exécution | 7 défauts corrigés (section 4) |
| CI | 4 échecs successifs corrigés, puis **tous les jobs verts** |

---

## 3. Arbitrages de la fusion

| Sujet | Décision | Motif |
|---|---|---|
| `src/lib/eudr/identite-operateur.ts` | **module union** : un seul classement `declared` / `missing` / `legacy_placeholder`, prédicats `nomValide`, `eoriValide`, `paysValide`, `resoudreIdentiteExport()` pure | deux vocabulaires coexistaient (`COMPLETE/ABSENTE/PARTIELLE` d'un côté) : le même dossier pouvait être « complet » ici et « absent » là. Choisir un côté cassait soit l'export de #9, soit les contrôles de #8 |
| migrations | `0009` conservée, `025` conserve son apport (produits, sentinelle, contrainte) **après** elle | drizzle s'exécute avant les scripts de sûreté ; `025` ne duplique plus la DDL de `0009` |
| sentinelle `XX0000000000000` | **écriture refusée** par contrainte ; état `legacy_placeholder` conservé pour les bases non migrées | une identité fabriquée ne doit jamais pouvoir être stockée |
| export TRACES | ordre : géométrie (409) → identité (422) → valeur probante (409) → déforestation (409) | « analyse non probante » ne doit pas masquer un défaut d'identité |
| `country_of_activity` | **obligatoire**, aucun repli `FR` | le pays d'activité n'est pas déductible d'autre chose |
| `traces-exporter` | plus de `"XX"`, `NO_VERDICT` sans analyse probante, attribution `approximate_bbox` avec avertissement | un pays inventé ou un verdict implicite est une fausse preuve |
| backend FastAPI | `router_protege` + `require_backend_token`, `/health` seule route publique | une seule règle d'accès, vérifiée pour toutes les routes de données |
| `.env.example`, `docker-compose.yml`, `README` | version #9 + compléments sécurité | le backend n'est plus déployé ; deux connexions base documentées |
| fichiers « par côté » (routes, composants, tests backend) | version #9, justifiée par ses gardes 404/422 déjà présentes | éviter une troisième variante non testée |

---

## 4. Défauts trouvés et corrigés pendant l'intégration

| # | Symptôme | Cause | Correctif | Preuve |
|---|---|---|---|---|
| 1 | Tests backend en masse en 401/503 | `require_backend_token` lisait `settings.backend_token`, **gelé à l'import** | lecture de `GF_BACKEND_TOKEN` **à chaque requête** | 28 échecs → 138 passés / 3 ignorés / 2 xfailed |
| 2 | Nom de jeton incohérent | tests et client utilisaient `GF_BACKEND_API_TOKEN`, que plus personne ne lit | alignement sur `GF_BACKEND_TOKEN` | CI `Verify Frontend & Backend` verte |
| 3 | `POST /suppliers/{id}/invitation` → **500** | `auth_user_by_email()` n'est plus exécutable par `geoforest_app` (script `023`) | recherche d'unicité d'adresse par la connexion d'administration, 4 champs seulement | parcours fournisseur 57/57 |
| 4 | `DELETE /suppliers/{id}/invitation` → **500** | le rôle applicatif n'a **pas** le droit de lire `gf_users` (ni de lister les comptes) | recherche du compte à révoquer par la connexion d'administration, filtre d'organisation explicite | révocation : session refusée à la requête suivante |
| 5 | Export refusé illisible pour l'un des deux contrats | `code`/`operator_identity` attendus en tête par le contrôle lot A, `error.code` par les tests HTTP | réponse 422 portant **les deux formes** | `tests/http` 34/34 **et** contrôle export 33/33 |
| 6 | Contrôle export cassé sur dossier « hérité » | `025` interdit désormais d'écrire la sentinelle : la fixture ne peut plus être créée | le contrôle vérifie le refus `23514` puis un 422 `missing` | 33/33 |
| 7 | `products.country_of_origin` : pays `FR` inventé | `notNull().default("FR")` en base et dans le schéma Drizzle | colonne **nullable sans défaut**, `025` retire le défaut existant | typecheck, migrations 13/13 |
| 8 | `.env.example` : variable de signature absente | fusion incomplète des deux listes | `GF_STORAGE_SIGNING_SECRET` restaurée, `GF_BACKEND_DOCS`/`GF_BACKEND_TOKEN` conservés | `git diff` des trois `.env.example` |
| 9 | Chemins publics incomplets | la route d'activation `invitation/accept` n'était déclarée ni publique ni gardée | ajoutée à la liste **exacte** + testée (préfixe non ouvert) | unit 52/52 |
| 10 | Pool d'administration : URL factice | `PoolAdministration` construisait `postgresql://absent@127.0.0.1:1/absent` | erreur explicite nommant `DATABASE_URL_ADMIN`, au premier usage réel | 28 contrôles pool, build sans base |
| 11 | Export sans identité : EORI vide déclaré « complet » | la règle n'exigeait que la forme du nom et de l'EORI | nom et EORI requis, pays facultatif mais jamais inventé | unit identité, contrôle 23/23 |

---

## 5. Vérifications

### 5.1 Environnement

PostgreSQL **16.2** local, base **vierge**, rôle `geoforest_app`
(`rolsuper = false`, `rolbypassrls = false`), mot de passe de test posé à la
main. Aucune donnée réelle, aucun secret de production.

### 5.2 Résultats

| Contrôle | Résultat |
|---|---|
| Migrations | **13/13** : drizzle `0000`–`0009`, puis `010`, `020`–`025` |
| RLS | **13/13 tables**, **34 politiques**, 2 déclencheurs de journal, 0 fonction d'auth exécutable par le rôle applicatif |
| `scripts/verifier-role.ts` | ✅ conforme (pas de `BYPASSRLS`, aucun droit de destruction) |
| Parcours e2e | **49/49** |
| Cross-tenant HTTP | **262/262**, aucune 5xx |
| Export identité HTTP | **33/33** |
| Parcours fournisseur HTTP | **57/57** |
| Tests unitaires | **52/52** |
| Contrats SQL | **52/52** |
| Contrats HTTP | **34/34** |
| Contrôles métier (`test:controles`, 9 scripts) | **tous verts** (EUDR **72/72**, readiness 25, DDS 40, preuves 27, pools 28…) |
| Backend Python | **138 passés**, 3 ignorés, 2 xfailed |
| Build | `npm run build` **sans base ni secrets** : succès |
| Lint / typecheck | 0 erreur |

### 5.3 CI

PR #8, tête `215ebfc` — **5 contrôles verts** :

| Contrôle | Durée |
|---|---|
| Verify Frontend & Backend | 1 m 20 |
| Base de données et contrats HTTP (PGlite) | 1 m 32 |
| Database & HTTP contracts (Neon branch) | 11 m 13 |
| Vercel | — |
| Vercel Preview Comments | — |

Le job Neon rejoue la chaîne complète sur une branche éphémère : création,
migrations, rôle applicatif, contrôles base, build, serveur de production,
e2e, cross-tenant, export identité, parcours fournisseur, suppression de la
branche. Les trois échecs intermédiaires observés en CI correspondaient aux
défauts 1, 2 et 5/6 ci-dessus, tous corrigés et revérifiés.

---

## 6. État de la PR #8

- `mergeable: MERGEABLE`, état de fusion `CLEAN` ;
- 203 fichiers, +32 979 / −1 189 depuis `main` ;
- PR #9 **fermée comme intégrée**, avec renvoi vers l'arbitrage ;
- commentaire de synthèse publié sur la PR #8 (`issuecomment-6293612544`).

---

## 7. Avant de fusionner sur `main` — ordre obligatoire

⚠️ **Le déploiement Vercel est déclenché par le push et n'exécute aucune
migration.** L'application refuse de servir sur un schéma incomplet (503,
`/api/ready` indisponible). L'ordre n'est donc pas une préférence.

1. **Sauvegarder** la base cible (`pg_dump --format=custom`).
2. **Migrer** : `DATABASE_URL_ADMIN=… npm run db:migrate` → code de sortie **0**
   (migrations + RLS + contrôles bloquants).
3. **Préflight `0008`** : compter les comptes fournisseur sans fiche
   (`select count(*) from gf_users where role = 'supplier' and supplier_id is null;`).
   Ils passent en quarantaine (rôle `viewer`, statut `suspended`) ; décision
   explicite avant la migration.
4. **Vérifier** : `npx tsx scripts/verifier-role.ts` puis `GET /api/ready` → 200.
5. **Déployer**, puis surveiller `/api/health`.

**Retour arrière** : les scripts `010`–`025` n'ont **pas** de descente ; le
retour arrière est une **restauration** de la sauvegarde de l'étape 1.
`db:rollback` ne défait que la dernière migration Drizzle et refuse sans
`.down.sql`.

Procédure détaillée : `docs/DEPLOYMENT_VERCEL.md` §3 bis.

---

## 8. Ce qui reste ouvert

| Réserve | État |
|---|---|
| Verdict C — déploiement | **non prêt** : sauvegarde/restauration jamais exercées sur une base hébergée, branche de production non qualifiée, pas de descendantes pour `010`–`025`, supervision/astreinte partielles |
| Verdict B — frontières EUDR (proposition E) | **bloquée** : aucune source retenue, aucun fichier, aucune empreinte, licence non vérifiée |
| `drizzle/0008` | pas de `.down.sql` ; la quarantaine qu'elle opère est documentée et préflightée, pas réversible automatiquement |
| Limitation de débit | compteur **en mémoire, par instance** : borne un client trop pressé, pas une attaque distribuée |
| Harnais e2e | le secret MFA n'est pas conservé : `seed:auth -- --reset` est requis avant chaque parcours (fait en CI) |
| Dépendance `braces` | avis `GHSA-vfj7-8cjw-p6xm` sans correctif disponible ; suivi requis |

---

## 9. Prochaines étapes proposées

1. **Revue humaine** de la PR #8 (diff de fusion `e9114dc` en premier).
2. **Exercer une restauration** de sauvegarde sur base jetable — condition du
   verdict C.
3. **Migrer la base cible** selon l'ordre de la section 7, puis fusionner sur
   `main` et déployer.
4. **Surveiller** `/api/health` et `/api/ready` après déploiement.
5. Ouvrir le chantier **E** (frontières EUDR) séparément : rien dans cette
   fusion ne dépend de lui.

---

*Ce rapport constate un état vérifié ; il ne déclare ni le projet terminé, ni
la proposition E validée, ni le déploiement prêt.*
