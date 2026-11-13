# GeoForest — dossier de reprise durable

> **Document de référence pour toute reprise après interruption.** Lire ce fichier avant tout nouvel audit, toute intervention Neon/Vercel ou toute reprise de PR.
>
> **État établi le : 13 novembre 2026 (UTC)**  
> **Dépôt :** `Huberaya/Geoforest` · **branche de référence :** `main`  
> **HEAD de main vérifié :** `9f786246c3b32286285743c0c3351595aa7a0b55`  
> **Dernière mise à jour du dossier :** 13/11/2026. Les états d'infrastructure et de PR sont des instantanés datés, à recontrôler avant toute action.

## 1. Règle de reprise — ne pas repartir de zéro

Toute nouvelle session ou tout agent doit :

1. Lire ce document en entier, puis consulter les documents techniques référencés ci-dessous.
2. Vérifier le HEAD actuel de `main`, les PR ouvertes, leurs bases/têtes, les derniers checks CI et les états Neon/Vercel pertinents. **Ne pas supposer que les SHA et états datés sont encore actuels.**
3. Reprendre au premier élément explicitement marqué **OUVERT**, **BLOQUÉ** ou **À REVALIDER**. Ne pas refaire les chantiers marqués **INTÉGRÉ** sans nouveau signal de régression.
4. Conserver les preuves : SHA exact, run GitHub, résultats des jobs, branche Neon concernée, identifiant de snapshot et horodatage. Une déclaration sans preuve n'est pas une clôture.
5. Travailler selon le cycle : **diagnostiquer → corriger → tester → intégrer (via PR) → vérifier**. Produire le correctif et ses tests, pas un audit sans action.
6. Ne jamais transformer une simulation, un test local, une branche éphémère ou un snapshot créé en preuve de validation de la production.

Ce dossier est le point de reprise commun. Lorsqu'un chantier avance, le mettre à jour dans la même PR que les changements concernés ou dans une PR documentaire dédiée. Ajouter la date, les SHA, les liens de preuve et le statut. Ne jamais effacer l'historique des décisions : ajouter une nouvelle entrée datée et expliquer ce qui change.

## 2. Identité et périmètre du produit

GeoForest est un SaaS de diligence raisonnée EUDR (règlement UE 2023/1115) : collecte des fournisseurs et des parcelles géolocalisées, validation des géométries, signaux forestiers/satellite, constitution de dossiers DDR/DDS et exports destinés au parcours TRACES-NT.

Le produit couvre notamment les chaînes bois, café, cacao, huile de palme, soja, caoutchouc et bovin. Les éléments réglementaires doivent rester exacts : un export de dossier ne signifie pas qu'une déclaration a été soumise à TRACES ; une simulation satellite n'est jamais une preuve de conformité ; une donnée manquante ou une source indisponible ne doit jamais produire un verdict positif.

Architecture documentée dans `README.md` et `docs/ARCHITECTURE.md` : Next.js App Router / TypeScript, PostgreSQL + Drizzle, RLS et isolation par organisation, composants GIS/EUDR, intégrations externes. Le backend FastAPI historique n'est plus déployé et ne doit pas être réexposé sans modèle d'isolation multi-tenant.

## 3. État GitHub de référence

### 3.1 Branche principale

- Dépôt public : https://github.com/Huberaya/Geoforest
- Branche par défaut : `main`
- HEAD observé le 13/11/2026 : `9f786246c3b32286285743c0c3351595aa7a0b55`
- Ce commit correspond à la fusion de la PR #22 (« P0 sécurité — isoler les secrets Neon des branches non fiables »).
- **Ne pas pousser directement sur `main`** : toute modification passe par une branche de travail et une PR, sauf procédure exceptionnelle explicitement autorisée.

### 3.2 PR structurantes intégrées

| PR | Sujet | État vérifié | Référence |
|---|---|---|---|
| #8 / #10 puis consolidation #11 | Socle produit, parcours et consolidation A/B/C, frontières pays, migrations et documentation | #11 fusionnée le 10/11/2026, merge SHA `cc61cfebe7c37b3540b3410ff64a00d3cfea2f59` | https://github.com/Huberaya/Geoforest/pull/11 |
| #19 | P0 privilèges SQL, RLS, ACL, fonctions SECURITY DEFINER | Fusionnée le 12/11/2026, merge SHA `bfd872920cf032bb13335d1e49689bad4ef46e36` | https://github.com/Huberaya/Geoforest/pull/19 |
| #22 | Isolation des secrets Neon dans GitHub Actions | Fusionnée le 12/11/2026, merge SHA `9f786246c3b32286285743c0c3351595aa7a0b55` | https://github.com/Huberaya/Geoforest/pull/22 |

