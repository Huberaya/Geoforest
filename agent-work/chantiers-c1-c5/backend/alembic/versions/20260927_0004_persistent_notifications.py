"""Add recipient-specific notification state and event idempotency.

Revision ID: 20260927_0004
Revises: 20260927_0003
Create Date: 2026-09-27

Additive only. Existing Alert.is_read values remain the fallback for legacy rows;
no live database is written by this migration file or its offline validation.
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20260927_0004"
down_revision = "20260927_0003"
branch_labels = None
depends_on = None

UUID = sa.String(length=36)
NOW = sa.text("now()")


def upgrade() -> None:
    op.add_column("alerts", sa.Column("dedupe_key", sa.String(length=180), nullable=True))
    op.create_unique_constraint(
        "uq_alerts_org_dedupe_key",
        "alerts",
        ["organization_id", "dedupe_key"],
    )
    op.create_index(
        "ix_alerts_org_created_at", "alerts", ["organization_id", "created_at"], unique=False
    )
    op.create_index(
        "ix_alerts_org_user_created_at",
        "alerts",
        ["organization_id", "user_id", "created_at"],
        unique=False,
    )
    op.create_table(
        "alert_recipient_states",
        sa.Column("alert_id", UUID, nullable=False),
        sa.Column("user_id", UUID, nullable=False),
        sa.Column("is_read", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=NOW, nullable=False),
        sa.ForeignKeyConstraint(["alert_id"], ["alerts.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("alert_id", "user_id"),
    )
    op.create_index(
        "ix_alert_recipient_states_user_read",
        "alert_recipient_states",
        ["user_id", "is_read"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_alert_recipient_states_user_read", table_name="alert_recipient_states")
    op.drop_table("alert_recipient_states")
    op.drop_index("ix_alerts_org_user_created_at", table_name="alerts")
    op.drop_index("ix_alerts_org_created_at", table_name="alerts")
    op.drop_constraint("uq_alerts_org_dedupe_key", "alerts", type_="unique")
    op.drop_column("alerts", "dedupe_key")
