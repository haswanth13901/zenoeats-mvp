"""Super Admin portal API.

Every cross-tenant read here goes through the system read surface and is
audited. Section 22.4: the normal request-path tenant role is never loosened
for platform analytics.
"""

import csv
import io
from uuid import UUID

from fastapi import APIRouter, Depends, Response
from sqlalchemy import select, text

from app.api.deps import require_platform_admin
from app.core import errors
from app.db.base import utcnow
from app.db.session import system_session, tenant_session
from app.models import (
    Restaurant, RestaurantOrderCounter, RestaurantPaymentAccount,
    RestaurantStatus, User,
)
from app.schemas.api import CreateRestaurantIn, RestaurantOut, RestaurantReportOut
from app.services import stripe_service

router = APIRouter(prefix="/admin", tags=["super-admin"])

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
def list_restaurants(admin: User = Depends(require_platform_admin)):
    with system_session() as session:
        _audit(session, admin, "SUPER_ADMIN_LIST_RESTAURANTS", {"scope": "all"})
        rows = session.execute(
            text(
                """
                SELECT r.id, r.slug, r.name, r.status, r.currency, r.tax_rate_bps,
                       r.accepting_orders, r.created_at,
                       rpa.stripe_account_id, rpa.charges_enabled
                FROM restaurants r
                LEFT JOIN restaurant_payment_accounts rpa ON rpa.restaurant_id = r.id
                WHERE r.deleted_at IS NULL
                ORDER BY r.created_at DESC
                """
            )
        ).mappings().all()

    return [
        RestaurantOut(
            id=r["id"], slug=r["slug"], name=r["name"], status=r["status"],
            currency=r["currency"], tax_rate_bps=r["tax_rate_bps"],
            accepting_orders=r["accepting_orders"],
            stripe_account_id=r["stripe_account_id"],
            charges_enabled=bool(r["charges_enabled"]),
            created_at=r["created_at"],
        )
        for r in rows
    ]


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
        admin_email = admin.email

    if existing_account_id is None:
        stripe_account = stripe_service.create_connected_account(admin_email)
        with tenant_session(restaurant_id) as session:
            session.add(
                RestaurantPaymentAccount(
                    restaurant_id=restaurant_id,
                    stripe_account_id=stripe_account.id,
                    onboarding_status="PENDING",
                )
            )
        existing_account_id = stripe_account.id

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
