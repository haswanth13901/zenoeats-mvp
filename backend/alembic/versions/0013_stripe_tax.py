"""Sales tax through Stripe Tax, per restaurant.

A flat rate per restaurant cannot represent prepared-food tax, which differs
by state, county, city and special district. A restaurant can now be switched
to Stripe Tax, which calculates on the restaurant's own connected account --
the restaurant is the merchant of record, so the tax obligation and the
filing reports are its own.

restaurants
  tax_mode           FLAT (the existing tax_rate_bps, still the default) or
                     STRIPE_TAX.
  tax_code           Stripe product tax code for what the restaurant sells.
                     txcd_40060003 is "Food for Immediate Consumption":
                     prepared and ready-to-eat food, meals, heated and
                     dispensed drinks.
  address_*          Where orders are picked up, which is where the sale
                     happens and so where tax is sourced. Also worth showing
                     customers.

orders
  tax_calculation_id        The Stripe calculation the order's tax_minor and
                            total came from. Null under FLAT.
  tax_transaction_id        Recorded once the payment succeeds, so the sale
                            appears in the restaurant's tax reports.
  tax_reversed_amount_minor How much of any refund has already been recorded
                            as a tax reversal, so a redelivered refund webhook
                            never reverses the same money twice.

No row-level security change: new columns inherit each table's policy.

Revision ID: 0013
Revises: 0012
"""

import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "restaurants",
        sa.Column("tax_mode", sa.String(16), nullable=False, server_default="FLAT"),
    )
    op.create_check_constraint(
        "ck_restaurants_tax_mode", "restaurants", "tax_mode IN ('FLAT', 'STRIPE_TAX')"
    )
    op.add_column(
        "restaurants",
        sa.Column("tax_code", sa.String(32), nullable=False, server_default="txcd_40060003"),
    )
    op.add_column("restaurants", sa.Column("address_line1", sa.String(200)))
    op.add_column("restaurants", sa.Column("address_line2", sa.String(200)))
    op.add_column("restaurants", sa.Column("address_city", sa.String(100)))
    op.add_column("restaurants", sa.Column("address_state", sa.String(100)))
    op.add_column("restaurants", sa.Column("address_postal_code", sa.String(20)))
    op.add_column("restaurants", sa.Column("address_country", sa.String(2)))

    op.add_column("orders", sa.Column("tax_calculation_id", sa.String(255)))
    op.add_column("orders", sa.Column("tax_transaction_id", sa.String(255)))
    op.add_column(
        "orders",
        sa.Column(
            "tax_reversed_amount_minor", sa.BigInteger, nullable=False, server_default="0"
        ),
    )
    op.create_check_constraint(
        "ck_order_tax_reversed", "orders", "tax_reversed_amount_minor >= 0"
    )


def downgrade() -> None:
    op.drop_constraint("ck_order_tax_reversed", "orders", type_="check")
    op.drop_column("orders", "tax_reversed_amount_minor")
    op.drop_column("orders", "tax_transaction_id")
    op.drop_column("orders", "tax_calculation_id")

    for column in (
        "address_country", "address_postal_code", "address_state",
        "address_city", "address_line2", "address_line1",
    ):
        op.drop_column("restaurants", column)
    op.drop_column("restaurants", "tax_code")
    op.drop_constraint("ck_restaurants_tax_mode", "restaurants", type_="check")
    op.drop_column("restaurants", "tax_mode")
