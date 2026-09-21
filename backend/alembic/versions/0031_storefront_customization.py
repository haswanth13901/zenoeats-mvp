"""Restaurant-owned storefront presentation, behind a platform switch.

The menu stays the only catalog. These tables hold photographs, presentation
and references to existing items; turning the module off leaves the saved
configuration in place but makes the public portal read exactly as before.
Every new table is tenant-owned and receives ENABLE and FORCE RLS together.

Revision ID: 0031
Revises: 0030
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade() -> None:
    uid = lambda: postgresql.UUID(as_uuid=True)  # noqa: E731
    op.add_column("restaurants", sa.Column("storefront_customization_enabled", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("restaurants", sa.Column("theme", postgresql.JSONB(), nullable=True))
    op.add_column("restaurants", sa.Column("logo_path", sa.String(500), nullable=True))
    op.add_column("restaurants", sa.Column("banner_interval_ms", sa.Integer(), nullable=False, server_default="5000"))
    op.create_check_constraint("ck_storefront_interval", "restaurants", "banner_interval_ms BETWEEN 2000 AND 10000")
    op.add_column("item_types", sa.Column("image_path", sa.String(500), nullable=True))
    op.add_column("item_types", sa.Column("show_in_shortcuts", sa.Boolean(), nullable=False, server_default=sa.true()))

    def common():
        return [sa.Column("id", uid(), primary_key=True),
                sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
                sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
                sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
                sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
                sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now())]

    op.create_table("storefront_banners", *common(),
        sa.Column("image_path", sa.String(500), nullable=False),
        sa.Column("headline", sa.String(80), nullable=False),
        sa.Column("subline", sa.String(160), nullable=False),
        sa.Column("cta_label", sa.String(30), nullable=False),
        sa.Column("cta_target_kind", sa.String(16), nullable=False),
        sa.Column("cta_target_id", uid(), nullable=True),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint("cta_target_kind IN ('menu','item_type','item','collection')", name="ck_banner_target_kind"),
        sa.CheckConstraint("(cta_target_kind = 'menu') = (cta_target_id IS NULL)", name="ck_banner_target_id"),
        sa.CheckConstraint("starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at", name="ck_banner_dates"))
    op.create_table("storefront_collections", *common(), sa.Column("title", sa.String(60), nullable=False))
    op.create_table("storefront_collection_items",
        sa.Column("collection_id", uid(), sa.ForeignKey("storefront_collections.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("item_id", uid(), sa.ForeignKey("menu_items.id"), primary_key=True),
        sa.Column("restaurant_id", uid(), sa.ForeignKey("restaurants.id"), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.UniqueConstraint("collection_id", "item_id", name="uq_storefront_collection_item"))
    for table in ("storefront_banners", "storefront_collections", "storefront_collection_items"):
        op.create_index(f"ix_{table}_restaurant_id", table, ["restaurant_id"])
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(f"""CREATE POLICY p_{table}_tenant ON {table} FOR ALL TO zenoeats_app
            USING (restaurant_id = current_setting('app.current_tenant', true)::uuid)
            WITH CHECK (restaurant_id = current_setting('app.current_tenant', true)::uuid)""")
        grants = "SELECT, INSERT, DELETE" if table == "storefront_collection_items" else "SELECT, INSERT, UPDATE, DELETE"
        op.execute(f"GRANT {grants} ON {table} TO zenoeats_app")


def downgrade() -> None:
    for table in ("storefront_collection_items", "storefront_banners", "storefront_collections"):
        op.drop_table(table)
    op.drop_column("item_types", "show_in_shortcuts")
    op.drop_column("item_types", "image_path")
    op.drop_constraint("ck_storefront_interval", "restaurants", type_="check")
    for column in ("banner_interval_ms", "logo_path", "theme", "storefront_customization_enabled"):
        op.drop_column("restaurants", column)
