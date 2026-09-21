"""Operator sessions can be ended on the server.

Admin and staff sessions are signed tokens in a cookie. Signing out only
deleted the cookie, so a token copied before sign-out -- from a shared
machine, a proxy log, a browser extension -- kept working until it expired:
up to eight hours for an administrator.

users.sessions_valid_after is the fix. Every admin and staff request already
reads the account row; a token issued before this moment is now refused.

  set on admin sign-out            ends that admin's sessions everywhere
  set on staff password change     ends the old password's sessions
  set on a super-admin reset       ends the account's sessions before the
                                   temporary password is handed over

Staff sign-out deliberately does not set it: restaurants share one login
across kitchen tablets, and one person signing out on their phone must not
sign out the tablet on the pass.

Revision ID: 0015
Revises: 0014
"""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column("sessions_valid_after", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "sessions_valid_after")