La PR #11 porte la consolidation de plusieurs travaux antérieurs. Sa description précise que le SHA de code validé était `94c5f14` et que le commit final `3650c43` ajoutait de la documentation. Consulter son corps et `docs/RAPPORT_CLOTURE_CHANTIERS_2026-10-29.md` pour la reconstitution détaillée. Ne pas réinterpréter les branches historiques comme des changements encore à intégrer sans comparer leur contenu à `main`.

### 3.3 PR ouvertes observées le 13/11/2026

| PR | Sujet | Tête observée | Base / état | Suite |
|---|---|---|---|---|
| #21 | P0 backfill BBOX et réconciliation Neon | `arena/p0-neon-backfill-guard` @ `c8268bc5013476184806cbd4f691549410a78f74` | ouverte, non fusionnée ; base `main` observée @ `61c17b1ffbc0348e383504b233580153922a9cbe`, antérieure au HEAD actuel | **Priorité de reprise.** Revalider la branche par rapport à main, lire les checks et le diff, puis faire une validation en lecture seule / `--essai`. Aucune écriture production sans GO spécifique. |
| #15 | Diagnostic de protection main | `arena/7b33661b-geoforest` | ouverte, ancienne | Historique ; ne pas fusionner sans audit du diff et de la pertinence actuelle. |
| #10 | P0-B backend SQLite | `integration/geoforest-p0-final-2026-10-21` | ouverte, base non-main `arena/569eff1a-geoforest` | Ancienne PR ; ne pas fusionner en l'état. |
| #7 | Corrections géospatiales / agents B et C | `arena/837c5c36-geoforest` | ouverte, ancienne | Historique ; vérifier si déjà intégré par consolidation #11. |
| #6, #5, #4, #3, #1 | WIP chantiers historiques | branches `forest/*`, `security/*`, `fix/*` | ouvertes, bases imbriquées / anciennes | Ne pas fusionner en chaîne. Les traiter comme archives à comparer à main. |

**Attention :** l'état des PR est celui observé le 13/11/2026. Au retour, vérifier l'API GitHub. Ne pas fermer ou fusionner automatiquement les PR anciennes ; documenter d'abord leur éventuel contenu non intégré.

## 4. P0 sécurité — état consolidé

### 4.1 GitHub Actions : secrets Neon

**État : intégré dans main par PR #22.**

Correctifs documentés et fusionnés :
- jobs Neon privilégiés limités au push sur `main` et au déclenchement manuel depuis `main` ;
- environnement GitHub `neon-ci` utilisé pour les jobs privilégiés ;
- checkout avec `persist-credentials: false` ;
- permissions minimales `contents: read` ;
- tests de régression pour empêcher le retour d'une exposition des secrets sur les PR et branches non fiables.

Configuration d'exploitation connue au 13/11/2026 :
- l'utilisateur a configuré les secrets requis dans l'environnement `neon-ci` ; leurs valeurs ne doivent jamais être demandées, lues ou consignées ;
- les branches de déploiement de l'environnement ont été limitées à `main` ;
- un seul compte GitHub est disponible ; aucun approbateur humain indépendant n'est disponible ;
- le ruleset a été configuré à **0 approbation requise** pour éviter de bloquer toutes les fusions dans un dépôt solo.

**Réserve de gouvernance non résolue :** il n'existe pas de revue humaine indépendante. Le fait d'avoir un environnement GitHub et des checks verts ne remplace pas une approbation indépendante. Ne jamais présenter ce point comme réglé.

### 4.2 Preuves GitHub de la PR #22

SHA testé : `9f786246c3b32286285743c0c3351595aa7a0b55`.

- CI run **43288578818** : 6/6 jobs en succès, dont `Database & HTTP contracts (Neon branch)`.
  https://github.com/Huberaya/Geoforest/actions/runs/43288578818
- Backup/restore run **43288578905** : 1/1 job en succès ; sauvegarde, restauration et comparaison via client PostgreSQL 18 réussies ; branche éphémère de test supprimée.
  https://github.com/Huberaya/Geoforest/actions/runs/43288578905

