"""Items own themselves, meal periods list them.

Categories sat between a meal and its items carrying two different things: a
name, which duplicated what a heading already says, and a kind, which
describes the item rather than the shelf it sits on. Worse, an item reached
its meal period through its category, so one item could be served in exactly
one period -- putting coffee on both breakfast and lunch meant two rows, two
prices to keep in step, and two sold-out toggles the kitchen had to remember.

So the kind moves onto the item, the item stops belonging to anything, and a
new meal_items link says which periods serve it. Nothing is thrown away: an
item keeps its old category's kind and starts out served by exactly the
period it was already under, so the menu reads the same the moment this runs.

SIDE joins the kinds here rather than later. Combos are next and they are
built out of a food, a drink and a side, so the vocabulary has to exist
before there is anything to select from.

Revision ID: 0004
Revises: 0003
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

KINDS = "'FOOD','BEVERAGE','SIDE','SAUCE'"


def _rls_force(tables: list[str], *, on: bool) -> None:
    """Turn FORCE ROW LEVEL SECURITY off around a data migration, and back on.

    This is not optional here, and getting it wrong fails quietly. The
    migration role owns these tables, 0001 sets FORCE so RLS applies to the
    owner too, and every policy is granted TO zenoeats_app. So a DML
    statement run by the migration role matches no policy and touches zero
    rows -- no error, no warning, nothing updated.

    DDL does not go through RLS, which is what makes the failure so
    misleading: the backfill updates nothing, and then the ALTER that sets
    the column NOT NULL reads the whole table and finds every null the
    backfill was supposed to have filled.

    Dropping FORCE restores the ordinary rule that a table's owner bypasses
    its own policies. It is put back before this migration ends, so the
    tenant guarantee is never weaker than it was outside this transaction.
    """
    verb = "FORCE" if on else "NO FORCE"
    for table in tables:
        op.execute(f"ALTER TABLE {table} {verb} ROW LEVEL SECURITY")


def upgrade() -> None:
    ts = lambda: sa.DateTime(timezone=True)  # noqa: E731
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731

    # The kind moves onto the item. Added nullable, backfilled from the
    # category the item was under, then tightened -- adding it NOT NULL with a
    # default would silently call every existing drink food.
    op.add_column("menu_items", sa.Column("kind", sa.String(16), nullable=True))

    op.create_table(
        "meal_items",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("meal_id", uid(), sa.ForeignKey("meals.id"), nullable=False),
        sa.Column("item_id", uid(), sa.ForeignKey("menu_items.id"), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("meal_id", "item_id", name="uq_meal_item"),
    )
    op.create_index("ix_meal_items_rid", "meal_items", ["restaurant_id"])
    op.create_index("ix_meal_items_meal", "meal_items", ["meal_id"])
    op.create_index("ix_meal_items_item", "meal_items", ["item_id"])

    # --- data, with the owner able to see it -----------------------------
    _rls_force(["menu_items", "menu_categories"], on=False)

    op.execute(
        """
        UPDATE menu_items i
           SET kind = c.kind
          FROM menu_categories c
         WHERE c.id = i.category_id
        """
    )
    # Only reachable if an item lost its category outside this schema's
    # rules. FOOD is the same default a new item gets.
    op.execute("UPDATE menu_items SET kind = 'FOOD' WHERE kind IS NULL")

    # Every live item starts out served by the period it was already under.
    # created_at is offset by the old sort order so the reader's tiebreaker
    # reproduces the order the menu was already in: rows written in one
    # transaction share now(), and a pure tie has no defined order.
    op.execute(
        """
        INSERT INTO meal_items (id, restaurant_id, meal_id, item_id, sort_order,
                                created_at, updated_at)
        SELECT gen_random_uuid(), i.restaurant_id, c.meal_id, i.id, c.sort_order,
               now() + (i.sort_order * interval '1 microsecond'), now()
          FROM menu_items i
          JOIN menu_categories c ON c.id = i.category_id
         WHERE i.deleted_at IS NULL
           AND c.deleted_at IS NULL
        """
    )

    # menu_categories is dropped below, so only the surviving table needs its
    # guarantee putting back.
    _rls_force(["menu_items"], on=True)

    op.alter_column("menu_items", "kind", nullable=False)
    op.create_check_constraint("ck_item_kind", "menu_items", f"kind IN ({KINDS})")

    # RLS is the tenant guarantee, not a convention, so the new table gets
    # the same treatment 0001 gives every other tenant table.
    op.execute("ALTER TABLE meal_items ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE meal_items FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY p_meal_items_tenant ON meal_items
        FOR ALL TO zenoeats_app
        USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    # 0001 sets default privileges for future tables, but only for tables
    # created by the role that ran it. Granting explicitly costs nothing and
    # does not depend on who runs the migration.
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON meal_items TO zenoeats_app")

    op.drop_column("menu_items", "category_id")
    op.drop_table("menu_categories")


def downgrade() -> None:
    """Rebuild the category layer, lossily.

    Category names are gone for good: nothing above records them any more. So
    the reverse builds one category per (period, kind) named after the kind,
    which reads as "Food", "Drinks" and holds exactly the items that heading
    showed. An item served by several periods cannot survive a shape that
    allows it only one, and lands under the first period that served it.
    """
    ts = lambda: sa.DateTime(timezone=True)  # noqa: E731
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731

    op.create_table(
        "menu_categories",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("meal_id", uid(), sa.ForeignKey("meals.id"), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint("kind IN ('FOOD','BEVERAGE','SAUCE')", name="ck_category_kind"),
    )
    op.create_index("ix_categories_rid", "menu_categories", ["restaurant_id"])
    op.create_index("ix_categories_meal", "menu_categories", ["meal_id"])
    op.add_column("menu_items", sa.Column("category_id", uid(), nullable=True))

    # Same reason as the upgrade: without this the rebuild reads and writes
    # nothing, and the NOT NULL at the end fails on rows it never saw.
    _rls_force(["menu_items", "meals", "meal_items"], on=False)

    # SIDE has no home in the old vocabulary; it reads as food there.
    op.execute(
        """
        INSERT INTO menu_categories (id, restaurant_id, meal_id, name, kind, sort_order,
                                     created_at, updated_at)
        SELECT gen_random_uuid(), pair.restaurant_id, pair.meal_id,
               initcap(pair.kind), pair.kind, 0, now(), now()
          FROM (
            -- DISTINCT has to close before the uuid is generated: a random
            -- value in the select list makes every row unique and dedupes
            -- nothing.
            SELECT DISTINCT mi.restaurant_id, mi.meal_id,
                   CASE WHEN i.kind = 'SIDE' THEN 'FOOD' ELSE i.kind END AS kind
              FROM meal_items mi
              JOIN menu_items i ON i.id = mi.item_id
          ) pair
        """
    )
    op.execute(
        """
        UPDATE menu_items i
           SET category_id = pick.category_id
          FROM (
            SELECT DISTINCT ON (mi.item_id) mi.item_id, c.id AS category_id
              FROM meal_items mi
              JOIN menu_items it ON it.id = mi.item_id
              JOIN menu_categories c
                ON c.meal_id = mi.meal_id
               AND c.kind = CASE WHEN it.kind = 'SIDE' THEN 'FOOD' ELSE it.kind END
             ORDER BY mi.item_id, mi.created_at, mi.id
          ) pick
         WHERE pick.item_id = i.id
        """
    )

    # Items no period served, and soft-deleted ones, have nowhere natural to
    # go under a shape that demands a category. They cannot simply be
    # deleted: order_items points at them, so a paid order would go too. They
    # are parked in an inactive "Unlisted" period instead, which keeps
    # history intact and keeps them off the menu.
    op.execute(
        """
        INSERT INTO meals (id, restaurant_id, name, sort_order, is_active,
                           created_at, updated_at)
        SELECT gen_random_uuid(), i.restaurant_id, 'Unlisted', 999, false, now(), now()
          FROM menu_items i
         WHERE i.category_id IS NULL
         GROUP BY i.restaurant_id
        """
    )
    op.execute(
        """
        INSERT INTO menu_categories (id, restaurant_id, meal_id, name, kind, sort_order,
                                     created_at, updated_at)
        SELECT gen_random_uuid(), m.restaurant_id, m.id, 'Unlisted', 'FOOD', 999, now(), now()
          FROM meals m
         WHERE m.name = 'Unlisted' AND m.is_active = false AND m.sort_order = 999
        """
    )
    op.execute(
        """
        UPDATE menu_items i
           SET category_id = c.id
          FROM menu_categories c
          JOIN meals m ON m.id = c.meal_id
         WHERE i.category_id IS NULL
           AND c.restaurant_id = i.restaurant_id
           AND c.name = 'Unlisted'
           AND m.is_active = false
           AND m.sort_order = 999
        """
    )

    _rls_force(["menu_items", "meals"], on=True)

    op.alter_column("menu_items", "category_id", nullable=False)
    op.create_foreign_key(
        "menu_items_category_id_fkey", "menu_items", "menu_categories",
        ["category_id"], ["id"],
    )

    op.execute("ALTER TABLE menu_categories ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE menu_categories FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY p_menu_categories_tenant ON menu_categories
        FOR ALL TO zenoeats_app
        USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON menu_categories TO zenoeats_app")

    op.drop_table("meal_items")
    op.drop_constraint("ck_item_kind", "menu_items", type_="check")
    op.drop_column("menu_items", "kind")
