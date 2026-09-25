"""The one tenant row a closing account has to reach across restaurants.

legal/data-deletion.html promises that closing an account removes the
customer's saved favourites. A customer's favourites belong to whichever
restaurants they saved them at, and only the system role sees across
restaurants -- the tenant role is confined to one by RLS, and a customer who
ordered at three would keep two lists.

So the system role may delete a favourite, and nothing else: no select, no
insert, no update, and no other tenant table. Following 0017, which granted
it a narrow read on memberships and the policy that makes the grant usable.

Revision ID: 0041
Revises: 0040
"""

from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("GRANT DELETE ON customer_favourites TO zenoeats_system")
    # Postgres checks column privileges on what a DELETE names in its WHERE,
    # so deleting "the favourites of this user" needs to be able to read that
    # one column. Nothing else about the row is legible to this role.
    op.execute("GRANT SELECT (user_id) ON customer_favourites TO zenoeats_system")
    # RLS applies to the system role on tenant tables, so the grant needs a
    # policy to match any rows at all. DELETE only, and every row: the point
    # is precisely to reach the restaurants this session is not scoped to.
    op.execute(
        """
        CREATE POLICY p_customer_favourites_system_delete ON customer_favourites
        FOR DELETE TO zenoeats_system
        USING (true)
        """
    )
    # And a read policy, because a DELETE whose WHERE reads a column has its
    # rows filtered by the SELECT policies too. Without this the delete is
    # not refused -- it matches nothing and removes nothing, which is the
    # worse failure of the two.
    op.execute(
        """
        CREATE POLICY p_customer_favourites_system_read ON customer_favourites
        FOR SELECT TO zenoeats_system
        USING (true)
        """
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS p_customer_favourites_system_read ON customer_favourites")
    op.execute("DROP POLICY IF EXISTS p_customer_favourites_system_delete ON customer_favourites")
    op.execute("REVOKE SELECT (user_id) ON customer_favourites FROM zenoeats_system")
    op.execute("REVOKE DELETE ON customer_favourites FROM zenoeats_system")
