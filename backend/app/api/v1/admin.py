"""Super Admin portal API.

Every cross-tenant read here goes through the system read surface and is
audited. Section 22.4: the normal request-path tenant role is never loosened
for platform analytics.
"""

import csv
import io
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import select, text

from app.api.deps import require_platform_admin
from app.config import settings
from app.core import platform_auth
from app.core.ratelimit import per_ip
from app.core import staff_auth
from app.core import errors
from app.db.base import utcnow
from app.db.session import system_session, tenant_session
from app.models import (
    Restaurant, RestaurantOrderCounter, RestaurantPaymentAccount,
    RestaurantStatus, RestaurantUser, StaffRole, StaffStatus, User,
)
from app.schemas.api import (
    AdminOrderOut, AdminOrderPageOut, CreateOwnerIn, CreateOwnerOut,
    CreateRestaurantIn, RestaurantOut, RestaurantReportOut, UpdateRestaurantIn,
)
from app.services import stripe_service

log = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["super-admin"])


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=256)


class AdminOut(BaseModel):
    email: str


@router.post(
    "/login",
    response_model=AdminOut,
    # Unauthenticated and credential-bearing, so it is the one endpoint here
    # worth brute forcing. Tight, and by address since there is no session yet.
    dependencies=[Depends(per_ip("admin_login", limit=10, window_seconds=300))],
)
def login(body: LoginIn, response: Response):
    admin = platform_auth.authenticate(body.email, body.password)
    if admin is None:
        # One message for both "no such admin" and "wrong password". The
        # difference would tell an attacker which addresses are worth attacking.
        log.warning("failed platform admin sign-in for %r", body.email[:64])
        raise errors.ApiError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.")

    response.set_cookie(
        key=platform_auth.SESSION_COOKIE,
        value=platform_auth.issue_session(admin),
        max_age=settings.ADMIN_SESSION_TTL_MINUTES * 60,
        # httponly: unreadable to JavaScript, so an XSS bug on any page of the
        # platform cannot exfiltrate a super-admin session.
        httponly=True,
        # lax: the cookie rides top-level navigations but not cross-site form
        # posts, which is what stops a CSRF against the mutating endpoints.
        samesite="lax",
        # Development is plain HTTP on .local; live must never send this in
        # the clear, so it follows the environment rather than being hardcoded.
        secure=settings.ENV == "production",
        path="/",
    )
    return AdminOut(email=admin.email)


@router.post("/logout", status_code=204)
def logout(response: Response):
    response.delete_cookie(
        key=platform_auth.SESSION_COOKIE,
        path="/",
        httponly=True,
        samesite="lax",
        secure=settings.ENV == "production",
    )


@router.get("/me", response_model=AdminOut)
def me(admin: User = Depends(require_platform_admin)):
    """Whether the caller holds a valid admin session. The frontend uses this
    to decide between the dashboard and the login form."""
    return AdminOut(email=admin.email)


# The declared cross-tenant read surface. Kept as one named query so the
# system role's access is reviewable in one place.
_REPORT_SQL = text(
    """
    SELECT r.id                AS restaurant_id,
           r.slug,
           r.name,
           r.status,
           r.currency,
           COALESCE(paid.cnt, 0)            AS orders_paid,
           COALESCE(paid.gross, 0)          AS gross_revenue_minor,
           COALESCE(paid.tax, 0)            AS tax_collected_minor,
           COALESCE(pending.cnt, 0)         AS orders_pending_payment,
           COALESCE(expired.cnt, 0)         AS orders_expired,
           paid.last_order_at
    FROM restaurants r
    LEFT JOIN LATERAL (
        SELECT count(*) AS cnt,
               sum(o.total_minor) AS gross,
               sum(o.tax_minor) AS tax,
               max(o.created_at) AS last_order_at
        FROM orders o
        WHERE o.restaurant_id = r.id
          AND o.paid_at IS NOT NULL
    ) paid ON true
    LEFT JOIN LATERAL (
        SELECT count(*) AS cnt FROM orders o
        WHERE o.restaurant_id = r.id AND o.status = 'PENDING_PAYMENT'
    ) pending ON true
    LEFT JOIN LATERAL (
        SELECT count(*) AS cnt FROM orders o
        WHERE o.restaurant_id = r.id AND o.status = 'EXPIRED'
    ) expired ON true
    WHERE r.deleted_at IS NULL
    ORDER BY r.name
    """
)


