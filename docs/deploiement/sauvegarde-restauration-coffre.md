# Sauvegarde chiffrée et restauration isolée du coffre S3

**État : exercice local sur données fictives, 29 septembre 2026. Aucune sauvegarde de production configurée.** Ni abonnement, ni accès Neon, ni transfert réel, ni autorisation de bascule. Les gardes de l'API S3 et de Vercel restent inchangés.

## Périmètre exact

L'outil conserve un dump PostgreSQL complet de la base de test et les octets S3 **référencés par le coffre documentaire** : objets scellés, y compris les versions rejetées, et chunks acquittés en base des uploads/contrôles en cours. Les chunks non acquittés et objets orphelins ne sont pas présentés comme des preuves validées et ne sont pas copiés.

Ce n'est pas encore une sauvegarde complète de l'infrastructure GeoForest : configurations/secrets externes, clés de chiffrement, comptes Clerk, ressources géospatiales externes et autres fichiers hors coffre nécessitent leur propre inventaire et procédure. Les fichiers documentaires historiques **locaux** font échouer l'opération plutôt que d'être silencieusement oubliés. Un upload local sans aucun octet ne nécessite pas de fichier associé.

L'archive est indépendante des versions S3 d'origine **sur le plan logique**. La recette la place sur disque local privé : elle ne démontre pas une indépendance physique de machine, de compte ou de région. La suppression des objets fictifs d'origine a été simulée ; la restauration ne relit pas le stockage S3 source ni la base source.

## Fonctionnement

Code : `backend/app/documents/recovery/` ; CLI : `scripts/document-recovery.py`.

### Capture

1. Refus hors `APP_ENV=test`, sans confirmation d'arrêt des writers, ou si l'URL PostgreSQL n'est pas `postgresql+psycopg` sur **127.0.0.1**, base suffixée `_test`, utilisateur `geoforest_migrator`, sans options URL supplémentaires.
2. Transaction PostgreSQL **REPEATABLE READ, READ ONLY**. Un snapshot exporté est donné à `pg_dump --snapshot` : les empreintes/inventaires et le dump décrivent le même état SQL.
3. Empreintes déterministes des lignes et vérification des indicateurs RLS des tables applicatives. Copie vérifiée des objets par **VersionId** ; copie des chunks déjà reçus avec taille et empreinte propres.
4. Chaque fichier est chiffré/authentifié en **AES-256-GCM**, avec nonce aléatoire et contexte lié à son nom opaque. Le dump, les fichiers et le manifeste ne sont pas stockés en clair dans l'archive.
5. Le manifeste chiffré est écrit en dernier et synchronisé sur disque. Sans ce manifeste authentifié, une capture partielle n'est pas une sauvegarde exploitable. Une sauvegarde existante n'est jamais écrasée.

Le marqueur `--writers-stopped` est une **attestation de l'opérateur**, pas une commande qui arrête réellement les services. Arrêter toutes les instances API/worker et interdire les suppressions/lifecycle S3 durant la capture. Le snapshot SQL ne rend pas atomiques des changements arbitraires effectués directement dans S3.

### Vérification

L'action `verify` vérifie l'authentification du manifeste et de chaque fichier, les tailles, SHA-256, doublons, fichiers absents/supplémentaires et contraintes de chemins/permissions. Elle ne nécessite ni PostgreSQL ni accès S3. Elle prouve l'intégrité de cette archive, **pas sa validité métier ou l'authenticité des documents**. La correspondance complète avec les lignes SQL est contrôlée pendant la restauration.

### Restauration

