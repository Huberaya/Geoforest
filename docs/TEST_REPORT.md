# GeoForest Trace — Rapport de vérification

**Mesuré le 05/11/2026** sur `main` (`21b8b83`) · **Version** `0.1.0` · **Runtime** Node 20 (CI), Node 22 (développement)

> ⚠️ Ce document remplace un précédent rapport daté du 30/09/2026, intitulé
> « Production Release v1.0.0 », qui affirmait **29/29 tests pytest**, **25/25
> routes** et **CSP applicative**. Ces trois affirmations étaient fausses au jour
> de sa rédaction comme au jour de cette vérification. Ce qui a été corrigé et
> comment est décrit au §6.
>
> Règle adoptée désormais : **chaque ligne de ce rapport porte la commande qui
> permet de la contredire.** Une affirmation non reproductible n'y a pas sa place.

---

## 1. Synthèse

| Domaine | Résultat mesuré | Commande de vérification |
|---|---|---|
| Types TypeScript | **0 erreur** | `npx tsc --noEmit` |
| Lint ESLint | **0 erreur, 5 avertissements** | `npx eslint .` |
| Build de production | **59 routes sources** (39 API + 20 pages) — 60 au build, `_not-found` étant généré par Next | `npm run build` |
| Tests backend (pytest) | **41 réussis, 3 ignorés** | `cd backend && pytest -q` |
| Contrôles de règles métier | **116 contrôles, tous verts** | `npm run check:eudr && npm run check:topologie && npm run check:regles && npm run check:csv && npm run check:seed && npm run check:version` |
| Bout en bout (serveur démarré) | **38 contrôles, tous verts** | `npm run check:e2e:complet` |
| Vulnérabilités production | **0** | `npm run audit:prod` |
| Vulnérabilités haute/critique | **0** | `npm audit --audit-level=high` |
| Intégration continue | **4 jobs verts** sur `main` | `gh run list --branch main --limit 1` |

---

## 2. Ce qui est réellement testé, et à quel niveau

Trois niveaux, et il faut les distinguer — les confondre est exactement l'erreur
du rapport précédent.

### 2.1 — Règles métier pures (116 contrôles, sans base ni serveur)

| Script | Contrôles | Ce qu'il vérifie |
|---|---|---|
| `check:eudr` | 24 | seuil 4 ha, 6 décimales, ordre GeoJSON `[lon, lat]`, WGS84, détection de CRS projeté, bornes de l'anneau, cohérence du moteur |
| `check:topologie` | 16 | auto-intersections, trous, anneaux non fermés, polygones dégénérés |
| `check:regles` | 40 | règles d'exploitation P1-06 |
| `check:csv` | 26 | encodages CSV / Latin-1 |
| `check:seed` | 10 | garde-fous de l'amorçage de démonstration |
| `check:version` | 5 | cohérence version / moteur Node |

Ces scripts existaient dans le dépôt mais **n'étaient exécutés par aucune CI**
avant le 04/11/2026. Ils le sont désormais, et chacun a été **falsifié** : casser
la valeur testée fait bien échouer le script.

### 2.2 — Bout en bout (38 contrôles, serveur réel + PostgreSQL réel)

`scripts/check-bout-en-bout.ts`, exécuté par le job CI `Bout en bout` :

- sondes `/api/health` et `/api/ready`, dont un aller-retour **réel** sur le stockage ;
- composant `role_base` : la RLS n'est pas contournée par le rôle applicatif ;
- RLS activée **et forcée** sur les 13 tables métier, lues dans `pg_class` ;
- authentification : mot de passe, activation TOTP, 8 codes de secours, session utilisable ;
- parcours métier : création d'une parcelle géolocalisée, relecture, surface ;
- **isolation multi-tenant** : B ne lit, ne modifie, ne supprime pas la parcelle de A.

Détail et limites : `docs/BANC-BOUT-EN-BOUT.md`.

### 2.3 — Backend FastAPI (41 tests, 3 ignorés)

Les 3 tests ignorés portent sur `/api/v1/geospatial/{sources,analyze}`, **routes
qui n'existent pas** dans le backend (cf. §4). Ils sont marqués `skip` avec
motif, pas supprimés : la couverture géospatiale doit être reprise côté
TypeScript, et le marqueur `--strict-markers` empêche un skip implicite de
passer pour un succès.

---

## 3. Ce qui n'est PAS testé — et qu'aucun document ne doit laisser croire