def _audit(session, actor: User, action: str, scope: dict):
    session.execute(
        text(
            """
            INSERT INTO platform_audit_logs
                (id, actor_user_id, action, scope, correlation_id, created_at)
            VALUES (gen_random_uuid(), :actor, :action, CAST(:scope AS jsonb),
                    gen_random_uuid()::text, now())
            """
        ),
        {"actor": str(actor.id), "action": action, "scope": __import__("json").dumps(scope)},
    )


@router.get("/restaurants", response_model=list[RestaurantOut])
def list_restaurants(
    include_deleted: bool = False,
    admin: User = Depends(require_platform_admin),
):
    """Deleted restaurants are hidden by default but reachable, because a
    soft delete you cannot see is a soft delete you cannot undo."""
    with system_session() as session:
        _audit(
            session, admin, "SUPER_ADMIN_LIST_RESTAURANTS",
            {"scope": "all", "include_deleted": include_deleted},
        )
        rows = session.execute(
            text(
                """
                SELECT r.id, r.slug, r.name, r.status, r.currency, r.tax_rate_bps,
                       r.accepting_orders, r.created_at, r.tagline, r.timezone,
                       r.deleted_at,
                       rpa.stripe_account_id, rpa.charges_enabled
                FROM restaurants r
                LEFT JOIN restaurant_payment_accounts rpa ON rpa.restaurant_id = r.id
                WHERE (:include_deleted OR r.deleted_at IS NULL)
                ORDER BY r.created_at DESC
                """
            ),
            {"include_deleted": include_deleted},
        ).mappings().all()

    return [
        RestaurantOut(
            id=r["id"], slug=r["slug"], name=r["name"], status=r["status"],
            currency=r["currency"], tax_rate_bps=r["tax_rate_bps"],
            accepting_orders=r["accepting_orders"],
            stripe_account_id=r["stripe_account_id"],
            charges_enabled=bool(r["charges_enabled"]),
            created_at=r["created_at"],
            tagline=r["tagline"], timezone=r["timezone"],
            deleted_at=r["deleted_at"],
        )
        for r in rows
    ]


def _restaurant_out(session, restaurant: Restaurant) -> RestaurantOut:
    account = session.execute(
        text(
            "SELECT stripe_account_id, charges_enabled FROM restaurant_payment_accounts "
            "WHERE restaurant_id = :rid"
        ),
        {"rid": str(restaurant.id)},
    ).mappings().one_or_none()
    return RestaurantOut(
        id=restaurant.id, slug=restaurant.slug, name=restaurant.name,
        status=restaurant.status, currency=restaurant.currency,
        tax_rate_bps=restaurant.tax_rate_bps,
        accepting_orders=restaurant.accepting_orders,
        stripe_account_id=account["stripe_account_id"] if account else None,
        charges_enabled=bool(account["charges_enabled"]) if account else False,
        created_at=restaurant.created_at, tagline=restaurant.tagline,
        timezone=restaurant.timezone, deleted_at=restaurant.deleted_at,
    )


@router.patch("/restaurants/{restaurant_id}", response_model=RestaurantOut)
def update_restaurant(
    restaurant_id: UUID,
    body: UpdateRestaurantIn,
    admin: User = Depends(require_platform_admin),
):
    """Edit a restaurant profile.

    exclude_unset is what makes this a real PATCH: only fields the caller
    actually sent are applied, so clearing the tagline with null stays
    distinguishable from omitting it, and two admins editing different fields
    do not silently overwrite one another.
    """
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise errors.validation_error("No fields to update.")

    with system_session() as session:
        restaurant = session.get(Restaurant, restaurant_id)
        if restaurant is None or restaurant.deleted_at is not None:
            raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No such restaurant.")

        if changes.get("currency"):
            changes["currency"] = changes["currency"].upper()

        for field, value in changes.items():
            setattr(restaurant, field, value)

        _audit(
            session, admin, "SUPER_ADMIN_UPDATE_RESTAURANT",
            {"restaurant_id": str(restaurant_id), "fields": sorted(changes)},
        )
        session.flush()
        return _restaurant_out(session, restaurant)


