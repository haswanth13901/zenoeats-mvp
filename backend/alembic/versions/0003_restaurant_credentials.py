"""Password credentials for restaurant staff.

Clerk owns customer identity. Restaurant operators are issued credentials by
the platform instead: the super admin creates the owner's login, and the owner
manages their own staff from the restaurant portal.

Both columns are nullable because most users have neither. A customer signs
in through Clerk and never has a password_hash; a platform administrator
authenticates against ADMIN_USERS and has no row-level credential either.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("password_hash", sa.String(512), nullable=True))
    # Set when the super admin issues a temporary password. While true, the
    # only thing the account may do is choose a new one -- enforced in
    # require_staff, not merely in the UI, so it cannot be skipped by calling
    # the API directly.
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean,
            nullable=False,
            server_default=sa.false(),
        ),
    )
    # Credentials are looked up by email on every sign-in attempt. Email is
    # already indexed, but not uniquely, and two rows sharing an address would
    # make "which account is this" ambiguous at exactly the wrong moment.
    op.create_index(
        "uq_users_email_with_password",
        "users",
        ["email"],
        unique=True,
        postgresql_where=sa.text("password_hash IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("uq_users_email_with_password", table_name="users")
    op.drop_column("users", "must_change_password")
    op.drop_column("users", "password_hash")
