"""The Stripe Connect webhook endpoint.

This is how an order normally becomes PAID -- the fallback of reading the
intent back from Stripe only exists for when it fails -- and it had no test
at all. It shipped broken: the handler read `.get("account")` off a
stripe-python Event, which raises rather than returning None, so every
delivery 500'd -- Stripe took the money and the order sat at PENDING_PAYMENT
until the TTL swept it.

So these tests drive the real endpoint with a real signature and a real
stripe.Event, rather than handing the handler a dict it would never see in
production. A test that passes a dict is exactly the test that missed this.
"""

import hashlib
import hmac
import json
import time
import uuid

import pytest

from app.config import settings

integration = pytest.mark.integration


def _client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app, base_url="http://spicehouse.zenoeats.local")


def _signed(event: dict, secret: str | None = None) -> tuple[str, dict]:
    """A payload and the Stripe-Signature header for it, signed as Stripe does."""
    payload = json.dumps(event)
    ts = int(time.time())
    key = secret if secret is not None else settings.STRIPE_CONNECT_WEBHOOK_SECRET
    sig = hmac.new(key.encode(), f"{ts}.{payload}".encode(), hashlib.sha256).hexdigest()
    return payload, {"Stripe-Signature": f"t={ts},v1={sig}", "Content-Type": "application/json"}


def _event(event_type="payment_intent.succeeded", account="acct_test_123", **extra):
    return {
        "id": f"evt_test_{uuid.uuid4().hex[:16]}",
        "object": "event",
        "type": event_type,
        "account": account,
        "created": int(time.time()),
        "livemode": False,
        "data": {"object": {"id": f"pi_{uuid.uuid4().hex[:16]}", "object": "payment_intent",
                            "status": "succeeded", "metadata": {}, **extra}},
    }


@integration
def test_a_signed_event_is_accepted_and_stored(monkeypatch):
    """The regression test for the 500. Nothing is mocked between the request
    and the row: the handler gets the same Event object Stripe's library
    builds in production."""
    from app.workers import tasks

    queued = []
    monkeypatch.setattr(tasks.process_stripe_event, "delay", lambda rid: queued.append(rid))

    event = _event()
    payload, headers = _signed(event)
    res = _client().post("/api/v1/webhooks/stripe/connect", content=payload, headers=headers)

    assert res.status_code == 200, res.text
    assert res.json() == {"received": True}
    assert len(queued) == 1, "a supported event must be handed to the worker"

    from sqlalchemy import select

    from app.db.session import system_session
    from app.models import StripeEvent, StripeEventStatus

    with system_session() as session:
        row = session.execute(
            select(StripeEvent).where(StripeEvent.stripe_event_id == event["id"])
        ).scalar_one()
        assert row.type == "payment_intent.succeeded"
        assert row.status == StripeEventStatus.RECEIVED.value
        # The field that raised. Rule 25: the worker matches the order's
        # restaurant against this before touching tenant state, so a null here
        # would be a silent refusal to process every payment.
        assert row.stripe_account_id == "acct_test_123"


@integration
def test_an_event_without_an_account_is_still_accepted(monkeypatch):
    """A platform-level event carries no `account`. The old code raised here
    instead of storing None."""
    from app.workers import tasks

    monkeypatch.setattr(tasks.process_stripe_event, "delay", lambda rid: None)

    event = _event()
    del event["account"]
    payload, headers = _signed(event)
    assert _client().post(
        "/api/v1/webhooks/stripe/connect", content=payload, headers=headers
    ).status_code == 200


@integration
def test_an_unsupported_event_is_stored_but_not_worked(monkeypatch):
    from app.workers import tasks

    queued = []
    monkeypatch.setattr(tasks.process_stripe_event, "delay", lambda rid: queued.append(rid))

    payload, headers = _signed(_event("invoice.paid"))
    assert _client().post(
        "/api/v1/webhooks/stripe/connect", content=payload, headers=headers
    ).status_code == 200
    assert queued == [], "an event we do not act on must not reach the worker"


@integration
def test_a_redelivery_is_not_processed_twice(monkeypatch):
    """Stripe retries aggressively. The second delivery is the normal case,
    and must not queue the work again."""
    from app.workers import tasks

    queued = []
    monkeypatch.setattr(tasks.process_stripe_event, "delay", lambda rid: queued.append(rid))

    payload, headers = _signed(_event())
    client = _client()
    first = client.post("/api/v1/webhooks/stripe/connect", content=payload, headers=headers)
    second = client.post("/api/v1/webhooks/stripe/connect", content=payload, headers=headers)

    assert first.status_code == 200 and second.status_code == 200
    assert second.json().get("duplicate") is True
    assert len(queued) == 1


@integration
def test_a_forged_signature_is_refused():
    payload, headers = _signed(_event(), secret="whsec_not_the_configured_one")
    res = _client().post("/api/v1/webhooks/stripe/connect", content=payload, headers=headers)
    assert res.status_code == 400
    assert res.json()["code"] == "INVALID_SIGNATURE"


@integration
def test_an_unsigned_request_is_refused():
    payload = json.dumps(_event())
    res = _client().post(
        "/api/v1/webhooks/stripe/connect",
        content=payload,
        headers={"Stripe-Signature": "t=1,v1=deadbeef", "Content-Type": "application/json"},
    )
    assert res.status_code == 400


@integration
def test_a_tampered_payload_is_refused():
    """The signature covers the body. Editing the amount after signing must
    not get past the door."""
    event = _event()
    payload, headers = _signed(event)
    tampered = payload.replace('"status": "succeeded"', '"status": "canceled"')
    assert tampered != payload
    res = _client().post("/api/v1/webhooks/stripe/connect", content=tampered, headers=headers)
    assert res.status_code == 400
