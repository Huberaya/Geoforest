# Migrations à appliquer sur Neon — procédure vérifiée

**Rédigé le 06/11/2026, avant la fusion de la PR #18.** Chaque point de ce
document a été vérifié par exécution sur un PostgreSQL 18 local, base vierge,
et non déduit du code.

---

## 1. Ce qu'il faut appliquer : **une seule migration**

Sur Neon, la base est en retard de **trois** migrations par rapport au code
(`0007`, `0008`, `0009`). Elles sont appliquées **ensemble** par une seule
commande, dans l'ordre, une seule fois :

```bash
DATABASE_URL_ADMIN='postgresql://…neon.tech/neondb?sslmode=require' \
  npm run db:migrate
```

`DATABASE_URL_ADMIN` — **jamais** `DATABASE_URL`. La migration crée des rôles,
des politiques RLS et des contraintes : le rôle applicatif `geoforest_app` n'a
pas ces droits, et c'est voulu.

Puis, **immédiatement après**, le remplissage du cadre englobant :

```bash
DATABASE_URL_ADMIN='…' npm run db:backfill-bbox -- --essai   # compte d'abord
DATABASE_URL_ADMIN='…' npm run db:backfill-bbox              # puis remplit
```

⚠️ **Les deux commandes vont ensemble.** La migration `0009` ajoute les colonnes
`bbox_*` **nullable**. Sans le remplissage, les parcelles créées avant C8 ont une
borne nulle, et le pré-filtre de détection de chevauchement les écarte **toutes**.
On croirait le contrôle actif alors qu'il ne verrait que les parcelles nouvelles.
C'est le défaut le plus probable de cette mise en production, et il est silencieux.

---

## 2. Ce que fait chaque migration

| # | Contenu | Effet sur les données existantes |
|---|---|---|
| **0007** | `parcel_audits.risk_level` perd son `NOT NULL` et son défaut ; ajout de `country_statut` (`NOT NULL`, défaut `'RESOLU'`) | **Aucune perte.** Les lignes existantes reçoivent `'RESOLU'`, ce qui est juste pour toute analyse antérieure : la colonne n'existait pas, mais la résolution du pays était déjà faite. |
| **0008** | `parcel_audits.plot_id` + clé étrangère **composite** + index | Colonne nullable. Les analyses antérieures gardent `plot_id = NULL` — elles ne sont rattachées à aucune parcelle, et le validateur le dit (`ANALYSE_NON_PROBANTE`), il ne l'invente pas. |
| **0009** | `gf_plots.bbox_min_lon/lat`, `bbox_max_lon/lat`, nullable | Bornes nulles pour les parcelles existantes → **`db:backfill-bbox` obligatoire**. |

---

## 3. Conflits vérifiés, et leur résultat

### Sécurité

