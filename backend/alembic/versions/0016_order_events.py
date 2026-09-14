"""Order events: who moved an order on the board, and why.

A manager can now hand an order over without the customer's PIN, and cancel
a paid one. Both are exactly the actions that need an answer to "who did that"
afterwards -- an override is how food leaves without proof the right person
took it -- so each staff action on an order writes a row here with the person
and, for the two exceptional ones, the reason they gave.

A table rather than columns on orders, because an order can be acted on more
than once and the history is the point.

Revision ID: 0016
Revises: 0015
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None

ACTIONS = "'MARKED_READY','COMPLETED_WITH_PIN','COMPLETED_BY_OVERRIDE','CANCELLED'"


def upgrade() -> None:
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731

    op.create_table(
        "order_events",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("order_id", uid(), sa.ForeignKey("orders.id"), nullable=False),
        sa.Column("actor_user_id", uid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("reason", sa.String(200)),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint(f"action IN ({ACTIONS})", name="ck_order_event_action"),
    )
    op.create_index("ix_order_events_rid", "order_events", ["restaurant_id"])
    op.create_index("ix_order_events_order", "order_events", ["order_id", "created_at"])

    # Tenant-owned: ENABLE + FORCE RLS and the app-role policy 0001 gives
    # every table carrying restaurant_id.
    op.execute("ALTER TABLE order_events ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE order_events FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY p_order_events_tenant ON order_events
        FOR ALL TO zenoeats_app
        USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    # No UPDATE: a record of who did what is only worth keeping if it cannot
    # be rewritten. DELETE is granted because the restaurant purge removes a
    # restaurant's rows through this role; nothing in the application deletes
    # an event, and the purge refuses any restaurant that has taken an order.
    op.execute("GRANT SELECT, INSERT, DELETE ON order_events TO zenoeats_app")
    # The grant above only adds. 0001 set default privileges that already give
    # zenoeats_app UPDATE on every table the migration role creates, so the
    # one right this table must not have has to be taken away explicitly.
    op.execute("REVOKE UPDATE ON order_events FROM zenoeats_app")


def downgrade() -> None:
    op.drop_table("order_events")
