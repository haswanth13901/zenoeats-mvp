"""Menu structure.

    Meal            Breakfast / Lunch / Dinner
      Category      kind = FOOD | BEVERAGE | SAUCE
        Item        the sellable thing
          <- ItemModifierGroup ->
            ModifierGroup     "Veggies", "Ice level", "Sauce add-ons"
              ModifierOption  "Lettuce" (+$0.00), "Light" / "Regular" / "Heavy"

Modifier groups are restaurant-level and reusable, attached to items through
the ItemModifierGroup join. A restaurant with twenty drinks defines "Ice
level" once. applies_to_kind lets the menu builder pre-filter the library so
adding a beverage surfaces Ice level rather than Veggies.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, Integer,
    String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class CategoryKind(str, enum.Enum):
    FOOD = "FOOD"
    BEVERAGE = "BEVERAGE"
    SAUCE = "SAUCE"


class SelectionType(str, enum.Enum):
    SINGLE = "SINGLE"   # radio. Ice level: light / regular / heavy.
    MULTI = "MULTI"     # checkbox. Veggies: lettuce, tomato, onion.


class Meal(Base, TimestampMixin):
    __tablename__ = "meals"

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    categories: Mapped[list["Category"]] = relationship(
        back_populates="meal", order_by="Category.sort_order"
    )


class Category(Base, TimestampMixin):
    __tablename__ = "menu_categories"

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    meal_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("meals.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default=CategoryKind.FOOD.value)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    meal: Mapped["Meal"] = relationship(back_populates="categories")
    items: Mapped[list["Item"]] = relationship(
        back_populates="category", order_by="Item.sort_order"
    )


class Item(Base, TimestampMixin):
    __tablename__ = "menu_items"
    __table_args__ = (
        CheckConstraint("base_price_minor >= 0", name="ck_item_price_non_negative"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_categories.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    base_price_minor: Mapped[int] = mapped_column(nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    image_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    category: Mapped["Category"] = relationship(back_populates="items")
    modifier_links: Mapped[list["ItemModifierGroup"]] = relationship(
        back_populates="item", order_by="ItemModifierGroup.sort_order",
        cascade="all, delete-orphan",
    )


class ModifierGroup(Base, TimestampMixin):
    __tablename__ = "modifier_groups"
    __table_args__ = (
        CheckConstraint("min_select >= 0", name="ck_group_min_non_negative"),
        CheckConstraint("max_select >= min_select", name="ck_group_max_gte_min"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    selection_type: Mapped[str] = mapped_column(
        String(16), nullable=False, default=SelectionType.MULTI.value
    )
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    min_select: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_select: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # Menu-builder filter hint. NULL means the group fits any category kind.
    applies_to_kind: Mapped[str | None] = mapped_column(String(16), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    options: Mapped[list["ModifierOption"]] = relationship(
        back_populates="group", order_by="ModifierOption.sort_order"
    )


class ModifierOption(Base, TimestampMixin):
    __tablename__ = "modifier_options"

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("modifier_groups.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    # May be negative: "no cheese -$0.50" is a legitimate decrement.
    # This is the documented exception to the non-negative money constraint.
    price_delta_minor: Mapped[int] = mapped_column(nullable=False, default=0)
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    group: Mapped["ModifierGroup"] = relationship(back_populates="options")


class ItemModifierGroup(Base):
    """Attaches a reusable modifier group to an item."""

    __tablename__ = "item_modifier_groups"
    __table_args__ = (
        UniqueConstraint("item_id", "group_id", name="uq_item_modifier_group"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_items.id"), nullable=False, index=True
    )
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("modifier_groups.id"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    item: Mapped["Item"] = relationship(back_populates="modifier_links")
    group: Mapped["ModifierGroup"] = relationship()
