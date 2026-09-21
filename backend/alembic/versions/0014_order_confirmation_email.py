"""Remember that an order's confirmation email has been sent.

The email goes out from the worker once the payment webhook marks the order
paid. Resend's idempotency key covers a retry within 24 hours; this covers
everything else -- a webhook redelivered days later, a task replayed by hand
-- so a customer is never told twice that the same order is confirmed.

Revision ID: 0014
Revises: 0013
"""

import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "orders",
        sa.Column("confirmation_email_sent_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("orders", "confirmation_email_sent_at")
