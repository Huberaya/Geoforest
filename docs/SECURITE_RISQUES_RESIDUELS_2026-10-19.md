# Sécurité — consolidation des quatre risques résiduels (phase 3)

**Rapport :** « Sécurité — consolidation des quatre risques résiduels (Geoforest, 2026-10-19) »
**Auteur :** Agent Arena.ai (Arena.ai — Agent Mode)
**Branche :** `arena/837c5c36-geoforest`

> Ce document ne remplace pas `docs/rapport-securite-agent-b.md`, **absent du
> dépôt** (vérifié : `docs/` ne contient que `ARCHITECTURE.md`,
> `DEPLOYMENT_VERCEL.md`, `EUDR_COMPLIANCE_GUIDE.md`,
> `RECETTE_VALIDATION_EXTERNE_2026-10-19.md`, `TEST_REPORT.md`,
> `VALIDATION_GEOFOREST_2026-10-19.md`). Il consigne l'état **mesuré** des
> quatre risques, pas leur état annoncé.

Statuts employés, sans nuance : `CORRIGÉ ET VÉRIFIÉ`, `ATTÉNUÉ — RISQUE
RÉSIDUEL`, `NON VÉRIFIÉ`, `BLOQUÉ`.

---

## E1 — Validation PostgreSQL serveur et RLS

**Statut : `NON VÉRIFIÉ`.**

### Ce qui est mesuré

| Élément | Résultat | Preuve |
|---|---|---|
| PostgreSQL serveur disponible dans cet environnement | **non** — aucun binaire `postgres`, `initdb`, `psql`, `pg_ctl` | `which` |
| PGlite (PostgreSQL embarqué WASM) | disponible, utilisé pour la migration 0007 | `scripts/check-migration-identite.ts`, 13/13 |
| Rôles applicatif et administratif séparés | **non exercé** — PGlite s'exécute en mono-utilisateur | — |
| Politiques RLS, isolation entre organisations | **non exercées** | — |
| `security_invoker = true` sur la vue de reprise | **vérifié** : la vue porte bien l'option | PGlite, `pg_class.reloptions` |

⚠️ **PGlite ne remplace pas PostgreSQL serveur.** Il n'a ni rôles, ni
privilèges, ni `SET ROLE`, ni sessions concurrentes. Tout ce qui suit reste
donc ouvert.

### Recette prête à exécuter (non exécutée)

Prérequis : une instance PostgreSQL 16+ **isolée** (jamais la production), un
superutilisateur de recette, et deux rôles distincts.

```bash
# 1. Instance isolée
export PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres
createdb geoforest_recette

# 2. Schéma + migrations
psql -d geoforest_recette -f scripts/sql/schema.sql   # ou npm run db:migrate
psql -d geoforest_recette -f scripts/sql/post-migrate/010_row_level_security.sql

# 3. Rôles
psql -d geoforest_recette <<'SQL'
create role recette_app login password :'mdp_app';
create role recette_admin login password :'mdp_admin' superuser;
SQL

# 4. Données synthétiques : deux organisations, une parcelle chacune
#    (aucune donnée réelle)
```

Contrôles attendus, à consigner un par un :

| # | Contrôle | Attendu |
|---|---|---|
| 1 | `select relrowsecurity, relforcerowsecurity from pg_class where relname='parcel_audits'` | `true`, `true` |
| 2 | Connexion en `recette_app` **sans** `app.current_org` : `select count(*) from parcel_audits` | **0** |
| 3 | `set app.current_org = '<org A>'` puis `select …` | uniquement les lignes de A |
| 4 | `insert … organization_id = <org B>` sous contexte A | **refusé** par `with check` |
| 5 | `recette_app` : `insert into v_parcel_audits_identite …` | **refusé** (vue en lecture seule) |
| 6 | `recette_app` : `delete from parcel_audits …` | **refusé** (DELETE révoqué) |
| 7 | `recette_app` : `select * from gf_users` sans contexte | **0** ligne |
| 8 | `select auth_user_by_email('…')` en `recette_app` | 1 ligne, **uniquement** les colonnes de cette fonction |
| 9 | `recette_app` : `insert into gf_sessions …` | **refusé** |
| 10 | Connexion avec un rôle portant `BYPASSRLS` | contourne la RLS → **échec de conception à signaler** |
| 11 | `reloptions` de `v_parcel_audits_identite` | `security_invoker=true` |

