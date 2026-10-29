# Agent A — Diagnostic de consolidation technique

Date : 19 octobre 2026 (UTC). Phase 1 uniquement. **En attente de validation du chef de chantier.**

Aucune fusion, fermeture de PR, correction applicative, modification de secret, migration exécutée, installation, déploiement, commit ou push pendant ce diagnostic. Seul ce rapport est ajouté. Les simulations `git merge-tree --write-tree` ne modifient ni branche ni index ; leurs arbres non référencés ne constituent pas une intégration.

## 1. Références et sources

Dépôt `Huberaya/Geoforest`. HEAD local et `origin/main` : `1c95f4c585ed8303f887089ae7450c9235523fd0` (dernier commit : retrait de la marque de sondage dans le résumé d’audit). Branche de session : `arena/e7725e3f-geoforest`, initialement propre. Le diagnostic porte sur des références lues successivement, pas une transaction atomique distante.

Sources : références Git récupérées, API GitHub des PR, check-runs et commit statuses, runs et étapes des jobs, rapports présents dans l’arbre de #6. Les résultats CI ci-dessous sont observés sur GitHub, **pas des tests relancés localement**.

### Branches distantes (SHA exacts)

```text
891c02f868e1f4d4302352ff9842dae2ce771fec	refs/heads/agent/chantiers-c1-c5-complement
bc61a23a472a97a0019613ee2966e8e483da4e74	refs/heads/arena/c73246d2-geoforest
fd45b97c7926ddd6dd5bcfa0b099789eb0771ab2	refs/heads/arena/gfw-fail-closed-2026-10-18
fbd171323a3ca424203cb34bbec3479fe8610652	refs/heads/chantier-1/socle-securise
a924ba85839cfb4921d3b1983dbc10d3e3e9299c	refs/heads/chantier-2/collecte-fournisseurs
106cfa3c7afa0b4716930ca78f3a58a69f196fad	refs/heads/chantier-3/parcelles-geolocalisation
425e29deaf3fd17c587b048c807d96c79d164c78	refs/heads/chantier-4/gis-sources
0fff6dc8726f353556025c0f60026a191768168e	refs/heads/chantier-5/forest-signals
7d391447ea9de6031b607b97630b258c7f27c966	refs/heads/chantier-6/documents-legality-risk
7c60517a24736d831d6424a1cea56bd22950b129	refs/heads/chantier-7/due-diligence-exports
63be1a1d400a390acf9e1e1bc41ec0927370d5f8	refs/heads/chantier-8/security-release
dbf78a1135fb5b9b6723499fb1f64c0b2a956d6b	refs/heads/fix/gfw-fail-closed-2026-10-18
751df8b8bac358fb252de9e9e9b1af664fd6e8bc	refs/heads/forest/chantiers-1-2-3-audit-2026-10-19
c639a2255d4e34ccfbbc3e0475ab20d9924564f0	refs/heads/forest/country-risk-neutralization-2026-10-18
e8c0cdb90f5944b14cd204165b0b7fb9265a8daa	refs/heads/forest/engine-evidence-chantier-d-2026-10-18
1c95f4c585ed8303f887089ae7450c9235523fd0	refs/heads/main
9d50bdc00d795571eb3ad832b8217ef1e12e1d1d	refs/heads/security/tenant-isolation-chanti-er-c-2026-10-18
```

### Graphe pertinent

```text
main 1c95f4c
└─ socle candidat (20 commits jusqu’à bc61a23)
   ├─ a0aa110 → 5 commits GFW → dbf78a1 (#1)
   └─ bc61a23 → 5 commits sécurité → cfa999d
      ├─ 9d50bdc (#3 ; déclencheur CI security/**)
      └─ 15 commits → e8c0cdb (#4)
         └─ 21 commits → c639a22 (#5)
            └─ 18 commits → 751df8b (#6)
```

Le dessin de la bifurcation #1 indique son point de départ a0aa110, avant bc61a23. #6 contient 79 commits absents de main ; il ne contient ni les 5 commits de #1 ni le dernier commit de #3. Les branches historiques `chantier-*`, `agent/*` et `arena/gfw-*` restent intactes ; elles ne sont pas proposées comme bases alternatives. La branche `arena/gfw-*` est distincte de la tête de #1 : ne pas les confondre.

## 2. Matrice PR

