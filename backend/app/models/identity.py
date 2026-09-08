import enum
import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, uuid_pk


class StaffRole(str, enum.Enum):
    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    KITCHEN = "KITCHEN"
    CASHIER = "CASHIER"


class StaffStatus(str, enum.Enum):
    INVITED = "INVITED"
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"


class User(Base, TimestampMixin):
    """Global platform identity, mirrored from Clerk.

    Clerk owns credentials, sessions, verification and MFA. This table exists
    so orders can carry a real foreign key and so we can authorize without a
    network call to Clerk on every request. Kept in sync by the Clerk webhook
    inbox. No restaurant_id, no tenant RLS policy.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    clerk_user_id: Mapped[str] = mapped_column(String(255), nullable=False, unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class RestaurantUser(Base, TimestampMixin):
    """Staff membership. Tenant owned, RLS enforced.

    Rule 27: a membership becomes ACTIVE only after the target account
    explicitly accepts. An email match alone never grants tenant access.
    Clerk Organizations drives invite and acceptance; this row is the
    authoritative record we authorize against.
    """

    __tablename__ = "restaurant_users"
    __table_args__ = (UniqueConstraint("restaurant_id", "user_id", name="uq_restaurant_user"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    restaurant_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("restaurants.id"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    role_code: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default=StaffStatus.INVITED.value)
    invited_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=True
    )
    invited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
