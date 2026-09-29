# Chantier 3 — file durable et worker documentaire locaux

29 septembre 2026 — suite du socle S3 `dadd62d`. **Point intermédiaire : le chantier 3 n'est pas clôturé.**

## Objectif et périmètre

Séparer les traitements longs de l'API, permettre la reprise après panne et conserver une quarantaine bloquante. Travail local exclusivement, données synthétiques. Aucun abonnement, fournisseur engagé, déploiement, transfert réel, accès Neon ou opération DNS.

## Réalisé

- Candidat SQL `backend/migrations/candidates/0008_document_queue.sql` : stockage et VersionId par version, immuabilité des références, file persistante PostgreSQL, audit humain/portail de l'enqueue et audit système des traitements.
- `document_enqueue` autorisé explicitement par organisation et rôle écrivain ou session portail fournisseur, avec refus des uploads locaux/incomplets/expirés et idempotence.
- `document_claim` : concurrence via `SKIP LOCKED`, lease de cinq minutes et jeton renouvelé ; les transactions SQL sont closes pendant les accès S3/antivirus.
- `document_complete` : refus des leases expirés/anciens et des résultats incohérents ; finalisation atomique. Reprise à 30 secondes pour indisponibilité, trois tentatives maximum, épuisement enregistré.
- Worker `backend/app/documents/worker.py`, commande `--once`, configuration autonome sans import des secrets Clerk/session. Compte worker séparé, sans accès direct aux tables métier ; vérification des privilèges au démarrage, y compris les droits par colonne et appartenances additionnelles.
- Objet de quarantaine identifié de façon stable pour reprendre une écriture interrompue sans duplication/écrasement ; intégrité vérifiée avant antivirus et format.
- Extraction du validateur de format existant dans `format_validation.py`, partagé par l'API locale et le worker : sous-processus et délai inchangés. Scanner ClamAV existant réutilisé, pas remplacé par le scanner synthétique des tests.
- Masquage des nouvelles références de stockage dans le DTO public.
- Affichage d'audit « Système · contrôle documentaire » distinct des utilisateurs et fournisseurs, avec trois nouveaux tests frontend.

## Recette et preuves

Preuves : `docs/rapports/preuves-chantier-8/document-worker/`.

| Suite / contrôle | Résultat |
|---|---:|
| File, permissions SQL, worker et parcours stockage simulé + DB réelle | **49 réussis** |
| Unitaires documentaires, dont S3 | **90 réussis** |
| API documentaire existante sur la base locale augmentée | **23 réussis**, 1 avertissement Starlette préexistant |
| Frontend unitaires | **80 réussis** |
| Ruff, TypeScript, ESLint, pip check, git diff --check | Réussis |
| Garde de recette DB sans opt-in | **49 ignorés**, aucun succès revendiqué pour ce lancement |

Soit **162 tests backend ciblés réussis**, pas une régression backend complète. Aucun nouveau test navigateur/responsive ni build Vercel effectué.

Tests significatifs : permissions négatives worker/API, isolation d'organisations, portail et révocation, refus de faux audit système, idempotence de l'audit d'enqueue, dérive de droits par colonne, concurrence sans double claim, backoff, trois crashes, token incorrect, expiration sans nouveau claim, reprise après suppression de l'appartenance humaine, objet déjà écrit après crash, version scellée, hash différent, format invalide, stockage incomplet et ClamAV/signatures absents.

**Nature des tests :** PostgreSQL 17/PostGIS local réel ; Moto S3 en mémoire ; antivirus synthétique pour les cas favorables ; inspection réelle du PNG via sous-processus. Aucun test favorable avec ClamAV réel ou fournisseur S3 réel. Les marqueurs de version moteur des doubles de test ne constituent pas une qualification antivirus.

## Base et migration : état exact

Le cluster local réinstallé a été inspecté avant initialisation : seule la base `postgres` existait, aucun rôle GeoForest. Une base exclusivement fictive `geoforest_queue_test` et les rôles locaux nécessaires ont été créés. Migrations 0001→0007 puis candidat appliqué en transaction locale ; fonction d'enqueue rafraîchie ensuite pour son audit atomique. Les fixtures tronquent uniquement la base de recette dédiée.

**Le candidat n'est pas dans Alembic `versions`.** Le head reste 0007 ; cette base de test est donc « 0007 + candidat », et non une 0008 officiellement enregistrée. Aucune modification du schéma Neon. Promotion en migration versionnée, contrôles de schéma et validation cloud distincte restent nécessaires.

## Non réalisé / dépendances

- Les routes publiques utilisent encore LocalStore : upload S3, finalisation en file, téléchargement S3 réautorisé, quotas, reprise des anciennes versions locales et suivi UI restent à intégrer. La garde d'activation S3 reste bloquante ; ne pas la supprimer isolément.
- Aucun fournisseur/région effective/coût/IAM qualifié ; aucune qualification S3 physique ou Vercel. Aucune activation automatique du rôle worker sur Neon.
- Aucun superviseur, concurrence de production, SLA, dimensionnement mémoire/disque ou alerting déployé. Un `--once` réussi n'est pas un service de fond opérationnel.
- Pas de purge de chunks/orphelins, ni de sauvegarde/restauration complète. Le versionnement seul ne protège pas contre la suppression ou la perte du compte. Garder DB, objets et correspondance des VersionId cohérents lors d'une restauration.
- Un worker autorisé est une frontière de confiance : il peut soumettre un résultat pour le job dont il détient le jeton. Les contrôles SQL ne remplacent ni l'antivirus effectif ni la protection de ses secrets/runtime.
- Le propriétaire des tables et fonctions reste privilégié ; cette identité ne doit jamais être utilisée par l'API ou le worker.

## Bilan

- **PRÊT localement :** file/worker isolés et reprise de panne testée, permissions négatives, audit système, non-régression ciblée du coffre local.
- **À FINALISER :** raccordement API S3, migration Alembic définitive, recette intégrée, supervision, restauration.
- **BLOQUÉ pour production :** fournisseur et antivirus réels non qualifiés, intégration encore incomplète ; protections Vercel conservées.
- **RISQUE RÉGLEMENTAIRE :** scan et intégrité ne démontrent ni authenticité, ni légalité, ni conformité EUDR. La revue humaine n'est pas remplacée.
- **PROCHAINE ÉTAPE du même chantier :** intégration des routes au stockage S3 et à la file, tests multi-tenant/API, puis sauvegarde/restauration et qualification réelle. Pas de nouveau GO requis pour le périmètre local déjà accepté.

Guide technique et procédure de recette : `docs/deploiement/document-worker-local.md`.