| Domaine | État réel |
|---|---|
| **Analyse satellite** | ❌ **jamais exécutée contre le fournisseur réel.** Le bac à sable ne joint pas `data-api.globalforestwatch.org` (TLS refusé). Aucun test ne couvre un appel GFW réussi. |
| **Rendu des pages** | ❌ aucun test de navigateur. Les 21 pages ne sont pas parcourues ; une erreur d'hydratation passerait la CI. |
| **Application déployée** | ❌ `*.vercel.app` injoignable depuis le bac à sable. « Se déploie » ≠ « répond ». |
| **Docimologie des seuils** | ❌ les seuils (4 ha, 6 décimales, densité 30 %) sont testés **contre eux-mêmes** : les tests vérifient que le code applique la constante, pas que la constante est la bonne. |
| **Charges / performance** | ❌ aucun test de montée en charge. |
| **Sauvegarde / restauration** | ❌ aucune restauration prouvée. La sonde `sauvegarde` est `non_configure`. |

---

## 4. Écarts entre la documentation et le code

Relevés le 05/11/2026. Chacun a été **mesuré**, pas supposé.

| Affirmation documentaire | Réalité mesurée |
|---|---|
| « 25 routes applicatives » | **60 routes** au build : 39 API + 21 pages |
| « Suite Pytest 29/29 » | **41 réussis, 3 ignorés** |
| « Analyses `Hansen`, Sentinel-2, ESA WorldCover » | **Hansen seul.** Aucune occurrence de Sentinel ni de WorldCover dans `src/lib/eudr/` |
| Page `/analyses/[id]` — « visualiseur comparatif temporel » | **La route n'existe pas.** Seul `analyses/page.tsx` existe |
| « Export de rapports PDF/Excel » | **Non implémenté** — aucune occurrence dans `/api/v1/reports` ni dans la page |
| Backend « Shapely & GeoPandas » | Non vérifié ; le backend stocke en **SQLite** |
| « CSP » | En-tête **`Content-Security-Policy-Report-Only`** : aucun blocage effectif |
| « HSTS preload » | `max-age=63072000; includeSubDomains` — **sans `preload`** |
| « Cycle de vie DDR à 9 statuts » | ✅ **vérifié exact** — `DDS_STATUSES` contient bien 9 entrées (`DRAFT` → `ARCHIVED`) |
| « Classification pays » | 🔴 **défaillante, mesurée** : Tanger, Alger, Tunis et Istanbul résolus `EU`/LOW ; Kiev résolu `RU`/HIGH. Détail : `EUDR_COMPLIANCE_GUIDE.md` §2 bis |
| « Signature électronique sur l'honneur » | Non vérifié |
| « Alertes d'expiration automatiques à 30 jours » | Non vérifié |
| « FPIC / droits coutumiers » | 🔴 **absent du code** — aucune catégorie documentaire FPIC. Les 5 existantes : `LAND_TENURE`, `HARVEST_PERMIT`, `TAX_CLEARANCE`, `LABOR_COMPLIANCE`, `CERTIFICATE_FSC_PEFC` |

Les quatre premières lignes sont les plus graves : elles décrivent des
fonctionnalités **inexistantes** dans un document destiné à un client.

---

## 5. Ce qu'un client peut lire sans risque

Ce document, et lui seul parmi les documents de `docs/`. Les autres ont été
alignés (§6), mais c'est ici que les chiffres sont tenus à jour.

---

## 6. Corrections apportées à la documentation (chantier C3)

| Document | Ce qui a été corrigé |
|---|---|
| `TEST_REPORT.md` | Réécrit intégralement. Les chiffres sont désormais mesurés et chaque affirmation porte sa commande. |
| `ARCHITECTURE.md` | Sentinel-2 / ESA WorldCover retirés du diagramme (non implémentés) ; CSP-Report-Only et HSTS sans `preload` décrits exactement ; mention « analyses multi-sources » corrigée. |
| `EUDR_COMPLIANCE_GUIDE.md` | À examiner au chantier C7 (validateur EUDR). |

---

## 7. Comment reproduire ce rapport

```bash
npx tsc --noEmit
npx eslint .
DATABASE_URL=postgresql://x@127.0.0.1:5432/x \
DATABASE_URL_ADMIN=postgresql://x@127.0.0.1:5432/x \
AUTH_SECRET=build-only-secret-32-caracteres-minimum npm run build

npm run check:eudr && npm run check:topologie && npm run check:regles
npm run check:csv && npm run check:seed && npm run check:version
npm run audit:prod && npm audit --audit-level=high

cd backend && pytest -q
```

Les contrôles de bout en bout exigent un PostgreSQL et un serveur :
`npm run check:e2e:complet` (voir `docs/BANC-BOUT-EN-BOUT.md`).

> ⚠️ `npm run build` **échoue** sans `DATABASE_URL` et `DATABASE_URL_ADMIN` :
> `src/db/admin.ts` refuse de s'instancier sans URL. Ce sont des valeurs
> factices ; aucun job ne s'y connecte.
