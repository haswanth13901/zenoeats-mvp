"""A modifier option may carry a picture, as an item already could.

"Extra cheese" reads as well as a word, but a customer choosing between three
sauces or four sizes of cup is choosing by eye. Items have had an image column
since the first migration; options never did.

A KEY, NOT A URL. The column holds a storage key shaped like
restaurants/<id>/options/<random>.webp, and the API builds the URL on the way
out. Stored as a URL, every row would name the host it was uploaded to, and
moving the images to object storage would mean rewriting the menu.

Nullable, with no default and no backfill. Every option that exists has no
picture, and that stays a complete, valid option: a picture is something a
restaurant adds, not something the schema asks for.

No row-level security change. The table's policy already filters by
restaurant_id, and a new column inherits it.

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("modifier_options", sa.Column("image_path", sa.Text(), nullable=True))


def downgrade() -> None:
    """Options forget their pictures. The files stay in storage, unreferenced,
    because a migration has no business deleting uploads it cannot put back."""
    op.drop_column("modifier_options", "image_path")
