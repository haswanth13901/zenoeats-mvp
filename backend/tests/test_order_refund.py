"""Giving a cancelled order's money back.

Cancelling used to move no money at all: a manager cancelled here and then
went to the Stripe Dashboard, and an order nobody remembered to refund looked
exactly like one that had been. The cancellation now carries the refund, and
a refund Stripe refuses is said out loud rather than assumed.
"""

import pytest
from sqlalchemy import text

from app.core import errors
from app.db.session import tenant_session
from tests.test_admin_restaurants import (  # noqa: F401  (fixtures)
    _create,
    _email,
    _owner,
    _set_own_password,
    _staff_client,
    admin_user,
    cleanup,
)
from tests.test_order_board_actions import _post, shop  # noqa: F401

pytestmark = pytest.mark.integration


@pytest.fixture
def stripe_refunds(monkeypatch):
    """Stripe, stubbed at our own service: every refund asked for, and the
    answer it is given. Nothing here reaches the network."""
    from app.api.v1 import restaurant as api

    asked = []
    answer = {"status": "succeeded", "amount": 1500, "id": "re_test"}

    def refund_order(payment, reason=None):
        asked.append({"payment": payment, "reason": reason})
        if isinstance(answer, Exception):
            raise answer
        return answer

    monkeypatch.setattr(api.stripe_service, "refund_order", refund_order)

    class Stripe:
        calls = asked

        @staticmethod
        def refuses(message):
            nonlocal answer
            answer = errors.ApiError(502, "REFUND_FAILED", message)

        @staticmethod
        def pends():
            nonlocal answer
            answer = {"status": "pending", "amount": 1500, "id": "re_test"}

    return Stripe


def _payment(shop_id, order_id):
    with tenant_session(shop_id) as session:
        return session.execute(
            text("SELECT status, refunded_minor FROM payments WHERE order_id = :i"),
            {"i": order_id},
        ).one()


def _with_intent(shop_id, order_id):
    """A payment that looks like a real one: Stripe cannot refund without it."""
    with tenant_session(shop_id) as session:
        session.execute(
            text(
                "UPDATE payments SET stripe_payment_intent_id = 'pi_test', "
                "stripe_account_id = 'acct_test' WHERE order_id = :i"
            ),
            {"i": order_id},
        )


# --- cancelling with the refund ------------------------------------------

def test_cancelling_refunds_the_customer(shop, stripe_refunds):
    order_id = shop.order(status="PREPARING")
    _with_intent(shop.id, order_id)

    res = _post(shop.manager, order_id, "cancel", reason="Kitchen closed early")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "CANCELLED"
    assert body["payment_status"] == "REFUNDED"
    assert body["refund_needed"] is False
    assert body["refund_problem"] is None

    assert len(stripe_refunds.calls) == 1
    assert stripe_refunds.calls[0]["reason"] == "Kitchen closed early"
    assert _payment(shop.id, order_id) == ("REFUNDED", 1500)


def test_a_no_show_can_be_cancelled_without_giving_the_money_back(shop, stripe_refunds):
    """Not every cancellation is a refund, and the board says which."""
    order_id = shop.order(status="READY_FOR_PICKUP")
    _with_intent(shop.id, order_id)

    res = _post(shop.manager, order_id, "cancel", reason="Never collected", refund=False)
    assert res.status_code == 200
    assert res.json()["refund_needed"] is True
    assert stripe_refunds.calls == []
    assert _payment(shop.id, order_id) == ("PAID", 0)


def test_a_slow_refund_is_pending_until_its_webhook(shop, stripe_refunds):
    order_id = shop.order(status="PREPARING")
    _with_intent(shop.id, order_id)
    stripe_refunds.pends()

    res = _post(shop.manager, order_id, "cancel", reason="Out of stock")
    assert res.status_code == 200
    assert res.json()["payment_status"] == "REFUND_PENDING"
    # Nothing is claimed as returned until the webhook says how much.
    assert _payment(shop.id, order_id) == ("REFUND_PENDING", 0)


def test_an_already_refunded_order_asks_stripe_for_nothing(shop, stripe_refunds):
    order_id = shop.order(status="PREPARING", payment="REFUNDED")
    res = _post(shop.manager, order_id, "cancel", reason="Refunded in Stripe")
    assert res.status_code == 200
    assert stripe_refunds.calls == []


# --- when Stripe refuses ---------------------------------------------------

