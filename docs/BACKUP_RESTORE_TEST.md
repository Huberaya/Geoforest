# GeoForest — Test de sauvegarde et de restauration réelles

Date : 14/10/2026 · Branche : `arena/c73246d2-geoforest` · Chantier 5 de la mission de finalisation (« B-2 » du plan).
Procédure opérationnelle : `docs/PRODUCTION_RUNBOOK.md`.

## Verdict

**VERIFIED — environnement local, périmètre mono-hôte.**

Une sauvegarde réelle (`pg_dump` + archive du stockage) a été produite, puis restaurée dans une base neuve.
La restauration a été vérifiée par trois preuves indépendantes : empreinte identique à la référence, contrôle
applicatif sur l'instance restaurée (25/25), et détection d'une altération d'un octet. Le test a aussi révélé une
lacune de configuration (secret de signature absent), corrigée dans ce chantier.

Ce verdict ne vaut pas pour une exploitation de production. Les limites sont listées plus bas et doivent être
levées avant tout pilote : sauvegarde planifiée, copie hors site, chiffrement des sauvegardes, rétention, mesure
des durées de restauration.

## Périmètre

Couvert :
- la base PostgreSQL de l'application (15 tables, journal d'audit à chaîne de condensats, ancres de chaîne) ;
- le stockage local des pièces (`GF_STORAGE_DIR`) ;
- la vérification du manifeste avant toute restauration ;
- le refus des restaurations dangereuses (cible existante, nom `app_db`, stockage non vide, sauvegarde altérée) ;
- le service applicatif restauré : connexion, liste des dossiers, téléchargement des pièces.

Hors périmètre, et restant ouvert :
- S3 (B6) : le stockage testé est local. Le chemin S3 n'a pas été exécuté.
- Docker (B3) : la restauration n'a pas été testée dans les conteneurs.
- Restauration sur un hôte distinct, sur un autre fournisseur de base, ou en point dans le temps (WAL).
- Chiffrement des sauvegardes et politique de rétention : non implémentés.

## Environnement

| Élément | Valeur |
|---|---|
| Serveur PostgreSQL | 16.14 (base `app_db`, rôle administrateur `postgres` pour la sauvegarde) |
| Outils client | `pg_dump`, `pg_restore`, `psql` 16.2, extraits du wheel `pgserver` (hors dépôt, sandbox sans paquet PostgreSQL) |
| Application | Next.js 16.3.8, `next start` (mode production), port 3101 pour l'instance restaurée |
| Stockage | `GF_STORAGE_DIR` local, 23 fichiers, 555 octets (jeu de test) |

Règle de version (`scripts/sauvegarde.sh`) : le `pg_dump` doit être de la même version majeure que le serveur, ou plus
récent. 16.2 avec un serveur 16.14 est donc accepté. Une version majeure inférieure est refusée.

## Procédure exécutée

Les scripts sont dans `scripts/`. Les variables d'environnement sont dans `/home/user/pgtest/` (hors dépôt, droits 600).

1. Empreinte de référence : `npx tsx scripts/empreinte-sauvegarde.ts --json > backups/empreinte-avant.json`.
2. Sauvegarde : `scripts/sauvegarde.sh /home/user/pgtest/backups/sauvegardes` → dossier `20261014T142534Z`.
3. Restauration : `scripts/restauration.sh <dossier> app_db_restore_t1 <dossier_stockage_neuf>`.
4. Comparaison : `scripts/empreinte-sauvegarde.ts --url <base restaurée> --comparer backups/empreinte-avant.json`.
5. Test des cas de refus : `scripts/check-sauvegarde.sh <dossier_de_test>` (16 contrôles, crée et supprime ses bases `gftest_*`).
6. Contrôle applicatif : `scripts/check-restauration-app.ts` contre `next start -p 3101` sur la base restaurée.
7. Mutation : un octet d'une pièce restaurée modifié, puis contrôle 6 relancé, puis fichier rétabli.

## Résultats

### 1. Sauvegarde réelle

| Contrôle | Résultat |
|---|---|
| Sauvegarde produite | `20261014T142534Z` : `base.dump` 252 Ko (format custom), `stockage.tar.gz`, `sauvegarde.json`, `MANIFEST.sha256` |
| Stockage archivé | 23 fichiers |
| Versions consignées | PostgreSQL 16.14, pg_dump 16.2 |
| Ordre | base vidée avant l'archive du stockage (une pièce écrite entre les deux apparaît en orphelin, sans incohérence) |

