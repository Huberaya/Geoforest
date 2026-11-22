# Audit des branches distantes par rapport à `main` — 21/11/2026

**Référence vérifiée :** `origin/main` @ `f5f7db4c81125ec45ddf7ea99356dde753e60d9b`  
**Méthode :** inventaire `git for-each-ref refs/remotes/origin/`, test d'ascendance (`git merge-base --is-ancestor`), comptage de commits (`ahead/behind`) et comparaison directe des fichiers modifiés (`git diff` contre `origin/main`).  
**Règle de sécurité :** cet audit est **strictement en lecture seule**. Aucune branche distante n'a été supprimée et aucune PR n'a été fermée.

---

## Synthèse (39 branches distantes hors `main` et `HEAD`)

| Catégorie | Nombre | Décision recommandée |
|---|---:|---|
| 1. Ancêtres stricts de `main` (`+0` commit d'avance) | 15 | **Archiver / supprimer** sans perte de code |
| 2. Intégrées par squash-merge ou remplacées sur `main` | 8 | **Clore les PR / supprimer** (0 régression sur `main`) |
| 3. Branches de documentation ou tests de barrière obsolètes / repris | 6 | **Clore / supprimer** après fusion du Chantier A |
| 4. Branche historique non fusionnable avec contenu partiel utile (PR #7) | 1 | **Ne jamais fusionner** ; évaluer portage sélectif de 5 scripts TS / 2 tests Python puis clore |
| 5. Lignée prototype initiale `chantier-1`..`8` (sept. 2026) | 9 | **Archiver / clore sans fusion** (architecture antérieure divergente) |
| **Total** | **39** | |

---

## Catégorie 1 — Ancêtres stricts de `main` (15 branches)

Ces branches ont exactement **0 commit absent de `origin/main`** (`git merge-base --is-ancestor` vrai). Tout leur historique est déjà dans `main`.

| Branche distante | Dernier commit | Date | Retard vs `main` | Notes |
|---|---|---|---:|---|
| `origin/arena/p0-neon-rls-hardening` | `eec5f28` | 2026-11-12 | -4 | Fusionnée via PR #19 (`bfd8729`) |
| `origin/arena/ba2f9eba-geoforest` | `c79f7ee` | 2026-11-10 | -27 | Fusionnée via PR #11 (`cc61cfe`) |
| `origin/arena/ef5b35fe-geoforest` | `04c845c` | 2026-11-10 | -187 | Fusionnée via PR #18 (`7a0d7ad`) |
| `origin/arena/revert-test-barriere` | `ccec780` | 2026-11-04 | -213 | Fusionnée via PR #14 (`21b8b83`) |
| `origin/integration/geoforest-p0-final-2026-10-21` | `b492d1d` | 2026-10-21 | -87 | PR #10 — ancêtre strict de `main` |
| `origin/arena/geoforest-backup-restore-proof-2026-10-21` | `24d0374` | 2026-10-21 | -79 | Reprise via consolidation PR #11 |
| `origin/arena/569eff1a-geoforest` | `47fa862` | 2026-10-20 | -92 | Reprise via PR #11 (PR #8) |
| `origin/integration/lot-a-b-identite-build` | `39111c1` | 2026-10-20 | -118 | Intégrée dans la lignée PR #11 |
| `origin/forest/chantiers-1-2-3-audit-2026-10-19` | `751df8b` | 2026-10-19 | -143 | Intégrée via PR #11 |
| `origin/arena/e7725e3f-geoforest` | `a545049` | 2026-10-19 | -128 | Intégrée via PR #11 |
| `origin/arena/c73246d2-geoforest` | `bc61a23` | 2026-10-18 | -202 | Audit initial intégré via PR #11 |
| `origin/fix/gfw-fail-closed-2026-10-18` | `dbf78a1` | 2026-10-18 | -198 | Intégrée via PR #11 |
| `origin/security/tenant-isolation-chanti-er-c-2026-10-18` | `9d50bdc` | 2026-10-18 | -196 | Intégrée via PR #11 |
| `origin/forest/engine-evidence-chantier-d-2026-10-18` | `e8c0cdb` | 2026-10-18 | -182 | Intégrée via PR #11 |
| `origin/forest/country-risk-neutralization-2026-10-18` | `c639a22` | 2026-10-18 | -161 | Intégrée via PR #11 |

---

## Catégorie 2 — Contenu intégré par squash-merge ou remplacé sur `main` (8 branches)

Ces branches apparaissent comme « divergées » uniquement en raison de squash-merges ou de réécriture de commits, mais leur code est déjà sur `main`.

| Branche distante | Tête | Date | Écart (`+/-`) | Preuve par `git diff` contre `main` |
|---|---|---|---:|---|
| `origin/docs/p0-neon-restore-backup-status-20261113` | `2d7883a` | 2026-11-13 | `+1/-1` | **0 différence** : squash-mergée en `f5f7db4` |
| `origin/fix/p0-backfill-bbox-guard-20261113` | `ffe5bad` | 2026-11-13 | `+4/-2` | Squash-mergée en `c231b7c` (seul ajout ultérieur de `f5f7db4` sur `MIGRATIONS-NEON.md`) |
| `origin/security/p0-ci-secret-isolation-20261112` | `5e7a46c` | 2026-11-12 | `+8/-3` | **0 différence** sur les fichiers touchés : squash-mergée en `9f78624` (PR #22) |
| `origin/arena/p0-neon-backfill-guard` | `c8268bc` | 2026-11-12 | `+10/-25` | **PR #21 remplacée par `c231b7c`** : `git diff` strictement vide sur `scripts/backfill-bbox.ts` et `scripts/ci/check-backfill-bbox.test.cjs` |
| `origin/fix/p0-health-storage-readiness-20261111` | `8315ebf` | 2026-11-11 | `+25/-26` | Squash-mergée en `61c17b1` (puis complétée par PR #19) |
| `origin/arena/geoforest-p0-final-2026-10-21` | `7e5905b` | 2026-10-21 | `+1/-87` | Commit `7e5905b` déjà cherry-pické dans `main` (commentaire test backend) |
| `origin/arena/gfw-fail-closed-2026-10-18` | `fd45b97` | 2026-10-18 | `+1/-199` | Test GFW `null/blank` remplacé par la suite C9/EUDR actuelle sur `main` |
| `origin/integration/geoforest-p0-a-b-2026-10-21` | `507c894` | 2026-10-21 | `+5/-128` | Règles d'identité explicite et fail-closed DB déjà portées sur `main` (`backend/tests/test_operateur_identite.py` et `test_database_fail_closed.py`) ; seul le fichier de test regroupé `test_fail_closed_security.py` diffère en nommage |

---

## Catégorie 3 — Branches de documentation ou tests de barrière obsolètes / repris (6 branches)

| Branche distante | Tête | Date | Écart (`+/-`) | Statut |
|---|---|---|---:|---|
| `origin/docs/geoforest-reprise-2026-11-13` | `b253ddc` | 2026-11-13 | `+3/-2` | PR #23 — **repris et actualisé** au 21/11/2026 dans `docs/REPRISE_GEOFOREST.md` et `README.md` |
| `origin/arena/1d5298ca-geoforest` | `502797c` | 2026-11-05 | `+1/-209` | Constat « checks fantômes retirés / 0 approbation » **repris** dans `docs/PROTECTION-MAIN.md` |
| `origin/arena/9a154c48-geoforest` | `1cd7cc8` | 2026-11-10 | `+1/-186` | Ancienne procédure `MIGRATIONS-NEON.md` remplacée par l'état du 13/11 (`f5f7db4`) |
| `origin/arena/7fa381ce-geoforest` | `d9e45c7` | 2026-11-04 | `+1/-217` | Instantané intermédiaire de `docs/PROTECTION-MAIN.md` (supplanté) |
| `origin/arena/7b33661b-geoforest` | `7789f73` | 2026-11-04 | `+1/-215` | PR #15 — diagnostic intermédiaire de `docs/PROTECTION-MAIN.md` (supplanté) |
| `origin/arena/test-2` | `55162e1` | 2026-11-04 | `+1/-212` | PR #16 — assertion volontairement fausse pour tester la barrière CI ; à supprimer |

---

## Catégorie 4 — Branche historique à contenu partiel non fusionnable (1 branche)

### `origin/arena/837c5c36-geoforest` (PR #7, `ca15ccb`, 2026-10-19, `+8/-222`)

- **Ne jamais fusionner telle quelle** : elle crée `drizzle/0007_operateur_non_renseigne.sql` qui entre en collision avec `drizzle/0007_c6d_risque_parcelle_nul.sql` sur `main` (le changement équivalent existe déjà sur `main` en `0012_operateur_non_renseigne.sql`).
- **Fichiers présents dans PR #7 et absents de `main` :**
  - **5 scripts de contrôle TypeScript** (éventuellement à porter sélectivement au chantier D si non déjà couverts par `tests/unit/` et `npm run audit:*`) :
    - `scripts/check-audit-dependances.ts`
    - `scripts/check-demarrage-sans-config.ts`
    - `scripts/check-eudr-geo-edge-cases.ts`
    - `scripts/check-limitation-memoire.ts`
    - `scripts/check-migration-identite.ts`
  - **2 fichiers de tests Python** (candidats au portage sélectif si `backend/` est conservé) :
    - `backend/tests/test_gfw_degraded.py`
    - `backend/tests/test_gis_edge_cases.py`
  - **Archives documentaires historiques** (sans besoin de reprise) : `RAPPORT_PHASE3`, `RAPPORT_PHASE11`, `RECETTE_VALIDATION_EXTERNE`, `ROTATION_SECRETS_ET_INTEGRITE_AUDIT`, `SECURITE_RISQUES_RESIDUELS`, `VALIDATION_GEOFOREST_2026-10-19`.
  - **`src/lib/eudr/frontieres.ts`** : volontairement retiré de `main` lors de la réconciliation #2 au profit de `src/lib/eudr/resolution-pays.ts` (ne pas réintroduire).

---

## Catégorie 5 — Lignée prototype initiale `chantier-1`..`8` (9 branches, 28–30/09/2026)

Ces 9 branches partagent un ancêtre lointain (`ba6b8da`, -247 commits derrière `main`) et correspondent à une première lignée expérimentale (Vitest, Playwright, worker documentaire local, `ruff.toml`) remplacée par l'architecture actuelle de `main`.

- `origin/chantier-1/socle-securise` (`fbd1713`, `+1/-247`)
- `origin/chantier-2/collecte-fournisseurs` (`a924ba8`, `+2/-247`)
- `origin/chantier-3/parcelles-geolocalisation` (`106cfa3`, `+4/-247`)
- `origin/chantier-4/gis-sources` (`425e29d`, `+8/-247`)
- `origin/chantier-5/forest-signals` (`0fff6dc`, `+12/-247`)
- `origin/chantier-6/documents-legality-risk` (`7d39144`, `+14/-247`)
- `origin/chantier-7/due-diligence-exports` (`7c60517`, `+18/-247`)
- `origin/chantier-8/security-release` (`63be1a1`, `+38/-247`)
- `origin/agent/chantiers-c1-c5-complement` (`891c02f`, `+5/-247`)

**Recommandation :** conserver uniquement si une archive historique de la piste worker ClamAV/S3 (`chantier-8`) est souhaitée comme référence de lecture, sinon taguer `archive/prototype-2026-09` sur `63be1a1` et supprimer les 9 branches.

---

## Procédure de nettoyage recommandée (à exécuter par le propriétaire)

1. Avant toute suppression, vérifier l'état live des PR ouvertes sur GitHub (`gh pr list --state open`) et des branches Neon Preview rattachées.
2. Clore les PR remplacées ou ancêtres (#21, #15, #10, #6, #5, #4, #3, #1) avec un commentaire renvoyant à ce document.
3. Supprimer d'abord les **15 branches de la Catégorie 1** (ancêtres stricts, risque nul), puis les **8 branches de la Catégorie 2** et les **6 de la Catégorie 3** une fois le Chantier A fusionné.
4. Décider du portage sélectif éventuel des 5 scripts TS / 2 tests Python de la PR #7 avant de fermer `arena/837c5c36-geoforest`.
