"""Stripe Tax on the restaurant's connected account.

The restaurant is the merchant of record for its direct charges, so it is
liable for the tax, and every call here carries its connected account id:
the calculation, the transaction that records the sale in its tax reports,
and the reversal that records a refund. Stripe's flow for this is exactly
that sequence -- calculate, charge the calculated total with the calculation
id in metadata, record a transaction once paid, reverse it on refund.

Tax is sourced at the pickup address: that is where the food changes hands.

Two cost and abuse controls, because Stripe bills per calculation and the
quote endpoint is public:
  * identical carts reuse a cached calculation for CALCULATION_CACHE_SECONDS,
    which also keeps a quote and the order placed from it on the same numbers;
  * uncached calculations per restaurant are capped per hour.
"""

import hashlib
import json
import logging
from uuid import UUID

import stripe
from redis.exceptions import RedisError
from sqlalchemy import select

from app.core import errors
from app.db.session import tenant_session
from app.models import Order, Restaurant, RestaurantPaymentAccount, TaxMode

log = logging.getLogger(__name__)

CALCULATION_CACHE_SECONDS = 30 * 60
UNCACHED_CALCULATIONS_PER_HOUR = 600

ADDRESS_FIELDS = {
    "address_line1": "street address",
    "address_city": "city",
    "address_state": "state",
    "address_postal_code": "postal code",
    "address_country": "country",
}


def _unavailable() -> errors.ApiError:
    return errors.ApiError(
        503, "TAX_UNAVAILABLE",
        "Tax could not be calculated right now. Try again in a moment.",
    )


def address_problems(restaurant: Restaurant) -> list[str]:
    """Which parts of the pickup address are missing. Stripe accepts a postal
    code alone for the US, but a full street address is what gets the local
    district rates right, so all of it is required."""
    return [label for field, label in ADDRESS_FIELDS.items() if not getattr(restaurant, field)]


def _address(restaurant: Restaurant) -> dict:
    return {
        "line1": restaurant.address_line1,
        "line2": restaurant.address_line2 or None,
        "city": restaurant.address_city,
        "state": restaurant.address_state,
        "postal_code": restaurant.address_postal_code,
        "country": (restaurant.address_country or "").upper(),
    }


# ------------------------------------------------------------ calculation ---

def calculate(restaurant: Restaurant, stripe_account_id: str, lines) -> "TaxResult":
    from app.services.tax import TaxResult

    billable = [line for line in lines if line.amount_minor > 0]
    if not billable:
        return TaxResult(tax_minor=0)

    if address_problems(restaurant):
        # An admin can only switch a restaurant to Stripe Tax with a full
        # address, so this is a restaurant edited out from under itself.
        log.error("restaurant %s uses Stripe Tax without a full address", restaurant.id)
        raise _unavailable()

    request = {
        "currency": restaurant.currency.lower(),
        "line_items": [
            {
                "amount": line.amount_minor,
                "quantity": line.quantity,
                "reference": f"L{index}",
                "tax_code": restaurant.tax_code,
                "tax_behavior": "exclusive",
            }
            for index, line in enumerate(billable, start=1)
        ],
        "customer_details": {"address": _address(restaurant), "address_source": "shipping"},
    }
    cache_key = "taxcalc:" + hashlib.sha256(
        json.dumps([stripe_account_id, request], sort_keys=True).encode()
    ).hexdigest()

    cached = _cache_get(cache_key)
    if cached is not None:
        return TaxResult(tax_minor=cached["tax_minor"], calculation_id=cached["calculation_id"])

    from app.core.ratelimit import consume

    try:
        consume(f"taxcalc:{restaurant.id}", UNCACHED_CALCULATIONS_PER_HOUR, 3600)
    except errors.ApiError:
        log.warning("restaurant %s hit the tax calculation cap", restaurant.id)
        raise

    try:
        calculation = stripe.tax.Calculation.create(**request, stripe_account=stripe_account_id)
    except stripe.StripeError as exc:
        log.error(
            "stripe tax calculation failed for restaurant %s: %s",
            restaurant.id, getattr(exc, "code", None) or type(exc).__name__,
        )
        raise _unavailable() from exc

    expected_total = sum(line.amount_minor for line in billable) + calculation.tax_amount_exclusive
    if calculation.amount_total != expected_total:
        # Our amounts are tax-exclusive, so anything else means Stripe read
        # the request differently from how it was meant. Charging on it would
        # be charging a number nobody can explain.
        log.error(
            "stripe tax total mismatch for restaurant %s: %s != %s",
            restaurant.id, calculation.amount_total, expected_total,
        )
        raise _unavailable()

    result = TaxResult(tax_minor=calculation.tax_amount_exclusive, calculation_id=calculation.id)
    _cache_set(cache_key, {"tax_minor": result.tax_minor, "calculation_id": result.calculation_id})
    return result


def _cache_get(key: str) -> dict | None:
    from app.core.ratelimit import runtime_redis

    try:
        raw = runtime_redis().get(key)
    except RedisError:
        return None
    return json.loads(raw) if raw else None


