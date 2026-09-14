"""Webhook inboxes. Verify, persist, enqueue, return 200 fast.

Section 8.2 and rule 17: every Stripe webhook is persisted with a unique
event id before processing, processed asynchronously, and is safe to receive
more than once. Nothing here mutates order or payment state; that happens in
the Celery worker after the account-to-tenant guard passes.
"""

import logging

import stripe
from fastapi import APIRouter, Header, Request, Response
from sqlalchemy.exc import IntegrityError

from app.config import settings
from app.db.base import utcnow
from app.db.session import system_session
from app.models import ClerkEvent, StripeEvent, StripeEventStatus
from app.services import stripe_service
from app.workers.tasks import process_clerk_event, process_stripe_event

log = logging.getLogger(__name__)
router = APIRouter(tags=["webhooks"])

# Only these are acted on. Everything else is stored and marked IGNORED so we
# have the audit trail without pretending to handle it.
SUPPORTED_STRIPE_EVENTS = {
    "payment_intent.succeeded",
    "payment_intent.payment_failed",
    "payment_intent.canceled",
    "charge.refunded",
    "account.updated",
}


@router.post("/webhooks/stripe/connect")
async def stripe_connect_webhook(
    request: Request,
    stripe_signature: str = Header(alias="Stripe-Signature"),
):
    payload = await request.body()

    try:
        event = stripe_service.construct_connect_event(payload, stripe_signature)
    except (ValueError, stripe.SignatureVerificationError) as exc:
        log.warning("rejected stripe webhook: %s", type(exc).__name__)
        return Response(status_code=400, content='{"code":"INVALID_SIGNATURE"}',
                        media_type="application/json")

    event_dict = event.to_dict() if hasattr(event, "to_dict") else dict(event)
    row_id = None

    with system_session() as session:
        row = StripeEvent(
            stripe_event_id=event["id"],
            type=event["type"],
            payload=event_dict,
            status=(
                StripeEventStatus.RECEIVED.value
                if event["type"] in SUPPORTED_STRIPE_EVENTS
                else StripeEventStatus.IGNORED.value
            ),
            received_at=utcnow(),
            # Connect events carry the connected account. Rule 25: this is
            # the value the worker must match against the restaurant's
            # configured account before touching tenant state.
            stripe_account_id=event.get("account"),
        )
        session.add(row)
        try:
            session.flush()
            row_id = str(row.id)
            should_process = row.status == StripeEventStatus.RECEIVED.value
        except IntegrityError:
            # Duplicate delivery. Stripe retries aggressively and this is the
            # normal case, not an error. 200 and stop.
            session.rollback()
            log.info("duplicate stripe event %s", event["id"])
            return {"received": True, "duplicate": True}

    if row_id and should_process:
        process_stripe_event.delay(row_id)

    return {"received": True}


@router.post("/webhooks/clerk")
async def clerk_webhook(request: Request):
    """Mirror Clerk identity changes into PostgreSQL.

    Same durability contract as the Stripe inbox: persist first, process
    asynchronously, tolerate redelivery.
    """
    from svix.webhooks import Webhook, WebhookVerificationError

    payload = await request.body()
    headers = {k.lower(): v for k, v in request.headers.items()}

    # Building the verifier and using it fail for different reasons and
    # deserve different answers. svix base64-decodes the secret in its
    # constructor and raises a plain binascii error there, not a
    # WebhookVerificationError, so an unset or malformed secret used to
    # escape the handler as an opaque 500.
    try:
        verifier = Webhook(settings.CLERK_WEBHOOK_SECRET)
    except Exception:
        # Our misconfiguration, not a bad request. 503 so Svix keeps the
        # delivery and retries once the secret is actually set.
        log.error("CLERK_WEBHOOK_SECRET is missing or malformed; cannot verify webhooks")
        return Response(status_code=503, content='{"code":"WEBHOOK_NOT_CONFIGURED"}',
                        media_type="application/json")

    try:
        verified = verifier.verify(payload, headers)
    except WebhookVerificationError:
        log.warning("rejected clerk webhook: bad signature")
        return Response(status_code=400, content='{"code":"INVALID_SIGNATURE"}',
                        media_type="application/json")

    event_id = headers.get("svix-id")
    row_id = None

    with system_session() as session:
        row = ClerkEvent(
            clerk_event_id=event_id,
            type=verified.get("type", "unknown"),
            payload=verified,
            received_at=utcnow(),
        )
        session.add(row)
        try:
            session.flush()
            row_id = str(row.id)
        except IntegrityError:
            session.rollback()
            return {"received": True, "duplicate": True}

    if row_id:
        process_clerk_event.delay(row_id)
    return {"received": True}
