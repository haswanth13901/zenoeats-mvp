"""Items a restaurant does not charge sales tax on.

Most of a menu is taxed as prepared food, but not all of it: bottled water,
a bag of coffee beans to take home, or anything else the restaurant's state
treats differently. A single rate per restaurant cannot say that, so the item
carries it.

Default false, so every existing item keeps being taxed exactly as it was.

Revision ID: 0027
Revises: 0026
"""

import sqlalchemy as sa
from alembic import op

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "menu_items",
        sa.Column("tax_exempt", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("menu_items", "tax_exempt")
