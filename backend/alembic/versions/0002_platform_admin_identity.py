"""Allow non-Clerk platform identities.

Clerk owns customer identity. Platform administrators authenticate against
credentials in the environment instead, so they have no Clerk user id -- but
they still need a users row, because platform_audit_logs.actor_user_id is a
NOT NULL foreign key to users.id. Without a row, every audited super-admin
action would fail.

clerk_user_id stays UNIQUE. Postgres allows many NULLs in a unique index, so
several non-Clerk identities coexist while Clerk ids remain one-to-one.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column(
        "users",
        "clerk_user_id",
        existing_type=sa.String(255),
        nullable=True,
    )
    # A row must be reachable by exactly one identity system. Without this,
    # a row with neither id is unreachable and a row with both is ambiguous.
    op.create_check_constraint(
        "ck_users_has_identity",
        "users",
        "clerk_user_id IS NOT NULL OR email IS NOT NULL",
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_has_identity", "users", type_="check")
    op.execute("DELETE FROM users WHERE clerk_user_id IS NULL")
    op.alter_column(
        "users",
        "clerk_user_id",
        existing_type=sa.String(255),
        nullable=False,
    )
