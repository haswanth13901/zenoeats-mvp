"""What a dish contains, in calories.

Optional, and null rather than zero when a restaurant has not worked it out:
"no figure" and "nothing in it" are different claims, and a customer reading
a menu should never be shown the second when the first is true.

Revision ID: 0038
Revises: 0037
"""

import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("menu_items", sa.Column("calories", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_item_calories_sane", "menu_items", "calories IS NULL OR calories BETWEEN 0 AND 20000"
    )


def downgrade() -> None:
    op.drop_constraint("ck_item_calories_sane", "menu_items", type_="check")
    op.drop_column("menu_items", "calories")
