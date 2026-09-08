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

# Accounts v2 lives on the client object rather than the module globals.
# Everything else here stays on v1 on purpose: Stripe accepts a v2 account id
# at v1 endpoints, so AccountLink, Account.retrieve and PaymentIntent all keep
# working unchanged against accounts created below. Verified against the live
# test API rather than assumed.
_client = stripe.StripeClient(settings.STRIPE_SECRET_KEY)


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


def create_connected_account(
    *,
    email: str,
    display_name: str,
    country: str = "US",
    entity_type: str = "company",
) -> str:
    """Create a connected account and return its id.

    Accounts v2. Stripe rejects `Account.create` (v1) outright for new Connect
    integrations, pointing at /v2/core/accounts instead.

    The v1 `type="standard"` shape maps onto v2 as `dashboard="full"` plus an
    explicit `merchant` configuration: v2 does not infer capabilities from an
    account type, you request them. `responsibilities` both set to "stripe"
    keeps the connected account liable for its own fees and losses, which is
    what direct charges require and what makes the restaurant, not Zenoeats,
    the merchant of record.

    Returns the id rather than the object because the v2 response shape omits
    most fields unless named in `include`, and every caller only wants the id.
    """
    try:
        account = _client.v2.core.accounts.create(
            {
                "contact_email": email,
                "display_name": display_name,
                "dashboard": "full",
                "identity": {"country": country.lower(), "entity_type": entity_type},
                "configuration": {
                    "merchant": {"capabilities": {"card_payments": {"requested": True}}}
                },
                "defaults": {
                    "currency": "usd",
                    "responsibilities": {
                        "fees_collector": "stripe",
                        "losses_collector": "stripe",
                    },
                },
                "include": ["configuration.merchant", "identity", "requirements"],
            }
        )
        return account.id
    except stripe.StripeError as exc:
        # Platform admins are trusted operators, not customers. The generic
        # "try again" told them nothing and was actively wrong for errors that
        # no amount of retrying fixes, such as a disabled capability.
        detail = getattr(exc, "user_message", None) or str(exc)
        log.error("stripe connected account creation failed: %s", detail)
        raise errors.payment_provider_unavailable(
            f"Stripe rejected the account creation: {detail}"
        ) from exc


def retrieve_account_status(stripe_account_id: str) -> dict:
    """Read a connected account's current state straight from Stripe.

    The account.updated webhook is the normal path, but it is not the only
    one that has to work. Stripe's own guidance for hosted onboarding is that
    the return_url carries no state, so the platform should retrieve the
    account and check its requirements -- a webhook that was missed, arrived
    while the worker was down, or was never configured would otherwise leave
    the portal permanently disagreeing with Stripe.

    Returns the flags plus why charges are disabled, if they are. Without the
    reason, "onboarding incomplete" is a dead end for whoever is trying to
    get a restaurant live.
    """
    try:
        account = stripe.Account.retrieve(stripe_account_id)
    except stripe.StripeError as exc:
        detail = getattr(exc, "user_message", None) or str(exc)
        log.error("could not retrieve connected account %s: %s", stripe_account_id, detail)
        raise errors.payment_provider_unavailable(
            f"Stripe could not be reached for this account: {detail}"
        ) from exc

    requirements = account.requirements
    currently_due = list(requirements.currently_due or []) if requirements else []
    past_due = list(requirements.past_due or []) if requirements else []
    disabled_reason = requirements.disabled_reason if requirements else None

    return {
        "charges_enabled": bool(account.charges_enabled),
        "payouts_enabled": bool(account.payouts_enabled),
        "details_submitted": bool(account.details_submitted),
        "disabled_reason": disabled_reason,
        "currently_due": currently_due,
        "past_due": past_due,
    }


def construct_connect_event(payload: bytes, signature: str) -> stripe.Event:
    """Verify the Connect webhook signature. Raises on tampering."""
    return stripe.Webhook.construct_event(
        payload, signature, settings.STRIPE_CONNECT_WEBHOOK_SECRET
    )
