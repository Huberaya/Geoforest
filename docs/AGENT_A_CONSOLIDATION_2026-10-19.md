# Agent A — Consolidation technique, phase 2

Date : 19 octobre 2026. Branche unique : `arena/e7725e3f-geoforest`.

## Références réconciliées avant modification

- Départ local et main distant : `1c95f4c585ed8303f887089ae7450c9235523fd0`.
- Branche de session absente du distant au départ (confirmé par `git ls-remote --heads`). Elle a été créée par push normal, sans remplacer de travail distant.
- Diagnostic initial non suivi et non commité au départ ; désormais suivi depuis `dde25c86440e2993f4b791b32f3de4a3b0c00b68`, chemin `docs/AGENT_A_DIAGNOSTIC_2026-10-19.md`. Son contenu reste un instantané de phase 1, pas l’état courant.
- SHA de code testé localement après toutes les corrections : **`26350a1e0ce89cde8af4c1a9a643b9123b5f1a8b`**. Les mises à jour documentaires suivantes ne sont pas incluses dans cette preuve locale ; leur tête doit être qualifiée séparément en CI.

| PR | Tête exacte conservée | Base API / merge-base Git | Cible distante au diagnostic |
|---|---|---|---|
| #1 | `dbf78a1135fb5b9b6723499fb1f64c0b2a956d6b` | `a0aa110683731f33473e9b34f9dd456532a3d1a9` | `bc61a23a472a97a0019613ee2966e8e483da4e74` |
| #3 | `9d50bdc00d795571eb3ad832b8217ef1e12e1d1d` | `bc61a23a472a97a0019613ee2966e8e483da4e74` | `bc61a23a472a97a0019613ee2966e8e483da4e74` |
| #4 | `e8c0cdb90f5944b14cd204165b0b7fb9265a8daa` | `cfa999da9a7a070592ee34ba89fe0437f991b573` | `9d50bdc00d795571eb3ad832b8217ef1e12e1d1d` |
| #5 | `c639a2255d4e34ccfbbc3e0475ab20d9924564f0` | `e8c0cdb90f5944b14cd204165b0b7fb9265a8daa` | `e8c0cdb90f5944b14cd204165b0b7fb9265a8daa` |
| #6 | `751df8b8bac358fb252de9e9e9b1af664fd6e8bc` | `c639a2255d4e34ccfbbc3e0475ab20d9924564f0` | `c639a2255d4e34ccfbbc3e0475ab20d9924564f0` |

Les références sont identiques à la phase 1. Les calculs utilisent les **têtes distantes réelles** des cibles, et non arbitrairement les bases API historiques. #1 : ancêtre a0aa110, branche cible avancée de bc61a23 (1 commit CI), 5 commits propres. #4 : ancêtre cfa999d, branche cible avancée de 9d50bdc (1 commit CI), 15 commits propres. Ce sont deux bifurcations prouvées par Git, pas des changements de base décidés par l’agent. #3 : 6 commits propres ; #5 : 21 ; #6 : 18. Liste complète des SHA et sujets dans l’annexe A du diagnostic.

## Intégration réalisée (fusions Git locales, aucune fusion de PR GitHub)

```text
main 1c95f4c → diagnostic dde25c8
 → fusion #3 cc55481 (socle bc61a23 + sécurité 9d50bdc)
 → fusion #4 946e9ca (e8c0cdb)
 → fusion #5 234867f (c639a22 ; union des déclencheurs CI)
 → fusion #6 e87bb75 (751df8b)
 → fusion #1 6e58dff (dbf78a1 ; union des tests GFW)
 → tests/propreté 7090959
 → correctif dépendance 26350a1
```

Les cinq têtes d’origine sont ancêtres du cumul : aucun commit supprimé, aucune réécriture, aucun reset, aucun push forcé. #1 est **intégrée**, non déclarée supersédée et non fermée. #3 fournit le socle et son déclencheur CI ; #4 conserve le durcissement moteur/preuves ; #5 neutralise les estimations pays ; #6 conserve les contrôles de géométrie/parité et le runner déterministe. Toutes les PR restent indépendantes de ces fusions locales.