def _cache_set(key: str, value: dict) -> None:
    from app.core.ratelimit import runtime_redis

    try:
        runtime_redis().setex(key, CALCULATION_CACHE_SECONDS, json.dumps(value))
    except RedisError:
        pass  # a cache miss next time costs one calculation, nothing more


# --------------------------------------------------------- account setup ---

def settings_problems(stripe_account_id: str) -> list[str]:
    """Why a connected account cannot use Stripe Tax yet; empty when it can.

    Stripe's own readiness signal is the account's tax settings status:
    active once a head office and preset tax code are set. Registrations are
    separate -- without one for the restaurant's state, calculations succeed
    but return zero tax -- and are the restaurant's to add.
    """
    try:
        tax_settings = stripe.tax.Settings.retrieve(stripe_account=stripe_account_id)
    except stripe.StripeError as exc:
        log.error("could not read tax settings for %s: %s", stripe_account_id, exc)
        raise errors.payment_provider_unavailable(
            "Stripe could not be reached to check this restaurant's tax settings."
        ) from exc

    if tax_settings.status == "active":
        return []
    missing = []
    details = getattr(tax_settings, "status_details", None)
    pending = getattr(details, "pending", None) if details else None
    if pending is not None:
        missing = list(getattr(pending, "missing_fields", None) or [])
    return [f"Stripe tax settings are {tax_settings.status}"] + [
        f"missing in Stripe: {field.replace('_', ' ')}" for field in missing
    ]


# --------------------------------------------------- after payment/refund ---

def _order_and_account(restaurant_id: UUID, order_id: UUID):
    with tenant_session(restaurant_id) as session:
        order = session.get(Order, order_id)
        account = session.execute(select(RestaurantPaymentAccount)).scalar_one_or_none()
        if order is None or account is None:
            return None
        return {
            "calculation_id": order.tax_calculation_id,
            "transaction_id": order.tax_transaction_id,
            "reversed": order.tax_reversed_amount_minor,
            "total": order.total_minor,
            "account": account.stripe_account_id,
        }


def record_transaction(restaurant_id: UUID, order_id: UUID) -> str | None:
    """Record a paid order's tax, so it appears in the restaurant's reports.

    Idempotent twice over: a stored transaction id short-circuits, and the
    Stripe idempotency key makes a retry after a crash between the Stripe call
    and the database write return the same transaction instead of a second.
    Raises on Stripe failure, so the webhook task retries.
    """
    state = _order_and_account(restaurant_id, order_id)
    if state is None or not state["calculation_id"]:
        return None
    if state["transaction_id"]:
        return state["transaction_id"]

    transaction = stripe.tax.Transaction.create_from_calculation(
        calculation=state["calculation_id"],
        reference=f"order_{order_id}",
        metadata={"order_id": str(order_id), "restaurant_id": str(restaurant_id)},
        stripe_account=state["account"],
        idempotency_key=f"order:{order_id}:tax-transaction",
    )

    with tenant_session(restaurant_id) as session:
        order = session.get(Order, order_id)
        if order is not None and not order.tax_transaction_id:
            order.tax_transaction_id = transaction.id
    log.info("recorded tax transaction for order %s", order_id)
    return transaction.id


def record_refund(restaurant_id: UUID, order_id: UUID, amount_refunded_minor: int) -> None:
    """Reverse the tax on whatever has been refunded since the last reversal.

    Stripe reports refunds cumulatively (amount_refunded on the charge), so
    the reversal is the difference from what is already recorded -- which is
    what makes a redelivered or out-of-order refund webhook harmless. A full
    refund with nothing reversed before is recorded as a full reversal;
    anything else as a flat partial one, which Stripe spreads across the lines
    in proportion.
    """
    state = _order_and_account(restaurant_id, order_id)
    if state is None or not state["calculation_id"]:
        return

    if not state["transaction_id"]:
        # The sale was never recorded -- its webhook still failing, say. A
        # reversal needs something to reverse.
        record_transaction(restaurant_id, order_id)
        state = _order_and_account(restaurant_id, order_id)
        if state is None or not state["transaction_id"]:
            return

    refunded = min(max(amount_refunded_minor, 0), state["total"])
    delta = refunded - state["reversed"]
    if delta <= 0:
        return

    common = dict(
        original_transaction=state["transaction_id"],
        reference=f"order_{order_id}_refund_{refunded}",
        metadata={"order_id": str(order_id), "refunded_minor": str(refunded)},
        stripe_account=state["account"],
        idempotency_key=f"order:{order_id}:tax-reversal:{refunded}",
    )
    if refunded == state["total"] and state["reversed"] == 0:
        stripe.tax.Transaction.create_reversal(mode="full", **common)
    else:
        stripe.tax.Transaction.create_reversal(mode="partial", flat_amount=-delta, **common)

    with tenant_session(restaurant_id) as session:
        order = session.get(Order, order_id)
        if order is not None and order.tax_reversed_amount_minor < refunded:
            order.tax_reversed_amount_minor = refunded
    log.info("recorded tax reversal of %s for order %s", delta, order_id)


def uses_stripe_tax(restaurant: Restaurant) -> bool:
    return restaurant.tax_mode == TaxMode.STRIPE_TAX.value
