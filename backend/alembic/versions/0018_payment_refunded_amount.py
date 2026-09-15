"""How much of a payment has been refunded.

The refund webhook recorded only a status -- REFUNDED or PARTIALLY_REFUNDED --
so a report could not say what was refunded, and counted every refunded order
as full revenue. Stripe sends the cumulative amount refunded on each charge;
this is where it goes.

Existing rows: a full refund is the whole payment. A partial refund's amount
was never kept, except on Stripe Tax restaurants, where the tax reversal
recorded it on the order; anything else starts at zero.

Revision ID: 0018
Revises: 0017
"""

import sqlalchemy as sa
from alembic import op

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "payments",
        sa.Column("refunded_minor", sa.BigInteger, nullable=False, server_default="0"),
    )
    op.create_check_constraint(
        "ck_payment_refunded_within_amount",
        "payments",
        "refunded_minor >= 0 AND refunded_minor <= amount_minor",
    )
    op.execute("UPDATE payments SET refunded_minor = amount_minor WHERE status = 'REFUNDED'")
    op.execute(
        """
        UPDATE payments p
           SET refunded_minor = LEAST(o.tax_reversed_amount_minor, p.amount_minor)
          FROM orders o
         WHERE o.id = p.order_id
           AND p.status = 'PARTIALLY_REFUNDED'
           AND o.tax_reversed_amount_minor > 0
        """
    )


def downgrade() -> None:
    op.drop_constraint("ck_payment_refunded_within_amount", "payments", type_="check")
    op.drop_column("payments", "refunded_minor")
