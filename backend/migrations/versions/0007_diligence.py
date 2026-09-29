"""Immutable diligence revisions and internal decisions, not official submissions."""

from pathlib import Path

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.get_bind().exec_driver_sql(Path(__file__).with_suffix(".sql").read_text())


def downgrade():
    raise RuntimeError(
        "Destructive downgrade forbidden: use a reviewed forward migration"
    )
