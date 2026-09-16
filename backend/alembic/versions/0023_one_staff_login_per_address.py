"""One staff login per email address, enforced by the database.

Sign-in finds a staff account by address alone and expects exactly one row
(api/v1/restaurant.py, staff_login). Two rows sharing an address therefore do
not shadow one another -- they make both accounts unreachable, because the
query raises rather than choosing. Nothing but convention stopped a second one
being created: users.email was indexed and not unique.

The invitation path happens to be careful, reusing an existing staff login
instead of making another, and the address change added alongside this
migration checks before it writes. Both are application rules, and an
application rule is one refactor away from not being a rule. This makes it
structural.

Deliberately not excluding soft-deleted rows: sign-in does not filter on
deleted_at either, so a deleted row and a live one sharing an address would
break exactly the same way. Staff rows are never soft-deleted today -- only
customers are, through Clerk -- so nothing is lost by counting them.

On lower(email) rather than email, because the constraint should hold against
a future caller that forgets to normalise. Every path today writes the address
already lowercased.

Revision ID: 0023
Revises: 0022
"""

from alembic import op

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None

INDEX = "uq_users_staff_email"


def upgrade() -> None:
    # Fails loudly if duplicates exist rather than silently skipping them: a
    # duplicate here means two people cannot sign in, which is worth stopping
    # a deploy for. There were none when this was written.
    op.execute(
        f"CREATE UNIQUE INDEX {INDEX} ON users (lower(email)) WHERE kind = 'STAFF'"
    )


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {INDEX}")