### 2. Restauration réelle

| Contrôle | Résultat |
|---|---|
| Vérification du manifeste | passée |
| Base cible | `app_db_restore_t1`, créée à neuf |
| Contrôle d'intégrité intégré | passé |
| Empreinte après restauration | **identique à la référence** : 15 tables, 1146 lignes, 2 ancres de journal, 46/46 pièces conformes au stockage, 23 fichiers, 555 octets, empreinte stockage `027c0b41…` |

### 3. Suite de tests des refus : `check-sauvegarde.sh` — 16/16

Journal : `backups/check-sauvegarde-1.log` (hors dépôt).

| Cas | Attendu | Obtenu |
|---|---|---|
| Nominal : sauvegarde, restauration, empreinte identique | réussite | ✅ |
| Dump altéré | refus, aucune base créée | ✅ (code 1) |
| Stockage altéré | refus | ✅ (code 1) |
| Sauvegarde sans manifeste | refus | ✅ (code 1) |
| Base cible déjà existante | refus | ✅ (code 1) |
| Nom `app_db` | refus | ✅ (code 2) |
| Stockage cible non vide | refus, aucune base créée | ✅ (code 1) |
| Sauvegarde incomplète, manifeste recalculé | refus au contrôle d'intégrité, base laissée pour inspection | ✅ |
| Condensat altéré en base | détecté par la comparaison | ✅ (code 1) |

Le cas « sauvegarde incomplète » est le plus instructif : son manifeste est cohérent, donc c'est le contrôle d'intégrité
après restauration, et non le manifeste, qui la refuse.

### 4. Contrôle applicatif de l'instance restaurée : `check-restauration-app.ts` — 25/25

Journaux : `backups/check-restauration-app-2.log` (passage final) et `check-restauration-app-1.log` (premier passage, voir §5).

| Contrôle | Résultat |
|---|---|
| Connexion avec le compte lecteur, sans MFA | ✅ |
| Liste des dossiers accessible | ✅ HTTP 200 |
| Nombre de dossiers de l'organisation de test | ✅ 23 / 23 |
| Obtention de l'URL signée, puis téléchargement, pour chacune des 21 pièces | ✅ HTTP 200 |
| Condensat SHA-256 des octets servis, comparé à la base de référence | ✅ 21/21 identiques |

Le contrôle lit la référence sur la base d'origine, en lecture seule, et ne compare que l'organisation de test.

### 5. Défaut trouvé pendant le test, et corrigé

**Premier passage : 3 succès, 22 échecs.** Toutes les émissions d'URL signée renvoyaient HTTP 500. Journal du serveur :
`GF_STORAGE_SIGNING_SECRET est absent ou trop court (≥ 32 caractères)`.

Cause : la variable n'était définie nulle part dans l'environnement. En développement, l'application retombe sur une
valeur de développement. En production, elle refuse de signer, ce qui est le comportement voulu. Mais rien ne
documentait la variable : ni `.env.example`, ni `docker-compose.yml`, ni la documentation. Un déploiement suivant la
documentation produisait donc des pièces impossibles à télécharger, sans message compréhensible pour l'exploitant.
Ce défaut n'était pas visible avant : les tests du dépôt appellent cette route surtout pour vérifier des refus d'accès (`check-cross-tenant.ts`). Aucun ne vérifiait la livraison d'octets identiques avec la configuration de production.

Corrections :
- `.env.example` : variable `GF_STORAGE_SIGNING_SECRET` documentée, avec génération et conséquence d'une absence.
- `docker-compose.yml` : `AUTH_SECRET` et `GF_STORAGE_SIGNING_SECRET` ajoutés au service frontend, en variables
  obligatoires (`:?`), comme les mots de passe de base. `AUTH_SECRET` était aussi absent du compose.
- `.env.local` (non versionné) : valeur générée aléatoirement pour l'environnement de test. La valeur n'est pas consignée.
- Instance redémarrée, contrôle relancé : 25/25.

La valeur de test est locale et n'est pas consignée. Une rotation invalide les liens en cours, qui sont éphémères.

### 6. Mutation : le contrôle détecte l'altération