## Corrections et causes racines

| Fichiers | Cause et résolution |
|---|---|
| `.github/workflows/ci.yml` | Conflit security/** contre forest/** lors de l’entrée #5. Union des cibles PR, push arena/** et forest/** conservés, permissions contents:read, pas de pull_request_target, pas de continue-on-error. Nouveau gate test:ci. |
| `scripts/check-eudr-rules.ts` | Conflit entre tests renforcés #6 et matrice #1. Les deux sont conservés ; chaque cas #1 vérifie aussi source=unavailable et est répété avec une ligne valide mélangée. |
| `src/lib/eudr/satellite-checker.ts` | La fusion automatique ajoute la garde de décision #1 en conservant la normalisation stricte #6 à l’entrée GFW. Validation volontairement redondante, pas de retour à la conversion permissive ni perte des trous/provenance/risque UNKNOWN. |
| `backend/tests/test_satellite_checker.py` | Ajout de la matrice exacte #1 à la frontière publique Python, seule et mélangée : 20 cas supplémentaires, réseau substitué. |
| `scripts/ci/check-workflow.test.cjs`, package.json/lock | 4 tests structurels YAML des déclencheurs, permissions, ordre création/migration/reset/nettoyage éphémère et gates qualité. js-yaml 4.3.2 devient dépendance de développement explicite (déjà présent transitivement). |
| 5 pages app + scripts/e2e/client.ts | Espaces finaux et ligne vide finale du cumul supprimés, sans changement métier. |
| package-lock.json | Audit confirmé : source-map-js 1.2.1 vulnérable (GHSA-68fv-2mgg-jv7q). Mise à jour compatible vers 1.2.2, seule cette entrée transitive change ; aucun downgrade Next/ESLint. |

## Matrice GFW et preuves

Pour chaque ligne : résultat attendu **source unavailable, compliant null, is_probative false**, vérifié dans les tests TS publics et Python publics. Chacun est testé seul et après une ligne valide de 2015.

| Cas de #1 | TS `testReponseGfw` | Python `test_pr1_matrix_fail_closed_at_public_boundary` |
|---|---|---|
| année absente | réussi | réussi |
| année nulle | réussi | réussi |
| année vide | réussi | réussi |
| année non numérique | réussi | réussi |
| année future | réussi | réussi |
| surface absente | réussi | réussi |
| surface nulle | réussi | réussi |
| surface vide | réussi | réussi |
| surface négative | réussi | réussi |
| surface infinie | réussi | réussi |

Les tests antérieurs #6 sur trous de polygone, provenance SHA-256, destination finale non officielle, confiance nulle, pays UNKNOWN, payload non tableau et perte post-2020 sont conservés et passent dans les suites. Cette preuve concerne les comportements simulés et le cumul testé, pas la vérité scientifique de GFW.

## Résultats locaux exacts

Exécution répétée après le correctif de dépendance sur `26350a1e0ce89cde8af4c1a9a643b9123b5f1a8b`, Node 22.22.3 / npm 10.9.8 / Python 3.11.2 (la CI définit Node 20 / Python 3.12) :

| Commande | Résultat observé |
|---|---|
| npm ci | exit 0, lockfile respecté, 430 paquets installés |
| npm run test:ci | exit 0, 4 tests réussis |
| npm run typecheck | exit 0 |
| npm run lint | exit 0 |
| npm run test:unit | exit 0, toutes les suites enchaînées réussissent |
| npm run test:eudr | exit 0, 72/72 |
| venv puis pip install -r backend/requirements.txt | exit 0, environnement isolé hors dépôt |
| python -m pytest -q -rx (backend, venv) | exit 0, **111 passed, 5 xfailed** |
| npm run build | exit 0, bundle Next.js produit |
| python -m compileall -q backend/app backend/main.py backend/index.py | exit 0 sur le même code backend ; pas d’étape build backend définie |
| git diff --check origin/main HEAD | exit 0, cumul complet |
| npm audit --json | exit 1, **5 high restantes**, contre 6 avant correction |

Les 5 xfail préexistants restent explicitement visibles : deux sur absence d’isolation tenant du service FastAPI historique, trois sur endpoints géospatiaux multi-sources non livrés. Ils ne sont ni corrigés ni requalifiés en succès. FastAPI reste retiré du chemin produit et lié à loopback.

Le runner `npx tsx --conditions=react-server scripts/satellite/validate-reference.ts` donne exit 2 : C/D réussis, A/B/E non exécutés faute de géométries et attentes expert. Une première tentative lancée en parallèle de npm ci a échoué MODULE_NOT_FOUND pendant le remplacement de node_modules ; relance séquentielle réussie pour C/D, sans modification du code. Ce n’est pas une preuve GFW réelle.

Les 5 high restantes proviennent de braces 3.0.3 / micromatch / fast-glob / chaîne eslint-config-next. Le registre ne propose pas de braces corrigé (latest 3.0.3) ; l’audit recommande eslint-config-next 14.2.35, rétrogradation incompatible avec Next 16. Aucun fix --force appliqué, risque non masqué.

## CI exacte et limites

Premier push de qualification : `7090959978a8cf87ce5fd2247fd3f52dc9cde70f`, run [39281279820](https://github.com/Huberaya/Geoforest/actions/runs/39281279820). Lors de la rédaction, **les deux jobs sont queued**, sans résultat : aucune réussite revendiquée. Ce run n’est pas une preuve du correctif de dépendance ultérieur ni du commit documentaire porteur de ce rapport. La tête finale sera poussée puis ses jobs examinés séparément ; le compte rendu de sortie identifiera son SHA et son run exact, ou explicitera le blocage.

Pas de Docker ni psql disponibles localement. Aucune base réelle n’a été utilisée localement, aucun secret lu ou modifié. Le workflow existant crée une branche Neon éphémère avant migrations et seed reset, puis la supprime avec always(). Les tests de structure vérifient cet ordre, mais **ne remplacent pas son exécution**. Tant que le job DB de la tête finale n’a pas réussi, migrations et DB/HTTP du cumul restent NON VALIDÉS.

## Migrations, configuration, sécurité et rapports

- Migrations 0007/0008 et post-migrate 023/024 inspectés : clés composites tenant, invitation fournisseur, quarantaine des comptes fournisseurs sans lien, délais SQL du rôle. Risque métier de la quarantaine à faire approuver pour un déploiement ; aucun SQL modifié par l’agent A, aucun déploiement effectué.
- Aucun diff par rapport à #6 dans drizzle/, scripts/sql/post-migrate/, docker-compose.yml, next.config.ts ou vercel.json. Configuration de production inchangée par les corrections de consolidation.
- Le secret scanner par motifs du diff ne suffit pas à certifier tout l’historique : aucun nouveau secret introduit volontairement ; les secrets historiques demeurent à tourner par l’exploitant. Aucun environnement local, venv, node_modules ou artefact ajouté à Git.
- Les rapports historiques reçoivent un bandeau vers cette preuve datée, sans remplacer leurs chiffres historiques par des résultats inventés. Le NO-GO production et les blocages scientifiques/externe sont maintenus.

**Statut : cumul construit et contrôles locaux réussis avec limites explicites ; qualification CI finale et DB conditionnées à l’exécution effective des jobs. Aucune PR fusionnée ou fermée sur GitHub, main non modifiée, aucun changement de secret ni déploiement production.**

## Diff et traçabilité du cumul de code testé

```text
.env.example                                       |   23 +-
 .github/workflows/ci.yml                           |  116 +-
 Dockerfile                                         |    3 +-
 README.md                                          |   20 +-
 backend/Dockerfile                                 |    5 +-
 backend/app/api/v1/endpoints.py                    |   64 +-
 backend/app/core/config.py                         |   20 +-
 backend/app/models/schemas.py                      |    5 +-
 backend/app/services/gis_validator.py              |   52 +-
 backend/app/services/satellite_checker.py          |  163 +-
 backend/app/services/traces_exporter.py            |    8 +-
 backend/tests/test_backend_auth.py                 |   59 +
 backend/tests/test_cross_tenant.py                 |   97 +
 backend/tests/test_eudr_pipeline.py                |  153 +-
 backend/tests/test_geospatial.py                   |   14 +
 backend/tests/test_satellite_checker.py            |  139 +
 backend/tests/test_security_config.py              |   38 +
 docker-compose.yml                                 |   37 +-
 docs/AGENT_A_DIAGNOSTIC_2026-10-19.md              |  365 +++
 docs/BACKUP_RESTORE_TEST.md                        |  193 ++
 docs/BLOCKERS_RESOLUTION_REPORT.md                 |  214 ++
 docs/CHANTIERS_GEOFOREST_2026-10-19.md             |   56 +
 docs/CI_NEON.md                                    |   46 +
 docs/CROSS_TENANT_TEST_REPORT.md                   |  136 +
 docs/DDS_STATE_MACHINE_TEST_REPORT.md              |  111 +
 docs/DEPLOYMENT_VERCEL.md                          |    3 +-
 docs/E2E_TEST_REPORT.md                            |   78 +
 docs/EUDR_WORKFLOW_VALIDATION.md                   |  121 +
 docs/EVIDENCE_ENGINE_SPEC.md                       |  179 ++
 docs/EVIDENCE_PACK_TEST_REPORT.md                  |  133 +
 docs/FINALIZATION_BASELINE.md                      |   56 +
 docs/PRODUCTION_READINESS_REPORT.md                |  160 ++
 docs/PRODUCTION_RUNBOOK.md                         |  154 +
 docs/SATELLITE_VALIDATION_REPORT.md                |  113 +
 docs/SECURITY_TEST_REPORT.md                       |   77 +
 docs/TEST_REPORT.md                                |    2 +-
 docs/TRACES_SCOPE.md                               |   44 +
 drizzle/0007_parcel_audit_liens.down.sql           |    6 +
 drizzle/0007_parcel_audit_liens.sql                |    6 +
 drizzle/0008_fournisseur_invitation.sql            |   10 +
 drizzle/meta/0007_snapshot.json                    | 2906 +++++++++++++++++++
 drizzle/meta/0008_snapshot.json                    | 2957 ++++++++++++++++++++
 drizzle/meta/_journal.json                         |   16 +-
 next-env.d.ts                                      |    4 +-
 next.config.ts                                     |   11 +-
 package-lock.json                                  |   14 +-
 package.json                                       |   20 +-
 scripts/check-cross-tenant-rls.ts                  |  237 ++
 scripts/check-cross-tenant.ts                      |  480 ++++
 scripts/check-dds-etats-http.ts                    |  281 ++
 scripts/check-dds-etats.ts                         |  172 ++
 scripts/check-eudr-rules.ts                        |  178 +-
 scripts/check-evidence-pack-http.ts                |  341 +++
 scripts/check-evidence-pack.ts                     |  177 ++
 scripts/check-fournisseur-http.ts                  |  401 +++
 scripts/check-readiness.ts                         |  185 ++
 scripts/check-restauration-app.ts                  |  101 +
 scripts/check-sauvegarde.sh                        |  129 +
 scripts/check-sql-limits.ts                        |    2 +-
 scripts/ci/check-workflow.test.cjs                 |   42 +
 scripts/ci/neon-branche.ts                         |  165 ++
 scripts/e2e/client.ts                              |  104 +
 scripts/e2e/parcours.ts                            |  257 ++
 scripts/empreinte-sauvegarde.ts                    |  189 ++
 scripts/restauration.sh                            |  104 +
 scripts/satellite/reference-cases.json             |   97 +
 scripts/satellite/validate-reference.ts            |  104 +
 scripts/sauvegarde.sh                              |  101 +
 scripts/seed-auth.ts                               |   69 +-
 .../sql/post-migrate/023_fournisseur_tenant.sql    |   24 +
 .../post-migrate/024_delais_role_applicatif.sql    |   15 +
 scripts/verifier-pack.ts                           |   54 +
 src/app/(app)/documents/page.tsx                   |    2 +-
 src/app/(app)/due-diligence/page.tsx               |    4 +-
 src/app/(app)/page.tsx                             |    5 +-
 src/app/(app)/plots/[id]/page.tsx                  |    6 +-
 src/app/(app)/plots/page.tsx                       |    2 +-
 src/app/(app)/reports/page.tsx                     |    4 +-
 src/app/(app)/risks/page.tsx                       |    2 +-
 src/app/(app)/settings/page.tsx                    |    2 +-
 src/app/(app)/suppliers/[id]/page.tsx              |    2 +
 src/app/(auth)/accepter-invitation/page.tsx        |  137 +
 src/app/api/v1/audit/parcel/route.ts               |   96 +-
 src/app/api/v1/audits/[id]/route.ts                |   20 +-
 src/app/api/v1/audits/route.ts                     |    4 +-
 src/app/api/v1/auth/invitation/accept/route.ts     |   96 +
 src/app/api/v1/auth/logout/route.ts                |    3 +-
 src/app/api/v1/documents/[id]/file/route.ts        |    9 +-
 src/app/api/v1/documents/[id]/route.ts             |   78 +-
 src/app/api/v1/documents/route.ts                  |   56 +-
 .../due-diligence/[id]/audits/[auditId]/route.ts   |   65 +
 src/app/api/v1/due-diligence/[id]/audits/route.ts  |   88 +
 .../v1/due-diligence/[id]/evidence-pack/route.ts   |   78 +
 .../api/v1/due-diligence/[id]/readiness/route.ts   |   32 +
 src/app/api/v1/due-diligence/[id]/route.ts         |  126 +-
 src/app/api/v1/due-diligence/route.ts              |   32 +
 src/app/api/v1/export/traces/route.ts              |   99 +-
 src/app/api/v1/nav/counts/route.ts                 |    6 +-
 src/app/api/v1/plots/[id]/route.ts                 |   88 +-
 src/app/api/v1/plots/route.ts                      |    9 +-
 src/app/api/v1/shipments/route.ts                  |   34 +-
 .../api/v1/supplier-portal/submissions/route.ts    |   21 +-
 src/app/api/v1/suppliers/[id]/invitation/route.ts  |  191 ++
 src/components/AuditResultCard.tsx                 |   14 +-
 src/components/RiskBadge.tsx                       |    2 +
 src/db/admin.ts                                    |    9 +
 src/db/index.ts                                    |   20 +-
 src/db/schema.ts                                   |   35 +
 src/lib/api.ts                                     |    7 +-
 src/lib/auth/perimetre.ts                          |   30 +
 src/lib/auth/session.ts                            |    4 +
 src/lib/eudr/dds-etats.ts                          |   92 +
 src/lib/eudr/gis-validator.ts                      |   63 +-
 src/lib/eudr/readiness-db.ts                       |  159 ++
 src/lib/eudr/readiness.ts                          |  356 +++
 src/lib/eudr/satellite-checker.ts                  |  205 +-
 src/lib/eudr/traces-exporter.ts                    |   36 +-
 src/lib/eudr/types.ts                              |   16 +-
 src/lib/evidence/assembler.ts                      |  328 +++
 src/lib/evidence/pack.ts                           |  171 ++
 src/lib/idempotence.ts                             |   14 +-
 src/proxy.ts                                       |    3 +
 vercel.json                                        |   45 +-
 123 files changed, 15725 insertions(+), 497 deletions(-)
```

### Corrections propres à la consolidation (par rapport à #6)

```text
M	.github/workflows/ci.yml
M	backend/tests/test_satellite_checker.py
A	docs/AGENT_A_DIAGNOSTIC_2026-10-19.md
M	package-lock.json
M	package.json
M	scripts/check-eudr-rules.ts
A	scripts/ci/check-workflow.test.cjs
M	scripts/e2e/client.ts
M	src/app/(app)/documents/page.tsx
M	src/app/(app)/due-diligence/page.tsx
M	src/app/(app)/plots/page.tsx
M	src/app/(app)/risks/page.tsx
M	src/app/(app)/settings/page.tsx
M	src/lib/eudr/satellite-checker.ts
```
