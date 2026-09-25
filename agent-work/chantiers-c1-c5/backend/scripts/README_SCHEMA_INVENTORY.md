# Inventaire de schéma PostgreSQL — lecture seule

Le script `inspect_postgres_schema.sql` collecte uniquement des métadonnées de schéma : versions serveur/PostGIS/Alembic, colonnes et types, contraintes, index et enums. Il ne lit pas de lignes métier et ne modifie ni schéma ni données.

Depuis une machine autorisée à joindre la base cible, avec `psql` installé :

```bash
psql "$PG_DSN" -X -v ON_ERROR_STOP=1 \
  -f backend/scripts/inspect_postgres_schema.sql \
  > schema_inventory.txt
```

- `PG_DSN` doit être injecté par le gestionnaire de secrets; ne le mettez pas dans le dépôt ni dans le rapport.
- Ne transmettez jamais le DSN, un mot de passe, un dump de données ou des lignes de tables.
- Le fichier `schema_inventory.txt` doit contenir uniquement le résultat de ce script; vérifiez-le avant partage.
- Si la base utilise un schéma autre que celui renvoyé par `current_schema()`, exécutez le script avec le `search_path` correspondant ou faites-le adapter par le DBA.
- L'inventaire ne modifie rien. Ne lancez pas `alembic upgrade`, `stamp`, `create_all` manuel ou SQL de migration sur la base cible avant d'avoir validé l'analyse de cet inventaire et effectué une sauvegarde.
