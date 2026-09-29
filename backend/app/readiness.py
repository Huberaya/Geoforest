"""Deployment gates, not a substitute for a DBA audit or isolation tests."""

from sqlalchemy import text

RLS_TABLES = (
    "organizations",
    "memberships",
    "audit_events",
    "suppliers",
    "supplier_contacts",
    "products",
    "product_commodities",
    "supplier_products",
    "lots",
    "supplier_collections",
    "supplier_imports",
    "supplier_invitations",
    "supplier_sessions",
    "collection_revisions",
    "plots",
    "plot_geolocations",
    "lot_plots",
    "plot_imports",
    "plot_proposals",
    "plot_proposal_revisions",
    "country_checks",
    "forest_analyses",
    "documents",
    "document_versions",
    "document_reviews",
    "legality_assessments",
    "risk_assessments",
    "compliance_tasks",
    "notification_outbox",
    "diligence_dossiers",
    "diligence_revisions",
    "diligence_decisions",
)


class UnsafeRuntimeDatabase(RuntimeError):
    """Fixed public message; never expose role names, DSNs or catalog details."""


def verify_runtime_database(conn):
    dangerous = conn.execute(
        text("""
      SELECT EXISTS (
        SELECT 1 FROM pg_roles r
        WHERE (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb)
        AND pg_has_role(current_user,r.oid,'MEMBER')
      ) OR EXISTS (
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p')
        AND pg_has_role(current_user,c.relowner,'MEMBER')
      ) OR has_schema_privilege(current_user,'public','CREATE')
    """)
    ).scalar_one()
    rows = (
        conn.execute(
            text("""
      SELECT c.relname,c.relrowsecurity,EXISTS(
        SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid
      ) AS has_policy
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=ANY(:names) AND c.relkind IN ('r','p')
    """),
            {"names": list(RLS_TABLES)},
        )
        .mappings()
        .all()
    )
    if (
        dangerous
        or len(rows) != len(RLS_TABLES)
        or any(
            not r["relrowsecurity"]
            or (not r["has_policy"] and r["relname"] != "supplier_sessions")
            for r in rows
        )
    ):
        raise UnsafeRuntimeDatabase("Database isolation configuration is not ready")


def verify_ready_connection(conn):
    verify_runtime_database(conn)
    version = conn.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
    postgis = conn.execute(text("SELECT postgis_version()")).scalar_one()
    if version != "0007" or not postgis:
        raise UnsafeRuntimeDatabase("Database schema is not ready")
    return {"status": "ok", "migration": version, "postgis": bool(postgis)}
