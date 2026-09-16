"""Taking a delivery back off a driver.

A manager could hand an order to a driver and hand it to a different one, but
not undo it: a customer who rang back to say they would collect after all left
the order a delivery for good. Undoing it is its own entry in the order's
history, so "it was a delivery this morning" still reads true afterwards.

Revision ID: 0020
Revises: 0019
"""

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

BEFORE = (
    "'MARKED_READY','COMPLETED_WITH_PIN','COMPLETED_BY_OVERRIDE','CANCELLED',"
    "'ASSIGNED_DRIVER','PICKED_UP','DELIVERED'"
)
AFTER = BEFORE + ",'UNASSIGNED_DRIVER'"


def upgrade() -> None:
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
