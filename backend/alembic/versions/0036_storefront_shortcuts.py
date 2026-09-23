"""Shortcuts the restaurant builds itself, instead of one per category.

The shortcut row under the banner used to list every category automatically,
named after it, with a toggle to hide one. A restaurant could not call its
"Burger" category "Our burgers", and could not point a shortcut at a few
dishes rather than everything filed there.

A shortcut is now a row of its own: a category, the label the restaurant
wants on it, an optional photo, and the items from that category it shows.
Tapping one scrolls to a section of exactly those items.

Existing restaurants keep the row they have today. Every category that was
showing in it becomes a shortcut with the category's name, its photo, and
all of the items filed directly under it, in the order the storefront listed
them.

Revision ID: 0036
Revises: 0035
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None

TABLES = ("storefront_shortcuts", "storefront_shortcut_items")


def upgrade() -> None:
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731
    op.create_table(
        "storefront_shortcuts",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("item_type_id", uid(), sa.ForeignKey("item_types.id"), nullable=False),
        sa.Column("label", sa.String(40), nullable=False),
        sa.Column("image_path", sa.String(500), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "storefront_shortcut_items",
        sa.Column("shortcut_id", uid(), sa.ForeignKey("storefront_shortcuts.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("item_id", uid(), sa.ForeignKey("menu_items.id"), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
    )
    for table in TABLES:
        op.create_index(f"ix_{table}_restaurant_id", table, ["restaurant_id"])

    # The backfill runs before RLS is switched on: the migration role owns
    # these tables, and FORCE would make its inserts match no policy (see
    # 0004). item_types and menu_items are read with FORCE lifted for the
    # same reason.
    for table in ("item_types", "menu_items"):
        op.execute(f"ALTER TABLE {table} NO FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        INSERT INTO storefront_shortcuts (id, restaurant_id, item_type_id, label, image_path, sort_order)
        SELECT gen_random_uuid(), t.restaurant_id, t.id, left(t.name, 40), t.image_path,
               row_number() OVER (
                   PARTITION BY t.restaurant_id
                   -- services/menu.load_item_types: each heading, then its
                   -- subheadings; siblings by sort_order, creation, id.
                   ORDER BY coalesce(p.sort_order, t.sort_order), coalesce(p.created_at, t.created_at),
                            coalesce(p.id, t.id), (t.parent_id IS NOT NULL),
                            t.sort_order, t.created_at, t.id
               ) - 1
        FROM item_types t
        LEFT JOIN item_types p ON p.id = t.parent_id
        WHERE t.deleted_at IS NULL
          AND (t.parent_id IS NULL OR p.deleted_at IS NULL)
          AND t.show_in_shortcuts
          AND EXISTS (SELECT 1 FROM menu_items i WHERE i.item_type_id = t.id AND i.deleted_at IS NULL)
        """
    )
    op.execute(
        """
        INSERT INTO storefront_shortcut_items (shortcut_id, item_id, restaurant_id, sort_order)
        SELECT s.id, i.id, s.restaurant_id,
               row_number() OVER (PARTITION BY s.id ORDER BY i.sort_order, i.created_at, i.id) - 1
        FROM storefront_shortcuts s
        JOIN menu_items i ON i.item_type_id = s.item_type_id AND i.deleted_at IS NULL
        """
    )
    for table in ("item_types", "menu_items"):
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")

    for table in TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"""CREATE POLICY p_{table}_tenant ON {table} FOR ALL TO zenoeats_app
            USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
            WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)""")
        grants = "SELECT, INSERT, DELETE" if table == "storefront_shortcut_items" else "SELECT, INSERT, UPDATE, DELETE"
        op.execute(f"GRANT {grants} ON {table} TO zenoeats_app")


def downgrade() -> None:
    for table in reversed(TABLES):
        op.drop_table(table)
