"""Item types are the restaurant's own words, not four hard-coded ones.

FOOD, BEVERAGE, SIDE and SAUCE were a dictionary in the schema. A tiffin
house filed tiffins, thalis and chaat under "Food" and read someone else's
vocabulary back on its own menu, and the order those headings appeared in was
decided in a Python file rather than by the people whose menu it is.

They become rows. Every restaurant is given the four it already had, in the
order they already read, and from that moment they are its own to rename,
reorder, add to or delete.

Three columns change shape and none loses anything:

  menu_items.kind            -> menu_items.item_type_id
  combo_slots.kind           -> combo_slots.item_type_id
  modifier_groups.applies_to_kinds (text[]) -> modifier_group_item_types

The array becomes a join table on the way, so a type that is deleted cannot
leave a group pointing at a word that no longer means anything.

Revision ID: 0007
Revises: 0006
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

# The old vocabulary, and the name each becomes. These are the same words
# services/menu.py already used as headings, so no menu reads differently the
# moment this runs.
KIND_NAMES = [
    ("FOOD", "Food", 0),
    ("BEVERAGE", "Drinks", 1),
    ("SIDE", "Sides", 2),
    ("SAUCE", "Sauces", 3),
]

NEW_TABLES = ["item_types", "modifier_group_item_types"]


def _rls_force(tables: list[str], *, on: bool) -> None:
    """Lift FORCE ROW LEVEL SECURITY around a data migration, then restore it.

    Same reason as 0004, which explains it at length: the migration role owns
    these tables and FORCE makes RLS apply to the owner too, so DML run here
    would match no policy and touch zero rows without erroring.
    """
    verb = "FORCE" if on else "NO FORCE"
    for table in tables:
        op.execute(f"ALTER TABLE {table} {verb} ROW LEVEL SECURITY")


def _protect(tables: list[str]) -> None:
    for table in tables:
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


def upgrade() -> None:
    ts = lambda: sa.DateTime(timezone=True)  # noqa: E731
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731

    op.create_table(
        "item_types",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("deleted_at", ts()),
        sa.Column("created_at", ts(), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", ts(), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_item_types_rid", "item_types", ["restaurant_id"])
    # Case-insensitive and only over live rows: "Drinks" and "drinks" are the
    # same heading to a customer, and a name freed by a deletion should be
    # reusable.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_item_type_name
            ON item_types (restaurant_id, lower(name))
         WHERE deleted_at IS NULL
        """
    )

    op.create_table(
        "modifier_group_item_types",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("group_id", uid(), sa.ForeignKey("modifier_groups.id"), nullable=False),
        sa.Column("item_type_id", uid(), sa.ForeignKey("item_types.id"), nullable=False),
        sa.UniqueConstraint("group_id", "item_type_id", name="uq_group_item_type"),
    )
    op.create_index("ix_mgit_rid", "modifier_group_item_types", ["restaurant_id"])
    op.create_index("ix_mgit_group", "modifier_group_item_types", ["group_id"])
    op.create_index("ix_mgit_type", "modifier_group_item_types", ["item_type_id"])

    op.add_column("menu_items", sa.Column("item_type_id", uid(), nullable=True))
    op.add_column("combo_slots", sa.Column("item_type_id", uid(), nullable=True))

    # --- data -------------------------------------------------------------
    _rls_force(
        ["menu_items", "combo_slots", "modifier_groups", "restaurants"], on=False
    )

    # Every restaurant gets the four it already had, whether or not its menu
    # uses them: they are the vocabulary to edit, and an empty menu needs one
    # as much as a full one does.
    for kind, name, order in KIND_NAMES:
        op.execute(
            f"""
            INSERT INTO item_types (id, restaurant_id, name, sort_order,
                                    created_at, updated_at)
            SELECT gen_random_uuid(), r.id, '{name}', {order}, now(), now()
              FROM restaurants r
            """
        )

    op.execute(
        """
        UPDATE menu_items i
           SET item_type_id = t.id
          FROM item_types t
         WHERE t.restaurant_id = i.restaurant_id
           AND t.name = CASE i.kind
                          WHEN 'FOOD' THEN 'Food'
                          WHEN 'BEVERAGE' THEN 'Drinks'
                          WHEN 'SIDE' THEN 'Sides'
                          WHEN 'SAUCE' THEN 'Sauces'
                        END
        """
    )
    op.execute(
        """
        UPDATE combo_slots s
           SET item_type_id = t.id
          FROM item_types t
         WHERE t.restaurant_id = s.restaurant_id
           AND t.name = CASE s.kind
                          WHEN 'FOOD' THEN 'Food'
                          WHEN 'BEVERAGE' THEN 'Drinks'
                          WHEN 'SIDE' THEN 'Sides'
                          WHEN 'SAUCE' THEN 'Sauces'
                        END
        """
    )
    # The array becomes one row per kind the group named. A group that named
    # none stays with no rows, which already means every type.
    op.execute(
        """
        INSERT INTO modifier_group_item_types (id, restaurant_id, group_id, item_type_id)
        SELECT gen_random_uuid(), g.restaurant_id, g.id, t.id
          FROM modifier_groups g
          CROSS JOIN LATERAL unnest(g.applies_to_kinds) AS k(kind)
          JOIN item_types t
            ON t.restaurant_id = g.restaurant_id
           AND t.name = CASE k.kind
                          WHEN 'FOOD' THEN 'Food'
                          WHEN 'BEVERAGE' THEN 'Drinks'
                          WHEN 'SIDE' THEN 'Sides'
                          WHEN 'SAUCE' THEN 'Sauces'
                        END
        """
    )

    _rls_force(["menu_items", "combo_slots", "modifier_groups", "restaurants"], on=True)

    # --- and the old vocabulary goes --------------------------------------
    op.alter_column("menu_items", "item_type_id", nullable=False)
    op.alter_column("combo_slots", "item_type_id", nullable=False)
    op.create_foreign_key(
        "menu_items_item_type_fkey", "menu_items", "item_types", ["item_type_id"], ["id"]
    )
    op.create_foreign_key(
        "combo_slots_item_type_fkey", "combo_slots", "item_types", ["item_type_id"], ["id"]
    )
    op.create_index("ix_items_type", "menu_items", ["item_type_id"])
    op.create_index("ix_combo_slots_type", "combo_slots", ["item_type_id"])

    op.drop_constraint("uq_combo_slot_kind", "combo_slots", type_="unique")
    op.create_unique_constraint(
        "uq_combo_slot_type", "combo_slots", ["combo_id", "item_type_id"]
    )
    op.drop_constraint("ck_combo_slot_kind", "combo_slots", type_="check")
    op.drop_constraint("ck_item_kind", "menu_items", type_="check")
    op.drop_constraint("ck_group_applies_to_kinds", "modifier_groups", type_="check")

    op.drop_column("menu_items", "kind")
    op.drop_column("combo_slots", "kind")
    op.drop_column("modifier_groups", "applies_to_kinds")

    _protect(NEW_TABLES)