def test_a_refusal_still_cancels_the_order_and_says_why(shop, stripe_refunds):
    """The safe way round: the order leaves the board, the money stays put,
    and the manager is told rather than left to assume."""
    order_id = shop.order(status="PREPARING")
    _with_intent(shop.id, order_id)
    stripe_refunds.refuses("Stripe refused the refund: this restaurant's Stripe balance is too low.")

    res = _post(shop.manager, order_id, "cancel", reason="Kitchen closed early")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["status"] == "CANCELLED"
    assert body["refund_needed"] is True
    assert "balance is too low" in body["refund_problem"]
    assert _payment(shop.id, order_id) == ("PAID", 0)
    # The attempt is in the order's history, not only in a log nobody reads.
    assert any("Refund failed" in (reason or "") for _, _, reason in shop.events(order_id))


# --- refunding afterwards --------------------------------------------------

def test_the_refund_can_be_asked_for_again_later(shop, stripe_refunds):
    order_id = shop.order(status="PREPARING")
    _with_intent(shop.id, order_id)
    _post(shop.manager, order_id, "cancel", reason="Never collected", refund=False)

    res = _post(shop.manager, order_id, "refund", reason="Agreed on the phone")
    assert res.status_code == 200, res.text
    assert res.json()["payment_status"] == "REFUNDED"
    assert _payment(shop.id, order_id) == ("REFUNDED", 1500)

    # And only once.
    again = _post(shop.manager, order_id, "refund", reason="Twice")
    assert again.status_code == 409
    assert "already been refunded" in again.json()["detail"]["message"]


def test_an_order_still_being_cooked_cannot_be_refunded(shop, stripe_refunds):
    """Cancelling is the decision that comes first: a refund on a live order
    would leave a customer owed food they no longer paid for."""
    order_id = shop.order(status="PREPARING")
    _with_intent(shop.id, order_id)

    res = _post(shop.manager, order_id, "refund", reason="Sorry")
    assert res.status_code == 409
    assert "Cancel this order" in res.json()["detail"]["message"]
    assert stripe_refunds.calls == []


def test_a_refusal_on_the_second_attempt_is_an_error_not_a_quiet_success(shop, stripe_refunds):
    order_id = shop.order(status="PREPARING")
    _with_intent(shop.id, order_id)
    _post(shop.manager, order_id, "cancel", reason="Never collected", refund=False)
    stripe_refunds.refuses("This order has already been refunded.")

    res = _post(shop.manager, order_id, "refund", reason="Try again")
    assert res.status_code == 502
    assert res.json()["detail"]["code"] == "REFUND_FAILED"
    assert _payment(shop.id, order_id) == ("PAID", 0)


def test_the_kitchen_cannot_refund(shop, stripe_refunds):
    order_id = shop.order(status="PREPARING")
    _post(shop.manager, order_id, "cancel", reason="Never collected", refund=False)
    assert _post(shop.cook, order_id, "refund", reason="here you go").status_code == 403
    assert stripe_refunds.calls == []


# --- what is actually asked of Stripe --------------------------------------

def test_the_whole_charge_including_the_platform_fee_goes_back(monkeypatch):
    """The sale did not happen, so Zenoeats' commission goes back with it --
    and one order can only ever produce one refund, however many times this
    is called."""
    import stripe

    from app.services import stripe_service

    sent = {}

    def create(**kwargs):
        sent.update(kwargs)
        return {"status": "succeeded", "amount": 1500, "id": "re_test"}

    monkeypatch.setattr(stripe.Refund, "create", create)

    class FakePayment:
        order_id = "00000000-0000-0000-0000-0000000000ab"
        stripe_payment_intent_id = "pi_test"
        stripe_account_id = "acct_test"

    stripe_service.refund_order(FakePayment(), "Kitchen closed")
    assert sent["payment_intent"] == "pi_test"
    assert sent["refund_application_fee"] is True
    assert sent["stripe_account"] == "acct_test"
    assert sent["idempotency_key"] == f"order:{FakePayment.order_id}:refund:v1"
    assert sent["metadata"]["reason"] == "Kitchen closed"


def test_a_payment_with_no_stripe_charge_is_refused_before_the_network(monkeypatch):
    from app.services import stripe_service

    class FakePayment:
        order_id = "00000000-0000-0000-0000-0000000000ab"
        stripe_payment_intent_id = None
        stripe_account_id = None

    with pytest.raises(errors.ApiError):
        stripe_service.refund_order(FakePayment())
