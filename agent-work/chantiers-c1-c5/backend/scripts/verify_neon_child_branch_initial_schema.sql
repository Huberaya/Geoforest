-- READ-ONLY validation after applying revision 20260925_0001.
-- First confirm in the Neon UI that the selected branch is the disposable child,
-- not `production`; PostgreSQL SQL does not verify the Neon control-plane branch.
-- This query reads catalog metadata only; it does not inspect application rows or write data.
WITH expected_tables(table_name) AS (
    VALUES
        ('organizations'),
        ('users'),
        ('alerts'),
        ('suppliers'),
        ('supplier_invitations'),
        ('products'),
        ('shipments'),
        ('plots'),
        ('audit_events')
),
expected_enums(enum_name) AS (
    VALUES
        ('productstatus'),
        ('suppliertype'),
        ('supplierstatus'),
        ('supplierriskrating'),
        ('shipmentstatus'),
        ('userrole'),
        ('alertlevel'),
        ('alertcategory'),
        ('plotsource'),
        ('plotstatus')
),
expected_jsonb_columns(table_name, column_name) AS (
    VALUES
        ('alerts', 'context'),
        ('audit_events', 'previous_data'),
        ('audit_events', 'new_data'),
        ('plots', 'geometry'),
        ('plots', 'centroid'),
        ('plots', 'bbox'),
        ('plots', 'validation_errors'),
        ('plots', 'validation_warnings')
),
actual_enums AS (
    SELECT
        typ.typname::text AS enum_name,
        array_agg(en.enumlabel::text ORDER BY en.enumsortorder) AS labels
    FROM pg_type AS typ
    JOIN pg_enum AS en ON en.enumtypid = typ.oid
    JOIN pg_namespace AS ns ON ns.oid = typ.typnamespace
    WHERE ns.nspname = current_schema()
      AND typ.typname IN (SELECT enum_name FROM expected_enums)
    GROUP BY typ.typname
),
actual_jsonb_columns AS (
    SELECT
        cls.relname::text AS table_name,
        att.attname::text AS column_name
    FROM pg_attribute AS att
    JOIN pg_class AS cls ON cls.oid = att.attrelid
    JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
    WHERE ns.nspname = current_schema()
      AND cls.relkind = 'r'
      AND att.attnum > 0
      AND NOT att.attisdropped
      AND att.atttypid = 'jsonb'::regtype
      AND cls.relname IN ('alerts', 'audit_events', 'plots')
)
SELECT jsonb_pretty(
    jsonb_build_object(
        'database', current_database(),
        'schema', current_schema(),
        'server_version', current_setting('server_version'),
        'search_path', current_setting('search_path'),
        'alembic_versions', (
            SELECT COALESCE(jsonb_agg(version_num ORDER BY version_num), '[]'::jsonb)
            FROM alembic_version
        ),
        'application_table_count', (
            SELECT count(*)
            FROM information_schema.tables AS tbl
            JOIN expected_tables AS exp ON exp.table_name = tbl.table_name
            WHERE tbl.table_schema = current_schema()
              AND tbl.table_type = 'BASE TABLE'
        ),
        'missing_application_tables', (
            SELECT COALESCE(jsonb_agg(exp.table_name ORDER BY exp.table_name), '[]'::jsonb)
            FROM expected_tables AS exp
            WHERE NOT EXISTS (
                SELECT 1
                FROM information_schema.tables AS tbl
                WHERE tbl.table_schema = current_schema()
                  AND tbl.table_type = 'BASE TABLE'
                  AND tbl.table_name = exp.table_name
            )
        ),
        'unexpected_base_tables', (
            SELECT COALESCE(jsonb_agg(tbl.table_name ORDER BY tbl.table_name), '[]'::jsonb)
            FROM information_schema.tables AS tbl
            WHERE tbl.table_schema = current_schema()
              AND tbl.table_type = 'BASE TABLE'
              AND tbl.table_name <> 'alembic_version'
              AND NOT EXISTS (
                  SELECT 1 FROM expected_tables AS exp WHERE exp.table_name = tbl.table_name
              )
        ),
        'named_application_indexes_ix', (
            SELECT count(*)
            FROM pg_indexes AS idx
            WHERE idx.schemaname = current_schema()
              AND idx.tablename IN (SELECT table_name FROM expected_tables)
              AND left(idx.indexname, 3) = 'ix_'
        ),
        'physical_indexes_on_application_tables', (
            SELECT count(*)
            FROM pg_indexes AS idx
            WHERE idx.schemaname = current_schema()
              AND idx.tablename IN (SELECT table_name FROM expected_tables)
        ),
        'foreign_key_count', (
            SELECT count(*)
            FROM pg_constraint AS con
            JOIN pg_class AS cls ON cls.oid = con.conrelid
            JOIN pg_namespace AS ns ON ns.oid = cls.relnamespace
            WHERE con.contype = 'f'
              AND ns.nspname = current_schema()
              AND cls.relname IN (SELECT table_name FROM expected_tables)
        ),
        'missing_enum_types', (
            SELECT COALESCE(jsonb_agg(exp.enum_name ORDER BY exp.enum_name), '[]'::jsonb)
            FROM expected_enums AS exp
            WHERE NOT EXISTS (
                SELECT 1 FROM actual_enums AS act WHERE act.enum_name = exp.enum_name
            )
        ),
        'unexpected_enum_types', (
            SELECT COALESCE(jsonb_agg(typ.typname::text ORDER BY typ.typname::text), '[]'::jsonb)
            FROM pg_type AS typ
            JOIN pg_namespace AS ns ON ns.oid = typ.typnamespace
            WHERE ns.nspname = current_schema()
              AND typ.typtype = 'e'
              AND NOT EXISTS (
                  SELECT 1 FROM expected_enums AS exp WHERE exp.enum_name = typ.typname::text
              )
        ),
        'actual_enum_types_and_labels', (
            SELECT COALESCE(
                jsonb_agg(jsonb_build_object('name', act.enum_name, 'labels', act.labels)
                          ORDER BY act.enum_name),
                '[]'::jsonb
            )
            FROM actual_enums AS act
        ),
        'jsonb_column_count', (SELECT count(*) FROM actual_jsonb_columns),
        'missing_expected_jsonb_columns', (
            SELECT COALESCE(
                jsonb_agg(exp.table_name || '.' || exp.column_name
                          ORDER BY exp.table_name, exp.column_name),
                '[]'::jsonb
            )
            FROM expected_jsonb_columns AS exp
            WHERE NOT EXISTS (
                SELECT 1
                FROM actual_jsonb_columns AS act
                WHERE act.table_name = exp.table_name
                  AND act.column_name = exp.column_name
            )
        ),
        'actual_jsonb_columns', (
            SELECT COALESCE(
                jsonb_agg(col.table_name || '.' || col.column_name ORDER BY col.table_name, col.column_name),
                '[]'::jsonb
            )
            FROM actual_jsonb_columns AS col
        ),
        'postgis_extension_installed', (
            SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')
        )
    )
) AS migration_validation;
