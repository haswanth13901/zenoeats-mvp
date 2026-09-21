"""What a delivery cost, kept on the order that paid it.

An order already knows it is a delivery and where it went (0019). It did not
know what the delivery was charged for, because until now nothing charged for
one: a manager handed an already-paid collection to a driver.

Two facts, both ours to keep. The fee, because it is money the customer paid
and a receipt has to be able to explain it. The distance, because it is what
chose the fee, and "why was I charged $7" is a question someone will ask a
year from now when the rings have been redrawn twice.

Deliberately not the ring's id. Rings are replaced as a set whenever a
restaurant edits them, so a foreign key to one would dangle by the next save.
The distance and the amount are what actually happened; the ring was only the
rule that applied at the time.

Coordinates are deliberately absent too. They are borrowed from a geocoding
provider under terms that allow caching rather than keeping, and nothing here
needs them once the distance is known.

Revision ID: 0026
Revises: 0025
"""

import sqlalchemy as sa
from alembic import op

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column(
            "delivery_fee_minor", sa.BigInteger(), nullable=False, server_default="0"
        ),
    )
    op.add_column("orders", sa.Column("delivery_miles", sa.Float(), nullable=True))
    op.create_check_constraint(
        "ck_order_delivery_fee", "orders", "delivery_fee_minor >= 0"
    )
    # A collection cannot have been charged for delivery. Nothing in the
    # application would do it, which is exactly why it is worth a constraint:
    # the mistake it guards against is a future refactor, not today's code.
    op.create_check_constraint(
        "ck_order_delivery_fee_needs_delivery",
        "orders",
        "delivery_fee_minor = 0 OR fulfillment_type = 'DELIVERY'",
    )


def downgrade() -> None:
    op.drop_constraint("ck_order_delivery_fee_needs_delivery", "orders", type_="check")
    op.drop_constraint("ck_order_delivery_fee", "orders", type_="check")
    op.drop_column("orders", "delivery_miles")
    op.drop_column("orders", "delivery_fee_minor")
