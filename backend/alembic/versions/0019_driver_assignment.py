"""Who is delivering an order, and where to.

The build is pickup-only: a customer cannot order a delivery, and nothing here
changes that. What a restaurant could not do was hand an order to one of its
own drivers -- a phone order it agreed to run out -- and say afterwards who
took it and when.

So an order may name a driver and an address. Both are set by a manager, not
by the customer, and both are null on every pickup order, which is still what
checkout creates.

The delivery states themselves need no migration: orders.status is a plain
string with the transition matrix in app/models/commerce.py as its only guard.
The order history's action list is a CHECK constraint, and does.

Revision ID: 0019
Revises: 0018
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

BEFORE = "'MARKED_READY','COMPLETED_WITH_PIN','COMPLETED_BY_OVERRIDE','CANCELLED'"
AFTER = BEFORE + ",'ASSIGNED_DRIVER','PICKED_UP','DELIVERED'"


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column(
            "driver_user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
    )
    # Typed by staff from a phone call, so one free-text line rather than the
    # structured address a restaurant's own pickup location needs.
    op.add_column("orders", sa.Column("delivery_address", sa.String(300), nullable=True))
    # A driver reads their own deliveries on every poll, and that is the query.
    op.create_index(
        "ix_orders_driver", "orders", ["restaurant_id", "driver_user_id", "status"]
    )

    op.drop_constraint("ck_order_event_action", "order_events", type_="check")
    op.create_check_constraint(
        "ck_order_event_action", "order_events", f"action IN ({AFTER})"
    )


def downgrade() -> None:
    op.execute(f"DELETE FROM order_events WHERE action NOT IN ({BEFORE})")
    op.drop_constraint("ck_order_event_action", "order_events", type_="check")
    op.create_check_constraint(
        "ck_order_event_action", "order_events", f"action IN ({BEFORE})"
    )

    op.drop_index("ix_orders_driver", table_name="orders")
    op.drop_column("orders", "delivery_address")
    op.drop_column("orders", "driver_user_id")
