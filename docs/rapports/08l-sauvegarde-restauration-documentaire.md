# Chantier 3 — sauvegarde chiffrée et restauration du coffre

29 septembre 2026 — suite de `ad1eae1`. **Livraison locale du mécanisme et de sa recette ; aucune sauvegarde de production activée.**

## Objectifs et périmètre réalisé

Récupérer les fichiers et leurs références en base sans dépendre de la présence des versions S3 d'origine. Protéger le dump et les octets par chiffrement authentifié, refuser une archive incomplète, préserver états de quarantaine/revues/audit et isoler la destination tant qu'aucune bascule n'est approuvée.

Les nouveaux modules sont indépendants des routes et de la configuration d'identité. Aucun changement des gardes Vercel/S3, des migrations applicatives ou du frontend. La modification préexistante d'`infra/bootstrap-db.sh` est laissée de côté.

### Fichiers principaux

- `backend/app/documents/recovery/archive.py` : fichiers privés, chiffrement/authentification AES-256-GCM, manifeste final, tailles bornées, refus des symlinks/hardlinks/écrasements.
- `backend/app/documents/recovery/database.py` : URL locale de test stricte, snapshot exporté, empreintes de lignes/RLS, `pg_dump`/`pg_restore` bornés sans mot de passe dans argv, vérification de cible hors service.
- `backend/app/documents/recovery/service.py` : capture des objets scellés et chunks acquittés, restauration depuis archive, liaison manifeste ↔ SQL, remappage des VersionId, révocation des accès clonés, reçu chiffré.
- `scripts/document-recovery.py` : actions `backup`, `verify`, `restore`, environnement externe et erreurs expurgées. La CLI refuse un endpoint S3 distant ; son usage opérationnel est limité à un émulateur loopback.
- Tests `backend/tests/recovery_unit/` et `backend/tests/document_recovery/`.
- Guide : `docs/deploiement/sauvegarde-restauration-coffre.md`.

## Déroulement de la preuve de restauration

1. Cluster PostgreSQL local inspecté : seule la base `postgres` existait, aucun rôle GeoForest. Création de rôles synthétiques non-superuser et d'une source fictive `geoforest_backup_test`, migrations 0001→0007 et candidat documentaire inchangé.
2. Données fictives de deux organisations : quatre versions, dont une validée techniquement, une rejetée, une en contrôle avec lease et une partiellement téléversée ; revue, audit, session utilisateur, session portail et invitation.
3. Capture cohérente du dump SQL et de l'inventaire grâce au snapshot exporté. Copie de deux objets et de deux chunks dans une archive chiffrée, clé distincte.
4. Suppression volontaire des **seuls objets fictifs Moto** de la source.
5. Nouvelle base cible isolée et nouveau bucket simulé vides. Restauration du dump réel avec PostgreSQL, comparaison des empreintes des tables applicatives, réécriture et relecture des objets.
6. Les VersionId cibles diffèrent des originaux ; les références SQL sont remappées sous contrôle transactionnel. Les octets, états, revues et audit sont conservés. Le document rejeté n'est pas promu en document validé.
7. Les sessions/invitations clonées sont révoquées. Les leases sont invalidés sans remettre à zéro les tentatives. Le fichier en contrôle peut être retraité depuis ses chunks restaurés ; la restauration elle-même ne valide aucun scan.
8. Reçu chiffré externe, `promotion=NOT_AUTHORIZED`. La base demeure inaccessible aux comptes runtime. Un test distinct ouvre temporairement une seule connexion API de validation puis révoque ce droit pour vérifier réellement RLS et immuabilité avec le rôle applicatif.

Les tests créent de nouvelles bases cibles fictives, jamais en écrasant une base existante. Les fixtures ne tronquent que la source de test explicitement désignée. Aucun accès, effacement, export ou modification Neon.

## Tests exécutés

Preuves : `docs/rapports/preuves-chantier-8/document-recovery/`.

| Suite / contrôle | Résultat |
|---|---:|
| Archive, clés, filesystem, limites de configuration et CLI | **29 réussis** |
| Sauvegarde/restauration PostgreSQL + S3 simulé | **13 réussis** |
| Non-régression unitaire documentaire | **96 réussis** |
| Contrôle sans opt-in DB | **13 ignorés**, aucun succès revendiqué |
| Ruff, pip check, git diff --check | Réussis |