| Vérification | Résultat |
|---|---|
| RLS sur les tables métier | **13/13**, y compris `parcel_audits` (0007/0008) et `gf_document_versions`. `gf_sessions` et `gf_login_attempts` restent hors RLS car ce sont des tables d'authentification globales, utilisées avant le contexte d'organisation : `gf_sessions` est réservée à `dbAdmin` ; `gf_login_attempts` ne donne au rôle applicatif que les droits sur `window_key`, `attempts`, `first_attempt_at` et `last_attempt_at`, nécessaires au compteur atomique. Les tests vérifient ces droits effectifs. |
| Rattachement inter-organisations via `parcel_audits.plot_id` | **Fermé.** La clé étrangère est **composite** `(plot_id, organization_id) → gf_plots(id, organization_id)`. Une organisation ne peut pas référencer la parcelle d'une autre. |
| Rattachement inter-organisations via `gf_documents.plot_id` | **Fermé**, par la contrainte composite `fk_gf_documents_plot_tenant`. Vérifié par tentative d'insertion réelle : refusée. |
| Double clé étrangère sur `gf_documents.plot_id` | **Constatée** : une FK simple (`plot_id → plots.id`) et une FK composite coexistent. La composite rattrape la simple, donc **pas de faille** — mais la simple est redondante et pourrait un jour être choisie à la place de l'autre. Signalée, non corrigée : la retirer demanderait une nouvelle migration et la retirer n'apporte aucune sécurité supplémentaire. |
| Contrôle applicatif du rattachement de parcelle | **Présent** dans `documents/route.ts` et `audit/parcel/route.ts` : la parcelle est vérifiée comme appartenant à l'organisation, avec un 404 plutôt qu'un 403 (répondre « interdit » confirmerait l'existence). Double barrière : applicative et base. |
| Migration exécutée par un rôle superutilisateur sur la production | **Non** : `db:migrate` exige `DATABASE_URL_ADMIN`. Le rôle applicatif reste sans `BYPASSRLS` et sans droit de destruction — le contrôle au démarrage le vérifie à chaque démarrage. |

### Code

| Vérification | Résultat |
|---|---|
| `src/db/schema.ts` et `drizzle/` concordent | **Oui.** `npm run check:schema` → aucune dérive. |
| Base construite **uniquement** par les migrations, puis application démarrée | **Oui.** Base vierge → 10/10 migrations, 15 tables → `check:e2e:complet` **68/68**. Rien ne dépend d'un état antérieur. |
| Le code lit-il une colonne que la migration n'ajoute pas ? | **Non.** Vérifié sur `countryStatut`, `plotId`, `bbox*` : ajoutées par 0007/0008/0009, présentes dans l'ordre. |
| Rejeu de la migration (idempotence) | **Sans effet**, vérifié. |

### Procédure

| Vérification | Résultat |
|---|---|
| Retour arrière de `0009` | **Vérifié** : les 4 colonnes `bbox_*` disparaissent, la migration est désenregistrée. ⚠️ Le script descend **toute** la pile : pour annuler seulement la dernière, relancer `db:migrate` après. |
| Retour arrière puis remontée de `0008` | **Vérifié** sur base réelle : `plot_id` disparaît, puis revient. |
| `0005_tracabilite` n'a pas de `.down.sql` | **Constaté.** Un retour arrière sur une base antérieure à `0005` refusera de s'exécuter — c'est le comportement voulu (« une descente manquante ne doit pas être prise pour une descente sans effet »). Sur Neon, la base est déjà au-delà : **sans effet**. |
| La CI migre-t-elle la production ? | **Non.** Les trois `db:migrate` de la CI tournent sur des bases jetables de runner. Aucun risque de collision. |
| Vercel exécute-t-il les migrations ? | **Non** — et c'est volontaire. `vercel.json` ne porte aucun hook de migration. Une migration déclenchée par un déploiement s'exécuterait plusieurs fois (build, preview, production) et sans supervision. **C'est à vous de la lancer.** |

---

## 4. Ordre d'exécution, sans ambiguïté

1. **Fusionner la PR #18** (ou pas — la migration peut être faite avant, le code
   tolère une base en avance ; l'inverse n'est pas vrai).
2. `DATABASE_URL_ADMIN='…' npm run db:migrate`
   → attendre `✅ Schéma à jour et cloisonnement vérifié.`
3. `DATABASE_URL_ADMIN='…' npm run db:backfill-bbox -- --essai`
   → lire le compte annoncé.
4. `DATABASE_URL_ADMIN='…' npm run db:backfill-bbox`
   → attendre `✅ Cadres englobants à jour.`
5. Redéployer sur Vercel, puis vérifier `GET /api/health`.

⚠️ **L'étape 2 avant le redéploiement.** Le code fusionné lit `bbox_*`,
`plot_id` et `country_statut`. Un déploiement sur une base non migrée produit des
**500 à la première écriture**, avec un message qui ne parle pas de migration.

⚠️ **Ne jamais utiliser `npm run db:push`.** Il recrée les tables et **efface les
politiques RLS**. C'est écrit dans `scripts/migrate.ts`, et c'est la raison pour
laquelle les migrations versionnées existent.

---

## 5. Ce qui a été vérifié par exécution, pas par lecture

- Base vierge → migrations → application démarrée → **68/68** contrôles de bout
  en bout (sondes, RLS, authentification, parcours DDR, export RGPD, isolation
  multi-tenant).
- Tentative réelle de rattacher le document d'une organisation à la parcelle
  d'une autre → **refusée** par la clé composite.
- Parcelle antérieure à C8 insérée avec une borne nulle → `db:backfill-bbox` la
  remplit ; rejoué → sans effet ; `--recalculer` → refait.
- `db:rollback` sur `0009` puis `0008`, avec vérification en base de la
  disparition des colonnes, puis remontée.
- Aucune dérive entre `src/db/schema.ts` et la base issue des migrations.

## 6. Ce que cette vérification ne couvre pas

- **Aucune exécution sur Neon.** Je n'ai pas d'accès à la base de production ;
  tout a été fait sur un PostgreSQL 18 local, base vierge puis base migrée. Neon
  est PostgreSQL : le risque résiduel est faible, mais il n'est pas nul — d'où
  l'étape 3 (`--essai`) avant l'étape 4.
- **La durée.** Sur une base peuplée, `0009` ajoute quatre colonnes nullables à
  `gf_plots` : instantané. `db:backfill-bbox` traite par lots de 200 — compter
  une seconde par lot environ.
- **Le retour arrière en production.** `0009.down` supprime des colonnes. Sur
  une base réelle, le retour arrière est d'abord une **restauration**, la
  descente ne faisant que remettre le schéma en cohérence avec le code
  redéployé.
