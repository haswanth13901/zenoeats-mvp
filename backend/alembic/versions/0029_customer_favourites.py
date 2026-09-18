"""The menu items a customer has saved as favourites, per restaurant.

Tenant-owned, like everything else a restaurant's storefront reads: a
favourite at one restaurant means nothing on another's menu, and RLS keeps the
list inside the restaurant it was saved at.

A link to the item rather than a copy of it. A favourite is a pointer at
something to order again, and should show today's name, price and sold-out
state -- unlike an order, which records what was bought. An item taken off the
menu is soft deleted (menu_items.deleted_at), so the link stays valid and the
list simply leaves it out.

Customers with an account only. A guest session lasts about as long as one
checkout, and a list that vanished with it would be worse than none.

ON DELETE CASCADE from users: a customer row going away takes its favourites
with it, and nothing else points at them.

Revision ID: 0029
Revises: 0028
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731

    op.create_table(
        "customer_favourites",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column(
            "user_id", uid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("item_id", uid(), sa.ForeignKey("menu_items.id"), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        # Saving the same item twice is one favourite, not two.
        sa.UniqueConstraint(
            "restaurant_id", "user_id", "item_id", name="uq_customer_favourite"
        ),
    )
    op.create_index(
        "ix_customer_favourites_user",
        "customer_favourites",
        ["restaurant_id", "user_id", "created_at"],
    )

    # Tenant-owned: ENABLE + FORCE RLS and the app-role policy every table
    # carrying restaurant_id gets.
    op.execute("ALTER TABLE customer_favourites ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE customer_favourites FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY p_customer_favourites_tenant ON customer_favourites
        FOR ALL TO zenoeats_app
        USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    # Saved and unsaved, never edited: there is nothing on the row to change.
    op.execute("GRANT SELECT, INSERT, DELETE ON customer_favourites TO zenoeats_app")


def downgrade() -> None:
    op.drop_table("customer_favourites")