Soit **42 nouveaux tests réussis**, plus **96 tests documentaires de non-régression**. Pas de relance de la suite backend complète ni des tests frontend/navigateur : cette livraison n'en modifie pas le code. Les résultats complets/browser de 08k restent des résultats historiques, pas des tests de cette livraison.

### Cas d'échec vérifiés

- Mauvaise clé, altération du manifeste ou d'un fichier, fichier absent/supplémentaire, substitution d'un autre fichier chiffré.
- Noms traversant les répertoires, doublons, symlink/hardlink, permissions trop ouvertes, clé incluse dans l'archive ou de mauvaise longueur.
- Base distante/métier, mauvaise identité DB, absence d'opt-in, refus de S3 distant dans la CLI.
- Tentative de restaurer sur la source, sur un bucket occupé ou sur une base contenant déjà une table : refus sans écrasement.
- Cible autorisée aux comptes applicatifs : refus avant restauration.
- Objet source manquant : pas de manifeste final ; présence d'un fichier historique local : refus plutôt qu'omission.
- Inventaire chiffré authentique mais incomplet par rapport à la base : refus avant écriture des objets cibles.
- Nouvelle ligne commise après le snapshot source : absente du dump et des empreintes restaurées, cohérence démontrée.
- Interruption après certaines écritures S3 : cible hors service, pas de reçu de réussite, archive intacte.
- Conflit pendant remappage : rollback de la transaction, anciennes références et triggers d'immuabilité restaurés, cible non publiée.

Une première tentative a échoué faute de droit `INSERT` sur la table de configuration PostGIS de la cible. La préparation locale a été corrigée et ce prérequis est désormais vérifié. Le rôle API/worker ne reçoit pas ce droit.

## Garanties démontrées / limites

**Démontré localement :** restauration depuis une archive indépendante des objets S3 supprimés, cohérence du snapshot SQL, intégrité et confidentialité des fichiers d'archive, remappage explicite de versions, préservation de la quarantaine/revue et fermeture des accès clonés, isolement de la cible en cas d'échec.

**Non démontré :** sauvegarde hors site ou dans un compte indépendant, stockage S3 persistant réel, IAM fournisseur, immutabilité/WORM, protection contre perte de la machine ou du compte, ClamAV réel, délais RPO/RTO de production, volumétrie réelle ou reprise globale du SaaS.

Le stockage est Moto en mémoire ; PostgreSQL/PostGIS et les commandes de dump/restauration sont réels et locaux. Les succès de scan du test de reprise utilisent un scanner synthétique et le validateur de format existant. La commande CLI `verify` est réellement exercée en sous-processus ; les opérations intégrées backup/restore appellent les mêmes fonctions Python avec Moto, pas un service HTTP S3 persistant.

Le dump inclut les données SQL, mais pas les secrets/configurations externes ou fichiers hors coffre. Le sous-ensemble documentaire **local** existant demande une sauvegarde séparée et bloque cette recette S3. Les tables d'extensions sont exclues des empreintes applicatives, leurs données de configuration restant gérées par le dump ; aucune compatibilité géospatiale interversions n'est revendiquée.

Des données en clair existent temporairement en mémoire et dans les fichiers temporaires privés des outils PostgreSQL. Pas d'effacement sécurisé revendiqué. Clé indépendante, volume temporaire approprié, politiques de rétention et protection contre la suppression restent à qualifier pour la production. Aucun nettoyage automatique des sources, archives ou cibles n'est ajouté.

## Bilan

- **PRÊT localement :** outil borné de capture/vérification/restauration et exercice de perte simulée réussi.
- **À FINALISER :** destination de sauvegarde physiquement indépendante en UE, gestion/escrow et rotation des clés, IAM, rétention, planification, alertes, RPO/RTO et exercices sur services réels.
- **BLOQUÉ pour production :** API S3 toujours limitée au test ; aucune sauvegarde distante, migration cloud ou bascule activée.
- **RISQUE RÉGLEMENTAIRE :** restaurer fidèlement une preuve ne valide ni son authenticité, ni sa légalité, ni la conformité EUDR. La restauration ne remplace pas la revue humaine.
- **PROCHAINE ÉTAPE recommandée :** qualification documentaire et technique d'un fournisseur UE, des droits et des garanties de sauvegarde ; finalisation de la migration et procédure d'activation seulement après validation distincte. Aucune souscription ou transfert réel implicite.
