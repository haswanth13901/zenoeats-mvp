"""Stuck orders can leave the board, and who moved them is kept.

There was no way to cancel an order and no manager override for the PIN, so a
customer who lost their PIN, never came, or was refunded from the Stripe
Dashboard left a ticket on the board for good -- and an order locked by five
wrong PINs could never be completed by anyone.
"""

import uuid

import pytest
from sqlalchemy import text

from app.core import staff_auth

from tests.test_admin_restaurants import (  # noqa: F401  (fixtures)
    _create,
    _email,
    _owner,
    _set_own_password,
    _staff_client,
    admin_user,
    cleanup,
)

pytestmark = pytest.mark.integration

PIN = "305518"


@pytest.fixture
def shop(admin_user, cleanup):
    from app.db.base import utcnow
    from app.db.session import system_session, tenant_session
    from app.models import RestaurantUser

    restaurant = _create(admin_user, cleanup)
    owner_email = _email()
    owner, _ = _owner(admin_user, restaurant.id, owner_email)
    _set_own_password(owner_email, "owner password 123")

    with system_session() as session:
        customer_id = session.execute(
            text(
                "INSERT INTO users (id, kind, email, clerk_user_id, is_platform_admin, "
                "is_active, must_change_password, created_at, updated_at) "
                "VALUES (gen_random_uuid(), 'CUSTOMER', :e, :c, false, true, false, now(), now()) "
                "RETURNING id"
            ),
            {"e": f"board-{uuid.uuid4().hex[:8]}@zenoeats.invalid", "c": f"user_b_{uuid.uuid4().hex}"},
        ).scalar_one()
        cook_id = session.execute(
            text(
                "INSERT INTO users (id, kind, email, password_hash, is_platform_admin, "
                "is_active, must_change_password, created_at, updated_at) "
                "VALUES (gen_random_uuid(), 'STAFF', :e, :h, false, true, false, now(), now()) "
                "RETURNING id"
            ),
            {"e": _email(), "h": staff_auth.hash_password("kitchen password 1")},
        ).scalar_one()
    with tenant_session(restaurant.id) as session:
        session.add(RestaurantUser(
            restaurant_id=restaurant.id, user_id=cook_id, role_code="KITCHEN",
            status="ACTIVE", invited_at=utcnow(), accepted_at=utcnow(),
        ))

    numbers = iter(range(4001, 5000))

    class Shop:
        id = restaurant.id
        owner_id = owner.user_id

        @staticmethod
        def client(user_id):
            c = _staff_client(restaurant.slug)
            c.cookies.set(staff_auth.SESSION_COOKIE, staff_auth.issue_session(user_id))
            return c

        manager = None
        cook = None

        @staticmethod
        def order(status="READY_FOR_PICKUP", payment="PAID", paid=True, attempts=0):
            from app.core.crypto import encrypt_field
            from app.models import Order, Payment

            now = utcnow()
            with tenant_session(restaurant.id) as session:
                order = Order(
                    restaurant_id=restaurant.id, order_number=next(numbers),
                    customer_user_id=customer_id, status=status,
                    payment_method="STRIPE", currency="USD", subtotal_minor=1500,
                    discount_minor=0, tax_minor=0, total_minor=1500,
                    pickup_pin_encrypted=encrypt_field(PIN), pickup_pin_failed_attempts=attempts,
                    paid_at=now if paid else None,
                )
                session.add(order)
                session.flush()
                session.add(Payment(
                    restaurant_id=restaurant.id, order_id=order.id, method="STRIPE",
                    status=payment, amount_minor=1500, currency="USD",
                    succeeded_at=now if paid else None,
                ))
                return str(order.id)

        @staticmethod
        def row(order_id):
            with tenant_session(restaurant.id) as session:
                return session.execute(
                    text("SELECT status, cancelled_reason, completed_at FROM orders WHERE id = :i"),
                    {"i": order_id},
                ).one()

        @staticmethod
        def events(order_id):
            with tenant_session(restaurant.id) as session:
                return [
                    tuple(r) for r in session.execute(
                        text(
                            "SELECT action, actor_user_id, reason FROM order_events "
                            "WHERE order_id = :i ORDER BY created_at"
                        ),
                        {"i": order_id},
                    ).all()
                ]

    Shop.manager = Shop.client(owner.user_id)
    Shop.cook = Shop.client(cook_id)
    Shop.cook_id = cook_id
    return Shop


def _post(client, order_id, action, **body):
    return client.post(f"/api/v1/restaurant/orders/{order_id}/{action}", json=body)


# ------------------------------------------------------------ override ---

def test_a_manager_hands_over_a_locked_order_and_it_is_recorded(shop):
    order_id = shop.order(attempts=5)
    assert _post(shop.cook, order_id, "complete", pin=PIN).status_code == 423

    board = shop.manager.get("/api/v1/restaurant/orders").json()
    assert next(o for o in board if o["order_id"] == order_id)["pin_locked"] is True

    res = _post(shop.manager, order_id, "override-complete", reason="  Phone died, checked name  ")
    assert res.status_code == 200, res.text
    assert res.json()["status"] == "COMPLETED"
    assert shop.row(order_id).completed_at is not None
    assert shop.events(order_id) == [
        ("COMPLETED_BY_OVERRIDE", shop.owner_id, "Phone died, checked name")
    ]
    assert all(o["order_id"] != order_id for o in shop.manager.get("/api/v1/restaurant/orders").json())


