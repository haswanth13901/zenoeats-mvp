from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


# ---------- Portal / menu ------------------------------------------------

class OptionOut(BaseModel):
    id: UUID
    name: str
    price_delta_minor: int
    is_default: bool
    is_available: bool


class ModifierGroupOut(BaseModel):
    id: UUID
    name: str
    selection_type: str
    is_required: bool
    min_select: int
    max_select: int
    options: list[OptionOut]


class ItemOut(BaseModel):
    id: UUID
    name: str
    description: str | None
    base_price_minor: int
    currency: str
    is_available: bool
    image_path: str | None
    modifier_groups: list[ModifierGroupOut]


class CategoryOut(BaseModel):
    id: UUID
    name: str
    kind: str
    items: list[ItemOut]


class MealOut(BaseModel):
    id: UUID
    name: str
    categories: list[CategoryOut]


class PortalOut(BaseModel):
    restaurant_id: UUID
    slug: str
    name: str
    tagline: str | None
    currency: str
    is_orderable: bool
    accepting_orders: bool
    stripe_publishable_key: str
    stripe_account_id: str | None


class MenuOut(BaseModel):
    meals: list[MealOut]


# ---------- Cart / orders ------------------------------------------------

class CartModifierIn(BaseModel):
    option_id: UUID
    quantity: int = Field(default=1, ge=1, le=20)


class CartLineIn(BaseModel):
    menu_item_id: UUID
    quantity: int = Field(ge=1, le=50)
    note: str | None = Field(default=None, max_length=280)
    modifiers: list[CartModifierIn] = Field(default_factory=list)


class QuoteIn(BaseModel):
    """Preview pricing. No order is created and no money moves."""
    items: list[CartLineIn]


class CreateOrderIn(BaseModel):
    items: list[CartLineIn]
    customer_note: str | None = Field(default=None, max_length=500)
    # Client-computed total, echoed back for a consistency check only. The
    # server total always wins; a mismatch returns PRICE_CHANGED so the
    # customer re-confirms rather than being silently charged a new amount.
    expected_total_minor: int | None = None


class AmountsOut(BaseModel):
    subtotal_minor: int
    discount_minor: int
    tax_minor: int
    total_minor: int


class QuoteOut(BaseModel):
    currency: str
    amounts: AmountsOut


class OrderModifierOut(BaseModel):
    group_name: str
    option_name: str
    unit_price_delta_minor: int
    quantity: int


class OrderItemOut(BaseModel):
    name: str
    quantity: int
    unit_price_minor: int
    line_total_minor: int
    item_note: str | None
    modifiers: list[OrderModifierOut]


class OrderOut(BaseModel):
    order_id: UUID
    order_number: int
    status: str
    payment_status: str
    fulfillment_type: str
    currency: str
    amounts: AmountsOut
    items: list[OrderItemOut]
    # Only ever returned to the owning customer or authorized staff, and only
    # once the order is paid.
    pickup_pin: str | None = None
    expires_at: datetime | None = None
    created_at: datetime


class PaymentIntentOut(BaseModel):
    order_id: UUID
    payment_id: UUID
    client_secret: str
    stripe_account_id: str
    publishable_key: str
    payment_status: str


# ---------- Admin --------------------------------------------------------

class CreateRestaurantIn(BaseModel):
    slug: str = Field(min_length=2, max_length=80, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=160)
    timezone: str = "America/Chicago"
    currency: str = "USD"
    tax_rate_bps: int = Field(default=0, ge=0, le=3000)
    tagline: str | None = None
    admin_email: str | None = None


class RestaurantOut(BaseModel):
    id: UUID
    slug: str
    name: str
    status: str
    currency: str
    tax_rate_bps: int
    accepting_orders: bool
    stripe_account_id: str | None
    charges_enabled: bool
    created_at: datetime


class RestaurantReportOut(BaseModel):
    restaurant_id: UUID
    slug: str
    name: str
    status: str
    currency: str
    orders_paid: int
    gross_revenue_minor: int
    tax_collected_minor: int
    average_order_value_minor: int
    orders_pending_payment: int
    orders_expired: int
    last_order_at: datetime | None
