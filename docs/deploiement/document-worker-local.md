# File documentaire et worker — recette locale uniquement

**État au 29 septembre 2026 : candidat et routes S3 raccordés en recette locale explicite, activation production interdite.** Ce guide ne vaut ni autorisation de migration Neon, ni qualification d'un fournisseur, ni procédure de déploiement en production.

## Architecture préparée

1. L'API autorisée termine un upload S3, puis appelle `authz.document_enqueue(org, version)` dans une transaction. **Le raccordement est disponible uniquement dans le profil de test local explicite** décrit dans `s3-api-locale.md`.
2. L'enqueue vérifie le rôle staff écrivain ou la session portail du fournisseur, l'état, la taille reçue et l'expiration. Un seul job par version ; l'audit de mise en file est atomique et attribué à l'acteur réel.
3. Le worker appelle `authz.document_claim()` : sélection `FOR UPDATE SKIP LOCKED`, lease de cinq minutes et nouveau jeton aléatoire. La transaction est fermée avant tout accès S3 ou scan.
4. Assemblage des chunks avec délai de 150 secondes, écriture conditionnelle sous un identifiant d'objet stable, vérification SHA-256, scanner existant puis validation de format dans un sous-processus isolé (15 secondes).
5. `authz.document_complete(...)` vérifie le jeton et le lease, les champs du résultat, le hash et le MIME annoncés pour un résultat favorable. Résultat, référence S3 versionnée, statut du job et audit système sont enregistrés dans la même transaction.
6. Un worker en retard ne peut pas publier son résultat. Un crash après écriture S3 peut reprendre le même objet sans l'écraser. Les contrôles indisponibles restent non téléchargeables, avec reprise différée de 30 secondes et trois tentatives maximum. Les leases expirés sont repris au prochain claim ; le troisième lease expiré conduit à un échec enregistré.

Le worker est une frontière de confiance : le SQL vérifie la cohérence des déclarations, mais ne réalise pas lui-même l'antivirus. Une compromission du worker ou du propriétaire des tables n'est pas neutralisée par un simple contrôle de hash.

## Migration candidate et rôles

Fichier : `backend/migrations/candidates/0008_document_queue.sql`.

- Ce fichier est volontairement **hors du répertoire Alembic `versions`**. `alembic upgrade head` reste sur 0007 et ne l'applique pas.
- La base de recette possède 0007 **plus** les objets du candidat ; ce n'est pas une migration 0008 officiellement enregistrée dans Alembic.
- Ajouts : `storage_backend`, `storage_version`, protections d'immuabilité, `document_jobs`, fonctions restreintes, acteur d'audit `system` sans usurpation d'identité humaine.
- Aucune lecture générale des tables métier ni mutation directe de la file n'est accordée au worker. La file a RLS sans politique de lecture applicative ; ses opérations passent par les fonctions `SECURITY DEFINER` à chemins de recherche fixés et tables qualifiées.
- Le propriétaire de ces fonctions est le migrateur, **pas** le compte runtime. Les fonctions n'acceptent ni SQL libre ni nom de table/objet arbitraire.

Un administrateur doit préprovisionner un rôle groupe **sans connexion** :

```sql
CREATE ROLE geoforest_document_worker NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
```

Le compte de connexion worker séparé reçoit uniquement ce rôle. Son mot de passe doit venir d'un gestionnaire de secrets, jamais d'un fichier versionné. Ne jamais lui accorder `geoforest_app`, `geoforest_migrator`, superuser ou BYPASSRLS. Le worker refuse au démarrage un compte disposant d'autres appartenances de rôles ou de droits directs sur les tables/colonnes métier. Les relations des extensions, notamment les métadonnées PostGIS, sont exclues de ce contrôle de lecture métier.

**Aucune de ces opérations de provisioning n'a été effectuée sur Neon.** Les capacités de création de rôles et la procédure finale Neon restent à valider.

## Environnement worker autonome

Le worker n'importe ni les routes ni `app.config.Settings`. Il ne requiert ni secret Clerk, ni session navigateur. `env_file=None` : injecter explicitement les variables dans son processus.

Variables nécessaires :

- `APP_ENV=production` ; exception `test` uniquement pour une base `_test` sur `127.0.0.1`.
- `DOCUMENT_STORAGE_BACKEND=s3`.
- `DOCUMENT_WORKER_DATABASE_URL` : URL `postgresql+psycopg`, identifiants du compte worker ; `sslmode=verify-full` obligatoire en production. CA certifi par défaut si aucun certificat explicite n'est configuré.
- `DOCUMENT_S3_ENDPOINT` : origine HTTPS explicite ; bucket, région, access key et secret key via `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_REGION`, `DOCUMENT_S3_ACCESS_KEY`, `DOCUMENT_S3_SECRET_KEY`.
- `DOCUMENT_S3_LOCAL_TEST=true` autorise uniquement HTTP sur 127.0.0.1 et `APP_ENV=test` ; ce n'est pas une option pour contourner TLS en production.
- `CLAMAV_EXECUTABLE`, `CLAMAV_DATABASE`, éventuellement `CLAMAV_LIBRARY_PATH` : scanner qualifié et signatures fraîches. Les contrôles ClamAV 1.4.6 existants sont conservés.

