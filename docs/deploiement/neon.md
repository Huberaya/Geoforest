# Neon — exploitation des migrations GeoForest

État au 29 septembre 2026 : **installation réelle effectuée avec autorisation** sur la base `neondb`, branche indiquée par l’utilisateur comme `Production`. Version Alembic `0007`, PostgreSQL 18.6, PostGIS 3.6.4. Le nom de branche n’a pas été contrôlé par l’API de gestion Neon ; la connexion à la base fournie a été vérifiée directement.

## Séparation des accès

- Le compte administratif fourni pour cette intervention possède BYPASSRLS et des droits de création ; **ne jamais l’utiliser comme compte applicatif**.
- `geoforest_migrator` : propriétaire des objets GeoForest ; création autorisée dans `public` et dans la base pour les migrations. Pas de SUPERUSER, BYPASSRLS, CREATEDB, CREATEROLE, REPLICATION ni appartenance à `neon_superuser`.
- `geoforest_app` : rôle runtime ; aucun de ces privilèges élevés, aucune appartenance au migrateur ou à `neon_superuser`, aucun droit CREATE dans `public`, non propriétaire des tables.
- Les deux mots de passe sont différents, générés aléatoirement et stockés uniquement dans des fichiers privés hors dépôt. Les droits de lecture/écriture applicatifs proviennent des migrations, pas d’un rôle administrateur Neon.

Les ACL contrôlées après installation n’autorisent notamment pas UPDATE/DELETE au runtime sur audit, décisions de diligence, revues documentaires ou analyses forestières. Les révisions de diligence ont un workflow UPDATE contrôlé par trigger ; ne pas les présenter comme des tables sans aucun droit UPDATE.

## Connexions et TLS

L’URL initiale était poolée. La connexion directe correspondante a été vérifiée et utilisée pour le dump, le provisionnement, Alembic et les contrôles. Les fichiers générés pour cette installation utilisent également la connexion directe ; l’usage poolé en exploitation reste à qualifier séparément.

Options utilisées : `sslmode=verify-full`, `sslrootcert` pointant vers le bundle CA système, `channel_binding=require`, `connect_timeout=15`. La CA doit exister dans l’image/hôte de destination. Ne pas désactiver la vérification du certificat pour contourner une erreur de packaging.

La vue `pg_stat_ssl` derrière le proxy n’est pas une preuve du handshake client ; le TLS client a été confirmé par le pilote. Cette recette ne qualifie pas le chiffrement au repos ni tous les liens internes du fournisseur.

## Particularité Neon rencontrée

Le plan de contrôle a refusé une création de rôle recevant un vérificateur SCRAM pré-calculé : il exige un **mot de passe d’entrée en clair dans la commande de provisionnement**. La transaction concernée a été annulée ; absence d’extension/rôles dédiés vérifiée avant la reprise.

La création a ensuite été effectuée via la connexion TLS vérifiée avec des mots de passe générés, sans journaliser les commandes ni afficher les valeurs. Ne pas copier ces commandes sensibles dans les logs, une issue, un historique shell partagé ou Git. Il ne s’agit pas d’une connexion réseau non chiffrée ; le stockage interne des secrets du fournisseur n’a pas été audité.

## Installation réalisée

1. Recette locale PostgreSQL 18.6/PostGIS 3.6.4 : migrations neuves, répétition sans effet, régression complète.
2. Nouvel inventaire distant en lecture seule : aucun objet relationnel utilisateur, aucune fonction utilisateur dans `public`, aucun grand objet ; absence des deux rôles dédiés et d’Alembic. Aucun autre client actif détecté au moment du contrôle, sans prétendre bloquer tous les accès futurs à la console.
3. Dump préalable privé ; restauration locale isolée avec noms de propriétaires et instructions ACL conservés.
4. Provisionnement autorisé de PostGIS et des deux rôles ; retrait du droit CREATE public ; vérification des privilèges et connexions dédiées.
5. `alembic upgrade head` avec le **migrateur**, puis deuxième passage sans nouvelle migration.
6. Contrôles réels de version, propriétaires, RLS, droits, compteurs et fonction géographique. Aucune insertion de recette dans Neon.
7. Dump après migration, restauration locale, comparaison du schéma/contenu/droits puis régression complète **sur la copie locale uniquement**.
8. Dernier contrôle distant en lecture seule : zéro ligne métier, sept références de commodités, version 0007.

## Rejouer une migration ultérieure

Ne pas relancer un script d’initialisation de rôles sur la base déjà installée. Ne pas remplacer les mots de passe existants implicitement. Revoir les nouvelles migrations, préserver un point de retour et planifier les accès avant chaque évolution.

Fournir `MIGRATION_DATABASE_URL` depuis un fichier privé ou un gestionnaire de secrets, puis :

```sh
.venv/bin/alembic -c backend/alembic.ini current
.venv/bin/alembic -c backend/alembic.ini upgrade head
.venv/bin/alembic -c backend/alembic.ini current
```

Ces commandes sont une procédure, pas une autorisation permanente d’appliquer une future migration en Production. Ne jamais lancer `alembic stamp head` pour masquer une migration non exécutée.

Le runtime ne doit recevoir que son propre `DATABASE_URL` ; ne pas lui injecter le mot de passe migrateur. Les fichiers `.env` préparés ont des valeurs entre quotes et sont hors dépôt. Les copier dans le canal de secrets de l’hébergement retenu, pas dans le frontend ou une variable `NEXT_PUBLIC_*`.

## Tests et retour arrière

**Ne jamais lancer pytest sur la base Neon Production.** Les fixtures tronquent les données de test ; les suffixes `_test` et les URLs locales sont des garde-fous, pas une invitation à renommer la production. Pour cette recette, deux bases PostgreSQL 18 locales distinctes ont reçu les tests.

Les dumps avant/après restent privés. Les fichiers de dump ne contiennent pas les mots de passe des rôles ; les rôles, secrets et attributs doivent être gérés séparément lors d’une reprise. La restauration locale a rétabli propriétaires, ACL et politiques des objets, mais ne reproduit pas le plan de contrôle Neon ni toutes ses propriétés internes.

En cas d’incident : interrompre les écritures, analyser l’état committé, préférer une correction revue ou une restauration vers une cible distincte. **Aucune suppression automatique de PostGIS, schémas, tables ou rôles** n’est fournie. Ne pas écraser une base qui aurait reçu de nouvelles données après cette intervention.

## Reste hors de cette opération

- Recette humaine Clerk développement et qualification ultérieure de production. Le [raccordement local](clerk-developpement.md) est développé/testé mais interdit avec Neon Production.
- Mise en service de l’application, activation des modules et provisionnement du coffre documentaire/antivirus.
- Qualification de l’hébergement applicatif, MFA/TLS de production, egress/sandbox, supervision, sauvegardes récurrentes, RPO/RTO et contrat/résidence des données Neon.
- Connecteur officiel EUDR et fonctionnalités différées des chantiers précédents.

La migration réussie n’équivaut ni au déploiement du SaaS ni à une validation réglementaire. Voir le [rapport de l’intervention](../rapports/08b-neon-migrations.md).