@router.delete("/restaurants/{restaurant_id}", response_model=dict)
def delete_restaurant(restaurant_id: UUID, admin: User = Depends(require_platform_admin)):
    """Soft delete. The row stays and deleted_at is set; every query already
    filters on it.

    Never a hard delete. Orders, payments and audit rows hang off this record
    and must survive for financial and tax retention. zenoeats_system is
    granted SELECT, INSERT and UPDATE on restaurants but deliberately not
    DELETE, so the database would refuse one anyway.

    An ACTIVE restaurant has to be suspended first: removing one out from
    under customers mid-checkout should not be a single click.

    The slug stays occupied afterwards, on purpose. It is printed on tables
    and saved in bookmarks, so handing that address to a different business
    would silently inherit an existing customer base.
    """
    with system_session() as session:
        restaurant = session.get(Restaurant, restaurant_id)
        if restaurant is None:
            raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No such restaurant.")
        if restaurant.deleted_at is not None:
            raise errors.ApiError(409, "ALREADY_DELETED", "This restaurant is already deleted.")
        if restaurant.status == RestaurantStatus.ACTIVE.value:
            raise errors.ApiError(
                409, "RESTAURANT_ACTIVE", "Suspend this restaurant before deleting it."
            )

        restaurant.deleted_at = utcnow()
        _audit(
            session, admin, "SUPER_ADMIN_DELETE_RESTAURANT",
            {"restaurant_id": str(restaurant_id), "slug": restaurant.slug},
        )

    return {"restaurant_id": str(restaurant_id), "deleted": True}


@router.post("/restaurants/{restaurant_id}/restore", response_model=dict)
def restore_restaurant(restaurant_id: UUID, admin: User = Depends(require_platform_admin)):
    """Undo a soft delete. Comes back SUSPENDED rather than ACTIVE, so
    reactivating still has to pass the readiness gate."""
    with system_session() as session:
        restaurant = session.get(Restaurant, restaurant_id)
        if restaurant is None:
            raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No such restaurant.")
        if restaurant.deleted_at is None:
            raise errors.ApiError(409, "NOT_DELETED", "This restaurant is not deleted.")

        restaurant.deleted_at = None
        restaurant.status = RestaurantStatus.SUSPENDED.value
        _audit(
            session, admin, "SUPER_ADMIN_RESTORE_RESTAURANT",
            {"restaurant_id": str(restaurant_id), "slug": restaurant.slug},
        )

    return {"restaurant_id": str(restaurant_id), "status": RestaurantStatus.SUSPENDED.value}


@router.post("/restaurants", response_model=RestaurantOut, status_code=201)
def create_restaurant(body: CreateRestaurantIn, admin: User = Depends(require_platform_admin)):
    """Create a tenant in DRAFT. Wildcard DNS already routes the subdomain;
    the portal only becomes orderable after activation."""
    from app.core.tenant import RESERVED_SLUGS

    if body.slug in RESERVED_SLUGS:
        raise errors.validation_error("That subdomain is reserved.")

    with system_session() as session:
        exists = session.execute(
            text("SELECT 1 FROM restaurants WHERE slug = :slug"), {"slug": body.slug}
        ).first()
        if exists:
            raise errors.ApiError(409, "SLUG_TAKEN", "That subdomain is already in use.")

        restaurant = Restaurant(
            slug=body.slug, name=body.name, timezone=body.timezone,
            currency=body.currency, tax_rate_bps=body.tax_rate_bps,
            tagline=body.tagline, status=RestaurantStatus.DRAFT.value,
        )
        session.add(restaurant)
        session.flush()

        session.add(
            RestaurantOrderCounter(
                restaurant_id=restaurant.id, next_order_number=1001, updated_at=utcnow()
            )
        )
        _audit(session, admin, "SUPER_ADMIN_CREATE_RESTAURANT",
               {"restaurant_id": str(restaurant.id), "slug": body.slug})
        rid = restaurant.id

    return RestaurantOut(
        id=rid, slug=body.slug, name=body.name, status=RestaurantStatus.DRAFT.value,
        currency=body.currency, tax_rate_bps=body.tax_rate_bps, accepting_orders=True,
        stripe_account_id=None, charges_enabled=False, created_at=utcnow(),
    )


