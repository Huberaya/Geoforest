# GeoForest — Rapport de readiness production

- **Version auditée** : branche `arena/c73246d2-geoforest`, à partir de `main` @ `1c95f4c`. Le `package.json` ne déclare pas de numéro de version.
- **Date** : 08/10/2026.
- **Méthode** : inspecter → corriger → tester → retester → documenter. Les chiffres ci-dessous sont ceux de la dernière exécution, sur le code final.
- **Documents associés** : `E2E_TEST_REPORT.md`, `SECURITY_TEST_REPORT.md`, `EUDR_WORKFLOW_VALIDATION.md`, `EVIDENCE_ENGINE_SPEC.md`.

---

## 0. Décision

# **NO-GO** — commercialisation EUDR en Europe

Motifs exacts (les critères de la section 24 du brief ne sont pas satisfaits) :

1. **Aucune analyse satellite probante réelle n'a été obtenue ni vérifiée.** Le serveur d'audit ne joint pas Global Forest Watch (`fetch failed`). Le produit ne peut donc, à ce jour, ni affirmer ni contester une conformité sur données réelles. Tant que ce point n'est pas levé (B1), aucun verdict « conforme » ne peut être présenté à un client.
2. **Aucune soumission TRACES n'existe.** Le produit produit un document d'export ; il ne transmet rien à TRACES NT. Toute mention de « soumis » serait fausse.
3. **Des identifiants par défaut ont existé dans le dépôt** (`postgres:postgres`, mot de passe de démonstration refusé par le seed). Ils doivent être considérés comme compromis et tournés par l'exploitant (B2). Ce n'est pas réalisable depuis l'environnement d'audit.
4. **Le déploiement conteneurisé n'a pas été exécuté** : le rôle applicatif et les variables doivent être vérifiés sur une instance réelle (B3).

Ce qui est acquis : les corrections P0 qui permettaient de présenter une fausse conformité sont en place, et les parcours principaux sont testés de bout en bout sur une base réelle (§1–§4). Ce n'est pas suffisant pour un GO.

**Option possible** : **CONDITIONAL GO pour un pilote interne** uniquement, sans mention de conformité probante, avec les analyses étiquetées non probantes et l'export soumis à revue humaine. Ce n'est pas une décision commerciale.

---

## 1. Format de réponse imposé

**GEOFOREST PRODUCTION READINESS**

