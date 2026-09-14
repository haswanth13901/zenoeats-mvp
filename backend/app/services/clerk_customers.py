"""Customers, as mirrored from Clerk.

Clerk owns who a customer is. This module keeps the one row per Clerk user
that the rest of the platform needs -- orders carry a foreign key to it, and
Stripe sends the receipt to its email -- and fills that row from Clerk's
Backend API the first time a customer shows up, rather than waiting for a
webhook. In local development the webhook never arrives at all, and in
production it can land seconds after the customer has already reached
checkout.

The webhook (api/v1/webhooks.py) is still the source of later changes: a new
email address, a new name, a deleted account.
"""

import logging
from dataclasses import dataclass

import httpx
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.core import errors
from app.db.base import utcnow
from app.db.session import system_session
from app.models import User, UserKind

log = logging.getLogger(__name__)

CLERK_API = "https://api.clerk.com/v1"
PENDING_EMAIL_DOMAIN = "pending.local"


@dataclass(frozen=True)
class ClerkProfile:
    clerk_user_id: str
    email: str | None
    email_verified: bool
    full_name: str | None


def profile_from_payload(data: dict) -> ClerkProfile:
    """Read a Clerk user object -- the Backend API's and the webhook's are the
    same shape."""
    emails = data.get("email_addresses") or []
    primary_id = data.get("primary_email_address_id")
    primary = next((e for e in emails if e.get("id") == primary_id), emails[0] if emails else None)
    email = (primary or {}).get("email_address")
    verified = ((primary or {}).get("verification") or {}).get("status") == "verified"
    name = " ".join(p for p in [data.get("first_name"), data.get("last_name")] if p) or None
    return ClerkProfile(
        clerk_user_id=str(data.get("id") or ""),
        email=email.strip().lower() if email else None,
        email_verified=verified,
        full_name=name[:160] if name else None,
    )


def fetch_profile(clerk_user_id: str) -> ClerkProfile | None:
    """The user as Clerk has them, or None if Clerk cannot say right now.

    None is survivable: the customer still gets a row, with a placeholder
    address that is filled in on a later request or by the webhook. A slow
    Clerk must not stand between a customer and their order.
    """
    if not settings.CLERK_SECRET_KEY:
        return None
    try:
        res = httpx.get(
            f"{CLERK_API}/users/{clerk_user_id}",
            headers={"Authorization": f"Bearer {settings.CLERK_SECRET_KEY}"},
            timeout=5.0,
        )
    except httpx.HTTPError as exc:
        log.warning("clerk backend api unreachable: %s", type(exc).__name__)
        return None
    if res.status_code != 200:
        log.warning("clerk backend api answered %s for a user lookup", res.status_code)
        return None
    return profile_from_payload(res.json())


def _placeholder_email(clerk_user_id: str) -> str:
    return f"{clerk_user_id}@{PENDING_EMAIL_DOMAIN}"


def has_placeholder_email(user: User) -> bool:
    return user.email.endswith("@" + PENDING_EMAIL_DOMAIN)


def receipt_address(user: User) -> str | None:
    """Where a payment receipt may be sent, or None for nowhere.

    A customer whose profile Clerk could not supply yet carries a
    user_...@pending.local placeholder. That is not an address anyone reads,
    and handing it to Stripe as receipt_email would send a receipt into the
    void on every such order. No receipt is better than a bounced one -- and
    far better than refusing the payment over it: the order page still shows
    the pickup PIN, which is what the customer actually needs.
    """
    if has_placeholder_email(user):
        log.warning("no receipt email for user %s: Clerk profile still unavailable", user.id)
        return None
    return user.email


def customer_for_clerk_user(clerk_user_id: str, token_email: str | None = None) -> User:
    """The customer row for a verified Clerk session, created on first sight.

    Refuses a Clerk id that somehow belongs to a staff or admin row: those
    populations never share a row, and a customer session must not open one.
    """
    with system_session() as session:
        user = session.execute(
            select(User).where(User.clerk_user_id == clerk_user_id)
        ).scalar_one_or_none()
        needs_profile = user is None or has_placeholder_email(user)
        if user is not None and not needs_profile:
            _ensure_customer(user)
            session.expunge(user)
            return user

    # Outside any transaction: a network call must never hold a connection
    # from the narrow system pool.
    profile = fetch_profile(clerk_user_id) if needs_profile else None

    try:
        with system_session() as session:
            user = upsert_customer(
                session, clerk_user_id, profile,
                fallback_email=token_email,
            )
            _ensure_customer(user)
            session.expunge(user)
            return user
    except IntegrityError:
        # Two first requests from the same new customer raced to create the
        # row. The unique index on clerk_user_id let exactly one win.
        with system_session() as session:
            user = session.execute(
                select(User).where(User.clerk_user_id == clerk_user_id)
            ).scalar_one()
            _ensure_customer(user)
            session.expunge(user)
            return user


def upsert_customer(
    session, clerk_user_id: str, profile: ClerkProfile | None, fallback_email: str | None = None
) -> User:
    """Create or refresh the row for a Clerk user. Shared by the request path
    and the webhook worker so both agree on what a customer row holds."""
    user = session.execute(
        select(User).where(User.clerk_user_id == clerk_user_id)
    ).scalar_one_or_none()

    email = (profile.email if profile else None) or (fallback_email or "").strip().lower() or None

    if user is None:
        user = User(
            kind=UserKind.CUSTOMER.value,
            clerk_user_id=clerk_user_id,
            email=email or _placeholder_email(clerk_user_id),
            full_name=profile.full_name if profile else None,
        )
        session.add(user)
        session.flush()
        return user

    if email:
        user.email = email
    if profile and profile.full_name:
        user.full_name = profile.full_name
    session.flush()
    return user


def deactivate(session, clerk_user_id: str) -> None:
    """A user deleted in Clerk. Soft delete: their orders and the tax history
    hanging off them are retained."""
    user = session.execute(
        select(User).where(User.clerk_user_id == clerk_user_id)
    ).scalar_one_or_none()
    if user is not None and user.kind == UserKind.CUSTOMER.value:
        user.is_active = False
        user.deleted_at = user.deleted_at or utcnow()


def _ensure_customer(user: User) -> None:
    if user.kind != UserKind.CUSTOMER.value:
        log.error("a clerk session named a %s row; refused", user.kind)
        raise errors.ApiError(401, "UNAUTHENTICATED", "Sign in to continue.")
    if not user.is_active or user.deleted_at is not None:
        raise errors.ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.")
