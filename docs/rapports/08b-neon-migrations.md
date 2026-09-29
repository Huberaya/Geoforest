# Neon — migrations appliquées et vérifiées

29 septembre 2026 · chantier 8 en cours · branche Git `chantier-8/security-release`.

## Résultat

**Les migrations GeoForest `0001 → 0007` ont été réellement appliquées sur la base Neon `neondb`, après confirmation explicite de l’utilisateur.** Le nom de branche `Production` est celui indiqué par l’utilisateur ; aucune interrogation de l’API de gestion Neon n’a été utilisée pour vérifier ce libellé.

- PostgreSQL **18.6**, PostGIS **3.6.4** installé.
- **37 tables applicatives/métadonnées** hors tables de l’extension PostGIS ; **32 avec RLS activée**.
- **Deux rôles dédiés** : runtime et migrateur séparés, sans SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE, REPLICATION ni appartenance à `neon_superuser`.
- Version Alembic **0007** ; second `upgrade head` réussi sans nouvelle migration.
- **Zéro ligne dans les 35 tables métier/session/audit** à l’issue de l’intervention.
- Seules initialisations : une ligne de version Alembic et les **sept codes statiques de commodités** prévus par les migrations. Les données système de PostGIS sont des références de l’extension, pas des parcelles de démonstration.
- Aucune connexion Clerk, aucun utilisateur, fournisseur, lot, parcelle, document ou dossier fictif ajouté dans Neon.

## Autorisation et protection des données

L’utilisateur a autorisé la préparation puis l’application des migrations sur cette cible, à condition de réussir les contrôles de compatibilité et de préparer un point de retour, sans données de démonstration.

L’inventaire distant initial a été répété via une connexion directe en lecture seule : base toujours dépourvue de relations utilisateur, fonctions utilisateur dans `public` et grands objets. Aucune suppression ou transformation de données n’était nécessaire. Aucun autre client actif n’a été observé au moment du contrôle ; cela ne constitue pas un verrou global contre une future action externe dans la console.

Le compte administratif transmis possède BYPASSRLS et n’a pas été choisi comme compte applicatif. Les identifiants ne figurent ni dans ce rapport ni dans le dépôt. Deux nouveaux secrets indépendants ont été générés pour les rôles dédiés et conservés dans des fichiers privés séparés.

## Recette avant écriture distante

PostgreSQL **18.6** et PostGIS **3.6.4** installés dans l’environnement local. La clé du dépôt PostgreSQL utilisée pour cette installation a le fingerprint `B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8`.

Sur une base locale jetable : migration neuve 0001→0007, deuxième upgrade, puis **863 tests réussis**, 13 avertissements, **410,01 s**. Cela valide le couple de versions ; ce n’est pas une reproduction de toutes les particularités du plan de contrôle Neon.

Un dump de la base distante **avant modification** a été conservé en privé et restauré dans une autre base locale, avec les noms de propriétaires et instructions ACL. Le schéma/contenu initial vide a été confirmé. Ce point de retour ne contient pas les mots de passe de rôles ni une image complète du compte cloud.

## Exécution et particularité fournisseur

L’URL reçue utilisait le pooling. Le point d’accès direct correspondant a été vérifié puis utilisé pour les opérations, avec TLS `verify-full`, CA système explicite et channel binding requis. Aucun assouplissement TLS n’a été réalisé.

Une première approche de création de rôles avec vérificateurs SCRAM pré-calculés a été rejetée par le plan de contrôle Neon, qui demande les mots de passe d’entrée au provisionnement. La transaction a été annulée ; l’absence d’extension/rôles persistants a été vérifiée avant reprise. Les mots de passe générés ont ensuite été transmis via TLS dans les commandes nécessaires, sans publication des valeurs ni journalisation des commandes sensibles.

PostGIS et les rôles ont été provisionnés, puis Alembic exécuté avec le **migrateur**, pas le compte administratif. Les contrôles finaux montrent que le runtime n’est ni propriétaire ni membre d’un rôle propriétaire/privilégié et ne peut pas créer dans `public`.

## Contrôles après migration

