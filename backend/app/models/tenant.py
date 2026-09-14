import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk


class RestaurantStatus(str, enum.Enum):
    """Frozen RestaurantLifecycle values (Appendix A.1)."""
    DRAFT = "DRAFT"
    INACTIVE = "INACTIVE"
    ACTIVE = "ACTIVE"
    SUSPENDED = "SUSPENDED"
    ARCHIVED = "ARCHIVED"


class TaxMode(str, enum.Enum):
    FLAT = "FLAT"
    STRIPE_TAX = "STRIPE_TAX"


DEFAULT_TAX_CODE = "txcd_40060003"


class Restaurant(Base, TimestampMixin):
    """Tenant root. Request-path access is scoped by id = app.current_tenant."""

    __tablename__ = "restaurants"

    id: Mapped[uuid.UUID] = uuid_pk()
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True,
                                        default=RestaurantStatus.DRAFT.value)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="America/Chicago")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="USD")

    # How tax is worked out. FLAT applies tax_rate_bps to every order.
    # STRIPE_TAX calculates on the restaurant's own connected account, for the
    # pickup address below, so the right state and local rates apply and the
    # sales land in the restaurant's Stripe tax reports. See services/tax.py.
    tax_mode: Mapped[str] = mapped_column(String(16), nullable=False, default=TaxMode.FLAT.value)
    tax_rate_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Stripe product tax code. txcd_40060003, "Food for Immediate
    # Consumption", covers prepared food, meals and dispensed drinks.
    tax_code: Mapped[str] = mapped_column(String(32), nullable=False, default=DEFAULT_TAX_CODE)

    # Where orders are picked up: where the sale happens, so where tax is
    # sourced. Required before a restaurant can use STRIPE_TAX.
    address_line1: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_line2: Mapped[str | None] = mapped_column(String(200), nullable=True)
    address_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address_state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address_postal_code: Mapped[str | None] = mapped_column(String(20), nullable=True)
    address_country: Mapped[str | None] = mapped_column(String(2), nullable=True)

    # Branding
    tagline: Mapped[str | None] = mapped_column(String(200), nullable=True)
    accepting_orders: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    @property
    def is_orderable(self) -> bool:
        return (
            self.status == RestaurantStatus.ACTIVE.value
            and self.accepting_orders
            and self.deleted_at is None
        )
