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

    # Platform tax policy for the approved launch geography. Swap for a
    # provider (Stripe Tax / TaxJar) behind TaxService when going
    # multi-jurisdiction. See section 7.1 of the architecture baseline.
    tax_rate_bps: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

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