⚠️ Le contrôle 10 est le plus important : il reproduit la mesure du
02/10/2026 selon laquelle `neondb_owner` contourne la RLS **même forcée**. Si
la recette le confirme, le cloisonnement dépend entièrement du rôle employé en
production, et `src/db/controle-role.ts` devient le seul garde-fou — à vérifier
au démarrage, pas à supposer.

### Prochaine action

Obtenir une instance PostgreSQL isolée et l'autorisation de l'utiliser.
**Aucune migration n'a été lancée, aucune base réelle n'a été touchée.**

---

## E2 — Vulnérabilité `braces`

**Statut production : `CORRIGÉ ET VÉRIFIÉ` (autre vulnérabilité, voir ci-dessous).
Statut `braces` : `ATTÉNUÉ — RISQUE RÉSIDUEL`.**

### Avis recontrôlé

`GHSA-vfj7-8cjw-p6xm` / `CVE-2026-93687`, sévérité **High** (CVSS v4 8.7).

- versions affectées : **`<= 3.0.3`** ;
- versions corrigées : **aucune** (`Patched versions: None`) ;
- nature : épuisement de pile dans les parcours d'AST récursifs, sur des motifs
  d'accolades profondément imbriqués → arrêt du processus Node (disponibilité
  seule : Confidentialité `None`, Intégrité `None`, Disponibilité `High`) ;
- référence amont : `micromatch/braces#70`.

### Arbre de dépendances mesuré

```
nextjs-postgresql-template
└── eslint-config-next@16.3.8            (devDependency)
    └── @next/eslint-plugin-next@16.3.8
        └── fast-glob@3.3.1
            └── micromatch@4.0.8
                └── braces@3.0.3        ← affecté, aucune version corrigée
```

`braces` **n'est pas** dans l'arbre de production. `npm run audit:sec`
(`--omit=dev`) le confirmerait s'il y figurait ; il n'y figure pas.

### Ce que dit l'audit, séparément

| Commande | Code de sortie | Résultat |
|---|---|---|
| `npm run audit:sec` (`--omit=dev --audit-level=high`) | **0** | `found 0 vulnerabilities` |
| `npm run audit:dev` (`--include=dev --audit-level=high`) | **1** | **5 vulnérabilités high**, toutes dues à `braces` |

⚠️ L'échec de l'audit de développement est **conservé et visible** : il n'est
ni masqué par un `--omit=dev`, ni exclu du rapport.

Les cinq entrées (`braces`, `fast-glob`, `micromatch`,
`@next/eslint-plugin-next`, `eslint-config-next`) sont **une seule et même
cause** : les quatre autres sont les paquets qui dépendent de `braces`. npm
propose `eslint-config-next@14.2.35`, c'est-à-dire une **rétrogradation de
deux majeures** (16.3.8 → 14.2.35). Cette « correction » casserait la
configuration ESLint du projet ; elle n'a pas été appliquée et ne doit pas
l'être.

### Exposition réelle

- `braces` n'est atteint que par **ESLint**, outil de développement, sur des
  motifs de fichiers **fournis par le dépôt** (`.eslintrc`, `eslint .`).
- Aucun chemin d'exécution serveur ne l'atteint : ni route, ni middleware, ni
  build de production.
- Un attaquant devrait donc pouvoir modifier la configuration ESLint, ce qui
  suppose déjà un accès en écriture au dépôt.
- **Risque résiduel : faible en pratique, mais non nul** — un contributeur
  malveillant, ou une dépendance qui injecterait un motif, suffirait à faire
  tomber un poste de développement ou une CI.

### Atténuations retenues

1. `audit:sec` et `audit:dev` sont **deux commandes distinctes** ; la première
   doit rester à 0 (exigence tenue), la seconde est surveillée.
2. Aucune rétrogradation de `eslint-config-next`.
3. Veille : réévaluer dès qu'une version `braces > 3.0.3` paraît. À ce jour,
   `npm view braces dist-tags` renvoie `latest: 3.0.3` — il n'y a rien à
   installer.

### Corrigé au passage — `source-map-js`

L'audit de production n'était **pas** à zéro avant cette phase :

