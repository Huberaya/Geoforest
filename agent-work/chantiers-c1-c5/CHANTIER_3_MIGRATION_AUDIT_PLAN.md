# Chantier 3 — Audit et préparation des migrations PostgreSQL

**Date : 25 septembre 2026**  
**Étape : audit terminé; plan validé; migration initiale préparée localement. Test réel Neon en attente d'un accès sécurisé.**

## 1. Cadrage confirmé

La cible confirmée par l'utilisateur est le projet Neon `sparkling-brook-79507514`, branche `br-delicate-brook-b1h226a9` (`production`), base `neondb`. L'utilisateur a autorisé une migration initiale et un test sur une **branche Neon enfant**, sans écriture sur `production`.

Inventaire read-only exécuté dans l'éditeur SQL Neon par l'utilisateur :

- PostgreSQL `18.6 (6569466)`; schéma utilisateur `public`; `search_path` `"$user", public`.
- Aucune relation applicative, colonne, contrainte, index, enum, ni table `alembic_version` dans les schémas utilisateur.
- Aucune extension PostGIS installée; `USAGE` et `CREATE` sont accordés sur `public`.
- La cible `production` vide est volontairement la bonne base. Cette confirmation ne vaut pas autorisation d'y écrire.

L'agent n'a ni clé/API Neon ni DSN injecté par un mécanisme de secrets, et ne peut donc pas créer la branche enfant ni ouvrir une connexion PostgreSQL. Les IDs projet/branche ne sont pas des identifiants d'accès. Aucun mot de passe/jeton/DSN ne doit être envoyé dans le chat.

## 2. Audit du schéma applicatif

`Base.metadata` charge neuf tables : `organizations`, `users`, `alerts`, `suppliers`, `supplier_invitations`, `products`, `shipments`, `plots`, `audit_events`. Le schéma porte 31 index SQLAlchemy et 10 types enum PostgreSQL.

Points de correspondance et de décision :

- Le champ `Plot.geometry` et les champs géographiques associés sont en JSONB sous PostgreSQL; les recherches n'ont trouvé aucun appel SQL `ST_*`, ni colonne SQLAlchemy `Geometry`/`Geography`. Le traitement spatial observé est côté application. **PostGIS n'est donc pas requis par le schéma actuel** et n'est pas créé par la révision initiale.
- Le type applicatif `UUIDType` compile actuellement en `VARCHAR(36)` PostgreSQL (malgré un ancien commentaire qui indiquait UUID natif). La révision reproduit le type effectif du modèle; elle ne change pas cette représentation.
- La révision initiale inclut `supplier_invitations`, car la cible est vierge et cette table fait partie des modèles actuels. Il n'y a donc pas de révision additive portail séparée pour cette cible.
- Le champ historique `suppliers.invite_token` reste inclus, car il est toujours présent dans le modèle. Il n'existe aucune donnée cible à purger; sa suppression/rotation éventuelle relève d'une évolution distincte après revue du code.
- Le modèle `AuditEvent` porte acteur, action, objet, date, IP, données précédente/nouvelle. Son immutabilité est actuellement protégée par des écouteurs ORM; elle n'est pas garantie par un mécanisme PostgreSQL contre les écritures directes ou une suppression en cascade. Ce risque n'est pas silencieusement corrigé dans la baseline.

## 3. Plan validé

1. Créer une baseline Alembic fraîche pour les neuf tables/modèles actuels, sans `stamp`, purge de données, `CREATE EXTENSION` ni écriture en production.
2. Garder le fichier de migration figé et autonome : pas d'import du `Base.metadata` vivant à l'exécution de la révision.
3. Générer le SQL PostgreSQL en mode offline, inspecter l'ordre des FK/index/enums et vérifier aussi la génération de downgrade.
4. Tester le `upgrade` réel sur une branche Neon enfant uniquement; vérifier ensuite les objets installés et la révision Alembic par des requêtes read-only. Ne pas toucher à `production`.
5. Avant toute future application sur `production`, obtenir une approbation distincte et confirmer une sauvegarde/branche de retour arrière.

## 4. Modifications locales préparées

- `backend/alembic/versions/20260925_0001_initial_schema.py` : baseline avec les neuf tables, les index et les enums courants; downgrade explicite des enums PostgreSQL.
- `backend/scripts/neon_child_branch_initial_upgrade.sql` : SQL offline exact de l'upgrade, marqué test-only; il a été exécuté dans un PostgreSQL embarqué PGlite 18.3, mais pas sur Neon.
- `backend/scripts/verify_neon_child_branch_initial_schema.sql` et `backend/scripts/README_NEON_CHILD_BRANCH_TEST.md` : vérification read-only et runbook de branche enfant; le runbook précise que l'identité de branche doit être confirmée dans l'interface Neon et ne prétend pas qu'une requête SQL générique peut la certifier.
- `backend/alembic/env.py` et `backend/alembic.ini` : URL de migration exigée via `DATABASE_URL`; retrait du DSN de secours codé en dur.
- `backend/app/core/database.py` et `backend/app/main.py` : suppression de la création silencieuse des extensions/tables au démarrage. Le démarrage vérifie maintenant, en lecture seule, que la base est au head Alembic; il échoue explicitement si la migration manque ou si la base n'est pas à jour.
- `docker-compose.yml` et `README.md` : migrations exécutées avant le serveur dans le compose local et dans les instructions de développement; documentation alignée sur l'absence de besoin PostGIS actuellement.