Toutes les PR demandées sont **OPEN, draft, non fusionnées**, `merged_at=null`. Les SHA de merge renvoyés par GitHub sont des références de simulation, pas des commits fusionnés dans main.

| PR | Cible | Base API | Tête exacte | Ancêtre commun avec cible distante actuelle | Commits exclusifs tête / cible |
|---|---|---|---|---|---|
| [#1](https://github.com/Huberaya/Geoforest/pull/1) | `arena/c73246d2-geoforest` | `a0aa110683731f33473e9b34f9dd456532a3d1a9` | `dbf78a1135fb5b9b6723499fb1f64c0b2a956d6b` | `a0aa110683731f33473e9b34f9dd456532a3d1a9` | 5 / 1 |
| [#3](https://github.com/Huberaya/Geoforest/pull/3) | `arena/c73246d2-geoforest` | `bc61a23a472a97a0019613ee2966e8e483da4e74` | `9d50bdc00d795571eb3ad832b8217ef1e12e1d1d` | `bc61a23a472a97a0019613ee2966e8e483da4e74` | 6 / 0 |
| [#4](https://github.com/Huberaya/Geoforest/pull/4) | `security/tenant-isolation-chanti-er-c-2026-10-18` | `cfa999da9a7a070592ee34ba89fe0437f991b573` | `e8c0cdb90f5944b14cd204165b0b7fb9265a8daa` | `cfa999da9a7a070592ee34ba89fe0437f991b573` | 15 / 1 |
| [#5](https://github.com/Huberaya/Geoforest/pull/5) | `forest/engine-evidence-chantier-d-2026-10-18` | `e8c0cdb90f5944b14cd204165b0b7fb9265a8daa` | `c639a2255d4e34ccfbbc3e0475ab20d9924564f0` | `e8c0cdb90f5944b14cd204165b0b7fb9265a8daa` | 21 / 0 |
| [#6](https://github.com/Huberaya/Geoforest/pull/6) | `forest/country-risk-neutralization-2026-10-18` | `c639a2255d4e34ccfbbc3e0475ab20d9924564f0` | `751df8b8bac358fb252de9e9e9b1af664fd6e8bc` | `c639a2255d4e34ccfbbc3e0475ab20d9924564f0` | 18 / 0 |

**Bases à clarifier avant intégration :** l’API #1 annonce a0aa110 alors que la branche cible vaut bc61a23 ; l’API #4 annonce cfa999d alors que sa cible vaut 9d50bdc. Les ancêtres Git expliquent les bifurcations, mais la base réellement voulue pour l’intégration reste à confirmer. Les états GitHub `clean` ne signifient pas que le cumul #1/#3/#6 est sans conflit.

### CI aux têtes exactes

- #1, #3, #4 : les deux jobs techniques et le contrôle Vercel Preview Comments sont terminés avec succès sur leurs têtes respectives ; statut Vercel success.
- #5 : exécutions techniques réussies mais aussi deux check-runs annulés sur la même tête ; l’API indique `mergeable_state=unstable`. Ne pas résumer tous ses contrôles par « tout vert » sans préciser l’annulation et la politique de contrôles requis.
- #6 : deux runs complets réussis, [push 39242577652](https://github.com/Huberaya/Geoforest/actions/runs/39242577652) et [PR 39242583997](https://github.com/Huberaya/Geoforest/actions/runs/39242583997), tous deux sur `751df8b8bac358fb252de9e9e9b1af664fd6e8bc`.
- Étapes du run PR #6 vérifiées par API : installation backend et pytest, **npm ci**, typecheck, lint, unitaires, règles EUDR, build ; création Neon éphémère, migrations, rôle applicatif, contrôles DB, seed de test, build, E2E, HTTP inter-tenant, parcours fournisseur, arrêt et suppression Neon : toutes `success`, aucune de ces étapes sautée.
- Cela ne certifie ni la production, ni la preuve GFW réelle, ni un futur arbre de résolution. Aucun nouveau workflow privilégié n’a été déclenché.

## 3. Recouvrement, pertes et conflits démontrés

- #1 : 5 commits exclusifs, **aucun patch identique** à #6 selon `git cherry origin/pr-6 origin/pr-1` (5 lignes `+`). Ils touchent `src/lib/eudr/satellite-checker.ts` et `scripts/check-eudr-rules.ts`.
- Le besoin fail-closed de #1 est repris fonctionnellement dans #4/#6 : normalisation stricte année/surface, rejet des lignes non objets et du champ data non tableau ; #6 ajoute validation à la frontière de décision et parité Python. Il ne faut pas appliquer mécaniquement les 5 commits de #1.
- Le tableau des 10 cas malformés de #1 est remplacé dans le script EUDR de #6 par des cas distincts, avec d’autres tests unitaires ailleurs. Avant de considérer #1 comme totalement supersédée, établir et exécuter une table de correspondance des cas (année absente/nulle/vide/non numérique/future, surface absente/nulle/vide/négative/infinie), y compris source unavailable, compliant null et is_probative false. Cette équivalence de couverture n’est pas certifiée par ce diagnostic.
- `merge-tree #1 #6` **échoue avec conflit** dans `scripts/check-eudr-rules.ts`. Le moteur fusionne textuellement automatiquement, ce qui n’est pas une preuve de cohérence métier.
- `merge-tree #3 #6` **échoue avec conflit** dans `.github/workflows/ci.yml`. #6 inclut forest/** mais n’inclut pas le déclencheur pull_request security/** de `9d50bdc`. Une intégration partant seulement de #6 perd ce déclencheur ; une résolution par « ours/theirs » peut perdre soit forest/** soit security/**. Préserver les deux intentions, sans élargir aveuglément l’exposition des jobs à secrets.
- `merge-tree #1 #3` réussit textuellement ; ce résultat n’annule pas les conflits avec #6.
- #5 et #6 sont descendants directs de #4 puis #5 : leurs différences locales ne doivent pas être réappliquées par-dessus leur cumul. Un squash/rebase des couches impose de recalculer leurs bases pour éviter duplication et réintroduction de code ancien.
- Diff main → #6 : **121 fichiers, 15 228 insertions, 491 suppressions**, dont deux snapshots Drizzle volumineux. Ce n’est pas une petite correction GFW : le socle apporte aussi isolation tenant, DDS, preuves, fournisseur, sauvegarde et CI DB. Sa revue est un prérequis.
- Migrations ajoutées : 0007 liens parcelle/audit, 0008 invitation fournisseur et scripts post-migrate 023/024. Aucune modification de migration déployée autorisée ; vérifier l’état de déploiement avant toute décision.
- `git diff --check origin/main origin/pr-6` : **exit 2**, défauts d’espaces dans cinq pages et ligne vide finale de `scripts/e2e/client.ts`. Défaut de propreté confirmé, pas une preuve de panne fonctionnelle.

## 4. Confrontation des rapports

| Rapport lu dans #6 | Constat actuel |
|---|---|
| CHANTIERS_GEOFOREST_2026-10-19 | Référence de test 0c74c5e et run 39183371600 historique ; n’identifie pas le dernier head testé 751df8b. Le succès actuel de #6 est confirmé séparément ; ne pas attribuer ses résultats à un nouveau commit. |
| FINALIZATION_BASELINE | Baseline du 08/10, migrations annoncées jusqu’à 0007 alors que #6 inclut 0008 ; résultats chiffrés historiques, non une qualification du cumul actuel. |
| SATELLITE_VALIDATION_REPORT | Contient des couches historiques, dont risque pays par boîtes englobantes « encore » présent, puis addendum de neutralisation. Lire chronologiquement ; présenter explicitement le statut courant UNKNOWN. A/B/E restent sans géométrie/attentes renseignées. |
| PRODUCTION_READINESS_REPORT | NO-GO et limites de production à maintenir ; ses nombres de tests et audits de dépendances ne sont pas une mesure sur 751df8b. |
| BLOCKERS_RESOLUTION_REPORT, SECURITY_TEST_REPORT | Preuves historiques utiles, mais rotation, audit complet de secrets, vulnérabilités actuelles, antivirus, S3, restauration réelle et GFW ne sont pas certifiés par une Preview ou la CI technique. Aucune valeur sensible n’est recopiée dans ce rapport. |

Les dépendances Python directes sont épinglées dans requirements.txt, mais sans verrouillage transitif/hashes : ce n’est pas l’équivalent du lockfile npm. Ne pas prétendre à une reproductibilité transitive stricte du backend.

## 5. Plan proposé — soumis au chef de chantier

1. **Confirmer les bases** : socle candidat `bc61a23a472a97a0019613ee2966e8e483da4e74`, couche sécurité complète `9d50bdc00d795571eb3ad832b8217ef1e12e1d1d`, puis #4 → #5 → #6. Ces branches ne sont pas main ; décider explicitement de la destination de consolidation avant toute intégration.
2. Recommander la séquence logique **socle → #3 → #4 → #5 → #6**. Ne fusionner aucune PR dans cette session. Examiner #1 comme variante supersédée à vérifier, pas une couche à empiler automatiquement ; aucune fermeture sans instruction.
3. Après validation seulement, construire le cumul autorisé sur la branche de session `arena/e7725e3f-geoforest` (fixée par Arena), préserver les deux familles de déclencheurs CI, et comparer chaque cas de #1 aux contrats du cumul. **Arrêt immédiat si une résolution impose un choix métier.**
4. Corrections limitées aux défauts démontrés et tests correspondants ; ne pas neutraliser les garde-fous métier pour rendre les tests verts. Nettoyer les défauts whitespace si autorisé. Éviter tout remaniement non nécessaire.
5. Sur le SHA final exact : npm ci, lint, typecheck, test:unit, test:eudr, build, installation backend isolée et pytest. Sur base jetable autorisée : migrations et tests DB/HTTP/E2E, y compris décision explicite sur les suites DDS HTTP, pack HTTP et RLS qui existent sans être toutes appelées explicitement par la CI actuelle.
6. Faire passer la CI complète sur ce SHA après push autorisé sur la seule branche de session. Relever run IDs, étapes, résultats réels, éventuels xfail et annulations. Mettre les rapports à jour avec le **SHA de code réellement testé** ; une nouvelle tête documentaire devra elle aussi repasser la CI.
7. Revue finale des commits, fichiers et du diff cumulé, scan de secrets sans exposer leurs valeurs, aucun .env local ni artefact, aucune migration de production ni rotation de secret dans ce périmètre.

**Point d’arrêt : bases d’intégration à confirmer, conflit de workflow prouvé, couverture supersédée de #1 non certifiée. Phase 2 non commencée.** Prochaine action précise : le chef de chantier confirme ou amende les points 1–3 et autorise la préparation du cumul sur la branche de session. Aucun résultat local d’installation/build/test/migration n’est revendiqué.

## 6. Commandes et résultats

- `git status --short`, `git remote -v`, `git log -1 --format=fuller` : checkout propre initial, HEAD ci-dessus.
- `git fetch origin --prune`, puis récupération explicite des refs heads et pulls : succès ; aucun changement de branche ni push.
- `git ls-remote --heads origin` : références listées en §1.
- `gh pr list --state all ...`, `gh api repos/Huberaya/Geoforest/pulls/{1,3,4,5,6}` : matrice et états ; PR #2 CLOSED non fusionnée, validation seulement.
- API `commits/<sha>/check-runs`, `commits/<sha>/status`, `pulls/<n>/commits`, `actions/runs?head_sha=...`, `actions/runs/39242583997/jobs` : succès, preuves CI ci-dessus.
- `git merge-base`, `git rev-list --left-right --count`, `git log base..head`, `git cherry`, `git diff --stat/--numstat`, `git show` : inventaire et comparaison, sans exécution du code candidat.
- `git merge-tree --write-tree` : #1/#6 exit 1 ; #3/#6 exit 1 ; #1/#3 exit 0. Aucun conflit résolu.
- `git diff --check origin/main origin/pr-6` : exit 2 (whitespace) ; contrôlé séparément pour ne pas masquer son statut.
- `gh run list --commit ...` : échec exit 1, option non supportée par gh 2.23.0 ; remplacé par l’API actions/runs filtrée par head_sha.
- Les sorties brutes, dont le diff candidat pouvant contenir des éléments historiques sensibles, restent hors dépôt ; seules les données non sensibles utiles sont reprises ici.

## Annexe A — commits uniques par couche

### PR #1 — absents de sa cible distante actuelle

```text
36c921f49591000db2227eaf82a27ef0ac32c009 fix(eudr): fail closed on malformed GFW rows
d05aa18328b4881165a53e2954a8cfebd5cc7571 test(eudr): reject malformed GFW response rows
3d27d6a435e8480fae681bd1564b87774d23f3ce fix(eudr): reject missing GFW values explicitly
ef4b3115fcb514057b9a128b3a7c4a4e970915a0 test(eudr): cover missing GFW area values
dbf78a1135fb5b9b6723499fb1f64c0b2a956d6b test(eudr): reject null and blank GFW years
```

### PR #3 — absents de sa cible distante actuelle

```text
3002d99364a61647c51a1a72ac2bb9a5d9439fb9 security: remove wildcard CORS default and fail closed in production
59af4a6a327c2ea8a2af6169470531ac6d1c7212 test: enforce explicit CORS origins in production
a59035a432fea448f03b9762d4ee605cf2c53611 security: bind retired FastAPI container to loopback only
8fe1ea895fc350c896100d83dec42099c2ca7f6c security: detect production environment for CORS validation
cfa999da9a7a070592ee34ba89fe0437f991b573 test: detect production CORS policy from common env names
9d50bdc00d795571eb3ad832b8217ef1e12e1d1d ci: run checks for stacked security work branches
```

### PR #4 — absents de sa cible distante actuelle

```text
d155ea969a75be989fca2fbcaefd6f545c1e11c0 fix(eudr): fail closed on malformed satellite evidence
795a2c54441ad5d967b507f981c159c272e5bacd feat(eudr): type satellite evidence digest
a33983fbc72974a86f54942d58097cca0ea3cb2b fix(eudr): avoid fabricated satellite confidence in summary
dd3462efb4a9e821e6b5ac985aa6b14ba0a1e87f test(eudr): cover geometry holes and malformed satellite responses
915245dfbccb5257ff915dbaee3d06eb64a426bb chore(eudr): remove uncalibrated confidence calculation
e5a47e9048f914f4012f93713c7c59830318ae79 fix(eudr): verify final satellite response host
43958ed7372254a9d836b1c5811559894e437fa0 test(eudr): reject satellite redirects to untrusted hosts
5fa835c121e200c503796381e1d7ac1543b175e6 docs(eudr): record engine fixes and external evidence blockers
5f9bdcbf8325f1be81a9ec8f79f3b0fc3dfa8170 fix(eudr): avoid overstating satellite result as legal compliance
8589def05dc2dc8e5d07d0d7d8d0fd6f61e54376 fix(ui): label satellite findings without legal overclaim
d9b8b224842ab0a7bc8936e79e35e996ffdabb1f fix(eudr): keep saved audit summaries evidence-scoped
511f4edd51a8ae3acf0ffe298c1c9cf09e73af35 fix(ui): hide uncalibrated confidence from historical audits
b353e7d3729e403c4462c3414fe8f5378a850a90 fix(eudr): export evidence provenance without legal overclaim
8d799de7bb57403a22473a1b2c99c07948cee3f4 docs(eudr): clarify confidence score requires calibration
e8c0cdb90f5944b14cd204165b0b7fb9265a8daa docs(eudr): document evidence-scoped results and export provenance
```

### PR #5 — absents de sa cible distante actuelle

```text
57f0c7542cd30a7150fba7393fa9e37eda20f9e1 fix(eudr): neutralize unverified country risk estimates
f94e313f6680d0fdbd50f5347c5b4bdc9d0a4b1b fix(eudr): model unassessed country risk explicitly
9c426292c6372271466dd7c08ed1b4acde741419 fix(ui): display unassessed country risk without implying a rating
d346d89171b326be2597640ea944a1f52147467f test(eudr): prevent bounding-box country risk claims
174413e2bda3dff419b209911f627c1256ce5104 docs(eudr): document country risk neutralization and remaining block
95abd04c257eb240e5dbb19b2b2993c4bb857fcc fix(backend): neutralize bounding-box country risk and uncalibrated confidence
add4f1a0f903de2e58bcbf2cdfca7af0b70158ca fix(api): allow explicit unknown risk classification
0e646c7f245a66773bca0c78d1a24c7e91e98668 test(backend): guard country risk and confidence neutrality
e87c4589b22820ccb074899fbb43fb3bb948ab25 ci: run verification workflows on forest work branches
7970fe4b4a74463d874d0c37ca31f668fd2567b1 fix(ui): render unknown supplier risk as unassessed
1af5872b7cea342f8e9bb8c4483ae20130580041 fix(ui): add neutral badge for unknown risk
1f35c4dc3793ab0118a7c26ec0068f73c85f3c55 test(backend): align EUDR pipeline with unassessed risk and confidence
85920d59832ff8c3109e4e3090c2050d238ed34a docs(backend): clarify unknown risk level contract
332fafc0839bb32ad666c386ed5dfbd0ff29aec8 test(backend): preserve simulated loss signal while neutralizing country risk
cff372b3431501e2b6694e6c0c67c2cb94f97740 fix(api): neutralize legacy country risk in audit summaries
421cd43536f779dae690bdf2fb2caba80e88031f fix(api): neutralize legacy country risk in audit detail reads
98e3fbd65550557d25a6f99994a37d3f7d8f7981 fix(export): remove inferred country risk and producer country
b65b681582d61f336f65e3ccd36031f99aa6b07a fix(api): neutralize legacy country risk in backend audit reads
4c6916d832bfbbc292fd444f8db9f3c2fa6eddc0 fix(export): suppress inferred country benchmark in backend exports
6a9a8a500f1184b920a4d57cc001b6383f323382 fix(api): avoid invented risk defaults for invalid audits
c639a2255d4e34ccfbbc3e0475ab20d9924564f0 docs(eudr): document legacy country risk neutralization
```

### PR #6 — absents de sa cible distante actuelle

```text
bc3f8b9c6e46198dbe8a64c24dc614295b9f8007 test(gfw): rendre le cas indisponible déterministe sans appel réseau
6d16c55a9f8956b6bb25ca0040986d5924eb6210 test(gfw): restaurer la clé d’environnement après le cas D
e3eb27881e39e6061d223f07a9b4ec94307fb52d docs(geoforest): tracer l’audit initial et les critères des chantiers 1-3
0c74c5e0c876b25aa80ff470535a7338638902c7 fix(satellite): enforce preregistered reference expectations
bd729140fd0102781864255feddad43215ac95dd docs(geoforest): record green technical CI and GFW blockers
3520a9bbf26f22d326fe52ebc139d78a7ccf7a6a fix(eudr): validate GFW rows fail-closed
eedf339ff8193482cd4f158ca953cc0098a2ef81 test(eudr): reject malformed GFW result rows
e2ec6204e7e3c42c8be61f9f548e7b6545bf04e0 fix(eudr): validate GFW rows at decision boundary
9d3407a4515af1ca3293e249889e1fe13a48ffc4 fix(eudr): align Python GFW validation with TypeScript
86f6d9bd9d20aae475cc3bbe448c068caa90c6a4 test(eudr): cover Python and TypeScript GFW parity
e667490702b5ba1b9b5e9dfa1516094c54dddad1 Fail closed on malformed GeoJSON FeatureCollections (TypeScript)
6e1dffcc2a4087f03c1ad1fd8c09295d58c4d5af Fail closed on malformed GeoJSON FeatureCollections (Python)
eb688aa072eb773579b5c538dcf59d2094fcd5c3 Test rejection of partially malformed GeoJSON FeatureCollections
65c8dec1169d8d1b859c57f061beb44397d7b5ec Harden GeoJSON feature and GeometryCollection validation
243aa3c5f4a0036aaa8ed4e23d89fee582037288 Harden Python GeoJSON extraction and coordinate validation
46e0fb5b2e9bed25ae5e774a1a4710bcfb016ea0 Test malformed Feature and GeometryCollection rejection
1ace9457efefa4b08e561201ff788053f0ea1c30 Align geometry tests with properties sanitization contract
751df8b8bac358fb252de9e9e9b1af664fd6e8bc Align malformed Feature properties test with normalized geometry contract
```

### Socle candidat — absents de main

```text
cf8749477029800925281dd263e0bca9b9df3926 P0/P1 production readiness: correct EUDR false-compliance paths, auth on FastAPI, tenant-safe audit links, document validation guard, readiness engine, E2E harness, and audit reports
8c9035982ff81a66c3b69a687280b3dcd0ddc2c0 Finalization pass: B9 browser no longer reaches FastAPI; baseline and blockers resolution report
0de2109f48c3947bf92ab4a831b50d1a45c5f32f TRACES scope (preparation only), B5 verification blocked, blockers report update
fcfd5948e35f242a84f683bf7bf5f59d49a8f487 Satellite: empty GFW response never yields a compliance verdict (TS + Python parity)
9193e31d0b58d30ea208c4768d28f18a470d23d5 B1 satellite validation kit (C, D run; A, B, E pending expert data); B2 history finding corrected; environment rebuild notes
74f5f43b933967e7eb7d3277e830308ccf5cb383 CI: build sans secrets, gates qualité, branches arena/**
d63eaf9c5c5bfd5c36efa381f50220f8a5c9f05c docs: chantier 1 CI verifié (run 38542469348 vert sur 74f5f43)
66ca4132694ca13ef46536a96cab358e0d1b874f Cloisonnement inter-organisations : tests HTTP et base, correction D1 (B-8)
7078796631476cafa26486baa23eb786820d150b Chantier 3 (B-12) : machine d'état DDS, EXPORTED / SUBMITTED / DECLARED
5fc05cb43dd303498259c41724c48fa294c353ff Chantier 4 (B-10) : pack de preuves d'un dossier, vérifiable hors ligne
bd7c3f2432f8fd37ff0bab33ff87554676ca53a8 Chantier 5 (B-2) : sauvegarde et restauration réelles, secrets de signature obligatoires
c6424b0efb560e11595569c167f8095a9231ae12 Chantier 6 (fournisseur) : invitation, accès limité, dépôt, cloisonnement
d13b57e0d166441f0d2677b024a6e6d9dcb11bfd Chantier 2 (B-8) : retrait du service FastAPI du déploiement, GET logout supprimé
a4bcc0f09a11324fafe6cb13730d25e7b04e9e2a CI : job « database » sur branche Neon éphémère (chantiers 1 et 2)
a61706595414b44938453e72ec9bbe44643ce5d9 ci: relance du job database (secrets NEON_* configurés)
ba27837df7dca228b42ead05bf1ced06d20f9a35 ci: relance du job database (secrets NEON_* créés dans GitHub)
205d83352c4faa780e51c522a759afa4a2951c91 CI Neon : délais de sécurité posés sur le rôle geoforest_app (P1-07)
5a2166dc18774df2551462d0c9c46ca8d36113c2 CI Neon : réinitialiser les comptes de démonstration avant les contrôles HTTP
a0aa110683731f33473e9b34f9dd456532a3d1a9 CI Neon : supprimer ne lit NEON_PROJECT_ID qu'en présence d'une branche créée
bc61a23a472a97a0019613ee2966e8e483da4e74 ci: run checks for pull requests targeting candidate branches
```

## Annexe B — inventaire du diff cumulé main → #6

Insertions / suppressions par fichier ; aucun de ces fichiers applicatifs n’a été modifié localement par l’agent A.

```text
18	5	.env.example
108	4	.github/workflows/ci.yml
2	1	Dockerfile
13	7	README.md
4	1	backend/Dockerfile
56	8	backend/app/api/v1/endpoints.py
19	1	backend/app/core/config.py
3	2	backend/app/models/schemas.py
32	20	backend/app/services/gis_validator.py
87	76	backend/app/services/satellite_checker.py
4	4	backend/app/services/traces_exporter.py
59	0	backend/tests/test_backend_auth.py
97	0	backend/tests/test_cross_tenant.py
143	10	backend/tests/test_eudr_pipeline.py
14	0	backend/tests/test_geospatial.py
107	0	backend/tests/test_satellite_checker.py
38	0	backend/tests/test_security_config.py
12	25	docker-compose.yml
193	0	docs/BACKUP_RESTORE_TEST.md
214	0	docs/BLOCKERS_RESOLUTION_REPORT.md
56	0	docs/CHANTIERS_GEOFOREST_2026-10-19.md
46	0	docs/CI_NEON.md
136	0	docs/CROSS_TENANT_TEST_REPORT.md
111	0	docs/DDS_STATE_MACHINE_TEST_REPORT.md
1	2	docs/DEPLOYMENT_VERCEL.md
78	0	docs/E2E_TEST_REPORT.md
121	0	docs/EUDR_WORKFLOW_VALIDATION.md
179	0	docs/EVIDENCE_ENGINE_SPEC.md
133	0	docs/EVIDENCE_PACK_TEST_REPORT.md
56	0	docs/FINALIZATION_BASELINE.md
160	0	docs/PRODUCTION_READINESS_REPORT.md
154	0	docs/PRODUCTION_RUNBOOK.md
113	0	docs/SATELLITE_VALIDATION_REPORT.md
77	0	docs/SECURITY_TEST_REPORT.md
1	1	docs/TEST_REPORT.md
44	0	docs/TRACES_SCOPE.md
6	0	drizzle/0007_parcel_audit_liens.down.sql
6	0	drizzle/0007_parcel_audit_liens.sql
10	0	drizzle/0008_fournisseur_invitation.sql
2906	0	drizzle/meta/0007_snapshot.json
2957	0	drizzle/meta/0008_snapshot.json
15	1	drizzle/meta/_journal.json
2	2	next-env.d.ts
3	8	next.config.ts
7	0	package-lock.json
15	3	package.json
237	0	scripts/check-cross-tenant-rls.ts
480	0	scripts/check-cross-tenant.ts
281	0	scripts/check-dds-etats-http.ts
172	0	scripts/check-dds-etats.ts
153	1	scripts/check-eudr-rules.ts
341	0	scripts/check-evidence-pack-http.ts
177	0	scripts/check-evidence-pack.ts
401	0	scripts/check-fournisseur-http.ts
185	0	scripts/check-readiness.ts
101	0	scripts/check-restauration-app.ts
129	0	scripts/check-sauvegarde.sh
1	1	scripts/check-sql-limits.ts
165	0	scripts/ci/neon-branche.ts
105	0	scripts/e2e/client.ts
257	0	scripts/e2e/parcours.ts
189	0	scripts/empreinte-sauvegarde.ts
104	0	scripts/restauration.sh
97	0	scripts/satellite/reference-cases.json
104	0	scripts/satellite/validate-reference.ts
101	0	scripts/sauvegarde.sh
59	10	scripts/seed-auth.ts
24	0	scripts/sql/post-migrate/023_fournisseur_tenant.sql
15	0	scripts/sql/post-migrate/024_delais_role_applicatif.sql
54	0	scripts/verifier-pack.ts
1	1	src/app/(app)/documents/page.tsx
3	1	src/app/(app)/due-diligence/page.tsx
4	1	src/app/(app)/page.tsx
3	3	src/app/(app)/plots/[id]/page.tsx
1	1	src/app/(app)/plots/page.tsx
3	1	src/app/(app)/reports/page.tsx
1	1	src/app/(app)/risks/page.tsx
1	1	src/app/(app)/settings/page.tsx
2	0	src/app/(app)/suppliers/[id]/page.tsx
137	0	src/app/(auth)/accepter-invitation/page.tsx
89	7	src/app/api/v1/audit/parcel/route.ts
15	5	src/app/api/v1/audits/[id]/route.ts
2	2	src/app/api/v1/audits/route.ts
96	0	src/app/api/v1/auth/invitation/accept/route.ts
2	1	src/app/api/v1/auth/logout/route.ts
8	1	src/app/api/v1/documents/[id]/file/route.ts
75	3	src/app/api/v1/documents/[id]/route.ts
44	12	src/app/api/v1/documents/route.ts
65	0	src/app/api/v1/due-diligence/[id]/audits/[auditId]/route.ts
88	0	src/app/api/v1/due-diligence/[id]/audits/route.ts
78	0	src/app/api/v1/due-diligence/[id]/evidence-pack/route.ts
32	0	src/app/api/v1/due-diligence/[id]/readiness/route.ts
76	50	src/app/api/v1/due-diligence/[id]/route.ts
32	0	src/app/api/v1/due-diligence/route.ts
97	2	src/app/api/v1/export/traces/route.ts
5	1	src/app/api/v1/nav/counts/route.ts
67	21	src/app/api/v1/plots/[id]/route.ts
8	1	src/app/api/v1/plots/route.ts
32	2	src/app/api/v1/shipments/route.ts
14	7	src/app/api/v1/supplier-portal/submissions/route.ts
191	0	src/app/api/v1/suppliers/[id]/invitation/route.ts
5	9	src/components/AuditResultCard.tsx
2	0	src/components/RiskBadge.tsx
9	0	src/db/admin.ts
18	2	src/db/index.ts
35	0	src/db/schema.ts
4	3	src/lib/api.ts
30	0	src/lib/auth/perimetre.ts
4	0	src/lib/auth/session.ts
92	0	src/lib/eudr/dds-etats.ts
41	22	src/lib/eudr/gis-validator.ts
159	0	src/lib/eudr/readiness-db.ts
356	0	src/lib/eudr/readiness.ts
100	77	src/lib/eudr/satellite-checker.ts
25	11	src/lib/eudr/traces-exporter.ts
13	3	src/lib/eudr/types.ts
328	0	src/lib/evidence/assembler.ts
171	0	src/lib/evidence/pack.ts
12	2	src/lib/idempotence.ts
3	0	src/proxy.ts
1	44	vercel.json
```