def test_an_override_needs_a_reason_and_a_manager(shop):
    order_id = shop.order()

    assert _post(shop.manager, order_id, "override-complete", reason="  ").status_code == 422
    assert _post(shop.manager, order_id, "override-complete").status_code == 422
    assert _post(shop.cook, order_id, "override-complete", reason="checked name").status_code == 403
    assert shop.row(order_id).status == "READY_FOR_PICKUP"
    assert shop.events(order_id) == []


def test_an_override_skips_the_pin_and_nothing_else(shop):
    cooking = shop.order(status="PREPARING")
    res = _post(shop.manager, cooking, "override-complete", reason="checked name")
    assert res.status_code == 409  # not ready yet

    unpaid = shop.order(payment="PENDING", paid=False)
    res = _post(shop.manager, unpaid, "override-complete", reason="checked name")
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "PAYMENT_NOT_CONFIRMED"


# -------------------------------------------------------------- cancel ---

def test_a_manager_cancels_a_paid_order_and_is_told_to_refund(shop):
    order_id = shop.order(status="PREPARING")

    res = _post(shop.manager, order_id, "cancel", reason="Customer called to cancel")
    assert res.status_code == 200, res.text
    assert res.json() == {
        "order_id": order_id, "status": "CANCELLED", "payment_status": "PAID",
        "refund_needed": True,
    }
    row = shop.row(order_id)
    assert row.status == "CANCELLED" and row.cancelled_reason == "CANCELLED_BY_RESTAURANT"
    assert shop.events(order_id) == [("CANCELLED", shop.owner_id, "Customer called to cancel")]
    assert all(o["order_id"] != order_id for o in shop.manager.get("/api/v1/restaurant/orders").json())

    # Cancelled is final.
    assert _post(shop.manager, order_id, "cancel", reason="again").status_code == 409


def test_a_refunded_order_is_flagged_on_the_board_and_needs_no_refund(shop):
    order_id = shop.order(status="PREPARING", payment="REFUNDED")

    board = shop.cook.get("/api/v1/restaurant/orders").json()
    ticket = next(o for o in board if o["order_id"] == order_id)
    assert ticket["payment_status"] == "REFUNDED"
    assert ticket["pin_locked"] is False

    res = _post(shop.manager, order_id, "cancel", reason="Refunded in Stripe")
    assert res.status_code == 200
    assert res.json()["refund_needed"] is False


def test_cancel_is_refused_for_kitchen_staff_and_unpaid_orders(shop):
    paid = shop.order()
    assert _post(shop.cook, paid, "cancel", reason="never came").status_code == 403

    unpaid = shop.order(status="PENDING_PAYMENT", payment="PENDING", paid=False)
    res = _post(shop.manager, unpaid, "cancel", reason="never came")
    assert res.status_code == 409
    assert "has not been paid" in res.json()["detail"]["message"]

    assert shop.row(paid).status == "READY_FOR_PICKUP"
    assert shop.row(unpaid).status == "PENDING_PAYMENT"


def test_another_restaurants_order_cannot_be_cancelled(shop, admin_user, cleanup):
    other = _create(admin_user, cleanup)
    other_owner = _email()
    out, _ = _owner(admin_user, other.id, other_owner)
    _set_own_password(other_owner, "other owner pass 1")
    order_id = shop.order()

    intruder = _staff_client(other.slug)
    intruder.cookies.set(staff_auth.SESSION_COOKIE, staff_auth.issue_session(out.user_id))
    assert _post(intruder, order_id, "cancel", reason="not mine").status_code == 404
    assert shop.row(order_id).status == "READY_FOR_PICKUP"


# ------------------------------------------------------------- history ---

def test_the_ordinary_path_is_recorded_too(shop):
    order_id = shop.order(status="PREPARING")

    assert _post(shop.cook, order_id, "ready").status_code == 200
    assert _post(shop.cook, order_id, "complete", pin=PIN).status_code == 200
    assert shop.events(order_id) == [
        ("MARKED_READY", shop.cook_id, None),
        ("COMPLETED_WITH_PIN", shop.cook_id, None),
    ]


def test_the_application_cannot_rewrite_an_event(shop):
    from sqlalchemy.exc import ProgrammingError

    from app.db.session import tenant_session

    order_id = shop.order()
    _post(shop.manager, order_id, "override-complete", reason="checked name")

    with pytest.raises(ProgrammingError, match="permission denied"):
        with tenant_session(shop.id) as session:
            session.execute(
                text("UPDATE order_events SET reason = 'nothing to see' WHERE order_id = :i"),
                {"i": order_id},
            )