Ces changements sont dans la copie applicative additive `agent-work/chantiers-c1-c5`; ils ne constituent ni un déploiement de l'application historique à la racine, ni une validation de production.

## 5. Tests et limites

### Vérifications locales

Le SQL Alembic PostgreSQL a été compilé en mode offline avec une URL factice, sans connexion réseau : upgrade avec 9 tables applicatives + `alembic_version`, 10 enums, 31 index, 16 FK; aucune création de PostGIS. Le downgrade compilé supprime tables/index et les 10 enums.

Un test d'exécution a ensuite utilisé **PGlite, moteur PostgreSQL embarqué version 18.3** : upgrade, exécution du contrôle read-only, vérification des 9 tables/31 index nommés/43 index physiques/16 FK/10 enums/8 colonnes JSONB et de la révision, downgrade sans objets applicatifs restants, puis nouvel upgrade. Le cycle complet a réussi. Aucun serveur PostgreSQL distant n'a été sollicité. Les deux tests Alembic offline dédiés passent; la suite backend complète passe : **87 tests réussis** (238 avertissements de dépréciation préexistants dans passlib/python-jose/pytest-asyncio). Le SQL de migration et le script de vérification ont aussi passé un contrôle syntaxique PostgreSQL par `pglast`.

PGlite valide l'exécution DDL sur un moteur PostgreSQL, mais **ne remplace pas un test sur la branche Neon**, ne vérifie ni les privilèges/limites de l'offre Neon, ni le réseau TLS/pooler, ni le comportement du serveur Neon PostgreSQL 18.6.

### Non exécuté

- Aucun `alembic upgrade`, `stamp`, `create_all`, requête d'écriture ou changement de schéma sur Neon.
- Aucune branche enfant Neon créée; aucun test réel sur le service Neon ou PostgreSQL 18.6 distant.
- Aucune écriture sur la branche `production`.

## 6. Risques et suites

1. **Blocage principal :** accès sécurisé à Neon absent dans cette session agent. Il faut un mécanisme d'intégration/secrets utilisable par l'agent pour créer et joindre une branche enfant; ne pas transmettre le secret dans le chat.
2. **Risque de portée :** la baseline reflète le modèle actuel, y compris `invite_token` historique. Toute suppression doit être une révision dédiée avec revue des usages.
3. **Audit trail :** l'immutabilité ORM seule n'empêche pas une modification SQL directe; le FK `organization_id ON DELETE CASCADE` pourrait aussi effacer des événements. Décision de politique/audit à traiter séparément avant usage réglementaire en production.
4. **Multi-tenant :** cette migration crée les FK/index du modèle mais n'ajoute pas de RLS PostgreSQL; l'isolation doit être démontrée dans les routes/services et faire l'objet de tests inter-tenant.
5. **PostGIS :** absent de la baseline, car aucune dépendance spatiale PostgreSQL n'a été trouvée. Si une fonctionnalité future introduit des requêtes spatiales SQL, une migration distincte et un test Neon devront l'ajouter.
6. Le downgrade initial détruit toutes les tables créées par cette révision; il ne doit être utilisé que sur une branche de test jetable ou après une sauvegarde vérifiée.

## 7. Rapport d'étape

**FAIT :** inventaire Neon confirmé vide; plan initial validé; audit des neuf modèles; baseline Alembic préparée; configuration Alembic sans DSN intégré; arrêt de la mutation implicite au démarrage; compilation offline upgrade/downgrade; cycle upgrade → vérification → downgrade → upgrade exécuté avec succès sur PGlite/PostgreSQL embarqué 18.3; kit de branche enfant prêt (SQL d'upgrade, contrôle read-only, runbook), sans secret intégré.

**NON FAIT :** test réel sur branche Neon enfant; vérification des privilèges/types/extensions sur cette branche; application sur `production` (non autorisée); test de déploiement de la copie applicative.

**PROBLÈMES :** aucune connexion Neon sécurisée disponible dans l'environnement agent; aucun client ou serveur PostgreSQL distant/local natif; PGlite n'est qu'une validation locale embarquée, pas un accès Neon.

**RISQUES :** limites détaillées à la section 6, en particulier absence de test sur le service Neon/PG 18.6 distant, `invite_token` historique, garanties d'immutabilité de l'audit et isolation multi-tenant.

**PROCHAINE ÉTAPE :** permettre un accès Neon via un mécanisme de secrets/intégration sécurisé compatible avec l'agent. L'étape suivante sera de créer une branche enfant jetable, exécuter `alembic upgrade head` uniquement sur cette branche, puis vérifier le schéma installé en read-only. La branche `production` restera intacte.