- Readiness DB du code du chantier 8 : **réussie sur le rôle runtime Neon**.
- Propriétaire des 37 tables : migrateur, pas runtime.
- Les 32 tables protégées ont RLS activée.
- Sans contexte métier : zéro ligne visible dans les 31 tables directement lisibles concernées ; `supplier_sessions` **refuse l’accès SELECT direct** et conserve ses helpers dédiés. Le script de contrôle a été ajusté pour reconnaître ce refus attendu ; aucune permission n’a été élargie.
- Droits append-only contrôlés sur audit, décisions de diligence, revues documentaires et analyses forestières : pas d’UPDATE/DELETE runtime.
- Fonctions privilégiées `authz` : `search_path` fixé.
- Requête PostGIS synthétique calculée en lecture seule, sans insertion : réussie.
- Lecture de version et compteurs après tous les tests locaux : toujours 0007 et zéro ligne métier.

La base étant vide, un SELECT ne suffit pas à prouver la séparation entre deux tenants réels. Cette séparation est couverte par les tests peuplés **exclusivement locaux**, notamment ceux exécutés sur la restauration décrite ci-dessous.

## Sauvegarde après migration et recette de restauration

Un second dump privé a été produit depuis Neon, puis restauré dans `geoforest_neon_after_test` en local. **Avant les tests destructifs locaux**, comparaison avec Neon en lecture seule :

| Élément | Résultat |
|---|---|
| Contenu des 37 tables | Identique, compteurs et SHA-256 comparés |
| Contraintes | Identiques |
| Politiques RLS | Identiques |
| Propriétaires, ACL et activation RLS des tables | Identiques |
| Définitions, propriétaires et ACL des fonctions `authz` | Identiques |

La régression complète a ensuite été lancée **uniquement sur cette copie locale**, avec URLs explicitement dirigées vers `127.0.0.1` et base suffixée `_test` : **863 tests réussis**, 13 avertissements, **415,29 s**, sortie 0.

Les avertissements connus concernent Starlette/TestClient et Rasterio. Le scanner des fixtures documentaires reste synthétique. Aucun test destructif, test antivirus ou population fictive n’a été exécuté dans Neon.

## Ce qui est livré — et ce qui ne l’est pas

**PRÊT côté schéma DB** : installation 0007, PostGIS, rôles dédiés, contrôles et sauvegardes ponctuelles privées.

**À FINALISER** : intégration de Clerk développement, configuration et hébergement de l’application, coffre/antivirus, sandbox, observabilité et sauvegardes récurrentes. Les modules ne sont pas activés automatiquement et aucun service applicatif n’a été déployé sur la base.

**NON QUALIFIÉ par cette opération** : disponibilité/SLA, RPO/RTO de production, résidence contractuelle des données, chiffrement au repos ou de tous les liens internes Neon, plan de reprise complet du fournisseur. Le TLS client a été vérifié, pas toute l’infrastructure interne.

**Aucune soumission officielle EUDR. Aucun achat de ressource ou branche cloud supplémentaire.** Les connexions ont utilisé l’infrastructure existante, ce qui peut consommer son usage habituel ; aucun abonnement n’a été souscrit.

## Configuration privée et suite

Deux fichiers protégés hors dépôt ont été préparés : `neon-runtime.env` pour l’application et `neon-migrator.env` réservé aux migrations. Les valeurs sont entre quotes ; le chemin CA doit être adapté à l’hôte futur. Ne pas importer le secret migrateur dans le runtime ni dans le frontend.

Le fichier administratif fourni et la copie JSON transitoire des nouveaux mots de passe ont été supprimés après contrôle ; seules les deux configurations privées séparées restent disponibles. Après leur remise dans le canal de secrets retenu, supprimer les copies transitoires restantes et effectuer les rotations nécessaires. Le mot de passe administratif fourni peut être renouvelé séparément des deux nouveaux mots de passe. Ne pas révoquer ces nouveaux identifiants avant leur transfert, sauf à prévoir leur remplacement dans la configuration.

[Procédure Neon](../deploiement/neon.md). Preuves expurgées : `preuves-chantier-8/neon/migration-verifiee.json`, `postgres18-neuf-tests.txt`, `restauration-neon-tests.txt`. Dumps et secrets restent privés hors Git.

Les migrations SQL existantes n’ont pas été modifiées. La migration distante est réalisée ; la documentation/preuve ajoutée dans ce bloc est committée localement mais non poussée faute de nouveau token GitHub. Le changement de mode préexistant de `infra/bootstrap-db.sh` reste exclu. Le chantier 8 dans son ensemble demeure ouvert.
