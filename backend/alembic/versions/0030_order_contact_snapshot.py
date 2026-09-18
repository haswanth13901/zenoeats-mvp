"""Keep receipt email and contact address on the order, independent of profile edits.

Revision ID: 0030
Revises: 0029
"""
import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("orders", sa.Column("contact_email", sa.String(320), nullable=True))
    op.add_column("orders", sa.Column("contact_address", sa.String(300), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "contact_address")
    op.drop_column("orders", "contact_email")
