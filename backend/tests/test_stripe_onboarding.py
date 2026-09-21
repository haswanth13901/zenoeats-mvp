"""Where Stripe sends the operator back is ours to decide.

The onboarding link used to be built from a return_url and refresh_url sent
as query parameters. Stripe redirects to whatever it was given, so that made
our onboarding flow an open redirect wearing Stripe's credibility: finish the
form, get handed to a page that looks like the portal and asks you to sign in.
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.core import platform_auth
from app.services import stripe_service

from tests.test_admin_restaurants import (  # noqa: F401  (fixtures)
    _create,
    _email,
    _owner,
    admin_user,
    cleanup,
)

pytestmark = pytest.mark.integration

ADMIN = "admin.zenoeats.local"


@pytest.fixture
def stripe_calls(monkeypatch):
    """Record what would have been sent to Stripe, and send nothing."""
    calls = {}

    def account(*, email, display_name, **kw):
        calls["email"] = email
        return f"acct_{uuid.uuid4().hex[:16]}"

    def link(account_id, refresh_url, return_url):
        calls["refresh_url"] = refresh_url
        calls["return_url"] = return_url
        return "https://connect.stripe.com/setup/s/test"

    monkeypatch.setattr(stripe_service, "create_connected_account", account)
    monkeypatch.setattr(stripe_service, "create_account_link", link)
    return calls


@pytest.fixture
def admin_client(admin_user, monkeypatch):
    from app.main import app

    monkeypatch.setattr(
        platform_auth.settings,
        "ADMIN_USERS",
        f"{admin_user.email}:{platform_auth.hash_password('x' * 16)}",
    )
    client = TestClient(app, base_url=f"http://{ADMIN}")
    client.cookies.set(
        platform_auth.SESSION_COOKIE,
        platform_auth.issue_session(platform_auth.PlatformAdmin(email=admin_user.email)),
    )
    return client


def test_stripe_returns_to_the_portal_and_nowhere_else(
    admin_user, cleanup, admin_client, stripe_calls
):
    restaurant = _create(admin_user, cleanup)
    _owner(admin_user, restaurant.id, _email())

    res = admin_client.post(f"/api/v1/admin/restaurants/{restaurant.id}/stripe-onboarding")

    assert res.status_code == 200, res.text
    assert res.json()["onboarding_url"].startswith("https://connect.stripe.com/")
    assert stripe_calls["return_url"] == f"http://{ADMIN}/admin"
    assert stripe_calls["refresh_url"] == f"http://{ADMIN}/admin"


def test_a_caller_cannot_choose_the_destination(admin_user, cleanup, admin_client, stripe_calls):
    """The old parameters are now ignored rather than obeyed."""
    restaurant = _create(admin_user, cleanup)
    _owner(admin_user, restaurant.id, _email())

    res = admin_client.post(
        f"/api/v1/admin/restaurants/{restaurant.id}/stripe-onboarding"
        "?return_url=https://phish.example/admin&refresh_url=https://phish.example/admin"
    )

    assert res.status_code == 200, res.text
    assert "phish.example" not in stripe_calls["return_url"]
    assert "phish.example" not in stripe_calls["refresh_url"]


def test_the_portal_url_is_https_in_production(monkeypatch):
    from types import SimpleNamespace

    from app.api.v1.admin import _admin_portal_url, settings

    monkeypatch.setattr(settings, "ENV", "production")
    request = SimpleNamespace(
        headers={"host": "admin.zenoeats.com"}, url=SimpleNamespace(scheme="http")
    )
    # http on the request: TLS is terminated at the proxy, so the scheme the
    # app sees is not the one the operator's browser used.
    assert _admin_portal_url(request) == "https://admin.zenoeats.com/admin"


# --------------------------------------------------- who Stripe writes to ---

def test_the_connected_account_is_contactable_at_the_owner(
    admin_user, cleanup, admin_client, stripe_calls
):
    """Verification requests, failed payouts and disputes are the
    restaurant's business, and must not land in a platform inbox."""
    restaurant = _create(admin_user, cleanup)
    owner_email = _email()
    _owner(admin_user, restaurant.id, owner_email)

    res = admin_client.post(f"/api/v1/admin/restaurants/{restaurant.id}/stripe-onboarding")

    assert res.status_code == 200, res.text
    assert stripe_calls["email"] == owner_email
    assert stripe_calls["email"] != admin_user.email


def test_onboarding_without_an_owner_is_refused(admin_user, cleanup, admin_client, stripe_calls):
    restaurant = _create(admin_user, cleanup)

    res = admin_client.post(f"/api/v1/admin/restaurants/{restaurant.id}/stripe-onboarding")

    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "OWNER_REQUIRED"
    assert stripe_calls == {}  # nothing was created at Stripe
