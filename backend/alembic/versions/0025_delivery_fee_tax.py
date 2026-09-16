"""Whether a delivery fee is taxed, for restaurants on a flat rate.

Delivery charges are taxable in some US states and not in others, and can
depend on whether the goods themselves are taxable. There is no answer that is
right for every restaurant on the platform, so this is the restaurant's to
set, next to the flat rate it already sets for the same reason.

Restaurants on Stripe Tax do not use it: Stripe is told the shipping amount and
decides taxability for the jurisdiction itself, which is the whole point of
being on Stripe Tax.

Default false. A fee taxed that should not have been is money taken from a
customer who did not owe it; a fee untaxed that should have been is a
liability the restaurant can settle. Neither is good, and the second is the
one a restaurant can put right.

Revision ID: 0025
Revises: 0024
"""

import sqlalchemy as sa
from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "restaurants",
        sa.Column(
            "delivery_fee_taxable", sa.Boolean(), nullable=False, server_default=sa.false()
        ),
    )


def downgrade() -> None:
    op.drop_column("restaurants", "delivery_fee_taxable")
