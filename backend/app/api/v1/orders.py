"""Checkout: quote, create order, create PaymentIntent, read order state.

The sequence is Appendix E.1:

  POST /orders                     order committed as PENDING_PAYMENT
  POST /orders/{id}/payment-intent PaymentIntent on the connected account
  (customer confirms in the browser)
  Stripe webhook                   the only thing that can say PAID
  GET  /orders/{id}                client polls for the authoritative state
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Header
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import current_restaurant, get_current_user, tenant_db
from app.config import settings
from app.core import errors, idempotency
from app.core.ratelimit import per_ip, per_user
from app.core.crypto import decrypt_field
from app.db.base import utcnow
from app.models import (
    Order, OrderItem, OrderStatus, Payment, PaymentStatus, Restaurant,
    RestaurantPaymentAccount, User,
)
from app.schemas.api import (
    AmountsOut, CreateOrderIn, OrderItemOut, OrderModifierOut, OrderOut,
    PaymentIntentOut, QuoteIn, QuoteOut,
)
from app.services import clerk_customers, stripe_service
from app.services.orders import create_pending_order
from app.services.pricing import price_cart

log = logging.getLogger(__name__)
router = APIRouter(tags=["orders"])


def _serialize(order: Order, payment: Payment | None, *, include_pin: bool) -> OrderOut:
    pin = None
    if include_pin and order.pickup_pin_encrypted and order.status in {
        OrderStatus.AUTO_ACCEPTED.value,
        OrderStatus.PREPARING.value,
        OrderStatus.READY_FOR_PICKUP.value,
    }:
        pin = decrypt_field(order.pickup_pin_encrypted)

    return OrderOut(
        order_id=order.id,
        order_number=order.order_number,
        status=order.status,
        payment_status=payment.status if payment else PaymentStatus.PENDING.value,
        fulfillment_type=order.fulfillment_type,
        currency=order.currency,
        amounts=AmountsOut(
            subtotal_minor=order.subtotal_minor,
            discount_minor=order.discount_minor,
            tax_minor=order.tax_minor,
            total_minor=order.total_minor,
        ),
        items=[
            OrderItemOut(
                name=i.name_snapshot,
                combo_name=i.combo_name_snapshot,
                combo_group=i.combo_group,
                quantity=i.quantity,
                unit_price_minor=i.unit_price_minor,
                line_total_minor=i.line_total_minor,
                item_note=i.item_note,
                modifiers=[
                    OrderModifierOut(
                        group_name=m.group_name_snapshot,
                        option_name=m.option_name_snapshot,
                        unit_price_delta_minor=m.unit_price_delta_minor,
                        quantity=m.quantity,
                    )
                    for m in i.modifiers
                ],
            )
            for i in order.items
        ],
        pickup_pin=pin,
        expires_at=order.expires_at,
        created_at=order.created_at,
    )


@router.post(
    "/orders/quote",
    response_model=QuoteOut,
    dependencies=[Depends(per_ip("quote", limit=120))],
)
def quote_cart(
    body: QuoteIn,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
):
    """Authoritative pricing preview. Creates nothing."""
    cart = price_cart(
        db,
        restaurant,
        [line.model_dump() for line in body.items],
        [combo.model_dump() for combo in body.combos],
    )
    return QuoteOut(
        currency=cart.currency,
        amounts=AmountsOut(
            subtotal_minor=cart.subtotal_minor,
            discount_minor=cart.discount_minor,
            tax_minor=cart.tax_minor,
            total_minor=cart.total_minor,
        ),
    )


@router.post(
    "/orders",
    response_model=OrderOut,
    status_code=201,
    dependencies=[Depends(per_user("create_order", limit=20))],
)
def create_order(
    body: CreateOrderIn,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    user: User = Depends(get_current_user),
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
):
    """Create a PENDING_PAYMENT order. No charge is attempted here.

    Rule 16: the order row always exists before Stripe is allowed to move
    money. If the customer closes the tab now, a Celery sweep expires the
    order after the TTL and nothing was ever charged.
    """
    payload = body.model_dump(mode="json")
    request_hash = idempotency.hash_request(payload)
    endpoint = "POST /api/v1/orders"

    replay = idempotency.lookup(
        db, key=idempotency_key, actor_id=user.id, endpoint=endpoint,
        request_hash=request_hash,
    )
    if replay is not None:
        return OrderOut.model_validate(replay)

    cart = price_cart(
        db,
        restaurant,
        [line.model_dump() for line in body.items],
        [combo.model_dump() for combo in body.combos],
    )

    if body.expected_total_minor is not None and body.expected_total_minor != cart.total_minor:
        # The menu changed between the quote and the confirm. Never silently
        # charge a different amount than the customer agreed to.
        raise errors.price_changed()

    order = create_pending_order(
        db,
        restaurant=restaurant,
        customer_user_id=user.id,
        cart=cart,
        customer_note=body.customer_note,
    )
    db.refresh(order)

    payment = db.execute(select(Payment).where(Payment.order_id == order.id)).scalar_one()
    response = _serialize(order, payment, include_pin=False)

    idempotency.store(
        db, key=idempotency_key, actor_id=user.id, endpoint=endpoint,
        request_hash=request_hash, status=201, body=response.model_dump(mode="json"),
    )
    return response


@router.post(
    "/orders/{order_id}/payment-intent",
    response_model=PaymentIntentOut,
    dependencies=[Depends(per_user("payment_intent", limit=20))],
)
def create_payment_intent(
    order_id: UUID,
    idempotency_key: str = Header(alias="Idempotency-Key"),
    user: User = Depends(get_current_user),
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
):
    """Create or return the PaymentIntent for an existing order.

    Stripe is called outside any long-running transaction (rule 6). If Stripe
    is unreachable, the order stays PENDING_PAYMENT and no charge is
    attempted; the customer can retry until the TTL expires it.
    """
    endpoint = "POST /api/v1/orders/{id}/payment-intent"
    request_hash = idempotency.hash_request({"order_id": str(order_id)})

    replay = idempotency.lookup(
        db, key=idempotency_key, actor_id=user.id, endpoint=endpoint,
        request_hash=request_hash,
    )
    if replay is not None:
        return PaymentIntentOut.model_validate(replay)

    order = db.get(Order, order_id)
    if order is None or order.customer_user_id != user.id:
        raise errors.order_not_found()
    if order.status != OrderStatus.PENDING_PAYMENT.value:
        raise errors.order_state_conflict("This order is no longer awaiting payment.")
    if order.expires_at and order.expires_at <= utcnow():
        raise errors.order_state_conflict("This order expired. Start a new one.")

    payment = db.execute(
        select(Payment).where(Payment.order_id == order.id).with_for_update()
    ).scalar_one()

    account = db.execute(select(RestaurantPaymentAccount)).scalar_one_or_none()
    if account is None:
        raise errors.payment_provider_unavailable("This restaurant is not set up for card payments.")

    # Stripe's own idempotency key is derived from the order id, so a retry
    # returns the same intent rather than creating a second one.
    intent = stripe_service.create_payment_intent(
        order, account, receipt_email=clerk_customers.receipt_address(user)
    )

    payment.stripe_payment_intent_id = intent.id
    payment.stripe_client_secret = intent.client_secret
    payment.stripe_account_id = account.stripe_account_id
    payment.status = PaymentStatus.PROCESSING.value
    db.flush()

    response = PaymentIntentOut(
        order_id=order.id,
        payment_id=payment.id,
        client_secret=intent.client_secret,
        stripe_account_id=account.stripe_account_id,
        publishable_key=settings.STRIPE_PUBLISHABLE_KEY,
        payment_status=payment.status,
    )
    idempotency.store(
        db, key=idempotency_key, actor_id=user.id, endpoint=endpoint,
        request_hash=request_hash, status=200, body=response.model_dump(mode="json"),
    )
    return response


@router.get("/orders/{order_id}", response_model=OrderOut)
def get_order(
    order_id: UUID,
    user: User = Depends(get_current_user),
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
):
    """Authoritative order state. This is what the tracking page polls.

    The client never decides that a payment succeeded. It reads what the
    webhook wrote.
    """
    order = db.execute(
        select(Order)
        .where(Order.id == order_id)
        .options(selectinload(Order.items).selectinload(OrderItem.modifiers))
    ).scalar_one_or_none()

    if order is None or order.customer_user_id != user.id:
        raise errors.order_not_found()

    payment = db.execute(select(Payment).where(Payment.order_id == order.id)).scalar_one_or_none()
    return _serialize(order, payment, include_pin=True)


@router.get("/orders", response_model=list[OrderOut])
def list_my_orders(
    user: User = Depends(get_current_user),
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
):
    """Order history, scoped to this restaurant by RLS and to this customer
    by ownership. Section 2.3: each restaurant sees only its own relationship
    with a customer."""
    orders = db.execute(
        select(Order)
        .where(Order.customer_user_id == user.id)
        .order_by(Order.created_at.desc())
        .limit(50)
        .options(selectinload(Order.items).selectinload(OrderItem.modifiers))
    ).scalars().all()

    payments = {
        p.order_id: p
        for p in db.execute(
            select(Payment).where(Payment.order_id.in_([o.id for o in orders]))
        ).scalars().all()
    } if orders else {}

    return [_serialize(o, payments.get(o.id), include_pin=True) for o in orders]
