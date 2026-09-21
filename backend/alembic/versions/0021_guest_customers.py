"""Ordering without an account.

A guest checkout still needs somewhere for the order's customer_user_id to
point, so a guest is a users row like everyone else -- with no Clerk id, no
password, and only the address typed for the receipt. GUEST joins the kinds
here; nothing else about the table changes.

Existing rows are untouched: no order becomes a guest order retroactively,
and the constraint only widens, so this is safe to apply ahead of the code
that writes the new kind.

Revision ID: 0021
Revises: 0020
"""

from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

BEFORE = "'CUSTOMER', 'STAFF', 'PLATFORM_ADMIN'"
AFTER = "'CUSTOMER', 'GUEST', 'STAFF', 'PLATFORM_ADMIN'"


def upgrade() -> None:
    op.drop_constraint("ck_users_kind", "users", type_="check")
    op.create_check_constraint("ck_users_kind", "users", f"kind IN ({AFTER})")


def downgrade() -> None:
    """Guests with orders survive this, deactivated but present.

    Their orders are paid history and carry a NOT NULL foreign key to them, so
    deleting the rows would mean destroying real sales. Only guests that never
    got as far as an order are removed. The restored constraint is therefore
    NOT VALID: it governs every new row, and grandfathers the ones that would
    otherwise make this migration impossible to run at all.
    """
    op.execute("UPDATE users SET is_active = false WHERE kind = 'GUEST'")
    op.execute(
        "DELETE FROM users WHERE kind = 'GUEST' AND id NOT IN "
        "(SELECT customer_user_id FROM orders)"
    )
    op.drop_constraint("ck_users_kind", "users", type_="check")
    op.execute(
        f"ALTER TABLE users ADD CONSTRAINT ck_users_kind "
        f"CHECK (kind IN ({BEFORE})) NOT VALID"
    )
