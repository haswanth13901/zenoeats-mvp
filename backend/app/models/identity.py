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
    # Runs deliveries. Sees the orders assigned to them and nothing else --
    # not the board, the menu, stock, reports or the team.
    DRIVER = "DRIVER"


class StaffStatus(str, enum.Enum):
    INVITED = "INVITED"
    ACTIVE = "ACTIVE"
    REVOKED = "REVOKED"


class UserKind(str, enum.Enum):
    """Which of the three identity systems a users row belongs to.

    The populations never overlap. A person who orders lunch and also works a
    restaurant's counter has two rows: one reached through Clerk, one through
    the credentials the restaurant issued. Keeping them apart is what stops a
    customer sign-in from ever opening a staff portal, and an email match from
    ever merging the two.

    GUEST is the one kind that is not a person we can name. It is created for
    a checkout with no account behind it, holds only what the customer typed
    for their receipt, and is reachable exclusively by the cookie minted with
    it (core/guest_auth.py). One row per guest checkout session, never looked
    up by email: an address nobody verified must not find another guest's
    orders.
    """

    CUSTOMER = "CUSTOMER"
    GUEST = "GUEST"
    STAFF = "STAFF"
    PLATFORM_ADMIN = "PLATFORM_ADMIN"


class User(Base, TimestampMixin):
    """Global platform identity. No restaurant_id, no tenant RLS policy.

    For customers, Clerk owns credentials, sessions, verification and Google
    sign-in, and this row mirrors the parts we need: a real foreign key for
    orders, and an email for receipts. Every permission is still resolved from
    our own tables, never from a claim in a token.
    """

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = uuid_pk()
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    # Customers only. Platform administrators and restaurant staff have no
    # Clerk identity, but still need a row here: platform_audit_logs and
    # restaurant_users both carry NOT NULL foreign keys to users.id.
    clerk_user_id: Mapped[str | None] = mapped_column(
        String(255), nullable=True, unique=True, index=True
    )
    email: Mapped[str] = mapped_column(String(320), nullable=False, index=True)
    full_name: Mapped[str | None] = mapped_column(String(160), nullable=True)
    # Customers and guests: the details checkout last saved, offered again
    # next time. Null until the first order; checkout is what requires them.
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Restaurant staff only. Customers authenticate through Clerk and platform
    # administrators against ADMIN_USERS, so both are null for them.
    password_hash: Mapped[str | None] = mapped_column(String(512), nullable=True)
    must_change_password: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Admin and staff tokens issued before this moment are refused. Set by
    # admin sign-out, a staff password change and a super-admin reset, so a
    # copied token stops working then rather than when it would have expired.
    sessions_valid_after: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def session_revoked(self, issued_at: float) -> bool:
        """Whether a token issued at `issued_at` (epoch seconds) predates the
        last time this account's sessions were ended."""
        return (
            self.sessions_valid_after is not None
            and issued_at < self.sessions_valid_after.timestamp()
        )


class RestaurantUser(Base, TimestampMixin):
    """Staff membership. Tenant owned, RLS enforced.

    Rule 27: a membership becomes ACTIVE only after the target account
    explicitly accepts. An email match alone never grants tenant access. The
    invitee signs in to this restaurant's portal with their staff credentials
    and accepts there; this row is the authoritative record we authorize
    against.
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