def downgrade() -> None:
    """Back to the four fixed words, keeping what can be mapped onto them.

    Lossy, and unavoidably so: a restaurant that renamed Food to Tiffins or
    added Thalis is holding vocabulary the old shape cannot express. Anything
    that does not map onto one of the four becomes FOOD, which is the same
    default a new item used to get.
    """
    kinds = "'FOOD','BEVERAGE','SIDE','SAUCE'"
    case = """
        CASE lower(t.name)
          WHEN 'drinks' THEN 'BEVERAGE'
          WHEN 'drink' THEN 'BEVERAGE'
          WHEN 'sides' THEN 'SIDE'
          WHEN 'side' THEN 'SIDE'
          WHEN 'sauces' THEN 'SAUCE'
          WHEN 'sauce' THEN 'SAUCE'
          ELSE 'FOOD'
        END
    """

    op.add_column("menu_items", sa.Column("kind", sa.String(16), nullable=True))
    op.add_column("combo_slots", sa.Column("kind", sa.String(16), nullable=True))
    op.add_column(
        "modifier_groups",
        sa.Column(
            "applies_to_kinds",
            postgresql.ARRAY(sa.String(16)),
            nullable=False,
            server_default="{}",
        ),
    )

    _rls_force(["menu_items", "combo_slots", "modifier_groups", "item_types"], on=False)

    op.execute(
        f"""
        UPDATE menu_items i SET kind = {case}
          FROM item_types t WHERE t.id = i.item_type_id
        """
    )
    op.execute("UPDATE menu_items SET kind = 'FOOD' WHERE kind IS NULL")
    op.execute(
        f"""
        UPDATE combo_slots s SET kind = {case}
          FROM item_types t WHERE t.id = s.item_type_id
        """
    )
    op.execute("UPDATE combo_slots SET kind = 'FOOD' WHERE kind IS NULL")
    op.execute(
        f"""
        UPDATE modifier_groups g
           SET applies_to_kinds = sub.kinds
          FROM (
            SELECT l.group_id, array_agg(DISTINCT {case}) AS kinds
              FROM modifier_group_item_types l
              JOIN item_types t ON t.id = l.item_type_id
             GROUP BY l.group_id
          ) sub
         WHERE sub.group_id = g.id
        """
    )

    _rls_force(["menu_items", "combo_slots", "modifier_groups"], on=True)

    # A combo that had two types mapping onto one kind would now break the
    # unique constraint, so the duplicates go. The first slot of each kind is
    # kept, which is the same rule 0004's downgrade uses for items.
    op.execute(
        """
        DELETE FROM combo_slots s
         WHERE EXISTS (
           SELECT 1 FROM combo_slots other
            WHERE other.combo_id = s.combo_id
              AND other.kind = s.kind
              AND (other.sort_order, other.id) < (s.sort_order, s.id)
         )
        """
    )

    op.alter_column("menu_items", "kind", nullable=False)
    op.alter_column("combo_slots", "kind", nullable=False)
    op.create_check_constraint("ck_item_kind", "menu_items", f"kind IN ({kinds})")
    op.create_check_constraint("ck_combo_slot_kind", "combo_slots", f"kind IN ({kinds})")
    op.create_check_constraint(
        "ck_group_applies_to_kinds",
        "modifier_groups",
        f"applies_to_kinds <@ ARRAY[{kinds}]::varchar[]",
    )

    op.drop_constraint("uq_combo_slot_type", "combo_slots", type_="unique")
    op.create_unique_constraint("uq_combo_slot_kind", "combo_slots", ["combo_id", "kind"])
    op.drop_index("ix_combo_slots_type", table_name="combo_slots")
    op.drop_index("ix_items_type", table_name="menu_items")
    op.drop_constraint("combo_slots_item_type_fkey", "combo_slots", type_="foreignkey")
    op.drop_constraint("menu_items_item_type_fkey", "menu_items", type_="foreignkey")
    op.drop_column("combo_slots", "item_type_id")
    op.drop_column("menu_items", "item_type_id")

    op.drop_table("modifier_group_item_types")
    op.drop_table("item_types")
