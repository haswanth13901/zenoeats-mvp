import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer,
    SmallInteger, String, Text, UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, uuid_pk


class OrderStatus(str, enum.Enum):
    """Frozen OrderStatus values, pickup-only MVP subset (Appendix A.5).

    Delivery states (READY_FOR_DELIVERY, DRIVER_ASSIGNED, DRIVER_ACCEPTED,
    OUT_FOR_DELIVERY, DELIVERY_FAILED) are intentionally absent from this
    build. They stay in the v3.0 baseline for the delivery release.
    """
    PENDING_PAYMENT = "PENDING_PAYMENT"
    AUTO_ACCEPTED = "AUTO_ACCEPTED"
    PREPARING = "PREPARING"
    READY_FOR_PICKUP = "READY_FOR_PICKUP"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"


# Normative transition matrix (Appendix A.6), pickup subset.
# Any transition not listed here is rejected with ORDER_STATE_CONFLICT.
ALLOWED_TRANSITIONS: dict[str, set[str]] = {
    OrderStatus.PENDING_PAYMENT.value: {
        OrderStatus.AUTO_ACCEPTED.value,
        OrderStatus.EXPIRED.value,
        OrderStatus.CANCELLED.value,
    },
    OrderStatus.AUTO_ACCEPTED.value: {
        OrderStatus.PREPARING.value,
        OrderStatus.CANCELLED.value,
    },
    OrderStatus.PREPARING.value: {
        OrderStatus.READY_FOR_PICKUP.value,
        OrderStatus.CANCELLED.value,
    },
    OrderStatus.READY_FOR_PICKUP.value: {
        OrderStatus.COMPLETED.value,
        OrderStatus.CANCELLED.value,
    },
    OrderStatus.COMPLETED.value: set(),
    OrderStatus.CANCELLED.value: set(),
    OrderStatus.EXPIRED.value: set(),
}


class RestaurantOrderCounter(Base):
    """Per-restaurant order number allocation.

    Rule: never SELECT MAX(order_number)+1 and never one global sequence.
    The row is locked FOR UPDATE inside the order-creation transaction so two
    concurrent checkouts cannot receive the same number.
    """

    __tablename__ = "restaurant_order_counters"
    __table_args__ = (
        CheckConstraint("next_order_number >= 1", name="ck_counter_min"),
    )

    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), primary_key=True
    )
    next_order_number: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1001)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Order(Base, TimestampMixin):
    __tablename__ = "orders"
    __table_args__ = (
        UniqueConstraint("restaurant_id", "order_number", name="uq_order_number_per_restaurant"),
        CheckConstraint("subtotal_minor >= 0", name="ck_order_subtotal"),
        CheckConstraint("discount_minor >= 0", name="ck_order_discount"),
        CheckConstraint("tax_minor >= 0", name="ck_order_tax"),
        CheckConstraint("total_minor >= 0", name="ck_order_total"),
        CheckConstraint(
            "pickup_pin_failed_attempts >= 0 AND pickup_pin_failed_attempts <= 5",
            name="ck_order_pin_attempts",
        ),
        Index("ix_orders_board", "restaurant_id", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    order_number: Mapped[int] = mapped_column(BigInteger, nullable=False)
    customer_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )

    fulfillment_type: Mapped[str] = mapped_column(String(16), nullable=False, default="PICKUP")
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    payment_method: Mapped[str] = mapped_column(String(24), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)

    # Immutable commercial snapshots. Rule 4: later menu edits never rewrite
    # order history.
    subtotal_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    discount_minor: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    tax_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)

    customer_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Encrypted, not hashed: the authenticated customer must be able to read
    # it back. Never logged, never in a URL, never in a push body.
    pickup_pin_encrypted: Mapped[str | None] = mapped_column(Text, nullable=True)
    pickup_pin_failed_attempts: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0
    )

    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_reason: Mapped[str | None] = mapped_column(String(120), nullable=True)

    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order", cascade="all, delete-orphan"
    )


class OrderItem(Base):
    __tablename__ = "order_items"
    __table_args__ = (
        CheckConstraint("unit_price_minor >= 0", name="ck_order_item_price"),
        CheckConstraint("quantity > 0", name="ck_order_item_qty"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("orders.id"), nullable=False, index=True
    )
    menu_item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("menu_items.id"), nullable=True
    )
    name_snapshot: Mapped[str] = mapped_column(String(180), nullable=False)
    unit_price_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    line_total_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    item_note: Mapped[str | None] = mapped_column(String(280), nullable=True)

    order: Mapped["Order"] = relationship(back_populates="items")
    modifiers: Mapped[list["OrderItemModifier"]] = relationship(
        back_populates="order_item", cascade="all, delete-orphan"
    )


class OrderItemModifier(Base):
    __tablename__ = "order_item_modifiers"
    __table_args__ = (
        CheckConstraint("quantity > 0", name="ck_order_modifier_qty"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    order_item_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("order_items.id"), nullable=False, index=True
    )
    modifier_option_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    group_name_snapshot: Mapped[str] = mapped_column(String(180), nullable=False)
    option_name_snapshot: Mapped[str] = mapped_column(String(180), nullable=False)
    # Documented exception: may be negative. No non-negative CHECK here.
    unit_price_delta_minor: Mapped[int] = mapped_column(BigInteger, nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    order_item: Mapped["OrderItem"] = relationship(back_populates="modifiers")


class IdempotencyKey(Base):
    """Durable replay contract for critical mutations (section 17.1).

    Same key + same request hash returns the stored response.
    Same key + different request hash returns 409.
    Platform-owned. No tenant RLS policy.
    """

    __tablename__ = "idempotency_keys"
    __table_args__ = (
        UniqueConstraint("key", "actor_id", "endpoint", name="uq_idempotency"),
        Index("ix_idempotency_expiry", "expires_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    key: Mapped[str] = mapped_column(String(255), nullable=False)
    actor_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    endpoint: Mapped[str] = mapped_column(String(255), nullable=False)
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)
    response_body: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
