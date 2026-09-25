-- GeoForest Trace: inventaire READ-ONLY du schéma PostgreSQL courant.
-- Ne lit aucune ligne métier et ne modifie ni schéma ni données.
-- À exécuter par l'équipe DBA sur la base cible avant de générer/stamper une migration.

\echo '=== Base, schéma, version PostgreSQL ==='
SELECT current_database() AS database_name,
       current_schema() AS schema_name,
       current_setting('server_version') AS server_version;

\echo '=== Extension PostGIS ==='
SELECT extname AS extension_name, extversion AS extension_version
FROM pg_extension
WHERE extname = 'postgis';

\echo '=== Présence et versions Alembic (NOTICE) ==='
DO $$
DECLARE
    version_table_schema text;
    version_values text;
BEGIN
    SELECT table_schema
      INTO version_table_schema
      FROM information_schema.tables
     WHERE table_schema = current_schema()
       AND table_name = 'alembic_version'
       AND table_type = 'BASE TABLE';

    IF version_table_schema IS NULL THEN
        RAISE NOTICE 'alembic_version: ABSENTE dans le schéma courant';
    ELSE
        EXECUTE format(
            'SELECT string_agg(version_num, '', '' ORDER BY version_num) FROM %I.alembic_version',
            version_table_schema
        ) INTO version_values;
        RAISE NOTICE 'alembic_version dans %: %',
            version_table_schema,
            COALESCE(version_values, '<table présente, aucune révision>');
    END IF;
END $$;

\echo '=== Tables et colonnes (sans données) ==='
SELECT c.table_schema,
       c.table_name,
       c.ordinal_position,
       c.column_name,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       c.column_default,
       c.character_maximum_length,
       c.numeric_precision,
       c.numeric_scale,
       c.datetime_precision
FROM information_schema.columns AS c
JOIN information_schema.tables AS t
  ON t.table_schema = c.table_schema
 AND t.table_name = c.table_name
WHERE c.table_schema = current_schema()
  AND t.table_type = 'BASE TABLE'
  AND c.table_name <> 'alembic_version'
ORDER BY c.table_name, c.ordinal_position;

\echo '=== Contraintes PK, FK, UNIQUE, CHECK et EXCLUDE ==='
SELECT ns.nspname AS schema_name,
       tbl.relname AS table_name,
       con.conname AS constraint_name,
       CASE con.contype
           WHEN 'p' THEN 'PRIMARY KEY'
           WHEN 'f' THEN 'FOREIGN KEY'
           WHEN 'u' THEN 'UNIQUE'
           WHEN 'c' THEN 'CHECK'
           WHEN 'x' THEN 'EXCLUDE'
           ELSE con.contype::text
       END AS constraint_type,
       pg_get_constraintdef(con.oid, true) AS definition
FROM pg_constraint AS con
JOIN pg_class AS tbl ON tbl.oid = con.conrelid
JOIN pg_namespace AS ns ON ns.oid = tbl.relnamespace
WHERE ns.nspname = current_schema()
  AND con.contype IN ('p', 'f', 'u', 'c', 'x')
ORDER BY tbl.relname, con.conname;

\echo '=== Index (définition uniquement) ==='
SELECT schemaname AS schema_name,
       tablename AS table_name,
       indexname AS index_name,
       indexdef AS definition
FROM pg_indexes
WHERE schemaname = current_schema()
ORDER BY tablename, indexname;

\echo '=== Types ENUM ==='
SELECT n.nspname AS schema_name,
       t.typname AS enum_name,
       string_agg(e.enumlabel, ', ' ORDER BY e.enumsortorder) AS labels
FROM pg_type AS t
JOIN pg_enum AS e ON e.enumtypid = t.oid
JOIN pg_namespace AS n ON n.oid = t.typnamespace
WHERE n.nspname = current_schema()
GROUP BY n.nspname, t.typname
ORDER BY t.typname;
