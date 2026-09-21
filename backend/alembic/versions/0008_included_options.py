"""What an item comes with, and at no charge.

A burger includes lettuce and onion. That was not expressible: the only
"comes as standard" flag lived on the option, in the shared library, so it
applied to every item using that group and could not differ between a burger
and a salad built from the same one. And it was a pre-selection only --
pricing charged the option's price whether it was standard or not, so an
included extra that cost anything was still billed.

Inclusion becomes a join from the item, and it does both things at once: the
option arrives chosen, and it adds nothing to the price on that item even
where the same option is charged elsewhere.

modifier_options.is_default goes with it. Two places saying what an item comes
with can disagree, and the item is the one that knows.

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def _rls_force(tables: list[str], *, on: bool) -> None:
    """Lift FORCE ROW LEVEL SECURITY around a data migration, then restore it.

    Same reason as 0004: the migration role owns these tables and FORCE makes
    RLS apply to the owner too, so DML run here would match no policy and
    touch zero rows without erroring.
    """
    verb = "FORCE" if on else "NO FORCE"
    for table in tables:
        op.execute(f"ALTER TABLE {table} {verb} ROW LEVEL SECURITY")


def upgrade() -> None:
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731

    op.create_table(
        "item_included_options",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("item_id", uid(), sa.ForeignKey("menu_items.id"), nullable=False),
        sa.Column("option_id", uid(), sa.ForeignKey("modifier_options.id"), nullable=False),
        sa.UniqueConstraint("item_id", "option_id", name="uq_item_included_option"),
    )
    op.create_index("ix_included_rid", "item_included_options", ["restaurant_id"])
    op.create_index("ix_included_item", "item_included_options", ["item_id"])
    op.create_index("ix_included_option", "item_included_options", ["option_id"])

    _rls_force(["modifier_options", "item_modifier_groups", "menu_items"], on=False)

    # An option marked standard in the library becomes an inclusion on every
    # item that actually offers its group. Same items pre-select the same
    # option afterwards, and now it is free there too.
    op.execute(
        """
        INSERT INTO item_included_options (id, restaurant_id, item_id, option_id)
        SELECT gen_random_uuid(), img.restaurant_id, img.item_id, o.id
          FROM item_modifier_groups img
          JOIN modifier_options o ON o.group_id = img.group_id
          JOIN menu_items i ON i.id = img.item_id
         WHERE o.is_default IS TRUE
           AND o.deleted_at IS NULL
           AND i.deleted_at IS NULL
        """
    )

    _rls_force(["modifier_options", "item_modifier_groups", "menu_items"], on=True)

    # Locked down after the backfill, not before. FORCE row-level security
    # applies to the owner as well, so a table protected first is a table this
    # migration cannot insert into.
    op.execute("ALTER TABLE item_included_options ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE item_included_options FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY p_item_included_options_tenant ON item_included_options
        FOR ALL TO zenoeats_app
        USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    op.execute(
        "GRANT SELECT, INSERT, UPDATE, DELETE ON item_included_options TO zenoeats_app"
    )

    op.drop_column("modifier_options", "is_default")


def downgrade() -> None:
    """Back to one flag on the option, which cannot say what this said.

    Lossy in the way the old shape was limited: an option included on one item
    and not another collapses to standard everywhere, and nothing carries the
    "included costs nothing" half at all.
    """
    op.add_column(
        "modifier_options",
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.false()),
    )

    _rls_force(["modifier_options"], on=False)
    op.execute(
        """
        UPDATE modifier_options o
           SET is_default = TRUE
         WHERE EXISTS (
           SELECT 1 FROM item_included_options inc WHERE inc.option_id = o.id
         )
        """
    )
    _rls_force(["modifier_options"], on=True)

    op.drop_table("item_included_options")
