"""A customer's name, phone and address, required to order.

Two places, for two different reasons.

On users, as the customer's saved details: what checkout fills in next time,
and what a profile page will edit. Nullable, because every customer who
ordered before this has none, and a guest row minted before checkout has not
been asked yet. Checkout is what makes them mandatory, not the column.

On orders, as a snapshot: who to call and what name to shout for this order,
exactly as it was given. Same reasoning as every other snapshot on an order --
a customer who moves house next month must not rewrite where last month's
delivery went, and a restaurant looking back at a complaint needs the number
the customer gave at the time. Nullable, because orders before this carry
none.

The delivery address already has a column on orders (0019); for a delivery it
is the snapshot. A collection keeps only the phone and name.

Revision ID: 0028
Revises: 0027
"""

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(32), nullable=True))
    op.add_column("users", sa.Column("address", sa.String(300), nullable=True))
    op.add_column("orders", sa.Column("contact_name", sa.String(160), nullable=True))
    op.add_column("orders", sa.Column("contact_phone", sa.String(32), nullable=True))


def downgrade() -> None:
    op.drop_column("orders", "contact_phone")
    op.drop_column("orders", "contact_name")
    op.drop_column("users", "address")
    op.drop_column("users", "phone")
