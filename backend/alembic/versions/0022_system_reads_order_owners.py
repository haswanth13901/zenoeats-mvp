"""Let the retention sweep tell an abandoned guest from a paying one.

A guest row is created the moment someone chooses "continue as guest", before
they have ordered anything, and most never do. Sweeping the abandoned ones
means asking "does this user own an order?" -- across every tenant, because a
guest belongs to no restaurant until they buy something.

orders is under RLS, and the sweep runs with no tenant set, so that question
answered "no orders exist" for everyone and would have proposed deleting the
customers of real, paid sales. The foreign key would have refused, taking the
rest of the sweep down with it.

p_orders_system_read already grants the system role a cross-tenant read; only
the column privilege was missing. Two columns, matching 0017: enough to join
an order to its customer and nothing else -- no totals, no notes, no PINs.

Revision ID: 0022
Revises: 0021
"""

from alembic import op

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT SELECT (id, customer_user_id) ON orders TO zenoeats_system")


def downgrade() -> None:
    op.execute("REVOKE SELECT (id, customer_user_id) ON orders FROM zenoeats_system")
