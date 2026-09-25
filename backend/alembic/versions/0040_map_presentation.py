"""How a restaurant's delivery map looks.

The map on a customer's order page was the same for every restaurant: the
platform's map style, and pins in the platform's colours, under a storefront
the restaurant had otherwise made its own.

Two settings now sit beside the rest of the storefront. The style names one
of the map styles the platform has set up in Google Cloud (null means the
platform's default), and the pins follow the restaurant's palette unless it
turns that off -- a restaurant whose brand colour is nearly the colour of a
road is better served by the plain pins.

Revision ID: 0040
Revises: 0039
"""

import sqlalchemy as sa
from alembic import op

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("restaurants", sa.Column("map_style_key", sa.String(32), nullable=True))
    op.add_column(
        "restaurants",
        sa.Column("map_pins_themed", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    op.drop_column("restaurants", "map_pins_themed")
    op.drop_column("restaurants", "map_style_key")
