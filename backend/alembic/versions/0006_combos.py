"""Combos: one item from each of several kinds, sold together for less.

A combo belongs to one meal period and holds one slot per kind it includes.
Each slot lists the items that may fill it, and a customer picks exactly one
from each. The saving is a percentage or a flat amount off what those items
would have cost separately.

Nothing about an item changes by joining a combo. Items keep their prices,
their modifiers and their sold-out toggle, so withdrawing a combo leaves the
menu exactly as it was.

order_items gains three nullable columns rather than a combo growing an order
table of its own. A combo becomes one line per slot -- the kitchen plates
items, not abstractions -- and the saving lands in orders.discount_minor,
which 0001 reserved for exactly this and which nothing has used until now.

Revision ID: 0006
Revises: 0005
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

KINDS = "'FOOD','BEVERAGE','SIDE','SAUCE'"

# Tenant-owned, so each gets ENABLE + FORCE RLS and the app-role policy that
# 0001 gives every table carrying restaurant_id.
NEW_TABLES = ["combos", "combo_slots", "combo_slot_items"]


def upgrade() -> None:
    ts = lambda: sa.DateTime(timezone=True)  # noqa: E731
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731

    op.create_table(
        "combos",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("meal_id", uid(), sa.ForeignKey("meals.id"), nullable=False),
        sa.Column("name", sa.String(180), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("discount_kind", sa.String(16), nullable=False, server_default="NONE"),
        sa.Column("discount_value", sa.Integer, nullable=False, server_default="0"),
        sa.Column("is_available", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(
            "discount_kind IN ('NONE','PERCENT','AMOUNT')", name="ck_combo_discount_kind"
        ),
        sa.CheckConstraint("discount_value >= 0", name="ck_combo_discount_non_negative"),
        # 10000 basis points is 100%. Past that the restaurant is paying the
        # customer to take the food away.
        sa.CheckConstraint(
            "discount_kind <> 'PERCENT' OR discount_value <= 10000",
            name="ck_combo_percent_within_range",
        ),
    )
    op.create_index("ix_combos_rid", "combos", ["restaurant_id"])
    op.create_index("ix_combos_meal", "combos", ["meal_id"])

    op.create_table(
        "combo_slots",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("combo_id", uid(), sa.ForeignKey("combos.id"), nullable=False),
        sa.Column("kind", sa.String(16), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.CheckConstraint(f"kind IN ({KINDS})", name="ck_combo_slot_kind"),
        sa.UniqueConstraint("combo_id", "kind", name="uq_combo_slot_kind"),
    )
    op.create_index("ix_combo_slots_rid", "combo_slots", ["restaurant_id"])
    op.create_index("ix_combo_slots_combo", "combo_slots", ["combo_id"])

    op.create_table(
        "combo_slot_items",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("slot_id", uid(), sa.ForeignKey("combo_slots.id"), nullable=False),
        sa.Column("item_id", uid(), sa.ForeignKey("menu_items.id"), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("slot_id", "item_id", name="uq_combo_slot_item"),
    )
    op.create_index("ix_combo_slot_items_rid", "combo_slot_items", ["restaurant_id"])
    op.create_index("ix_combo_slot_items_slot", "combo_slot_items", ["slot_id"])
    op.create_index("ix_combo_slot_items_item", "combo_slot_items", ["item_id"])

    for table in NEW_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"""
            CREATE POLICY p_{table}_tenant ON {table}
            FOR ALL TO zenoeats_app
            USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
            WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)
            """
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO zenoeats_app")

    # --- how an order remembers a combo ----------------------------------
    # All nullable: every line written before now, and every line that is not
    # part of a combo, has nothing to say here.
    op.add_column(
        "order_items",
        sa.Column("combo_id", uid(), sa.ForeignKey("combos.id"), nullable=True),
    )
    op.add_column(
        "order_items", sa.Column("combo_name_snapshot", sa.String(180), nullable=True)
    )
    op.add_column("order_items", sa.Column("combo_group", sa.Integer, nullable=True))
    op.create_index(
        "ix_order_items_combo_group", "order_items", ["order_id", "combo_group"]
    )


def downgrade() -> None:
    op.drop_index("ix_order_items_combo_group", table_name="order_items")
    op.drop_column("order_items", "combo_group")
    op.drop_column("order_items", "combo_name_snapshot")
    op.drop_column("order_items", "combo_id")

    # Slots and their choices go with the combo they belong to; nothing
    # outside these three tables points at them.
    op.drop_table("combo_slot_items")
    op.drop_table("combo_slots")
    op.drop_table("combos")
