"""Versioned parcels, tenant-bound lot provenance and supplier proposals."""

from pathlib import Path

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade():
    op.get_bind().exec_driver_sql(Path(__file__).with_suffix(".sql").read_text())


def downgrade():
    raise RuntimeError(
        "Destructive downgrade disabled; use a reviewed forward migration."
    )
