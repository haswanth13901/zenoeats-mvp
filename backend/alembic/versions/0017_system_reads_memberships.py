"""Let the system role count a login's memberships, and nothing more.

A restaurant admin can now reset a team member's password. That is only safe
for a login used at that restaurant alone: the same login at a second
restaurant would hand the admin that membership too -- the takeover the staff
invitation used to allow. Row-level security rightly hides every other
restaurant's team from the tenant role, so the question "is this login used
anywhere else?" has to be asked through the system role.

Column-level, like every system read in 0001: user_id and status, which is
exactly what a count of live memberships needs. Not which restaurants, not
roles, not dates.

Revision ID: 0017
Revises: 0016
"""

from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT SELECT (user_id, status) ON restaurant_users TO zenoeats_system")
    # RLS applies to the system role on tenant tables, so the column grant
    # needs a read policy to see any rows at all. SELECT only.
    op.execute(
        """
        CREATE POLICY p_restaurant_users_system_read ON restaurant_users
        FOR SELECT TO zenoeats_system
        USING (true)
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY p_restaurant_users_system_read ON restaurant_users")
    op.execute("REVOKE SELECT (user_id, status) ON restaurant_users FROM zenoeats_system")
