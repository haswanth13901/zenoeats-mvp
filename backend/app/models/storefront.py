"""A restaurant's presentation, separate from what it sells.

Collections hold pointers, never copies of prices or availability. The menu
remains the authority for what a customer can order, so taking a dish off a
meal period cannot leave a second, stale catalog on the home page.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk


class StorefrontBanner(Base, TimestampMixin):
    __tablename__ = "storefront_banners"

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True)
    image_path: Mapped[str] = mapped_column(String(500), nullable=False)
    headline: Mapped[str] = mapped_column(String(80), nullable=False, default="")
    subline: Mapped[str] = mapped_column(String(160), nullable=False, default="")
    cta_label: Mapped[str] = mapped_column(String(30), nullable=False, default="Explore the menu")
    cta_target_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="menu")
    cta_target_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # How the photograph sits in the banner, which is a fixed shape the photo
    # rarely shares. The point of the picture -- a face, a burger, a logo --
    # is what has to survive the crop, and only the person who chose the photo
    # knows where it is. Percentages of the image, not pixels: the same values
    # hold when the same banner is cropped differently on a phone.
    focal_x: Mapped[int] = mapped_column(Integer, nullable=False, default=50)
    focal_y: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    # Percent. 100 is the photo at its natural cover size; higher moves in.
    zoom: Mapped[int] = mapped_column(Integer, nullable=False, default=100)


class StorefrontCollection(Base, TimestampMixin):
    __tablename__ = "storefront_collections"

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(60), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class StorefrontCollectionItem(Base):
    __tablename__ = "storefront_collection_items"
    __table_args__ = (UniqueConstraint("collection_id", "item_id", name="uq_storefront_collection_item"),)

    collection_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("storefront_collections.id", ondelete="CASCADE"), primary_key=True)
    item_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("menu_items.id"), primary_key=True)
    restaurant_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
