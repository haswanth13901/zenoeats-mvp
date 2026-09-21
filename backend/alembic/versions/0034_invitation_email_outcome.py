"""What happened to the last invitation email for each team membership.

Sending is done later, by the worker, so the portal answered "we're
emailing them" at the moment of inviting and never heard more. An email the
provider refused -- an unverified sender domain, a bad address -- looked
exactly like one that arrived, and a restaurant waited on an invitation that
was never delivered with nothing on the page to say so.

The worker now writes back the outcome of its last attempt: SENT, FAILED or
NOT_CONFIGURED, when, and for a failure a short explanation fit for the
restaurant admin to read. Null while an invitation is still queued, and for
every membership invited before this existed.

Revision ID: 0034
Revises: 0033
"""

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("restaurant_users", sa.Column("invitation_email_status", sa.String(16), nullable=True))
    op.add_column("restaurant_users", sa.Column("invitation_email_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("restaurant_users", sa.Column("invitation_email_problem", sa.String(200), nullable=True))
    op.create_check_constraint(
        "ck_restaurant_users_invitation_email_status",
        "restaurant_users",
        "invitation_email_status IS NULL OR invitation_email_status IN ('SENT', 'FAILED', 'NOT_CONFIGURED')",
    )


def downgrade() -> None:
    op.drop_constraint("ck_restaurant_users_invitation_email_status", "restaurant_users", type_="check")
    op.drop_column("restaurant_users", "invitation_email_problem")
    op.drop_column("restaurant_users", "invitation_email_at")
    op.drop_column("restaurant_users", "invitation_email_status")