```
source-map-js  1.0.0 - 1.2.1
Severity: high
GHSA-68fv-2mgg-jv7q — event-loop DoS via indexed source-map section offsets
1 high severity vulnerability   (npm audit --omit=dev)
```

Chaîne : `next@16.3.8 → postcss@8.5.23 → source-map-js@1.2.1`, et
`@tailwindcss/postcss → @tailwindcss/node → source-map-js`. Il s'agit bien
d'une dépendance de **production**.

Correction : `overrides` dans `package.json` → `source-map-js@^1.2.2`
(version publiée corrigeant l'avis : `>=1.2.2`). Vérifié après installation :
les trois occurrences résolvent en `1.2.2`, et `npm run audit:sec` retourne
**0 vulnérabilité**, code de sortie 0.

---

## E3 — Anciens comptes de démonstration

**Statut : `ATTÉNUÉ — RISQUE RÉSIDUEL`.**

### Ce qui a été mesuré dans le code

`scripts/seed-auth.ts`, avant correction :

| Défaut | Preuve |
|---|---|
| Mot de passe **codé en dur** en valeur de repli | `const DEMO_PASSWORD = process.env.SEED_DEMO_PASSWORD ?? "<littéral>"` |
| Mot de passe **affiché sur stdout** | `console.log(\`\nMot de passe commun : ${DEMO_PASSWORD}\`)` |
| **Aucune garde** contre `NODE_ENV=production` | grep : aucune occurrence de `NODE_ENV` |
| **Aucune exigence** de longueur | — |
| Réinitialisation de MFA sur comptes existants | `mfaSecret: null, mfaEnabledAt: null, mfaRecoveryCodes: null` |

Le littéral était présent à **deux** endroits : `scripts/seed-auth.ts` et une
fixture de `scripts/check-p106-regles.ts`. Les deux ont été retirés.

### Correction appliquée et testée

`scripts/check-seed-securite.ts` — **7/7**, exécute réellement le seed :

| Contrôle | Résultat |
|---|---|
| sans `SEED_DEMO_PASSWORD` → refus explicite | ✅ |
| aucun mot de passe dans la sortie | ✅ |
| mot de passe trop court → refus | ✅ |
| le mot de passe fourni n'est pas recopié | ✅ |
| `NODE_ENV=production` → refus, même avec un mot de passe valide | ✅ |
| aucune valeur de repli dans le code | ✅ |
| seule la longueur est journalisée | ✅ |

### Ce qui reste ouvert

⚠️ **Un correctif de code ne nettoie aucune base.** Les comptes créés par
d'anciens lancements — sur un environnement de recette, de préproduction ou
pire — portent peut-être encore le mot de passe historique.

**Inventaire : impossible à établir depuis ce dépôt.** Aucun accès aux bases
n'est autorisé ici, et aucune preuve d'existence de comptes de démonstration
hors développement n'est disponible. L'inventaire doit être fait par
l'exploitant, sur chaque environnement, avec la requête suivante :

```sql
-- Lecture seule. Aucune modification.
select u.email, u.role, o.slug, u.status, u.password_updated_at, u.mfa_enabled_at
  from gf_users u join gf_organizations o on o.id = u.organization_id
 where u.email in (
   'admin@geoforest.eu','conformite@geoforest.eu','auditeur@geoforest.eu',
   'lecteur@geoforest.eu','admin@tenant-b.test'
 );
```

Critère de clôture : sur **chaque** environnement, la requête ne renvoie
aucune ligne, ou chaque ligne renvoyée a `password_updated_at` postérieur à
la date de retrait du littéral **et** une authentification vérifiée avec le
nouveau secret.

Procédure de rotation : `docs/ROTATION_SECRETS_ET_INTEGRITE_AUDIT.md`.

---

## E4 — Limitation des requêtes, rotation des secrets, chaîne d'audit

### E4.1 Limitation des requêtes

**Statut : `ATTÉNUÉ — RISQUE RÉSIDUEL`** (limitation en mémoire assumée).

Inventaire mesuré — **toutes** les limitations sont en mémoire de processus,
dans `src/lib/rate-limit.ts`, appelées depuis `src/proxy.ts` :

| Portée | Clé | Fenêtre | Mémoire |
|---|---|---|---|
| Routes recevant un secret (`CHEMINS_SECRETS`) | `auth:<ip>` | `CADENCE_AUTH` | `Map` du module |
| Toutes les routes API | compteur global | rafale + soutenu | `Map` du module |
| Quotas par organisation | `org-*:<org>` | fenêtre org | `Map` du module |

Conséquences, mesurables et **non corrigées** :

1. **Redémarrage** : la `Map` repart vide → le quota est intégralement rendu.
2. **Plusieurs instances** : chacune compte séparément → la limite effective
   est multipliée par le nombre d'instances.
3. **Bord** : le compteur vit dans le processus du middleware ; selon
   l'hébergeur, plusieurs instances de middleware peuvent coexister.

Ces trois points sont déjà écrits dans l'en-tête du module ; ils sont
**assumés**, pas niés. Ce qui manquait est leur **inventaire** (ci-dessus) et
une épreuve : `scripts/check-limitation-memoire.ts` démontre le point 1 en
vidant le module (`reinitialiserCadence`) et en constatant que le quota est
rendu — le comportement est donc **documenté par un test**, pas seulement par
un commentaire.

**Non implémenté, et pourquoi.** Une limitation partagée exigerait un
magasin commun (Redis, ou une table PostgreSQL). Le middleware s'exécute sur
le Edge Runtime, où le client `pg` n'est pas disponible ; l'y brancher
imposerait soit de déplacer toute la limitation dans chaque route (Node), soit
d'ajouter une dépendance d'infrastructure. Les deux dépassent le périmètre
autorisé ici : aucune infrastructure n'est disponible, et modifier le
middleware changerait le comportement d'authentification. **Planifié, non
réalisé.**

### E4.2 Rotation des secrets

**Statut : documenté, `NON VÉRIFIÉ`** — aucune rotation n'a été exécutée.

Procédure : `docs/ROTATION_SECRETS_ET_INTEGRITE_AUDIT.md` § 1. Elle couvre
l'ordre, la validation, le retour arrière et l'absence de divulgation.

### E4.3 Chaîne d'audit

**Statut : `BLOQUÉ`** au sens propre — la chaîne n'existe pas.

`src/lib/audit-log.ts` écrit dans `audit_logs` sans chaînage cryptographique.
Le commentaire du fichier l'annonce : « Le journal inaltérable append-only
reste à construire — cf. P1-10 ». Rien dans le code ne permet de détecter une
altération : une ligne modifiée ou supprimée par un accès direct à la base ne
laisse aucune trace.

Une **vérification périodique est donc impossible** : il n'y a rien à
vérifier. La procédure de détection et d'alerte est décrite dans
`docs/ROTATION_SECRETS_ET_INTEGRITE_AUDIT.md` § 3, en même temps que le
schéma minimal qui la rendrait possible. **Aucune ligne de ce schéma n'est
implémentée.**

---

## Synthèse des quatre risques

| Risque | Statut | Preuve | Prochaine action |
|---|---|---|---|
| E1 — PostgreSQL serveur / RLS | `NON VÉRIFIÉ` | PGlite 13/13 pour la migration ; aucun serveur disponible | Instance isolée + recette § E1 |
| E2 — `braces` | `ATTÉNUÉ — RISQUE RÉSIDUEL` | Avis relu ; dev seul ; 0 en production après correction `source-map-js` | Veille sur `braces > 3.0.3` |
| E3 — Comptes de démonstration | `ATTÉNUÉ — RISQUE RÉSIDUEL` | Seed 7/7 ; littéral retiré ; inventaire hors dépôt impossible | Inventaire par l'exploitant + rotation |
| E4a — Limitation en mémoire | `ATTÉNUÉ — RISQUE RÉSIDUEL` | Inventaire + démonstration | Magasin partagé (hors périmètre) |
| E4b — Rotation des secrets | `NON VÉRIFIÉ` | Procédure écrite, non exécutée | Exécution encadrée |
| E4c — Chaîne d'audit | `BLOQUÉ` | Chaîne inexistante | Concevoir puis implémenter P1-10 |

---

*Document « Sécurité — consolidation des quatre risques résiduels (Geoforest,
2026-10-19) » établi par **Agent Arena.ai** (Arena.ai — Agent Mode). Aucune
base de production n'a été contactée.*
