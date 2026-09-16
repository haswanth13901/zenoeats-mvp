"""Delivery areas: where a restaurant delivers, and what it charges.

Until now "delivery" meant a manager handing an already-paid collection to one
of the restaurant's own drivers, with an address typed by hand afterwards.
This is the groundwork for a customer choosing delivery and being charged for
it: rings drawn around the restaurant, each with a fee, and the restaurant's
own address placed on a map to measure them from.

Beyond the outermost ring is not free delivery. It is no delivery.

Coordinates for the restaurant are stored; coordinates for customers are not.
Google's terms allow caching a geocoding result for about thirty days rather
than keeping it, and a restaurant's own trading address is a fact it gave us
about itself. What an order will keep is the distance and the fee, which are
ours to keep.

Revision ID: 0024
Revises: 0023
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731

    # --- the restaurant's own position ---------------------------------
    op.add_column(
        "restaurants",
        sa.Column("delivery_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("restaurants", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("restaurants", sa.Column("longitude", sa.Float(), nullable=True))
    # The address those coordinates were found from, so an address edited
    # without placing it again is detectable rather than quietly measuring
    # every delivery from where the restaurant used to be.
    op.add_column("restaurants", sa.Column("geocoded_address", sa.String(500), nullable=True))

    # --- the rings ------------------------------------------------------
    op.create_table(
        "delivery_zones",
        sa.Column("id", uid(), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("max_miles", sa.Float(), nullable=False),
        sa.Column("fee_minor", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("max_miles > 0", name="ck_delivery_zone_miles"),
        sa.CheckConstraint("fee_minor >= 0", name="ck_delivery_zone_fee"),
        # Two rings sharing an edge leave an empty band between them and make
        # the cheaper one unreachable.
        sa.UniqueConstraint("restaurant_id", "max_miles", name="uq_delivery_zone_edge"),
    )
    op.create_index("ix_delivery_zones_rid", "delivery_zones", ["restaurant_id", "max_miles"])

    # Tenant-owned: ENABLE + FORCE RLS and the app-role policy that every
    # table carrying restaurant_id gets in 0001.
    op.execute("ALTER TABLE delivery_zones ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE delivery_zones FORCE ROW LEVEL SECURITY")
    op.execute(
        """
        CREATE POLICY p_delivery_zones_tenant ON delivery_zones
        FOR ALL TO zenoeats_app
        USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)
        """
    )
    # Full rights here, unlike order_events: a ring is a setting a restaurant
    # edits and removes, not a record of something that happened.
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_zones TO zenoeats_app")


def downgrade() -> None:
    op.drop_table("delivery_zones")
    op.drop_column("restaurants", "geocoded_address")
    op.drop_column("restaurants", "longitude")
    op.drop_column("restaurants", "latitude")
    op.drop_column("restaurants", "delivery_enabled")
