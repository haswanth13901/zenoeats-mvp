"""Failed sign-ins are logged without the address that was typed."""

import logging
import uuid

import pytest

from app.config import settings
from app.core.logsafe import email_for_log


def test_the_address_is_masked_and_fingerprinted(monkeypatch):
    monkeypatch.setattr(settings, "SESSION_SECRET", "s" * 44)
    logged = email_for_log("Sam.Customer@Example.com")
    assert logged.startswith("s***@example.com#")
    assert "sam.customer" not in logged.lower()


def test_the_same_address_is_recognisable_across_attempts(monkeypatch):
    monkeypatch.setattr(settings, "SESSION_SECRET", "s" * 44)
    assert email_for_log("sam@example.com") == email_for_log(" SAM@example.com ")
    assert email_for_log("sam@example.com") != email_for_log("sal@example.com")


def test_the_fingerprint_depends_on_the_secret(monkeypatch):
    """A bare hash could be reversed by hashing a leaked address list."""
    monkeypatch.setattr(settings, "SESSION_SECRET", "a" * 44)
    first = email_for_log("sam@example.com")
    monkeypatch.setattr(settings, "SESSION_SECRET", "b" * 44)
    assert email_for_log("sam@example.com") != first


def test_odd_input_never_raises():
    assert email_for_log(None) == "<none>"
    assert email_for_log("") == "<none>"
    assert email_for_log("not-an-email").startswith("n***#")


@pytest.mark.integration
def test_a_failed_admin_sign_in_does_not_log_the_address(caplog, monkeypatch):
    from fastapi.testclient import TestClient

    from app.core import ratelimit
    from app.main import app

    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)
    address = f"victim-{uuid.uuid4().hex[:8]}@example.com"
    with caplog.at_level(logging.WARNING):
        # The platform API answers on its own hostname only.
        res = TestClient(app, base_url="http://admin.zenoeats.local").post(
            "/api/v1/admin/login", json={"email": address, "password": "wrong password"}
        )
    assert res.status_code == 401
    assert "failed platform admin sign-in" in caplog.text
    assert address not in caplog.text
    assert address.split("@")[0] not in caplog.text
