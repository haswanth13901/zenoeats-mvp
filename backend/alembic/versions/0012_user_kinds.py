"""Every users row names the identity system it belongs to.

Three populations share the users table and must never be confused for one
another:

  CUSTOMER        signs in through Clerk; reached by clerk_user_id
  STAFF           credentials the platform issues; users.password_hash
  PLATFORM_ADMIN  declared in ADMIN_USERS

Until now which one a row was had to be inferred -- a clerk_user_id here, a
password_hash there -- and the inferences overlapped: a platform admin was
looked up as "a row with this email and no Clerk id", which a restaurant
owner with the same address also is. users.kind says it outright.

Backfilled from what each row already was:

  is_platform_admin                      PLATFORM_ADMIN
  password_hash set, or the "pending:"   STAFF
    placeholder a staff invite made
  anything else                          CUSTOMER

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("kind", sa.String(16), nullable=True))
    op.execute(
        """
        UPDATE users SET kind = CASE
            WHEN is_platform_admin THEN 'PLATFORM_ADMIN'
            WHEN password_hash IS NOT NULL THEN 'STAFF'
            WHEN clerk_user_id LIKE 'pending:%' THEN 'STAFF'
            ELSE 'CUSTOMER'
        END
        """
    )
    op.alter_column("users", "kind", existing_type=sa.String(16), nullable=False)
    op.create_check_constraint(
        "ck_users_kind", "users", "kind IN ('CUSTOMER', 'STAFF', 'PLATFORM_ADMIN')"
    )


def downgrade() -> None:
    op.drop_constraint("ck_users_kind", "users", type_="check")
    op.drop_column("users", "kind")
