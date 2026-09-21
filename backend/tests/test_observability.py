"""Error tracking sends faults, and never the secrets around them.

Events are captured with an in-memory transport, so nothing leaves the
machine; the assertions are about what would have.
"""

import json

import pytest

from app.config import settings
from app.core import observability


from sentry_sdk.transport import Transport


class _Capture(Transport):
    """A Sentry transport that keeps envelopes instead of sending them. Must
    subclass Transport: anything else is ignored and the real HTTP transport
    is used."""

    def __init__(self, options=None):
        super().__init__(options)
        self.envelopes = []

    def capture_envelope(self, envelope):
        self.envelopes.append(envelope)


@pytest.fixture
def sentry(monkeypatch):
    import sentry_sdk

    monkeypatch.setattr(settings, "SENTRY_DSN", "https://public@o0.ingest.sentry.io/0")
    transport = _Capture()
    assert observability.init_error_tracking("test", transport=transport)
    yield transport
    sentry_sdk.get_client().close()
    monkeypatch.setattr(observability, "_enabled", False)


def _events(transport) -> list[dict]:
    events = []
    for envelope in transport.envelopes:
        for item in envelope.items:
            if item.type == "event":
                events.append(json.loads(item.payload.get_bytes()))
    return events


def test_off_without_a_dsn(monkeypatch):
    monkeypatch.setattr(settings, "SENTRY_DSN", "")
    assert observability.init_error_tracking("test") is False
    observability.capture(RuntimeError("nothing is sent"))  # must not raise


def test_a_caught_fault_is_reported_with_its_reference_and_without_secrets(sentry):
    import sentry_sdk

    def place_order(password, pickup_pin, client_secret):
        raise RuntimeError("payment backend fell over")

    sentry_sdk.set_extra("pickup_pin", "123456")
    sentry_sdk.set_extra("receipt_email", "sam@example.com")
    sentry_sdk.set_extra("order_number", 1001)
    try:
        place_order("hunter2-password", "654321", "pi_123_secret_abc")
    except RuntimeError as exc:
        observability.capture(exc, reference="3f9c1a2b")
    sentry_sdk.flush()

    events = _events(sentry)
    assert len(events) == 1
    event = events[0]

    # Sentry attaches the source lines around each frame. In this test those
    # lines are the literals above, which is not a leak -- production source
    # holds no runtime secrets -- so they are set aside before looking.
    frames = [
        frame
        for exception in event["exception"]["values"]
        for frame in exception["stacktrace"]["frames"]
    ]
    for frame in frames:
        assert "vars" not in frame, "local variables must never be sent"
        for key in ("pre_context", "context_line", "post_context"):
            frame.pop(key, None)
    raw = json.dumps(event)

    assert event["tags"]["reference"] == "3f9c1a2b"
    assert "payment backend fell over" in raw
    # Harmless context survives...
    assert event["extra"]["order_number"] == 1001
    # ...secrets and PII do not, whether set as extra data or sitting in the
    # frame's local variables.
    for secret in ("123456", "sam@example.com", "hunter2-password", "654321", "pi_123_secret_abc"):
        assert secret not in raw, secret