Ces runs prouvent le comportement du workflow sur sa branche de test. Ils ne prouvent pas la restauration du snapshot de production mentionné plus bas.

### 4.3 Ruleset de main

État rapporté après configuration par l'utilisateur :
- ruleset GitHub actif ciblant `main` ;
- checks obligatoires configurés ;
- protection de suppression et non-fast-forward ;
- nombre d'approbations humaines requis : **0**, faute de second compte.

Le document historique `docs/PROTECTION-MAIN.md` contient des mesures du 05/11/2026 et mentionne encore une approbation requise ainsi que deux checks fantômes. **Il est partiellement obsolète** par rapport à la configuration ultérieure. Ne pas s'en servir seul comme preuve de l'état actuel. À la prochaine passe d'administration, relire le ruleset et les checks réellement produits, puis mettre à jour ce document.

## 5. Neon — état exact et limites connues

### 5.1 Projet

- Projet Neon : **Geoforest Trace**
- ID : `sparkling-brook-79507514`
- Région : `aws-eu-central-1`
- PostgreSQL : 18
- Forfait observé : `free_v3`
- Branche primaire / par défaut : `production`
- ID production : `br-delicate-brook-b1h226a9`
- État : `ready`
- `protected: false`

### 5.2 Protection native de branche — BLOQUÉE PAR LE FORFAIT

Tentative réelle d'activer `protected: true` sur production via l'API Neon : **refus HTTP 422** — nombre maximal de branches protégées atteint pour le forfait actuel ; Neon demande une mise à niveau ou la réduction du nombre de branches protégées.

L'utilisateur a indiqué qu'il ne peut pas activer le forfait Launch. La protection native Neon ne peut donc pas être considérée comme activée et ne doit pas être retentée à répétition sans changement de forfait ou de capacité.

La branche de production a toutefois des `restricted_actions` liées à son rattachement Vercel :
- `delete` — raison `vercel production branch` ;
- `delete-rw-endpoint` — raison `vercel production branch read-write endpoint` ;
- `move-rw-endpoint-using-api` — raison `vercel production branch read-write endpoint`.

Ces restrictions sont **partielles**. Elles ne prouvent ni `protected: true`, ni la protection contre toutes les opérations destructrices ou les modifications SQL. Ne pas les présenter comme équivalentes à la protection native.

### 5.3 Snapshot manuel de référence

Snapshot manuel créé et relu dans la liste Neon :
- ID : `snap-lively-mud-b1n6qm8i`
- nom : `geoforest-p0-security-baseline-20261113`
- branche source : `br-delicate-brook-b1h226a9` (production)
- date de création : `2026-11-13T09:40:24Z`
- type : manuel.

**Limite importante :** le snapshot existe et sa présence a été relue, mais sa restauration spécifique n'a pas été exécutée. Le workflow CI backup/restore est un test séparé sur une branche éphémère. Ne jamais confondre ces deux preuves.

### 5.4 Planification des snapshots

La lecture du calendrier Neon a renvoyé `schedule: []` le 13/11/2026. Aucune planification automatique n'était configurée à cet instant. Le snapshot manuel ne remplace pas une sauvegarde récurrente. Recontrôler les capacités et la configuration actuelles du forfait avant de conclure sur les possibilités de rétention/sauvegarde.

### 5.5 Inventaire des branches Neon observé le 13/11/2026

Branches alors présentes (à revalider avant toute opération) :
- `production` — `br-delicate-brook-b1h226a9` ;
- `isolation-rls-verification-20261112` — `br-still-mouse-b1sl0r6z` ;
- `preview/arena/p0-neon-backfill-guard` — `br-shy-thunder-b1wid5co` ;
- `preview/arena/p0-neon-rls-hardening` — `br-sweet-rain-b1kd6y5l` ;
- `preview/arena/ba2f9eba-geoforest` — `br-polished-cherry-b1seemi6` ;
- `preview/fix/p0-health-storage-readiness-20261111` — `br-shy-unit-b11zu261` ;
- `vercel-dev` — `br-bold-haze-b1we6dyc`.