1. Toute l'archive est authentifiée **avant de modifier une destination**. Mauvaise clé, octet modifié, fichier absent, lien symbolique ou inventaire incohérent : refus.
2. Base et bucket distincts de la source ; base vide hors extension PostGIS, bucket vide **y compris anciennes versions et marqueurs de suppression**. Aucun écrasement, purge ou `DROP DATABASE` automatique.
3. Base cible hors service : aucun autre login non-superuser autorisé à se connecter, aucun autre client connecté. PostgreSQL doit aussi être isolé par l'opérateur. Un DBA/superuser demeure une identité de confiance, pas un adversaire neutralisé par l'outil.
4. Versions majeure PostgreSQL et chaîne de version PostGIS identiques à celles consignées. Restauration SQL en une transaction par `pg_restore --single-transaction --exit-on-error` ; comparaison de toutes les empreintes applicatives et indicateurs RLS avant remappage.
5. Contrôle de concordance manifeste ↔ documents restaurés. Les objets et chunks sont réécrits dans le bucket cible puis relus/vérifiés. Les nouveaux `VersionId` sont conservés : ils ne sont pas supposés identiques à ceux de la source.
6. Sous verrou exclusif de la table, le propriétaire désactive **uniquement dans une transaction** les deux triggers d'immuabilité nécessaires au remappage. Seul `storage_version` est remplacé, avec comparaison préalable organisation/version/objet/hash/ancienne référence ; les triggers sont réactivés avant commit. Une erreur annule aussi leur désactivation. Aucun droit de contournement permanent n'est accordé à l'API ou au worker.
7. Révocation des sessions utilisateurs, sessions portail et invitations restaurées. Les leases de jobs sont invalidés et remis en file, **sans réinitialiser les tentatives**. Aucun scan ni revue humaine n'est déclaré réussi par la restauration ; états, octets, revues et audit d'origine sont conservés.
8. Reçu séparé chiffré/authentifié : identifiant de sauvegarde, destination, correspondance ancienne/nouvelle version, mesures de sécurité appliquées. La conclusion est toujours **`promotion: NOT_AUTHORIZED`**. La base reste interdite à l'API/worker.

L'audit historique en base n'est pas réécrit pour prétendre qu'un utilisateur a approuvé la restauration. Le reçu externe constitue la trace de cette opération technique ; en exploitation, le rattacher à une demande de changement approuvée et à l'identité de l'opérateur dans un journal indépendant.

En cas de panne après la restauration SQL ou après certaines écritures S3, la cible peut être partielle. Elle reste hors service, sans reçu de réussite. **Ne pas la publier ni forcer une reprise en écrasant son contenu.** Diagnostiquer puis préparer une nouvelle destination vide ; l'archive source reste intacte.

## Clés et fichiers privés

- Clé de 32 octets aléatoires, fournie par `DOCUMENT_RECOVERY_KEY_FILE`, fichier propriétaire courant, mode **0600**, un seul lien, pas de symlink. Elle doit être hors du répertoire d'archive.
- Répertoires d'archive et parents privés **0700**, fichiers **0600**. Aucun fichier n'est extrait depuis un chemin libre présent dans une archive.
- Sauvegarder/escrower la clé séparément : **perdre la clé rend l'archive inutilisable**. Ne pas la joindre à l'archive, au dépôt Git, aux logs ou au rapport. L'indépendance physique de la conservation de clé reste à organiser.
- Les mots de passe PostgreSQL sont transmis au sous-processus via un environnement minimal, jamais dans ses arguments. Les secrets S3/Clerk ne sont pas transmis aux outils PostgreSQL. Exécuter sous une identité système dédiée en exploitation.
- `pg_dump` / `pg_restore` utilisent des fichiers temporaires non nommés privés, mais **des données en clair existent temporairement en RAM et sur le filesystem temporaire**. Ce n'est pas de l'effacement sécurisé. Un volume temporaire chiffré ou adapté doit être qualifié avant production.
- AES-GCM protège contre une altération indétectée, pas contre la suppression des archives ni la compromission de la clé. Rétention, Object Lock éventuel, immutabilité et IAM indépendants ne sont pas encore déployés.

## Limites intentionnelles de la recette

Base physique source ≤ 32 Mio ; dump ≤ 64 Mio ; archive logique ≤ 256 Mio ; ≤ 2 048 objets/chunks ; ≤ 100 000 lignes par table ; manifeste ≤ 2 Mio. Les requêtes et outils ont des timeouts ; `prlimit` borne la taille des fichiers produits et le CPU des outils. Ces plafonds sont pour la recette, **pas un dimensionnement de production**. Un dépassement refuse l'opération, il ne doit pas produire une archive tronquée réputée complète.

Les empreintes de tables excluent les relations appartenant aux extensions PostgreSQL ; le dump conserve les données de configuration d'extension gérées par PostgreSQL. Cette recette n'est pas une certification de migration géospatiale entre versions. Aucun RPO/RTO de production n'est établi par des temps sur quelques fichiers synthétiques.

`pg_restore` exécute du SQL : n'accepter que des archives issues d'une source et d'un opérateur de confiance. Le chiffrement authentifié ne rend pas inoffensif un dump malveillant créé par un détenteur de la clé ou une source compromise.

## Préparer une cible locale neuve

Inspecter d'abord les rôles/bases existants. Ne pas rebootstrapper, changer des mots de passe ou supprimer une base déjà présente. La source de tests doit être exclusivement fictive.

Prérequis : rôles `geoforest_app`, `geoforest_migrator`, `geoforest_document_worker` comme dans le guide worker. Le migrateur n'est pas superuser/BYPASSRLS/CREATEDB. Un administrateur local prépare une **nouvelle** cible :

