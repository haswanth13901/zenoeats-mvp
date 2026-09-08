"""Order lifecycle guarantees that must hold regardless of the UI."""

import pytest

from app.core import errors
from app.models import ALLOWED_TRANSITIONS, OrderStatus
from app.services.orders import transition


class FakeOrder:
    def __init__(self, status):
        self.status = status
        self.paid_at = None
        self.completed_at = None
        self.cancelled_reason = None
        self.expires_at = "set"
        self.updated_at = None


def test_client_cannot_jump_an_order_to_paid_states():
    """PENDING_PAYMENT -> PREPARING is not a legal single step. Only the
    webhook path (via AUTO_ACCEPTED) gets there."""
    order = FakeOrder(OrderStatus.PENDING_PAYMENT.value)
    with pytest.raises(errors.ApiError) as exc:
        transition(order, OrderStatus.PREPARING.value)
    assert exc.value.code == "ORDER_STATE_CONFLICT"


def test_webhook_path_reaches_preparing():
    order = FakeOrder(OrderStatus.PENDING_PAYMENT.value)
    transition(order, OrderStatus.AUTO_ACCEPTED.value)
    assert order.paid_at is not None
    assert order.expires_at is None
    transition(order, OrderStatus.PREPARING.value)
    assert order.status == OrderStatus.PREPARING.value


def test_terminal_states_are_terminal():
    for terminal in [OrderStatus.COMPLETED, OrderStatus.CANCELLED, OrderStatus.EXPIRED]:
        assert ALLOWED_TRANSITIONS[terminal.value] == set()
        order = FakeOrder(terminal.value)
        with pytest.raises(errors.ApiError):
            transition(order, OrderStatus.PREPARING.value)


def test_expired_order_cannot_become_paid():
    order = FakeOrder(OrderStatus.EXPIRED.value)
    with pytest.raises(errors.ApiError):
        transition(order, OrderStatus.AUTO_ACCEPTED.value)


def test_every_transition_target_is_a_known_status():
    known = {s.value for s in OrderStatus}
    for source, targets in ALLOWED_TRANSITIONS.items():
        assert source in known
        assert targets <= known
