"""The IT support role, exercised against the running API.

tests/test_role_coverage.py already proves which roles each endpoint's
dependency admits, and it does so without a database. This asks the other
half of the question: with a real IT_SUPPORT membership and a real session,
does the restaurant actually answer?

Worth asking separately because a role check passing is not the same as an
endpoint working. Several of these also run `storefront.require_enabled`, a
rate limiter, or an audit write that needs a real membership row behind the
caller -- and a role can be admitted by `require_staff` and still fall over
on one of those.

The refusals are here for the opposite reason. They are the promise the role
is worth having for, and a promise nobody exercised is one a later change can
quietly drop.
"""

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
from tests.test_delivery_zones import _fake_geocoder

pytestmark = pytest.mark.integration

ADDRESS = {
    "address_line1": "44 Main St", "address_city": "Chicago",
    "address_state": "IL", "address_postal_code": "60614", "address_country": "US",
}


@pytest.fixture(autouse=True)
def no_rate_limits(monkeypatch):
    """Several of these endpoints are rate limited per person, and the point
    here is who may call them rather than how often."""
    from app.core import ratelimit

    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)


@pytest.fixture
def support(admin_user, cleanup):
    """A restaurant with an owner and one IT support member.

    Returns both clients: the owner's, to set up anything support may not
    create for itself, and support's, which is what the tests are about.
    """
    from app.db.base import utcnow
    from app.db.session import system_session, tenant_session
    from app.models import RestaurantUser, StaffRole

    restaurant = _create(admin_user, cleanup)
    owner_email = _email()
    owner, _ = _owner(admin_user, restaurant.id, owner_email)
    _set_own_password(owner_email, "owner password 123")

    def client(user_id):
        c = _staff_client(restaurant.slug)
        c.cookies.set(staff_auth.SESSION_COOKIE, staff_auth.issue_session(user_id))
        return c

    with system_session() as session:
        user_id = session.execute(
            text(
                "INSERT INTO users (id, kind, email, password_hash, is_platform_admin, "
                "is_active, must_change_password, created_at, updated_at) "
                "VALUES (gen_random_uuid(), 'STAFF', :e, :h, false, true, false, now(), now()) "
                "RETURNING id"
            ),
            {"e": _email(), "h": staff_auth.hash_password("support password 12")},
        ).scalar_one()
    with tenant_session(restaurant.id) as session:
        session.add(RestaurantUser(
            restaurant_id=restaurant.id, user_id=user_id,
            role_code=StaffRole.IT_SUPPORT.value,
            status="ACTIVE", invited_at=utcnow(), accepted_at=utcnow(),
        ))

    return client(owner.user_id), client(user_id), restaurant


def test_support_signs_in_and_is_told_its_role(support):
    _, client, _ = support
    me = client.get("/api/v1/restaurant/me")
    assert me.status_code == 200, me.text
    # The portal decides which tabs to render from this, so it has to arrive
    # as the role code rather than anything prettied up for a screen.
    assert me.json()["role_code"] == "IT_SUPPORT"


def test_support_can_read_what_it_needs_to_diagnose(support):
    _, client, _ = support

    for path in (
        "/api/v1/restaurant/orders",
        "/api/v1/restaurant/orders/history",
        "/api/v1/restaurant/stock",
        "/api/v1/restaurant/menu",
        "/api/v1/restaurant/items",
        "/api/v1/restaurant/item-types",
        "/api/v1/restaurant/combos",
        "/api/v1/restaurant/modifier-groups",
        "/api/v1/restaurant/profile",
        "/api/v1/restaurant/delivery",
    ):
        res = client.get(path)
        assert res.status_code == 200, (path, res.text)


def test_support_can_fix_the_restaurants_own_record(support):
    """The typo-in-the-trading-name case, which is why the role exists."""
    _, client, _ = support

    res = client.patch(
        "/api/v1/restaurant/profile", json={"tagline": "Open late, most nights."}
    )
    assert res.status_code == 200, res.text
    assert res.json()["tagline"] == "Open late, most nights."
    assert client.get("/api/v1/restaurant/profile").json()["tagline"] == "Open late, most nights."