@router.post(
    "/restaurants/{restaurant_id}/owner",
    response_model=CreateOwnerOut,
    status_code=201,
)
def create_restaurant_owner(
    restaurant_id: UUID,
    body: CreateOwnerIn,
    admin: User = Depends(require_platform_admin),
):
    """Issue the owner login for a restaurant.

    The platform creates exactly one account per restaurant -- the owner, with
    the ADMIN role -- and the owner invites their own staff from the
    restaurant portal. Creating every kitchen hire here would turn each one
    into a support request for the platform.

    The temporary password is returned once, in this response, and never
    again: only its argon2 hash is stored. must_change_password is set, so it
    is worthless the moment the owner signs in and replaces it.

    There is no email step yet, so the super admin passes the password to the
    owner out of band. That is also why forgotten passwords are reissued here
    rather than reset by the account holder.
    """
    email = body.email.strip().lower()

    with system_session() as session:
        restaurant = session.get(Restaurant, restaurant_id)
        if restaurant is None or restaurant.deleted_at is not None:
            raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No such restaurant.")
        slug = restaurant.slug

        existing = session.execute(
            select(User).where(User.email == email, User.password_hash.isnot(None))
        ).scalar_one_or_none()
        if existing is not None:
            # One credentialed account per address, enforced by a partial
            # unique index as well. Reissuing here would silently move an
            # existing owner between restaurants.
            raise errors.ApiError(
                409, "EMAIL_TAKEN",
                "That email already has a restaurant login.",
            )

        temp_password = staff_auth.generate_temp_password()
        owner = User(
            clerk_user_id=None,
            email=email,
            full_name=body.full_name,
            password_hash=staff_auth.hash_password(temp_password),
            must_change_password=True,
        )
        session.add(owner)
        session.flush()
        owner_id = owner.id

        _audit(
            session, admin, "SUPER_ADMIN_CREATE_RESTAURANT_OWNER",
            {"restaurant_id": str(restaurant_id), "slug": slug, "owner_email": email},
        )

    # Membership is a tenant-owned row, so it is written under the tenant role
    # with RLS in force rather than through the platform's system role.
    with tenant_session(restaurant_id) as session:
        session.add(
            RestaurantUser(
                restaurant_id=restaurant_id,
                user_id=owner_id,
                role_code=StaffRole.ADMIN.value,
                status=StaffStatus.ACTIVE.value,
                invited_at=utcnow(),
                accepted_at=utcnow(),
            )
        )

    return CreateOwnerOut(user_id=owner_id, email=email, temporary_password=temp_password)


@router.post("/restaurants/{restaurant_id}/owner/reset-password", response_model=CreateOwnerOut)
def reset_owner_password(
    restaurant_id: UUID,
    body: CreateOwnerIn,
    admin: User = Depends(require_platform_admin),
):
    """Reissue a temporary password for an existing staff account.

    Stands in for a self-service reset until there is an email provider to
    send a link through. The account must already be staff at this restaurant,
    so this cannot be used to take over an arbitrary address.
    """
    email = body.email.strip().lower()

    with system_session() as session:
        restaurant = session.get(Restaurant, restaurant_id)
        if restaurant is None or restaurant.deleted_at is not None:
            raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No such restaurant.")
        user = session.execute(
            select(User).where(User.email == email, User.password_hash.isnot(None))
        ).scalar_one_or_none()
        if user is None:
            raise errors.ApiError(404, "USER_NOT_FOUND", "No login for that email.")
        user_id = user.id

    with tenant_session(restaurant_id) as session:
        membership = session.execute(
            select(RestaurantUser).where(RestaurantUser.user_id == user_id)
        ).scalar_one_or_none()
        if membership is None:
            raise errors.ApiError(
                404, "USER_NOT_FOUND", "That login is not staff at this restaurant."
            )

    temp_password = staff_auth.generate_temp_password()
    with system_session() as session:
        user = session.get(User, user_id)
        user.password_hash = staff_auth.hash_password(temp_password)
        user.must_change_password = True
        _audit(
            session, admin, "SUPER_ADMIN_RESET_STAFF_PASSWORD",
            {"restaurant_id": str(restaurant_id), "user_email": email},
        )

    return CreateOwnerOut(user_id=user_id, email=email, temporary_password=temp_password)


