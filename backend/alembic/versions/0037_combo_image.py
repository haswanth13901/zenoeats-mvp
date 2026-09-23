"""A photo of the meal deal itself.

A combo borrowed a photograph from whichever item inside it had one, so the
card for "Burger Meal" showed a burger on its own -- never the tray the deal
actually is. It can now carry its own, like an item; without one it still
borrows, so nothing changes for a combo nobody photographs.

Revision ID: 0037
Revises: 0036
"""

import sqlalchemy as sa
from alembic import op

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("combos", sa.Column("image_path", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("combos", "image_path")
