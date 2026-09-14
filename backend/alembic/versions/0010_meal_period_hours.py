"""A meal period may say the hours it is served.

Breakfast 7:00 to 11:00, Late night 22:00 to 02:00. Two nullable columns
rather than one required pair, because every period that exists today says
nothing about hours and must stay valid: unset means the restaurant has not
said, not midnight to midnight.

WALL CLOCK, NOT AN INSTANT. `time without time zone`, read in whatever the
restaurant's own day is. There is no timezone on a restaurant anywhere in
this schema, so an aware time would be storing an offset nobody supplied and
could not be trusted to be right. That is deliberate and it is also the
limit: these hours are for a customer to read. Nothing gates ordering by
them, and nothing should until a restaurant carries a timezone, or a shop in
one place would stop taking orders on a clock belonging to another.

CROSSING MIDNIGHT IS ALLOWED. Late night runs 22:00 to 02:00 and that is the
period most likely to want hours at all, so there is no `starts_at < ends_at`
check here. An end at or before the start reads as running into the next day.
Equal ends are refused by the API rather than by the database, where the
message can say which of the two readings -- nothing, or a full day -- it
could not choose between.

BOTH OR NEITHER. Half a range is not a fact about anything: a period that
opens at seven and never closes tells a customer less than saying nothing.
The constraint is written as an equality between two IS NULL tests, which is
true when both are set and true when both are unset.

Revision ID: 0010
Revises: 0009
"""

import sqlalchemy as sa
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("meals", sa.Column("starts_at", sa.Time(), nullable=True))
    op.add_column("meals", sa.Column("ends_at", sa.Time(), nullable=True))
    op.create_check_constraint(
        "ck_meal_hours_both_or_neither",
        "meals",
        "(starts_at IS NULL) = (ends_at IS NULL)",
    )


def downgrade() -> None:
    """Hours are forgotten. Nothing else changes.

    No item moves and no period disappears -- a period that said 7:00 to
    11:00 goes back to saying nothing about when it is served, which is the
    menu every restaurant had before this ran.
    """
    op.drop_constraint("ck_meal_hours_both_or_neither", "meals", type_="check")
    op.drop_column("meals", "ends_at")
    op.drop_column("meals", "starts_at")
