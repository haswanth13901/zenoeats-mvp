"""How a restaurant's name is shown beside its logo.

The customer header and the sign-in pages show a mark and the restaurant's
name. The mark could already be a logo (restaurants.logo_path); the name was
always plain text in the platform's display font. A restaurant can now
either pick the font its name is set in, or upload its own lettering as an
image. An image, when there is one, takes precedence; clearing it goes back
to text in the chosen font.

Existing restaurants keep exactly what they show today: no image, and the
default font.

Revision ID: 0035
Revises: 0034
"""

import sqlalchemy as sa
from alembic import op

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None

FONTS = ("default", "lora", "playfair", "fraunces", "merriweather", "dm_sans")


def upgrade() -> None:
    op.add_column("restaurants", sa.Column("brand_name_image_path", sa.String(500), nullable=True))
    op.add_column(
        "restaurants",
        sa.Column("brand_name_font", sa.String(32), nullable=False, server_default="default"),
    )
    op.create_check_constraint(
        "ck_restaurants_brand_name_font",
        "restaurants",
        "brand_name_font IN (" + ", ".join(f"'{f}'" for f in FONTS) + ")",
    )


def downgrade() -> None:
    op.drop_constraint("ck_restaurants_brand_name_font", "restaurants", type_="check")
    op.drop_column("restaurants", "brand_name_font")
    op.drop_column("restaurants", "brand_name_image_path")