@router.post("/restaurants/{restaurant_id}/stripe-onboarding")
def start_stripe_onboarding(
    restaurant_id: UUID,
    return_url: str,
    refresh_url: str,
    admin: User = Depends(require_platform_admin),
):
    """Create or reuse the connected account and return a hosted onboarding
    link. Zenoeats never touches KYC data."""
    with tenant_session(restaurant_id) as session:
        restaurant = session.get(Restaurant, restaurant_id)
        if restaurant is None:
            raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No such restaurant.")
        account = session.execute(select(RestaurantPaymentAccount)).scalar_one_or_none()
        existing_account_id = account.stripe_account_id if account else None
        restaurant_name = restaurant.name
        admin_email = admin.email

    if existing_account_id is None:
        # contact_email is still the platform admin's: Restaurant has no
        # contact field yet. It becomes the owner's address once restaurant
        # accounts exist, and Stripe's notifications about this account should
        # go to them, not to us.
        account_id = stripe_service.create_connected_account(
            email=admin_email,
            display_name=restaurant_name,
        )
        with tenant_session(restaurant_id) as session:
            session.add(
                RestaurantPaymentAccount(
                    restaurant_id=restaurant_id,
                    stripe_account_id=account_id,
                    onboarding_status="PENDING",
                )
            )
        existing_account_id = account_id

    url = stripe_service.create_account_link(existing_account_id, refresh_url, return_url)
    return {"onboarding_url": url, "stripe_account_id": existing_account_id}


@router.post("/restaurants/{restaurant_id}/activate", response_model=dict)
def activate_restaurant(restaurant_id: UUID, admin: User = Depends(require_platform_admin)):
    """Readiness gate. Activation requires a connected account with charges
    enabled and at least one available menu item."""
    with tenant_session(restaurant_id) as session:
        restaurant = session.get(Restaurant, restaurant_id)
        if restaurant is None:
            raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No such restaurant.")

        account = session.execute(select(RestaurantPaymentAccount)).scalar_one_or_none()
        blockers = []
        if account is None:
            blockers.append("No Stripe connected account.")
        elif not account.charges_enabled:
            blockers.append("Stripe account cannot accept charges yet.")

        item_count = session.execute(
            text("SELECT count(*) FROM menu_items WHERE is_available = true AND deleted_at IS NULL")
        ).scalar_one()
        if item_count == 0:
            blockers.append("No available menu items.")

        if blockers:
            raise errors.ApiError(409, "NOT_READY_FOR_ACTIVATION", " ".join(blockers))

        restaurant.status = RestaurantStatus.ACTIVE.value

    with system_session() as session:
        _audit(session, admin, "SUPER_ADMIN_ACTIVATE_RESTAURANT",
               {"restaurant_id": str(restaurant_id)})

    return {"restaurant_id": str(restaurant_id), "status": RestaurantStatus.ACTIVE.value}


@router.post("/restaurants/{restaurant_id}/suspend", response_model=dict)
def suspend_restaurant(restaurant_id: UUID, admin: User = Depends(require_platform_admin)):
    with tenant_session(restaurant_id) as session:
        restaurant = session.get(Restaurant, restaurant_id)
        if restaurant is None:
            raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No such restaurant.")
        restaurant.status = RestaurantStatus.SUSPENDED.value

    with system_session() as session:
        _audit(session, admin, "SUPER_ADMIN_SUSPEND_RESTAURANT",
               {"restaurant_id": str(restaurant_id)})
    return {"restaurant_id": str(restaurant_id), "status": RestaurantStatus.SUSPENDED.value}


