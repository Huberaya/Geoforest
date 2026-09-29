# Coffre S3 — raccordement API en recette locale

Au 29 septembre 2026, l'API sait réserver et déposer en S3, mettre une version en file et télécharger un objet versionné après validation. **Ce fonctionnement est volontairement limité au test local ; ce guide n'autorise aucun déploiement ni migration Neon.**

## Activation strictement bornée

Le backend par défaut reste `local`. Pour exercer les routes S3 :

- `APP_ENV=test` et `DOCUMENT_S3_API_TEST=true` obligatoires.
- `DATABASE_URL` doit viser **127.0.0.1** et une base dont le nom finit par `_test`. L'option de test est refusée avec une base distante ou un nom de base métier, même si le backend par défaut est `local`.
- `DOCUMENT_STORAGE_BACKEND=s3` et `DOCUMENTS_ENABLED=true`.
- Configuration stockage : `DOCUMENT_S3_ENDPOINT`, `DOCUMENT_S3_REGION`, `DOCUMENT_S3_BUCKET`, `DOCUMENT_S3_ACCESS_KEY`, `DOCUMENT_S3_SECRET_KEY`. Secrets serveur exclusivement. Le client S3 est réutilisé dans le process ; un changement de configuration/secrets demande un redémarrage.
- HTTPS vérifié sauf l'exception `DOCUMENT_S3_LOCAL_TEST=true`, autorisée uniquement pour HTTP sur 127.0.0.1 en environnement test.
- Schéma **0007 + candidat** `backend/migrations/candidates/0008_document_queue.sql`, rôle worker préprovisionné comme décrit dans `document-worker-local.md`.

Les tests automatisés utilisent Moto **en mémoire**, sans serveur S3 persistant. Ne pas inventer une URL de service Moto : la fixture remplace le client stockage. Aucun bucket fournisseur n'a été créé.

Le profil Vercel continue de refuser le coffre. Le mode `transaction_pool` avec documents activés reste refusé : aucun assouplissement des gardes de qualification cloud dans cette étape. L'option de test n'est pas un moyen d'activer S3 en production. Les opérations portant sur une version S3 existante sont aussi bloquées si le garde est absent, même quand le backend par défaut est local.

## Contrat des routes

- Réservation : autorisation, rattachements et quota inchangés. Pour une nouvelle version S3, contrôle du candidat SQL et de la configuration privée du bucket avant commit. Une erreur annule la réservation et le nouveau document éventuel.
- Upload : blocs de **64 000 octets**, dernier bloc de la taille restante. Taille maximale inchangée : 20 Mio. Écriture conditionnelle, jamais d'écrasement. Le compteur SQL n'avance qu'après succès du stockage. Une réponse perdue après l'écriture S3 permet de renvoyer **le même bloc** ; un bloc différent est refusé.
- `/finish` : retourne une version `SCANNING` mise en file, sans lancer ClamAV ni acquérir le verrou de scan synchrone. Les reprises sont conduites par le worker, pas par le navigateur. Les appels répétés ne créent pas de nouveau job ni de nouvel audit d'enqueue.
- DTO : `processing_mode` vaut `inline` ou `background`. Aucun `storage_backend`, `storage_version`, `object_id`, `input_sha256` ou `actor_id` interne exposé.
- Téléchargement : refus avant `SCAN_PASSED`, lecture du `VersionId` enregistré et vérification SHA-256 avant toute restitution ; réautorisation et audit après ouverture. Une perte d'accès à cet instant ferme le fichier sans envoyer son contenu.
- Revue humaine : toujours distincte des contrôles techniques, avec permissions existantes.

## Anciennes versions locales

Aucun déplacement automatique, aucune suppression. Une version locale déjà validée reste téléchargeable si le même stockage local est accessible et intègre. Si ce disque n'existe pas sur la nouvelle instance, le téléchargement échoue de manière bloquante : **S3 n'a pas magiquement migré les anciens fichiers**.

Sur une instance configurée S3, un upload local encore incomplet ne peut pas être repris/finalisé : réponse 409 et invitation à créer une nouvelle version. Une nouvelle version S3 du même document est possible sans altérer la précédente. Une migration de données réelle exige un plan séparé et une validation explicite.

## Suivi de traitement dans l'interface

Actualisation toutes les cinq secondes pendant `SCANNING` ou les reprises possibles de `SCAN_UNAVAILABLE`. Requêtes séquentielles, annulées au changement de contexte/démontage ; pas de requête dans un onglet masqué. Délai progressif jusqu'à trente secondes sur panne transitoire ; arrêt après perte d'accès 401/403/404. Arrêt également après résultat terminal ou trois tentatives indisponibles.

Le bouton de relance manuelle ne s'affiche plus pour les traitements en arrière-plan. En cas d'épuisement des trois essais, l'interface propose une nouvelle version ou un contact administrateur. La réussite du scan reste libellée « revue nécessaire ».

## Recette reproductible

Après préparation de la base fictive `geoforest_queue_test` et du candidat selon le guide worker :

```sh
DATABASE_URL='postgresql+psycopg://geoforest_app:local-test-app-password@127.0.0.1/geoforest_queue_test' \
MIGRATION_DATABASE_URL='postgresql+psycopg://geoforest_migrator:local-test-migrator-password@127.0.0.1/geoforest_queue_test' \
PYTHONPATH=backend .venv/bin/pytest backend/tests/test_documents_s3_api.py -q
```

Cette suite utilise PostgreSQL réel, Moto en mémoire, un résultat antivirus synthétique et le sous-processus réel de validation de format. Les fixtures nettoient la **base de test uniquement**. Elle est ignorée explicitement si la base n'est pas la base locale dédiée. Aucun bootstrap de données n'est réalisé par les tests.

La recette navigateur, séparée, utilise l'interface Next réelle avec réponses API fictives, sans compte réel :

```sh
# Démarrer séparément le serveur Next local en AUTH_PROVIDER=oidc, APP_ENV=development.
PUBLIC_ORIGIN=http://localhost:3000 E2E_DOCUMENTS_MOCK=1 \
  npx playwright test tests/e2e/documents-background.mock.spec.ts
```

Ce test opt-in ne valide ni Clerk/OIDC réel, ni le transport réseau API→S3, ni l'antivirus. Il vérifie les états, l'actualisation et l'affichage aux largeurs 1440 et 390 px.

## Restant avant production

Sauvegarde indépendante et restauration complète DB + objets + manifeste ; finalisation de la migration Alembic ; fournisseur/région UE, IAM et encryption qualifiés ; ClamAV réel/signatures et worker supervisé ; tests de pannes et charge sur services réels ; qualification Vercel.

La réservation et l'écriture des chunks effectuent encore des appels S3 sous verrou transactionnel. Les contrôles de configuration du bucket sont conservateurs et répétés : coût en requêtes et durée des verrous à mesurer/optimiser avant exploitation. Aucun nettoyage de chunks/orphelins n'est automatisé ici. Le volume logique du quota n'est pas une borne des coûts physiques S3 (staging, versions et conservation).

## Exercice de restauration désormais disponible

Le mécanisme chiffré et la restauration isolée DB + coffre S3 ont été testés localement sur données fictives : voir [le guide de sauvegarde/restauration](sauvegarde-restauration-coffre.md). Cela ne configure pas de sauvegarde distante ni de bascule en production ; l’indépendance physique, les clés, la rétention, les alertes et les objectifs RPO/RTO restent à qualifier.
