"""Stripe Connect. Direct charges on the restaurant's connected account.

Section 8: the restaurant is the merchant of record, receives payouts and
owns dispute operations. Zenoeats omits application_fee_amount, so the
platform fee is $0 in MVP.

Every call here happens outside a database transaction (rule 6).
"""

import logging

import stripe

from app.config import settings
from app.core import errors
from app.models import Order, RestaurantPaymentAccount

log = logging.getLogger(__name__)
stripe.api_key = settings.STRIPE_SECRET_KEY
stripe.max_network_retries = 2


def create_payment_intent(
    order: Order, account: RestaurantPaymentAccount, receipt_email: str | None
) -> stripe.PaymentIntent:
    """Create a PaymentIntent on the connected account.

    The Stripe idempotency key is derived server side from the order id. It
    is a different concern from our API idempotency key, which is scoped to
    actor plus endpoint. Retrying this call for the same order will always
    return the same intent rather than creating a second one.
    """
    if not account.charges_enabled:
        raise errors.payment_provider_unavailable(
            "This restaurant cannot accept card payments right now."
        )

    try:
        return stripe.PaymentIntent.create(
            amount=order.total_minor,
            currency=order.currency.lower(),
            automatic_payment_methods={"enabled": True},
            metadata={
                "order_id": str(order.id),
                "restaurant_id": str(order.restaurant_id),
                "order_number": str(order.order_number),
            },
            receipt_email=receipt_email,
            stripe_account=account.stripe_account_id,
            idempotency_key=f"order:{order.id}:pi:v1",
        )
    except stripe.StripeError as exc:
        log.warning("stripe PaymentIntent failed for order %s: %s", order.id, exc.user_message or exc)
        raise errors.payment_provider_unavailable() from exc


def retrieve_payment_intent(intent_id: str, stripe_account_id: str) -> stripe.PaymentIntent:
    try:
        return stripe.PaymentIntent.retrieve(intent_id, stripe_account=stripe_account_id)
    except stripe.StripeError as exc:
        raise errors.payment_provider_unavailable() from exc


def create_account_link(stripe_account_id: str, refresh_url: str, return_url: str) -> str:
    """Stripe-hosted onboarding. Zenoeats never collects KYC data itself."""
    try:
        link = stripe.AccountLink.create(
            account=stripe_account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
        return link.url
    except stripe.StripeError as exc:
        raise errors.payment_provider_unavailable() from exc


def create_connected_account(email: str, country: str = "US") -> stripe.Account:
    try:
        return stripe.Account.create(
            type="standard",
            country=country,
            email=email,
        )
    except stripe.StripeError as exc:
        raise errors.payment_provider_unavailable() from exc


def construct_connect_event(payload: bytes, signature: str) -> stripe.Event:
    """Verify the Connect webhook signature. Raises on tampering."""
    return stripe.Webhook.construct_event(
        payload, signature, settings.STRIPE_CONNECT_WEBHOOK_SECRET
    )