@router.get("/restaurants/{restaurant_id}/orders", response_model=AdminOrderPageOut)
def restaurant_orders(
    restaurant_id: UUID,
    status: str | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    admin: User = Depends(require_platform_admin),
):
    """Orders for one restaurant, for platform support and billing questions.

    A cross-tenant read, so it runs on the declared system surface and is
    audited like every other one. The column list is not a formatting choice:
    zenoeats_system has column-level SELECT on orders, and customer_note,
    pickup_pin_encrypted and customer_user_id are excluded from it. Asking for
    them here would be refused by Postgres, which is the point -- answering
    "why was this card charged" never requires reading what the customer wrote
    or the PIN that releases their food.

    currency comes from the restaurant rather than the order for the same
    reason: orders.currency is outside the grant.
    """
    with system_session() as session:
        restaurant = session.execute(
            text(
                "SELECT slug, currency FROM restaurants "
                "WHERE id = :rid AND deleted_at IS NULL"
            ),
            {"rid": str(restaurant_id)},
        ).mappings().one_or_none()
        if restaurant is None:
            raise errors.ApiError(404, "RESTAURANT_NOT_FOUND", "No such restaurant.")

        _audit(
            session, admin, "SUPER_ADMIN_READ_RESTAURANT_ORDERS",
            {"restaurant_id": str(restaurant_id), "status": status, "limit": limit},
        )

        total = session.execute(
            text(
                "SELECT count(*) FROM orders WHERE restaurant_id = :rid "
                "AND (:status IS NULL OR status = :status)"
            ),
            {"rid": str(restaurant_id), "status": status},
        ).scalar_one()

        rows = session.execute(
            text(
                """
                SELECT o.id, o.order_number, o.status, o.total_minor, o.tax_minor,
                       o.created_at, o.paid_at, o.expires_at,
                       p.status AS payment_status,
                       p.stripe_payment_intent_id
                FROM orders o
                LEFT JOIN payments p ON p.order_id = o.id
                WHERE o.restaurant_id = :rid
                  AND (:status IS NULL OR o.status = :status)
                ORDER BY o.created_at DESC
                LIMIT :limit OFFSET :offset
                """
            ),
            {"rid": str(restaurant_id), "status": status, "limit": limit, "offset": offset},
        ).mappings().all()

    return AdminOrderPageOut(
        restaurant_id=restaurant_id,
        slug=restaurant["slug"],
        total=total,
        orders=[
            AdminOrderOut(
                order_id=r["id"], order_number=r["order_number"], status=r["status"],
                total_minor=r["total_minor"], tax_minor=r["tax_minor"],
                currency=restaurant["currency"],
                created_at=r["created_at"], paid_at=r["paid_at"],
                expires_at=r["expires_at"],
                payment_status=r["payment_status"],
                stripe_payment_intent_id=r["stripe_payment_intent_id"],
            )
            for r in rows
        ],
    )


@router.get("/reports", response_model=list[RestaurantReportOut])
def platform_reports(admin: User = Depends(require_platform_admin)):
    with system_session() as session:
        _audit(session, admin, "SUPER_ADMIN_READ_REPORTS", {"scope": "all_restaurants"})
        rows = session.execute(_REPORT_SQL).mappings().all()

    return [
        RestaurantReportOut(
            restaurant_id=r["restaurant_id"], slug=r["slug"], name=r["name"],
            status=r["status"], currency=r["currency"],
            orders_paid=r["orders_paid"],
            gross_revenue_minor=int(r["gross_revenue_minor"] or 0),
            tax_collected_minor=int(r["tax_collected_minor"] or 0),
            average_order_value_minor=(
                int(r["gross_revenue_minor"] or 0) // r["orders_paid"]
                if r["orders_paid"] else 0
            ),
            orders_pending_payment=r["orders_pending_payment"],
            orders_expired=r["orders_expired"],
            last_order_at=r["last_order_at"],
        )
        for r in rows
    ]


@router.get("/reports.csv")
def platform_reports_csv(admin: User = Depends(require_platform_admin)):
    with system_session() as session:
        _audit(session, admin, "SUPER_ADMIN_EXPORT_REPORTS", {"scope": "all_restaurants"})
        rows = session.execute(_REPORT_SQL).mappings().all()

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "restaurant", "slug", "status", "currency", "orders_paid",
        "gross_revenue", "tax_collected", "average_order_value",
        "pending_payment", "expired", "last_order_at",
    ])
    for r in rows:
        paid = r["orders_paid"] or 0
        gross = int(r["gross_revenue_minor"] or 0)
        writer.writerow([
            r["name"], r["slug"], r["status"], r["currency"], paid,
            f"{gross / 100:.2f}",
            f"{int(r['tax_collected_minor'] or 0) / 100:.2f}",
            f"{(gross // paid) / 100:.2f}" if paid else "0.00",
            r["orders_pending_payment"], r["orders_expired"],
            r["last_order_at"].isoformat() if r["last_order_at"] else "",
        ])

    return Response(
        content=buffer.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="zenoeats-report.csv"'},
    )