Nettoyage déjà réalisé sur le projet GeoForest uniquement :
- branche Neon `preview/security/p0-ci-secret-isolation-20261112` supprimée après fusion de la PR #22 ;
- branche Neon `preview/arena/ef5b35fe-geoforest` supprimée car obsolète et sans PR ouverte correspondante.
Les branches production, vérification RLS, preview backfill, preview RLS, preview consolidation, preview health/storage et vercel-dev ont été préservées lors de ce nettoyage.

**Règle de suppression :** inventorier les PR GitHub, les déploiements Vercel et la branche Neon par ID avant suppression. Ne jamais supprimer une branche parce que son nom semble ancien. La production est hors périmètre de nettoyage.

## 6. Base de données, migrations et backfill — règles de sécurité

- Les migrations sont versionnées dans `drizzle/`; la procédure historique est décrite dans `docs/MIGRATIONS-NEON.md`.
- Le projet utilise un rôle d'administration séparé et un rôle applicatif `geoforest_app` soumis à RLS.
- PR #19 a renforcé l'allowlist de privilèges, les fonctions `SECURITY DEFINER`, les droits PostGIS et les tests RLS. La PR a été fusionnée.
- Le diagnostic de production ayant précédé #19 rapportait `geoforest_app` en `NOSUPERUSER`, `NOBYPASSRLS`, sans `CREATEROLE` ni `CREATEDB`, avec RLS/FORCE RLS sur 13/13 tables métier.
- Des tables/ACL historiques et objets PostGIS avaient été identifiés ; consulter la description et les preuves de la PR #19 avant de modifier les droits.

### Interdictions persistantes sans GO explicite

Ne pas exécuter sur Neon production :
- `npm run db:migrate`, `prisma migrate deploy`, `migrate resolve`, ou toute commande qui modifie le registre des migrations ;
- `npm run db:backfill-bbox` sans `--essai) ;
- `db:push`, `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `GRANT`, `REVOKE`, changement de rôle, de propriétaire ou de politique RLS ;
- restauration d'un snapshot, reset, changement d'endpoint ou toute opération destructive.

La PR #21 ajoute des garde-fous au backfill BBOX et corrige sa documentation. Elle exige explicitement `DATABASE_URL_ADMIN`, vérifie les privilèges, traite toute borne BBOX manquante, comptabilise les mises à jour et ajoute des tests. La PR est encore ouverte dans l'instantané du 13/11/2026. **Son existence ne vaut pas autorisation de lancer le backfill en production.**

Le document `docs/MIGRATIONS-NEON.md` porte une procédure datée du 06/11/2026, avant les évolutions ultérieures. Il doit être revalidé par rapport aux migrations réellement appliquées et aux PR #19/#21 avant toute opération. Ne jamais exécuter sa procédure historique telle quelle sans un nouvel inventaire read-only et une autorisation explicite.

## 7. Historique des chantiers et documents de référence

Les chantiers initiaux ont été structurés en lots A–H : socle/CI, collecte fournisseurs, géolocalisation des parcelles, sources GIS, signaux forestiers, documents/légalité/risque, exports de diligence raisonnée, sécurité et release.

Documents existants à conserver et consulter :
- `docs/CHANTIERS_GEOFOREST_2026-10-19.md` — découpage des chantiers A–H ;
- `docs/RAPPORT_CLOTURE_CHANTIERS_2026-10-29.md` — consolidation et clôture des lots ;
- `docs/RAPPORT_FINALISATION_POST_PR11_2026-10-29.md` — état après PR #11 ;
- `docs/DECISIONS.md` — décisions métier et techniques durables ;
- `docs/ARCHITECTURE.md` — architecture ;
- `docs/EUDR_COMPLIANCE_GUIDE.md` — règles métier EUDR ;
- `docs/EVIDENCE_ENGINE_SPEC.md` — preuves ;
- `docs/SECURITE-BACKEND.md`, `docs/SECURITY_TEST_REPORT.md`, `docs/CROSS_TENANT_TEST_REPORT.md` — sécurité et isolation ;
- `docs/DEPLOYMENT_VERCEL.md`, `docs/PRODUCTION_RUNBOOK.md` — exploitation et déploiement ;
- `docs/CI_NEON.md`, `docs/BACKUP_RESTORE_TEST.md` — CI et preuve de restauration ;
- `docs/PRODUCTION_READINESS_REPORT.md` — audit de readiness initial, daté du 08/10/2026 et **historique**, pas un verdict actuel.

