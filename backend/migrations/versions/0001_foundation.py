"""Identity, tenant authorization and append-only events. Extensions/roles are provisioned separately."""

from pathlib import Path

from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.get_bind().exec_driver_sql(Path(__file__).with_suffix(".sql").read_text())


def downgrade():
    raise RuntimeError(
        "Destructive downgrade disabled: restore a tested backup or write a reviewed forward migration."
    )