- **Current version** : branche `arena/c73246d2-geoforest` (base `1c95f4c`), sans numéro de version publié.
- **Date** : 08/10/2026
- **P0 fixed** : 13 (détail §2).
- **P1 fixed** : 4 (détail §3).
- **Tests** (dernière exécution) :
  - `npm run test:unit` : **158 contrôles réussis, 0 échec** (EUDR 36, P106 40, GIS 16, CSV 26, readiness 40) ;
  - `npm run test:eudr` : 36/36 ;
  - `npm run test:backend` (pytest, environnement `/home/user/.venv-gf`) : **63 réussis, 3 `xfail`** (moteur géospatial non livré) ;
  - `npm test` : exit 0 **uniquement** si `python3` dispose de pytest (sinon échec d'environnement, pas de code) ;
  - `npm run test:db` : OK (limites SQL et rôle applicatif conformes) ;
  - `npm run test:e2e` : **49/49** sur build de production ;
  - `npm run typecheck` : OK ; `npm run lint` : exit 0, 0 avertissement ; `npm run build` : exit 0.
- **Security** : contrôles OK sur authentification, MFA, autorisations, cloisonnement API, rôle DB, service FastAPI. **Ouverts** : 6 « high » npm (outillage lint), CSP en report-only, rotation des identifiants (non faite), historique Git non audité par outil dédié.
- **GIS** : validation de géométrie et précision 6 décimales testées (16/16, 26/26 CSV). Non testé : géométries réelles de production.
- **Satellite** : **non validé en conditions réelles.** Aucun verdict probant produit pendant l'audit (GFW injoignable). Chemins « indisponible » et « simulé non probant » : validés. Chemin GFW : tests unitaires à substitution réseau uniquement.
- **EUDR** : workflow et readiness validés (cf. `EUDR_WORKFLOW_VALIDATION.md`). Validation juridique : **non faite**.
- **Evidence** : dépôt de pièce avec SHA-256 ; validation réservée à la conformité, refusée pour pièce sans fichier et pièce `INFECTED` ; antivirus **absent** (toutes les pièces `NOT_SCANNED`) ; S3 **non exécuté** ; dépôt de fichier non testé de bout en bout.
- **TRACES** : export contrôlé et bloqué selon les règles ; **aucune soumission officielle** (non implémentée).
- **Multi-tenant** : cloisonnement API vérifié par E2E (6/6) ; rôle DB conforme (RLS active, sans BYPASSRLS).
- **Production** : **non prête**. Voir blocages.
- **Remaining blockers** : B1 à B9 (§5).
- **Final decision** : **NO-GO** (commercialisation). CONDITIONAL GO possible pour pilote interne uniquement.

---

## 2. Corrections P0

| ID | Constat | Correction | Preuve |
|---|---|---|---|
| P0-01 | Seed de démonstration : mot de passe public accepté, comptes démo créables en production, comptes existants pouvant être réinitialisés sans demande | `scripts/seed-auth.ts` : refus si `NODE_ENV=production` ; `SEED_DEMO_PASSWORD` obligatoire, ≥ 12 caractères, refus des mots de passe publics ; compte existant inchangé sauf `--reset` explicite | Lecture du code (`scripts/seed-auth.ts`, garde-fous lignes 49 à 67) |
| P0-02 | **Faux « conforme »** : tolérance de 0,5 % de la parcelle (au moins 0,01 ha) : une perte post-2020 sous ce seuil était classée conforme | Seuil supprimé (`src/lib/eudr/satellite-checker.ts`, commentaire d'origine conservé) ; toute perte post-2020 est non conforme | `check-eudr-rules` (36/36) ; `test_perte_faible_post_2020_reste_non_conforme` |
| P0-03 | Source GFW non officielle (miroir, hôte usurpé) acceptée comme preuve | Hôte non officiel → aucun verdict, hôte nommé, aucune requête | `test_source_non_officielle_ne_produit_aucun_verdict`, `test_hote_officiel` (paramétré) |
| P0-04 | Propriété `simulated_loss_year` d'une Feature pouvant dicter le verdict ; README le présentait comme fonctionnalité | Propriété jamais lue ; README corrigé | `grep` : aucune occurrence dans `src/` ni `backend/app/` |
| P0-05 | **Export TRACES** : une parcelle probante déforestée après 2020 était exportable | Blocage 409 (TypeScript et FastAPI) ; export « signalé » supprimé | `test_export_non_compliant_bloque` (pytest) |
| P0-06 | Pas de contrôle de préparation avant déclaration ; risque et complétude saisissables à la main | Moteur de readiness (`src/lib/eudr/readiness.ts`) ; porte de sortie vers `READY_FOR_DECLARATION` (revue + moteur sans blocage) ; champs calculés, saisie refusée (409) | `check-readiness` (40/40) ; E2E-004 |
| P0-07 | Analyses non rattachées à la parcelle ni au dossier | Migration 0007 (`drizzle/0007_parcel_audit_liens.sql`, `.down.sql`) : `plot_id`, `due_diligence_id`, clés composites tenant-safe ; rattachement à la création de l'analyse | E2E-003, E2E-005 |
| P0-08 | Parcelle non mise à jour depuis l'analyse | Statut, année de perte et confiance de la parcelle dérivés de l'analyse rattachée ; une analyse non probante laisse `PENDING` | E2E-003 (`audits_linked_by = plot_id`, statut `PENDING`) |
| P0-09 | Pièces : URL libre acceptable comme pièce ; validation possible hors de la conformité | URL refusée (422) ; `VALID` réservé à `dds:validate` (403 sinon), exige pièce déposée (`storage_key`, `sha256`, 422 sinon), refuse `INFECTED` (422) | E2E-008 (422, 403, 422) |
| P0-10 | **Service FastAPI** : création d'analyses, lecture et export TRACES sans authentification | Jeton Bearer obligatoire (comparaison à temps constant), fermeture (503) si non configuré ; export FastAPI soumis aux mêmes blocages | `test_backend_auth.py` (14 cas collectés) |
| P0-11 | Repli de l'application vers un superutilisateur (`postgres:postgres`) ; identifiants par défaut dans `docker-compose.yml`, `Dockerfile`, `.env.example` | Repli supprimé ; refus au chargement en production sans `DATABASE_URL` ; compose : `GF_APP_DB_PASSWORD` obligatoire, application sur le rôle `geoforest_app` | Refus en production reproduit ; **compose non exécuté** (B3) |
| P0-12 | Scripts `test:e2e`, `check-readiness` référencés par `package.json` et absents du dépôt | Scripts créés : `scripts/e2e/parcours.ts`, `scripts/check-readiness.ts` | `npm run test:e2e` et `test:unit` : exit 0 |
| P0-13 | Chiffres de tests faux dans la documentation | Remplacés par les mesures du jour (63 réussis / 3 xfail) | `README.md`, `docs/TEST_REPORT.md` |

## 3. Corrections P1

| ID | Constat | Correction | Preuve |
|---|---|---|---|
| P1-01 | Avertissements de lint | Supprimés | `npm run lint` : exit 0, 0 avertissement |
| P1-02 | Tests pytest visant un moteur géospatial absent | Marqués `xfail(strict=True)` avec la raison : ils restent visibles et signaleront leur passage à « réussi » le jour où la fonctionnalité existe | 3 `xfail` |
| P1-03 | `GET /plots/{id}` : analyses rattachées par texte de référence, non unique | Rattachement par `plot_id` ; repli par référence limité aux lignes sans `plot_id` | E2E-003 |
| P1-04 | Test pytest sur l'export non conforme encodant l'ancienne politique | Attente mise à jour (409) ; nom du test corrigé | `test_export_non_compliant_bloque` |

## 4. Fonctionnalités : opérationnelles, simulées, non validées, absentes

| Fonctionnalité | État | Preuve / commentaire |
|---|---|---|
| Authentification, MFA (admin et conformité), sessions | **Opérationnelle** | E2E-001 |
| Autorisations par rôle et cloisonnement tenant (API) | **Opérationnelle** | E2E-006, E2E-008 |
| Rôle DB applicatif (RLS, sans BYPASSRLS) | **Opérationnelle** sur base de test | `npm run test:db` |
| Validation géométrique et précision EUDR (6 décimales) | **Opérationnelle** | `check-gis-topology` 16/16 ; `check-csv-latin` 26/26 |
| Création de parcelles, fournisseurs, produits | **Opérationnelle** | E2E-003 |
| Analyse satellite : statuts sans verdict (indisponible, simulée, géométrie invalide) | **Opérationnelle** | E2E-002, E2E-007 |
| Analyse satellite : **verdict probant** (GFW officiel) | **Non validée** : code présent, tests unitaires à substitution réseau, aucune donnée réelle | B1 |
| Mode démonstration (`GFW_DEMO_MODE`) | **Simulé**, marqué non probant, jamais utilisable pour l'export | pytest `test_export_refused_in_demo_mode` |
| Readiness et refus de déclaration | **Opérationnelle** | `check-readiness` ; E2E-003, E2E-004 |
| Risque expliqué (facteurs, raisons) | **Opérationnelle** ; échelle différente du brief (§7) | `check-readiness` |
| Rattachement analyses ↔ dossier ↔ parcelle | **Opérationnelle** | E2E-003, E2E-005 |
| Dépôt de pièces (SHA-256, stockage disque local) | **Code présent**, dépôt de fichier **non testé** de bout en bout | §5, point B4 |
| Validation de pièce par la conformité | **Opérationnelle** avec contrôles | E2E-008 |
| Antivirus | **Absent** : toutes les pièces `NOT_SCANNED` | B4 |
| Stockage S3 | **Non exécuté** | B6 |
| Export TRACES (document) | **Opérationnel** avec blocages | E2E-007 ; pytest |
| Soumission TRACES NT | **Absente** : aucun appel dans le produit | B7 |
| Déclaration officielle (statut `DECLARED`) | **Absente** : aucune route ne la pose | — |
| Service FastAPI (`backend/`) | **Opérationnel** derrière jeton ; stockage SQLite (repli `/tmp` si le chemin échoue) | pytest 63/3 xfail |
| Moteur géospatial (3 tests `xfail`) | **Non livré** : aucune route `geospatial` | `backend/tests/test_geospatial.py` |
| Tableau de bord (synthèse) | **Non re-vérifié** pendant cet audit | — |
| Portail fournisseur | **Non testé** de bout en bout (aucun compte fournisseur dans le jeu de test) | §7 |

## 5. Blocages restants (avant tout GO)

| # | Blocage | Action requise | Qui |
|---|---|---|---|
| **B1** | Aucune analyse satellite **probante** réelle | Obtenir une clé GFW, lancer l'analyse sur un jeu de parcelles de référence (cas conformes, cas déforestés connus), comparer les verdicts à une vérité terrain, faire valider la méthode par un expert | Exploitant + expert géospatial |
| **B2** | Identifiants par défaut et compromis possibles (`postgres:postgres`, un mot de passe de démonstration public, comptes démo) | Rotation : mot de passe superutilisateur, rôle `geoforest_app`, `AUTH_SECRET`, clés GFW ; suppression des comptes démo ; scan d'historique Git (gitleaks ou équivalent) | Exploitant |
| **B3** | Déploiement conteneurisé non exécuté ; rôle applicatif à créer | Exécuter `docker compose up` (ou l'hébergeur) ; créer le rôle `geoforest_app` ; vérifier `verifier-role` et `/api/health` sur l'instance | Exploitant |
| **B4** | Pas d'antivirus ; dépôt de fichier non testé de bout en bout | Intégrer un moteur réel **ou** décider formellement qu'une pièce `NOT_SCANNED` ne peut pas être validée ; tester le dépôt complet | Produit + sécurité |
| **B5** | CSP en report-only, `unsafe-inline` / `unsafe-eval` | CSP appliquée, nonces | Front |
| **B6** | Stockage S3 jamais exécuté | Tests d'écriture, lecture, suppression sur S3 réel, ou retrait de l'option | Exploitant |
| **B7** | Aucune soumission TRACES | Décider du périmètre : export seul (à présenter comme tel) ou intégration officielle à construire | Produit + conformité |
| **B8** | Scénarios E2E à recouper avec le brief | Comparer la liste officielle des `E2E-001` à `E2E-008` au harnais ; combler les écarts (portail fournisseur notamment). **Le détail de ces scénarios n'était pas disponible dans le contexte de cette passe.** | Produit |
| **B9** | *Corrigé le 08/10/2026* : le client pouvait appeler FastAPI via `NEXT_PUBLIC_API_URL` | Appels navigateur limités aux routes Next ; rewrite supprimé ; preuves dans `BLOCKERS_RESOLUTION_REPORT.md` | Front |

## 6. Dépendances et configuration

- `npm run audit:sec` : exit 1, **6 « high »**, 0 critical, toutes dans `eslint-config-next` (outillage). La correction proposée par npm est une **rétrogradation** à 14.x, incompatible avec Next 16 : **ne pas l'appliquer**. Mise à jour à planifier.
- `/api/health` : `degraded`. Les composants autres que base, stockage et disque ne sont pas examinés par cet audit.
- Le service FastAPI utilise SQLite (repli `/tmp` si le chemin échoue). Concurrence non éprouvée ; à porter sur PostgreSQL ou à retirer.

## 7. Écarts entre le brief et le produit

- **Échelle de risque** : le brief attend `LOW / MEDIUM / HIGH / UNKNOWN`. Le produit utilise `LOW / STANDARD / HIGH / CRITICAL` pour le dossier, et `HIGH` pour une analyse indisponible. `UNKNOWN` n'est pas un niveau de sortie. **Point ouvert** : à trancher avec la conformité.
- **Statuts satellite** : `UNKNOWN` est remplacé par `ANALYSIS_UNAVAILABLE` (cf. `EVIDENCE_ENGINE_SPEC.md`).
- **Scénarios E2E** : les intitulés `E2E-001` à `E2E-008` sont ceux du harnais ; leur correspondance exacte avec le brief n'a pas été vérifiée (B8).
- **Règles EUDR dupliquées** Python / TypeScript (tables pays, hotspots) : pas de test croisé. Point ouvert.

## 8. Ce qui reste à faire, dans l'ordre

1. Lever **B1** : sans analyse probante validée, rien d'autre ne suffit pour un GO.
2. Lever **B2** et **B3** : rotation, déploiement vérifié, rôle applicatif confirmé sur l'instance cible.
3. Décider **B4**, **B6**, **B7** : antivirus, S3, périmètre TRACES. Ce sont des décisions produit, pas seulement techniques.
4. Lever **B5**, **B9** : CSP appliquée, aucun jeton dans le navigateur.
5. Traiter **B8**, les points ouverts de §7, et la mise à jour de `eslint-config-next`.
6. Rejouer `npm test`, `npm run test:e2e` (sur build de production), `npm run test:db`, et un scan d'historique. **Seul un résultat vert sur l'ensemble, avec B1 à B3 levés, permettrait de reconsidérer la décision.**

## 9. Reproductibilité

```bash
npm ci
npm run typecheck && npm run lint && npm run build
npm run test:unit
PATH=/chemin/vers/venv-avec-pytest/bin:$PATH npm run test:backend   # ou npm test
npm run db:migrate && SEED_DEMO_PASSWORD='…' NODE_ENV=development npm run seed:auth -- --reset
npm run start &                                                      # puis
E2E_BASE_URL=http://127.0.0.1:3000 E2E_PASSWORD='…' npm run test:e2e
npm run test:db
```

Les mots de passe ne doivent **jamais** être écrits dans le dépôt. Les fichiers d'environnement locaux
utilisés pendant l'audit sont hors dépôt.
