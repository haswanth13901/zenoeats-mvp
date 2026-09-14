"""The operator APIs answer only where their own portal is served.

Restaurants and the platform portal are subdomains of one root domain, so a
cookie set on any of them counts as same-site on all of them: a request made
by a page on spicehouse.zenoeats.com carries the admin session cookie of
whoever is signed in at admin.zenoeats.com. That made every storefront origin
-- and anything injected into one -- a way to drive the super-admin API.

Two rules close it: the platform API exists on admin.<root> and nowhere else,
and neither operator API accepts a request whose Origin is a different host.
"""

import pytest
from fastapi.testclient import TestClient

from app.core import platform_auth, staff_auth

from tests.test_admin_restaurants import (  # noqa: F401  (fixtures)
    _create,
    _email,
    _owner,
    admin_user,
    cleanup,
)

pytestmark = pytest.mark.integration

ADMIN = "admin.zenoeats.local"


def _client(host, cookie=None, token=None):
    from app.main import app

    client = TestClient(app, base_url=f"http://{host}")
    if cookie:
        client.cookies.set(cookie, token)
    return client


# ------------------------------------------------- the platform API's home ---

def test_the_platform_api_is_not_served_on_a_restaurant_subdomain(admin_user, cleanup):
    restaurant = _create(admin_user, cleanup)
    for host in (f"{restaurant.slug}.zenoeats.local", "zenoeats.local", "www.zenoeats.local"):
        res = _client(host).post(
            "/api/v1/admin/login", json={"email": "someone@example.com", "password": "x" * 12}
        )
        assert res.status_code == 404, host

    assert _client(ADMIN).post(
        "/api/v1/admin/login", json={"email": "someone@example.com", "password": "x" * 12}
    ).status_code in (401, 429)


def test_a_session_cookie_is_useless_off_the_admin_hostname(admin_user, cleanup):
    """Even holding a valid session, the endpoint is not there to be called."""
    restaurant = _create(admin_user, cleanup)
    token = platform_auth.issue_session(platform_auth.PlatformAdmin(email=admin_user.email))
    client = _client(
        f"{restaurant.slug}.zenoeats.local", platform_auth.SESSION_COOKIE, token
    )
    assert client.get("/api/v1/admin/restaurants").status_code == 404


# ------------------------------------------------------------ cross origin ---

def test_the_platform_api_refuses_a_call_made_from_another_origin(admin_user, cleanup, monkeypatch):
    restaurant = _create(admin_user, cleanup)
    monkeypatch.setattr(
        platform_auth.settings,
        "ADMIN_USERS",
        f"{admin_user.email}:{platform_auth.hash_password('x' * 16)}",
    )
    token = platform_auth.issue_session(platform_auth.PlatformAdmin(email=admin_user.email))
    client = _client(ADMIN, platform_auth.SESSION_COOKIE, token)

    blocked = client.get(
        "/api/v1/admin/me", headers={"Origin": f"http://{restaurant.slug}.zenoeats.local"}
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "CROSS_ORIGIN_DENIED"

    allowed = client.get("/api/v1/admin/me", headers={"Origin": f"http://{ADMIN}"})
    assert allowed.status_code == 200


def test_a_restaurants_portal_refuses_a_call_made_from_another_restaurant(admin_user, cleanup):
    ours = _create(admin_user, cleanup)
    neighbour = _create(admin_user, cleanup)
    out, _ = _owner(admin_user, ours.id, _email())
    client = _client(
        f"{ours.slug}.zenoeats.local",
        staff_auth.SESSION_COOKIE,
        staff_auth.issue_session(out.user_id),
    )

    blocked = client.get(
        "/api/v1/restaurant/me", headers={"Origin": f"http://{neighbour.slug}.zenoeats.local"}
    )
    assert blocked.status_code == 403

    allowed = client.get(
        "/api/v1/restaurant/me", headers={"Origin": f"http://{ours.slug}.zenoeats.local"}
    )
    assert allowed.status_code == 200


def test_a_request_with_no_origin_is_left_alone(admin_user, cleanup):
    """curl, a server, and a plain same-origin GET send no Origin at all."""
    restaurant = _create(admin_user, cleanup)
    out, _ = _owner(admin_user, restaurant.id, _email())
    client = _client(
        f"{restaurant.slug}.zenoeats.local",
        staff_auth.SESSION_COOKIE,
        staff_auth.issue_session(out.user_id),
    )
    assert client.get("/api/v1/restaurant/me").status_code == 200


def test_the_storefront_api_still_answers_across_origins(admin_user, cleanup):
    """Customer endpoints authenticate with a bearer token the caller has to
    hold, so pinning them to an origin would buy nothing."""
    restaurant = _create(admin_user, cleanup)
    res = _client(f"{restaurant.slug}.zenoeats.local").get(
        "/api/v1/menu", headers={"Origin": "http://somewhere-else.zenoeats.local"}
    )
    assert res.status_code != 403
