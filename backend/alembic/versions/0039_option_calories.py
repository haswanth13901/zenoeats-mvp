"""What a choice adds, in calories.

An item states what it contains as it comes; a size or an extra states what
it changes that by, the same way it states what it changes the price by.
Large fries are not a second dish -- they are the same dish with 230 more
calories, and one number on the option says so for every item that offers
the group.

May be negative: "no cheese" takes calories off exactly as it takes money
off. Null means the restaurant has not stated a change, which is counted as
none -- unlike an item, where null means the whole figure is unknown.

Revision ID: 0039
Revises: 0038
"""

import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("modifier_options", sa.Column("calories_delta", sa.Integer(), nullable=True))
    op.create_check_constraint(
        "ck_option_calories_delta_sane",
        "modifier_options",
        "calories_delta IS NULL OR calories_delta BETWEEN -20000 AND 20000",
    )


def downgrade() -> None:
    op.drop_constraint("ck_option_calories_delta_sane", "modifier_options", type_="check")
    op.drop_column("modifier_options", "calories_delta")
