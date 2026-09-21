"""When a customer agreed to the terms, and to which version.

The sign-up page has always shown a checkbox; nothing recorded that it was
ticked. That is answerable while the form is on screen and unanswerable
afterwards, which is the wrong way round -- the question is asked months
later, about one person, usually by someone who is not us.

Nullable on purpose. Staff and platform administrators agree to nothing here,
and every customer who signed up before this column existed has no agreement
on record. A backfilled timestamp would be a worse answer than none, because
it would look like evidence.

Revision ID: 0033
Revises: 0032
"""

import sqlalchemy as sa
from alembic import op

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("terms_accepted_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("terms_version", sa.String(32), nullable=True))
    # Either both or neither. A timestamp without a version says someone
    # agreed to something we can no longer identify, which is not evidence of
    # anything; a version without a timestamp is not evidence either.
    op.create_check_constraint(
        "ck_users_terms_recorded_together",
        "users",
        "(terms_accepted_at IS NULL) = (terms_version IS NULL)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_terms_recorded_together", "users", type_="check")
    op.drop_column("users", "terms_version")
    op.drop_column("users", "terms_accepted_at")
