"""Background processing.

The pattern that matters here is Appendix E.8: system-role discovery, then
tenant-scoped execution.

  1. Load the event under zenoeats_system (narrow declared read surface).
  2. Resolve order_id -> restaurant_id and the configured connected account.
  3. Prove the event's stripe_account_id matches that restaurant.
  4. Open a SEPARATE zenoeats_app transaction with SET LOCAL app.current_tenant
     and do the business mutation under FORCE RLS.

Step 3 is what stops a compromised or misrouted Connect event from mutating
another restaurant's orders.
"""

import logging
from uuid import UUID

from sqlalchemy import select, text

from app.db.base import utcnow
from app.db.session import system_session, tenant_session
from app.models import (
    ClerkEvent, Order, OrderStatus, Payment, PaymentStatus,
    RestaurantPaymentAccount, StripeEvent, StripeEventStatus, User,
)
from app.services.orders import transition
from app.workers.celery_app import celery_app

log = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=5, default_retry_delay=10, name="app.workers.tasks.process_stripe_event")
def process_stripe_event(self, event_row_id: str):
    with system_session() as session:
        event = session.get(StripeEvent, UUID(event_row_id))
        if event is None:
            log.error("stripe event row %s not found", event_row_id)
            return
        if event.status == StripeEventStatus.PROCESSED.value:
            return  # already done, redelivery is safe
        payload = event.payload
        event_type = event.type
        account_id = event.stripe_account_id
        event.attempts += 1

    try:
        handler = {
            "payment_intent.succeeded": _handle_intent_succeeded,
            "payment_intent.payment_failed": _handle_intent_failed,
            "payment_intent.canceled": _handle_intent_canceled,
            "charge.refunded": _handle_charge_refunded,
            "account.updated": _handle_account_updated,
        }.get(event_type)

        if handler is None:
            _mark(event_row_id, StripeEventStatus.IGNORED.value)
            return

        handler(payload, account_id)
        _mark(event_row_id, StripeEventStatus.PROCESSED.value)

    except Exception as exc:
        log.exception("stripe event %s (%s) failed", event_row_id, event_type)
        _mark(event_row_id, StripeEventStatus.FAILED.value, error=str(exc)[:2000])
        raise self.retry(exc=exc)


def _mark(event_row_id: str, status: str, error: str | None = None):
    with system_session() as session:
        event = session.get(StripeEvent, UUID(event_row_id))
        if event is None:
            return
        event.status = status
        event.error = error
        if status == StripeEventStatus.PROCESSED.value:
            event.processed_at = utcnow()


def _resolve_tenant_for_intent(intent_id: str, event_account_id: str | None):
    """Narrow cross-tenant discovery, then the account guard.

    Returns (restaurant_id, payment_id) or None if this event is not ours.
    Raises PermissionError when the event's account does not match the
    restaurant's configured connected account, which is a real security
    signal and should page someone.
    """
    with system_session() as session:
        row = session.execute(
            text(
                """
                SELECT p.id AS payment_id,
                       p.restaurant_id,
                       rpa.stripe_account_id AS configured_account
                FROM payments p
                JOIN restaurant_payment_accounts rpa
                  ON rpa.restaurant_id = p.restaurant_id
                WHERE p.stripe_payment_intent_id = :intent_id
                """
            ),
            {"intent_id": intent_id},
        ).one_or_none()

    if row is None:
        log.warning("no payment for intent %s", intent_id)
        return None

    if event_account_id and row.configured_account != event_account_id:
        raise PermissionError(
            f"Connect event account {event_account_id} does not match the account "
            f"configured for restaurant {row.restaurant_id}"
        )

    return row.restaurant_id, row.payment_id


def _handle_intent_succeeded(payload: dict, event_account_id: str | None):
    intent = payload["data"]["object"]
    resolved = _resolve_tenant_for_intent(intent["id"], event_account_id)
    if resolved is None:
        return
    restaurant_id, payment_id = resolved

    with tenant_session(restaurant_id) as session:
        payment = session.get(Payment, payment_id)
        if payment is None:
            return
        if payment.succeeded_at is not None:
            return  # idempotent: already applied

        payment.status = PaymentStatus.PAID.value
        payment.succeeded_at = utcnow()
        payment.failure_message = None

        order = session.get(Order, payment.order_id)
        if order and order.status == OrderStatus.PENDING_PAYMENT.value:
            # Only a verified webhook can do this. The client never can.
            transition(order, OrderStatus.AUTO_ACCEPTED.value)
            transition(order, OrderStatus.PREPARING.value)
            log.info("order %s paid and now PREPARING", order.order_number)


def _handle_intent_failed(payload: dict, event_account_id: str | None):
    intent = payload["data"]["object"]
    resolved = _resolve_tenant_for_intent(intent["id"], event_account_id)
    if resolved is None:
        return
    restaurant_id, payment_id = resolved

    with tenant_session(restaurant_id) as session:
        payment = session.get(Payment, payment_id)
        if payment is None or payment.succeeded_at is not None:
            return
        payment.status = PaymentStatus.FAILED.value
        error = (intent.get("last_payment_error") or {}).get("message")
        payment.failure_message = error
        # The order stays PENDING_PAYMENT so the customer can retry until the
        # TTL sweep expires it.