Un octet d'une pièce restaurée a été modifié (`9e30ba39…/32/3235….pdf`). Résultat :
- code de sortie 1 ;
- pièce `7852e503-4f38-49ed-8c68-9f5677712340` désignée nommément ;
- 2 échecs (la pièce, et l'agrégat « toutes les pièces servies à l'identique ») ; 20 pièces restent conformes.

Le fichier a été rétabli depuis une copie `cp -p`. Vérification : l'empreinte du stockage est de nouveau identique à la
référence (`027c0b41…`, 23 fichiers, 555 octets). Journal : `backups/check-restauration-app-mutation-B.log`.

### 7. Écart attendu après mise en service

Après le contrôle applicatif, le comparateur signale 3 écarts sur l'instance restaurée :
- `gf_audit_logs` : 457 → 502 lignes ;
- `gf_sessions` : 73 → 76 lignes ;
- ancre de journal : séquence 457 → 502.

Ces écarts sont le fait des connexions et des téléchargements du contrôle applicatif, qui écrivent dans le journal et
créent des sessions. Ce ne sont pas des pertes ni des altérations. Le comparateur les signale parce qu'il n'accepte
aucune différence avec la référence : c'est voulu. Après une mise en service réelle, la comparaison à la référence n'a
plus de sens, et la vérification se fait par la chaîne du journal (`scripts/verifier-chaine.ts`).

## Limites connues

1. **Une seule machine, un seul disque.** La sauvegarde n'est pas copiée hors site. Une perte du poste fait perdre
   sauvegarde et données.
2. **Aucune planification.** Les sauvegardes sont manuelles. Aucune cadence (RPO) n'est définie ni tenue.
3. **Aucune rétention.** Aucune règle ne supprime les anciennes sauvegardes, et aucune ne les conserve.
4. **Pas de chiffrement des sauvegardes.** `base.dump` contient des données personnelles (courriels des auteurs du
   journal, identités des comptes). Le chiffrement au repos est à faire.
5. **Durées non mesurées.** Le RTO n'est pas établi. Aucune durée de sauvegarde ou de restauration n'a été chronométrée ;
   le jeu de test (23 fichiers) ne permet pas d'extrapoler à un volume réel.
6. **Secrets non sauvegardés.** `AUTH_SECRET` et `GF_STORAGE_SIGNING_SECRET` ne font pas partie de la sauvegarde. Sans
   `AUTH_SECRET` d'origine, les sessions restaurées sont invalides. Ils doivent être conservés dans le coffre de
   l'exploitant.
7. **Cohérence non garantie pendant l'écriture.** Le script n'arrête pas l'application. Une pièce écrite entre le dump
   et l'archive apparaît en orphelin du stockage, ce qui est sans gravité. L'instantané cohérent suppose un arrêt de
   l'application pendant l'opération.
8. **Mot de passe dans l'URL.** Il apparaît dans la liste des processus pendant `pg_dump`. Acceptable sur un poste de
   confiance ; en production, utiliser `~/.pgpass` (droits 600).
9. **Comparateur par empreinte.** `empreinte-sauvegarde.ts` contrôle les comptages, la chaîne du journal, les condensats
   des pièces et l'empreinte du stockage. Il ne fait pas de comparaison colonne par colonne.
10. **Le contrôle applicatif lit le compte lecteur uniquement.** Les droits écriture, administration et MFA ne sont pas
    testés sur l'instance restaurée.

## Ce qui reste à faire pour une exploitation

- Planifier la sauvegarde et définir un RPO ; copier hors site ; chiffrer ; définir la rétention.
- Mesurer le RTO sur un volume réaliste, et restaurer sur un second hôte.
- Tester le chemin S3 (B6) avec un bucket réel.
- Refaire ce test dans les conteneurs une fois Docker disponible (B3).
- Ajouter une étape de restauration à la CI, sur un jeu réduit.

## Fichiers produits

- `scripts/empreinte-sauvegarde.ts` — empreinte de la base et du stockage ; `--json`, `--comparer`.
- `scripts/sauvegarde.sh` — sauvegarde locale.
- `scripts/restauration.sh` — restauration vérifiée dans une base neuve.
- `scripts/check-sauvegarde.sh` — 16 contrôles des refus et de la sensibilité.
- `scripts/check-restauration-app.ts` — contrôle applicatif de l'instance restaurée.
- `.env.example`, `docker-compose.yml` — secrets obligatoires documentés.

Journaux et sauvegardes : hors dépôt, dans `/home/user/pgtest/backups/` (non versionnés).
