"""Request dependencies: identity, tenant resolution, tenant-scoped session.

The order matters and it is the same order as the defense-in-depth diagram in
section 16.2:

    TLS -> authenticate -> RBAC -> trusted tenant context -> state validation
        -> transaction with FORCE RLS -> audit
"""

from dataclasses import dataclass
from typing import Iterator

from fastapi import Depends, Header, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import errors
from app.core.auth import AuthError, ClerkPrincipal, verify_clerk_token
from app.core import platform_auth
from app.core.tenant import extract_slug
from app.db.session import AppSessionLocal, system_session
from app.models import (
    Restaurant, RestaurantStatus, RestaurantUser, StaffRole, StaffStatus, User,
)
from sqlalchemy import text


@dataclass
class TenantContext:
    restaurant_id: str
    slug: str


def get_principal(authorization: str | None = Header(default=None)) -> ClerkPrincipal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise errors.ApiError(401, "UNAUTHENTICATED", "Sign in to continue.")
    token = authorization.split(" ", 1)[1].strip()
    try:
        return verify_clerk_token(token)
    except AuthError as exc:
        raise errors.ApiError(401, "UNAUTHENTICATED", str(exc)) from exc


def get_current_user(principal: ClerkPrincipal = Depends(get_principal)) -> User:
    """Resolve the local user row mirrored from Clerk.

    If the Clerk webhook has not landed yet (a customer who signed up two
    seconds ago), create the row on first use so checkout is not blocked by
    webhook latency. The webhook remains the source of updates.
    """
    with system_session() as session:
        user = session.execute(
            select(User).where(User.clerk_user_id == principal.clerk_user_id)
        ).scalar_one_or_none()

        if user is None:
            user = User(
                clerk_user_id=principal.clerk_user_id,
                email=principal.email or f"{principal.clerk_user_id}@pending.local",
            )
            session.add(user)
            session.flush()

        if not user.is_active or user.deleted_at is not None:
            raise errors.ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.")

        session.expunge(user)
        return user


def resolve_tenant(request: Request) -> TenantContext:
    """Trusted tenant context from the Host header.

    A restaurant id in the request body is decoration. This is the only
    thing that decides which tenant the request belongs to.
    """
    slug = extract_slug(request.headers.get("host"))
    if slug is None:
        # Development convenience: allow an explicit header when the client
        # cannot set a subdomain (curl, tests, localhost without wildcard DNS).
        slug = request.headers.get("x-zenoeats-restaurant")
    if not slug:
        raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No restaurant for this address.")

    with system_session() as session:
        row = session.execute(
            select(Restaurant.id, Restaurant.status)
            .where(Restaurant.slug == slug, Restaurant.deleted_at.is_(None))
        ).one_or_none()

    if row is None:
        raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No restaurant for this address.")
    if row.status in (RestaurantStatus.ARCHIVED.value, RestaurantStatus.DRAFT.value):
        raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No restaurant for this address.")

    return TenantContext(restaurant_id=str(row.id), slug=slug)


def tenant_db(tenant: TenantContext = Depends(resolve_tenant)) -> Iterator[Session]:
    """A zenoeats_app transaction with SET LOCAL app.current_tenant.

    Everything the endpoint reads or writes through this session is filtered
    by FORCE ROW LEVEL SECURITY.
    """
    session = AppSessionLocal()
    try:
        session.begin()
        session.execute(
            text("SELECT set_config('app.current_tenant', :tid, true)"),
            {"tid": tenant.restaurant_id},
        )
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def current_restaurant(
    tenant: TenantContext = Depends(resolve_tenant),
    db: Session = Depends(tenant_db),
) -> Restaurant:
    restaurant = db.get(Restaurant, tenant.restaurant_id)
    if restaurant is None:
        # Would mean RLS filtered the tenant root, which should be
        # impossible. Fail closed.
        raise errors.tenant_scope_denied()
    return restaurant


def require_staff(*roles: StaffRole):
    """Authorize a staff role within the resolved tenant.

    Clerk org membership in the token is not consulted. The authoritative
    record is restaurant_users, read under the tenant-scoped session.
    """
    allowed = {r.value for r in roles} if roles else {r.value for r in StaffRole}

    def _dep(
        user: User = Depends(get_current_user),
        db: Session = Depends(tenant_db),
        tenant: TenantContext = Depends(resolve_tenant),
    ) -> RestaurantUser:
        membership = db.execute(
            select(RestaurantUser).where(
                RestaurantUser.user_id == user.id,
                RestaurantUser.status == StaffStatus.ACTIVE.value,
            )
        ).scalar_one_or_none()

        if membership is None or membership.role_code not in allowed:
            raise errors.tenant_scope_denied()
        return membership

    return _dep


def require_platform_admin(request: Request) -> User:
    """Authorize a platform administrator from the environment-backed session.

    Deliberately not Clerk. Clerk is the customer identity provider; platform
    operators are a separate, tiny population declared in ADMIN_USERS. A Clerk
    token cannot satisfy this dependency and an admin session cannot satisfy
    the customer ones -- the two never overlap.

    A users row is resolved (and created on first sign-in) because
    platform_audit_logs.actor_user_id is a NOT NULL foreign key to users.id.
    Every audited super-admin action needs a real actor, and naming each
    operator in ADMIN_USERS is what keeps that column worth reading.
    """
    token = request.cookies.get(platform_auth.SESSION_COOKIE)
    if not token:
        raise errors.ApiError(401, "UNAUTHENTICATED", "Sign in to continue.")

    admin = platform_auth.verify_session(token)
    if admin is None:
        raise errors.ApiError(401, "UNAUTHENTICATED", "Your session has expired. Sign in again.")

    return _ensure_platform_admin_user(admin.email)


def _ensure_platform_admin_user(email: str) -> User:
    """The users row backing an environment-declared administrator.

    is_platform_admin is re-asserted on every sign-in so the environment stays
    the single source of truth: revoking someone in ADMIN_USERS is enough, and
    a stale row cannot grant access on its own.
    """
    with system_session() as session:
        user = session.execute(
            select(User).where(User.email == email, User.clerk_user_id.is_(None))
        ).scalar_one_or_none()

        if user is None:
            user = User(
                clerk_user_id=None,
                email=email,
                full_name="Platform Administrator",
                is_platform_admin=True,
            )
            session.add(user)
            session.flush()
        elif not user.is_platform_admin:
            user.is_platform_admin = True

        if not user.is_active or user.deleted_at is not None:
            raise errors.ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.")

        session.expunge(user)
        return user