def test_support_can_set_the_delivery_area(support, monkeypatch):
    """The whole sequence, because it is one support call: the address is
    wrong, so the restaurant is not where the map thinks, so the rings never
    match and delivery cannot even be switched on."""
    _, client, _ = support
    _fake_geocoder(monkeypatch, lat=41.9227, lng=-87.6431)

    assert client.patch("/api/v1/restaurant/profile", json=ADDRESS).status_code == 200

    located = client.post("/api/v1/restaurant/delivery/locate")
    assert located.status_code == 200, located.text
    assert (round(located.json()["latitude"], 4), round(located.json()["longitude"], 4)) == (
        41.9227, -87.6431,
    )

    zoned = client.put(
        "/api/v1/restaurant/delivery/zones", json={"zones": [{"max_miles": 3, "fee_minor": 400}]}
    )
    assert zoned.status_code == 200, zoned.text

    res = client.patch("/api/v1/restaurant/delivery", json={"delivery_enabled": True})
    assert res.status_code == 200, res.text
    assert res.json()["delivery_enabled"] is True


def test_support_cannot_change_what_is_sold(support):
    """Reading the menu and editing it are two different answers.

    The read above is what lets support say why an item is not on the
    storefront. Everything here is the restaurant's to decide, and a price a
    support login could edit is a price nobody can account for.
    """
    owner, client, _ = support

    types = {t["name"]: t["id"] for t in owner.get("/api/v1/restaurant/item-types").json()}
    created = owner.post(
        "/api/v1/restaurant/items",
        json={"name": "Flat White", "item_type_id": types["Drinks"], "base_price_minor": 350},
    )
    assert created.status_code == 201, created.text
    item_id = created.json()["id"]

    refused = [
        client.post(
            "/api/v1/restaurant/items",
            json={"name": "Nope", "item_type_id": types["Drinks"], "base_price_minor": 100},
        ),
        client.patch(f"/api/v1/restaurant/items/{item_id}", json={"base_price_minor": 1}),
        client.delete(f"/api/v1/restaurant/items/{item_id}"),
        # Sold out is the floor's call during service, not support's.
        client.patch(
            f"/api/v1/restaurant/items/{item_id}/availability", params={"is_available": "false"}
        ),
    ]
    assert [r.status_code for r in refused] == [403, 403, 403, 403], [r.text for r in refused]

    # And the item is exactly as the owner left it.
    item = next(
        i for i in owner.get("/api/v1/restaurant/items").json() if i["id"] == item_id
    )
    assert item["base_price_minor"] == 350


def test_support_cannot_read_the_takings_or_touch_the_team(support):
    """The other two refusals, stated as the questions someone asks of the role.

    Reports are what the restaurant earned. The staff screen issues logins and
    resets passwords, so reaching it would let a support account hand itself
    an admin membership -- which is the whole reason the role is separate from
    one.
    """
    _, client, _ = support

    assert client.get("/api/v1/restaurant/reports").status_code == 403
    assert client.get("/api/v1/restaurant/staff").status_code == 403
    assert client.post(
        "/api/v1/restaurant/staff",
        json={"email": _email(), "role_code": "ADMIN"},
    ).status_code == 403


def test_support_cannot_act_on_a_live_order(support):
    """Cancelling is a refund. The two collection steps are the counter's.

    Asserted against an order id that does not exist, because the role check
    runs before the order is looked up: a 403 here means refused for who is
    asking, where the floor would get as far as 404 or 422.
    """
    _, client, _ = support

    missing = "00000000-0000-0000-0000-000000000000"
    for path in (
        f"/api/v1/restaurant/orders/{missing}/ready",
        f"/api/v1/restaurant/orders/{missing}/complete",
        f"/api/v1/restaurant/orders/{missing}/override-complete",
        f"/api/v1/restaurant/orders/{missing}/cancel",
    ):
        assert client.post(path, json={}).status_code == 403, path


def test_support_is_not_offered_the_delivery_surface(support):
    """Deliveries belong to the people in the car and the manager sending them."""
    _, client, _ = support

    assert client.get("/api/v1/restaurant/deliveries").status_code == 403
    assert client.get("/api/v1/restaurant/drivers").status_code == 403


def test_support_owns_its_own_login_like_everyone_else(support):
    """Your own name is yours whatever you do here, support included."""
    _, client, _ = support

    res = client.patch("/api/v1/restaurant/me", json={"full_name": "Sam Okafor"})
    assert res.status_code == 200, res.text
    assert res.json()["full_name"] == "Sam Okafor"