```sql
CREATE DATABASE geoforest_restore_test OWNER geoforest_migrator;
REVOKE CONNECT ON DATABASE geoforest_restore_test FROM PUBLIC;
-- Puis, connecté exclusivement à cette nouvelle base :
CREATE EXTENSION postgis;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT INSERT ON public.spatial_ref_sys TO geoforest_migrator;
```

Le dernier droit sert au chargement des données de configuration PostGIS par `pg_restore`. Il ne concerne que cette cible isolée et n'est accordé ni au rôle API ni au worker. Une première recette a détecté son absence ; l'outil vérifie désormais ce prérequis avant restauration.

La source doit être au schéma 0007 + candidat documentaire, déjà peuplée avec des données fictives. Le candidat reste hors d'Alembic `versions`. Aucun changement de schéma cloud ou nouvelle migration applicative n'est introduit ici.

## CLI locale

La CLI refuse également S3 distant : `DOCUMENT_STORAGE_BACKEND=s3`, `DOCUMENT_S3_LOCAL_TEST=true` et endpoint **HTTP sur 127.0.0.1** sont requis pour `backup` et `restore`. Fournir bucket, région et identifiants fictifs de l'émulateur. La recette automatisée utilise Moto en mémoire, pas un émulateur HTTP persistant ; les opérations intégrées appellent les mêmes fonctions Python, et la commande `verify` est testée en sous-processus.

Injecter `DOCUMENT_RECOVERY_DATABASE_URL` et `DOCUMENT_RECOVERY_KEY_FILE` depuis un environnement privé. Ne pas placer d'identifiants dans la ligne de commande.

```sh
# APP_ENV=test, base source et configuration S3 de l'émulateur source injectées.
.venv/bin/python scripts/document-recovery.py backup \
  --directory /chemin/prive/sauvegarde-neuve --writers-stopped

.venv/bin/python scripts/document-recovery.py verify \
  --directory /chemin/prive/sauvegarde-neuve

# Remplacer l'environnement par la base cible et le bucket cible vides.
.venv/bin/python scripts/document-recovery.py restore \
  --directory /chemin/prive/sauvegarde-neuve \
  --receipt /chemin/prive/recu-neuf.gcm --writers-stopped
```

Les réponses stdout sont bornées à des agrégats ou `DOCUMENT_RECOVERY_FAILED`, jamais aux clés, URL de connexion, titres de documents ou dump SQL.

## Tests reproductibles

```sh
PYTHONPATH=backend .venv/bin/pytest \
  --confcutdir=backend/tests/recovery_unit backend/tests/recovery_unit -q

DOCUMENT_RECOVERY_TEST_URL='postgresql+psycopg://geoforest_migrator:local-test-migrator-password@127.0.0.1/geoforest_backup_test' \
PYTHONPATH=backend:backend/tests .venv/bin/pytest \
  --confcutdir=backend/tests/document_recovery backend/tests/document_recovery -q
```

La suite d'intégration exige une base fictive dédiée exactement nommée `geoforest_backup_test`, avec les migrations 0001→0007 puis le candidat. **Ses fixtures tronquent cette seule source de test entre les cas**. Elles créent de nouvelles cibles `geoforest_dr_<identifiant>_test` via l'administrateur PostgreSQL local ; elles n'effacent pas les cibles existantes. Sans l'opt-in, les tests sont ignorés, pas comptés comme réussis. Les mots de passe figurant dans ces commandes sont exclusivement les valeurs synthétiques du laboratoire.

## Avant une vraie politique de sauvegarde

Choisir et qualifier : compte de sauvegarde distinct, région UE effective, fournisseur et garanties, chiffrement/KMS/escrow, IAM lecture source et écriture destination sans suppression, rétention et éventuel verrouillage, exports DB cohérents, supervision et alertes, budgets, RPO/RTO, restauration périodique complète et procédure de bascule approuvée. La conservation des preuves et les obligations de suppression doivent faire l'objet d'une politique validée, pas d'un nettoyage automatique ajouté à ce prototype.

## Qualification de la destination indépendante

Le [dossier stockage UE du lot 08m](qualification-stockage-ue.md) distingue le coffre runtime du dépôt d'archives chiffrées, propose une séparation des comptes/clés/régions et précise droits, rétention, coûts et recette restante. Aucun fournisseur n'est encore qualifié, aucun transport offsite n'est activé. Le diagnostic en lecture seule ne remplace ni la recette IAM ni l'exercice de restauration.
