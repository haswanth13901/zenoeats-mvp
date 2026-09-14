"""An item type may sit under another one, and no deeper.

Food holds Burgers and Nuggets; Drinks holds Hot Beverages. The alternative
was making Burgers and Nuggets top-level types, which the schema already
allowed and which quietly costs something: item_type_id is not only a
heading. It decides which modifier groups the builder offers for an item and
which combo slot the item can fill. Splitting Food into Burgers and Nuggets
therefore splits the add-ons group in two and turns one "pick a food" slot
into two slots that each offer half the menu.

So the nesting is display only. Combos and the modifier filter read the root
through ItemType.root_id, and nothing structural ever sees the child.

Two levels, enforced here rather than in the API. The pair of generated
columns and the composite foreign key below are the whole mechanism:

  is_root         true on a top-level type, false on a child
  parent_is_root  true when this row has a parent, NULL when it does not

The foreign key is (parent_id, parent_is_root) -> (id, is_root). It can only
match a row whose is_root is true, which is to say a top-level one, so a
child cannot be given a child. MATCH SIMPLE, the default, skips the check
entirely when any referencing column is NULL, which is what leaves top-level
types -- both columns NULL and true respectively -- alone.

Nothing existing moves. Every type is top-level the moment this runs, which
is the menu every restaurant already has.

Revision ID: 0009
Revises: 0008
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "item_types",
        sa.Column("parent_id", postgresql.UUID(as_uuid=True), nullable=True),
    )
    op.create_index("ix_item_types_parent", "item_types", ["parent_id"])

    # Both derived from parent_id, so neither can drift from it and neither
    # is something the application writes.
    op.execute(
        """
        ALTER TABLE item_types
          ADD COLUMN is_root boolean
            GENERATED ALWAYS AS (parent_id IS NULL) STORED,
          ADD COLUMN parent_is_root boolean
            GENERATED ALWAYS AS (CASE WHEN parent_id IS NULL THEN NULL ELSE true END)
            STORED
        """
    )
    # The target the composite key points at. Redundant as a uniqueness rule
    # -- id is already the primary key -- and required as a key: a foreign
    # key must reference a unique constraint over exactly its columns.
    op.execute(
        "ALTER TABLE item_types ADD CONSTRAINT uq_item_type_root UNIQUE (id, is_root)"
    )
    op.execute(
        """
        ALTER TABLE item_types
          ADD CONSTRAINT item_types_parent_is_top_level_fkey
          FOREIGN KEY (parent_id, parent_is_root)
          REFERENCES item_types (id, is_root)
        """
    )
    # A type cannot be its own parent. The composite key does not catch this
    # on its own: a row pointing at itself has is_root false, but only after
    # the update lands, and the check reads cleanly either way.
    op.create_check_constraint(
        "ck_item_type_parent_not_self", "item_types", "parent_id IS DISTINCT FROM id"
    )


def downgrade() -> None:
    """Back to one flat level, and subcategories become top-level types.

    Lossy only in that the grouping is lost. No item changes type and no
    heading disappears: a menu that read Food, Burgers, Nuggets reads Food,
    Burgers, Nuggets afterwards, with the indent gone. sort_order is left
    as it is, so children land wherever their within-parent order puts them.
    """
    op.drop_constraint("ck_item_type_parent_not_self", "item_types", type_="check")
    op.drop_constraint(
        "item_types_parent_is_top_level_fkey", "item_types", type_="foreignkey"
    )
    op.drop_constraint("uq_item_type_root", "item_types", type_="unique")
    op.drop_column("item_types", "parent_is_root")
    op.drop_column("item_types", "is_root")
    op.drop_index("ix_item_types_parent", table_name="item_types")
    op.drop_column("item_types", "parent_id")