Les rapports historiques peuvent contenir des états, chiffres ou procédures devenus obsolètes. Leur date et leur SHA doivent être lus avant de les utiliser comme preuve actuelle.

## 8. Backlog de reprise priorisé

### P0 — à reprendre en premier

1. **Réconcilier la PR #21 avec le main actuel** : vérifier le diff, les checks, le statut de la branche, l'écart de base et les éventuels changements intervenus depuis son ouverture. Ne pas merger automatiquement.
2. **Réconcilier les migrations Neon en lecture seule** : comparer migrations du dépôt, registre Neon et schéma réel ; documenter chaque différence. Ne modifier ni registre ni schéma.
3. **Qualifier BBOX** : lancer uniquement les contrôles non destructifs et le mode `--essai` sur la cible explicitement vérifiée ; présenter le compte et le plan d'écriture avant toute demande de GO.
4. **Revoir les contrôles de protection GitHub** : lire le ruleset réel, vérifier exactement les checks requis et réellement produits ; corriger `docs/PROTECTION-MAIN.md` qui est daté et partiellement obsolète.
5. **Maintenir la réserve Neon** : protection native indisponible sur Free ; sauvegarde automatique non planifiée dans l'instantané ; snapshot manuel non restauré. Ne pas marquer P0 totalement clos tant que ces limites restent non compensées.

### P1 — avant pilote réel / commercialisation

- preuve satellite GFW réelle sur parcelles de référence, avec source, date, couverture, limites et reproductibilité ;
- validation des géométries et données réelles représentatives par pays/commodité ;
- validation juridique du parcours EUDR et de la génération des dossiers ;
- preuve opérationnelle de stockage de documents, antivirus réel, sauvegarde/restauration et rétention ;
- parcours complet fournisseur → parcelle → analyse → pièces → DDR/DDS → export, avec séparation stricte des organisations ;
- clarification et preuve du périmètre TRACES-NT : export préparatoire ≠ dépôt officiel ;
- tests de charge, observabilité, incidents, support et processus de reprise ;
- revue des dépendances, secrets, rôles, politiques, journaux et conformité RGPD.

La commercialisation reste **NO-GO tant que les preuves externes et opérationnelles critiques ne sont pas acquises**. Ne pas transformer un statut de code vert en autorisation commerciale.

## 9. Protocole de mise à jour de ce dossier

À chaque jalon significatif, ajouter une entrée datée dans la section « Journal de reprise » ci-dessous et mettre à jour les tableaux concernés :
- SHA de `main`, branche et SHA de travail ;
- PR, état, base/head SHA et URL ;
- workflows : run ID, SHA testé, conclusion de chaque job ;
- Neon : project/branch IDs, état, snapshot IDs, restrictions observées ;
- migrations : état read-only, sans exposer d'URL de connexion ni de secret ;
- changements effectués et éléments explicitement non touchés ;
- prochaine action, blocage et autorisation requise.

Ne jamais écrire de secret, de mot de passe, de chaîne de connexion, de données personnelles ou de contenu de variable d'environnement dans ce document.

## 10. Journal de reprise

### 2026-11-13 — consolidation P0 et point de reprise

- `main` vérifié à `9f786246c3b32286285743c0c3351595aa7a0b55`.
- PR #19 et #22 fusionnées ; PR #11 fusionnée antérieurement.
- CI run `43288578818` : 6/6 jobs succès sur le SHA de main.
- Backup/restore run `43288578905` : 1/1 job succès sur branche Neon éphémère.
- Projet Neon `sparkling-brook-79507514`, production `br-delicate-brook-b1h226a9`, forfait `free_v3`, `protected=false`.
- Tentative de protection native rejetée par Neon en HTTP 422 (limite du forfait).
- Restrictions Vercel de suppression/déplacement endpoint observées, mais partielles.
- Snapshot manuel `snap-lively-mud-b1n6qm8i` créé et relu ; restauration de ce snapshot non prouvée.
- Calendrier de snapshot Neon lu : `schedule: []`.
- PR #21 ouverte, tête `c8268bc5013476184806cbd4f691549410a78f74`, à réconcilier avec main.
- Aucune migration, backfill, modification de données métier, changement de schéma, révocation ACL ou déploiement production effectué pendant cette passe de consolidation.

**Prochaine action :** reprendre PR #21 et la réconciliation read-only Neon. Conserver les réserves du forfait et de l'absence d'approbateur indépendant.