def _handle_intent_canceled(payload: dict, event_account_id: str | None):
    intent = payload["data"]["object"]
    resolved = _resolve_tenant_for_intent(intent["id"], event_account_id)
    if resolved is None:
        return
    restaurant_id, payment_id = resolved

    with tenant_session(restaurant_id) as session:
        payment = session.get(Payment, payment_id)
        if payment is None or payment.succeeded_at is not None:
            return
        payment.status = PaymentStatus.FAILED.value
        order = session.get(Order, payment.order_id)
        if order and order.status == OrderStatus.PENDING_PAYMENT.value:
            transition(order, OrderStatus.CANCELLED.value, reason="PAYMENT_CANCELLED")


def _handle_charge_refunded(payload: dict, event_account_id: str | None):
    """Reconcile refunds, including ones issued from the restaurant's own
    Stripe Dashboard. Rule 26: a refund changes payment state, never
    OrderStatus."""
    charge = payload["data"]["object"]
    intent_id = charge.get("payment_intent")
    if not intent_id:
        return
    resolved = _resolve_tenant_for_intent(intent_id, event_account_id)
    if resolved is None:
        return
    restaurant_id, payment_id = resolved

    with tenant_session(restaurant_id) as session:
        payment = session.get(Payment, payment_id)
        if payment is None:
            return
        refunded = charge.get("amount_refunded", 0)
        total = charge.get("amount", 0)
        payment.status = (
            PaymentStatus.REFUNDED.value if refunded >= total
            else PaymentStatus.PARTIALLY_REFUNDED.value
        )


def _handle_account_updated(payload: dict, event_account_id: str | None):
    """Pause ordering when a restaurant loses charges_enabled rather than
    letting PaymentIntents fail one customer at a time."""
    account = payload["data"]["object"]
    account_id = account.get("id") or event_account_id
    if not account_id:
        return

    with system_session() as session:
        row = session.execute(
            text(
                "SELECT restaurant_id FROM restaurant_payment_accounts "
                "WHERE stripe_account_id = :acct"
            ),
            {"acct": account_id},
        ).one_or_none()
    if row is None:
        return

    with tenant_session(row.restaurant_id) as session:
        mapping = session.execute(select(RestaurantPaymentAccount)).scalar_one_or_none()
        if mapping is None:
            return
        mapping.charges_enabled = bool(account.get("charges_enabled"))
        mapping.payouts_enabled = bool(account.get("payouts_enabled"))
        mapping.details_submitted = bool(account.get("details_submitted"))
        mapping.onboarding_status = "COMPLETE" if account.get("details_submitted") else "PENDING"
        if not mapping.charges_enabled:
            log.error("restaurant %s lost charges_enabled", row.restaurant_id)


@celery_app.task(bind=True, max_retries=3, name="app.workers.tasks.process_clerk_event")
def process_clerk_event(self, event_row_id: str):
    """Mirror Clerk users into the local users table."""
    with system_session() as session:
        event = session.get(ClerkEvent, UUID(event_row_id))
        if event is None or event.status == "PROCESSED":
            return
        event.attempts += 1
        etype = event.type
        data = (event.payload or {}).get("data", {})

    try:
        with system_session() as session:
            if etype in ("user.created", "user.updated"):
                clerk_id = data.get("id")
                emails = data.get("email_addresses") or []
                primary = data.get("primary_email_address_id")
                email = next(
                    (e.get("email_address") for e in emails if e.get("id") == primary),
                    emails[0].get("email_address") if emails else None,
                )
                name = " ".join(
                    p for p in [data.get("first_name"), data.get("last_name")] if p
                ) or None

                user = session.execute(
                    select(User).where(User.clerk_user_id == clerk_id)
                ).scalar_one_or_none()
                if user is None:
                    session.add(User(clerk_user_id=clerk_id, email=email or "", full_name=name))
                else:
                    user.email = email or user.email
                    user.full_name = name or user.full_name

            elif etype == "user.deleted":
                user = session.execute(
                    select(User).where(User.clerk_user_id == data.get("id"))
                ).scalar_one_or_none()
                if user:
                    # Soft delete. Transactional and audit records are
                    # retained per the retention policy.
                    user.is_active = False
                    user.deleted_at = utcnow()

        with system_session() as session:
            row = session.get(ClerkEvent, UUID(event_row_id))
            if row:
                row.status = "PROCESSED"
                row.processed_at = utcnow()

    except Exception as exc:
        log.exception("clerk event %s failed", event_row_id)
        with system_session() as session:
            row = session.get(ClerkEvent, UUID(event_row_id))
            if row:
                row.status = "FAILED"
                row.error = str(exc)[:2000]
        raise self.retry(exc=exc)


@celery_app.task(name="app.workers.tasks.expire_pending_orders")
def expire_pending_orders():
    """TTL sweep for abandoned checkouts.

    Discovery under the system role, mutation under the tenant role. An order
    that has a successful payment is never expired, no matter what the clock
    says.
    """
    with system_session() as session:
        rows = session.execute(
            text(
                """
                SELECT o.id, o.restaurant_id
                FROM orders o
                WHERE o.status = 'PENDING_PAYMENT'
                  AND o.expires_at IS NOT NULL
                  AND o.expires_at <= now()
                LIMIT 500
                """
            )
        ).all()

    expired = 0
    for row in rows:
        with tenant_session(row.restaurant_id) as session:
            order = session.get(Order, row.id)
            if order is None or order.status != OrderStatus.PENDING_PAYMENT.value:
                continue
            payment = session.execute(
                select(Payment).where(Payment.order_id == order.id)
            ).scalar_one_or_none()
            if payment and payment.succeeded_at is not None:
                continue  # a webhook is in flight; leave it alone
            transition(order, OrderStatus.EXPIRED.value)
            expired += 1

    if expired:
        log.info("expired %d stale pending orders", expired)
    return expired
