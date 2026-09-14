"""A modifier group shows on several item kinds, not one.

applies_to_kind held a single kind, so a Size group that belongs on both
drinks and sides could only be built twice -- two libraries, two sets of
options, and nothing keeping them in step. It becomes a list.

Empty means every kind, which is the same thing NULL used to mean. The column
is NOT NULL with a default of {} rather than nullable, so "everything" has
exactly one representation and no caller has to test for both.

Revision ID: 0005
Revises: 0004
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

KINDS = "'FOOD','BEVERAGE','SIDE','SAUCE'"


def _rls_force(tables: list[str], *, on: bool) -> None:
    """Lift FORCE ROW LEVEL SECURITY around a data migration, then restore it.

    Same reason as 0004, which explains it at length: the migration role owns
    these tables, FORCE makes RLS apply to the owner too, and every policy is
    granted TO zenoeats_app -- so DML run here matches no policy and updates
    zero rows without erroring, while the DDL that follows sees every one.
    """
    verb = "FORCE" if on else "NO FORCE"
    for table in tables:
        op.execute(f"ALTER TABLE {table} {verb} ROW LEVEL SECURITY")


def upgrade() -> None:
    op.add_column(
        "modifier_groups",
        sa.Column(
            "applies_to_kinds",
            postgresql.ARRAY(sa.String(16)),
            nullable=False,
            server_default="{}",
        ),
    )

    _rls_force(["modifier_groups"], on=False)
    # A group that named one kind now names a list of one. A group that named
    # none stays empty, which already means every kind.
    op.execute(
        """
        UPDATE modifier_groups
           SET applies_to_kinds = ARRAY[applies_to_kind]
         WHERE applies_to_kind IS NOT NULL
        """
    )
    _rls_force(["modifier_groups"], on=True)

    # The old column had no constraint, so nothing checked the vocabulary. An
    # array is the harder thing to typo into, not the easier one, so it gets
    # the check the single column never had: every element must be a kind.
    op.create_check_constraint(
        "ck_group_applies_to_kinds",
        "modifier_groups",
        f"applies_to_kinds <@ ARRAY[{KINDS}]::varchar[]",
    )

    op.drop_column("modifier_groups", "applies_to_kind")


def downgrade() -> None:
    """Back to one kind per group, keeping the first.

    Lossy by construction: a Size group offered on drinks and sides is
    exactly what the old column could not hold, so the second kind is
    dropped. The first is kept rather than the group being blanked, because
    showing on too few kinds is a smaller surprise than a group suddenly
    offered on everything.
    """
    op.add_column("modifier_groups", sa.Column("applies_to_kind", sa.String(16), nullable=True))

    _rls_force(["modifier_groups"], on=False)
    op.execute(
        """
        UPDATE modifier_groups
           SET applies_to_kind = applies_to_kinds[1]
         WHERE cardinality(applies_to_kinds) > 0
        """
    )
    # SIDE did not exist before 0004 and has no equivalent here.
    op.execute("UPDATE modifier_groups SET applies_to_kind = 'FOOD' WHERE applies_to_kind = 'SIDE'")
    _rls_force(["modifier_groups"], on=True)

    op.drop_constraint("ck_group_applies_to_kinds", "modifier_groups", type_="check")
    op.drop_column("modifier_groups", "applies_to_kinds")
