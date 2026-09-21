"""How each banner photograph is framed.

A banner is a fixed shape and a photograph is whatever shape it was taken in,
so the storefront has always cropped. Until now it cropped every photo the
same way -- centre, 60% down -- which cut the subject out of any picture that
did not happen to agree with that. These three columns let the restaurant say
which part of its own photo matters.

The defaults reproduce exactly what saved banners show today, so no existing
storefront changes appearance when this runs.

Revision ID: 0032
Revises: 0031
"""

import sqlalchemy as sa
from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("storefront_banners", sa.Column("focal_x", sa.Integer(), nullable=False, server_default="50"))
    op.add_column("storefront_banners", sa.Column("focal_y", sa.Integer(), nullable=False, server_default="60"))
    op.add_column("storefront_banners", sa.Column("zoom", sa.Integer(), nullable=False, server_default="100"))
    # The API validates these too. The constraint is what holds when something
    # else writes the row -- a fix-up script, a future import, a mistake.
    op.create_check_constraint("ck_banner_focal", "storefront_banners", "focal_x BETWEEN 0 AND 100 AND focal_y BETWEEN 0 AND 100")
    op.create_check_constraint("ck_banner_zoom", "storefront_banners", "zoom BETWEEN 100 AND 200")


def downgrade() -> None:
    op.drop_constraint("ck_banner_zoom", "storefront_banners", type_="check")
    op.drop_constraint("ck_banner_focal", "storefront_banners", type_="check")
    for column in ("zoom", "focal_y", "focal_x"):
        op.drop_column("storefront_banners", column)