Commande préparée :

```sh
PYTHONPATH=backend .venv/bin/python -m app.documents.worker --once
```

Elle traite au maximum un job. Un superviseur externe devra la relancer périodiquement, avec une fréquence, une concurrence et des ressources mesurées. **Aucun superviseur n'est déployé.** Un retour sans job peut aussi correspondre à l'enregistrement d'un lease épuisé ; ne pas arrêter définitivement la planification pour ce motif. Le process ne conserve pas de connexion SQL pendant le traitement, mais nécessite du disque temporaire et de la RAM ; ces ressources sont à dimensionner.

Les erreurs de commande produisent seulement `WORKER_UNAVAILABLE`, sans URL de connexion ni détail de document. L'audit SQL conserve les résultats et tentatives ; prévoir alertes sur les files en attente, leases expirés et échecs, sans journaliser le contenu documentaire.

## Reproduction des tests

Prérequis : PostgreSQL/PostGIS local, rôles locaux non privilégiés et **base fictive dédiée** `geoforest_queue_test`. Ne pas utiliser la base applicative ou une copie de données réelles.

Dans une base de recette neuve : installer PostGIS par l'administrateur, créer le rôle groupe worker, un login `geoforest_worker_test` qui en est membre, puis appliquer les migrations 0001→0007 avec `geoforest_migrator`. Enfin appliquer le candidat avec `psql -v ON_ERROR_STOP=1 -1 -f backend/migrations/candidates/0008_document_queue.sql`. Une application répétée du candidat échoue : ne pas supprimer des tables pour la forcer.

Les fixtures utilisent uniquement des mots de passe synthétiques locaux : `local-test-migrator-password`, `local-test-app-password`, `local-synthetic-worker-password`. Elles refusent toute autre base que `geoforest_queue_test` et tout hôte autre que 127.0.0.1. **Elles tronquent les tables de cette seule base de recette entre les tests.** Ne pas exposer ce PostgreSQL sur le réseau.

```sh
.venv/bin/pip install -r backend/requirements.lock
export DOCUMENT_QUEUE_TEST_URL='postgresql+psycopg://geoforest_migrator:local-test-migrator-password@127.0.0.1/geoforest_queue_test'
PYTHONPATH=backend .venv/bin/pytest --confcutdir=backend/tests/document_worker backend/tests/document_worker -q
PYTHONPATH=backend .venv/bin/pytest --confcutdir=backend/tests/documents_unit backend/tests/documents_unit -q
```

Sans `DOCUMENT_QUEUE_TEST_URL`, la nouvelle suite d'intégration est ignorée explicitement, pas comptée comme réussie. Elle ne bootstrappe aucune base automatiquement. Le S3 est simulé en mémoire avec Moto ; les tests de succès antivirus utilisent un scanner synthétique. Les formats sont réellement inspectés dans le sous-processus existant. Un scanner/signatures absents sont aussi testés : refus de libérer le document.

## Avant activation

- Qualifier upload/finalisation/download S3 et le suivi UI sur un vrai fournisseur et un vrai worker supervisé. Le raccordement est testé avec Moto et antivirus synthétique, pas qualifié en production. Ne pas simplement supprimer le garde `Settings`. Les anciennes versions locales restent sur leur stockage d’origine ; leur reprise sur une instance configurée S3 est refusée, sans effacement.
- Transformer le candidat en migration Alembic versionnée après revue complète, ajuster les contrôles de schéma, puis demander une validation distincte avant toute application Neon.
- Qualifier IAM, région effective UE, API conditionnelles, confidentialité, chiffrement et coûts sur le fournisseur choisi. Aucun fournisseur n'est encore qualifié.
- Qualifier ClamAV réel, supervision, purge contrôlée des chunks/orphelins et limites des workers. Aucun nettoyage automatique n'est introduit ici pour éviter de supprimer des preuves.
- Tester une sauvegarde indépendante DB+objets+manifeste et une restauration complète, avec remappage maîtrisé des VersionId si nécessaire. Le versionnement ne remplace pas la sauvegarde.
- Effectuer recette API S3, navigateur/responsive et qualification Vercel. Les gardes Vercel et l'interdiction d'activer S3 côté API restent en place.

## Exercice de restauration désormais disponible

Le mécanisme chiffré et la restauration isolée DB + coffre S3 ont été testés localement sur données fictives : voir [le guide de sauvegarde/restauration](sauvegarde-restauration-coffre.md). Cela ne configure pas de sauvegarde distante ni de bascule en production ; l’indépendance physique, les clés, la rétention, les alertes et les objectifs RPO/RTO restent à qualifier.
