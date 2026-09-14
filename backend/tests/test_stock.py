"""The sold-out toggle is reachable by the staff it is for.

The toggle endpoint has always accepted every staff role, but the only screen
with one read /items, which is managers only. A kitchen login therefore could
not mark anything sold out. /stock is the list that screen needs, readable by
every role and carrying nothing a kitchen login should not see.
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

pytestmark = pytest.mark.integration


@pytest.fixture
def kitchen(admin_user, cleanup):
    """A restaurant with a small menu and one member of each role."""
    from app.db.base import utcnow
    from app.db.session import system_session, tenant_session
    from app.models import RestaurantUser

    restaurant = _create(admin_user, cleanup)
    owner_email = _email()
    owner, _ = _owner(admin_user, restaurant.id, owner_email)
    _set_own_password(owner_email, "owner password 123")

    def client(user_id):
        c = _staff_client(restaurant.slug)
        c.cookies.set(staff_auth.SESSION_COOKIE, staff_auth.issue_session(user_id))
        return c

    clients = {"ADMIN": client(owner.user_id)}
    for role in ("MANAGER", "KITCHEN", "CASHIER"):
        with system_session() as session:
            user_id = session.execute(
                text(
                    "INSERT INTO users (id, kind, email, password_hash, is_platform_admin, "
                    "is_active, must_change_password, created_at, updated_at) "
                    "VALUES (gen_random_uuid(), 'STAFF', :e, :h, false, true, false, now(), now()) "
                    "RETURNING id"
                ),
                {"e": _email(), "h": staff_auth.hash_password("staff password 12")},
            ).scalar_one()
        with tenant_session(restaurant.id) as session:
            session.add(RestaurantUser(
                restaurant_id=restaurant.id, user_id=user_id, role_code=role,
                status="ACTIVE", invited_at=utcnow(), accepted_at=utcnow(),
            ))
        clients[role] = client(user_id)

    owner_client = clients["ADMIN"]
    types = {t["name"]: t["id"] for t in owner_client.get("/api/v1/restaurant/item-types").json()}
    burgers = owner_client.post(
        "/api/v1/restaurant/item-types", json={"name": "Burgers", "parent_id": types["Food"]}
    ).json()

    def item(name, type_id):
        res = owner_client.post(
            "/api/v1/restaurant/items",
            json={"name": name, "item_type_id": type_id, "base_price_minor": 500},
        )
        assert res.status_code == 201, res.text
        return res.json()["id"]

    ids = {
        # Created drinks first, so the order below is the menu's and not creation's.
        "Iced Tea": item("Iced Tea", types["Drinks"]),
        "Smash Burger": item("Smash Burger", burgers["id"]),
        "Fries": item("Fries", types["Sides"]),
        "Gone": item("Gone", types["Sides"]),
    }
    assert owner_client.delete(f"/api/v1/restaurant/items/{ids['Gone']}").status_code == 200
    return clients, ids


def test_every_role_can_read_stock_in_menu_order(kitchen):
    clients, _ = kitchen

    for role, client in clients.items():
        res = client.get("/api/v1/restaurant/stock")
        assert res.status_code == 200, (role, res.text)

    rows = clients["KITCHEN"].get("/api/v1/restaurant/stock").json()
    assert [(r["name"], r["type"]) for r in rows] == [
        ("Smash Burger", "Food / Burgers"),
        ("Iced Tea", "Drinks"),
        ("Fries", "Sides"),
    ]
    # Only what flipping the toggle needs: no prices, groups or photos.
    assert set(rows[0]) == {"id", "name", "type", "is_available"}


def test_kitchen_and_cashier_can_mark_an_item_sold_out(kitchen):
    clients, ids = kitchen

    for role in ("KITCHEN", "CASHIER"):
        client = clients[role]
        off = client.patch(
            f"/api/v1/restaurant/items/{ids['Fries']}/availability", params={"is_available": "false"}
        )
        assert off.status_code == 200, (role, off.text)
        fries = next(r for r in client.get("/api/v1/restaurant/stock").json() if r["name"] == "Fries")
        assert fries["is_available"] is False
        client.patch(
            f"/api/v1/restaurant/items/{ids['Fries']}/availability", params={"is_available": "true"}
        )


def test_a_deleted_item_cannot_be_toggled(kitchen):
    clients, ids = kitchen
    res = clients["KITCHEN"].patch(
        f"/api/v1/restaurant/items/{ids['Gone']}/availability", params={"is_available": "true"}
    )
    assert res.status_code == 422


def test_menu_editing_is_still_managers_only(kitchen):
    clients, _ = kitchen
    for role in ("KITCHEN", "CASHIER"):
        assert clients[role].get("/api/v1/restaurant/items").status_code == 403
        assert clients[role].get("/api/v1/restaurant/reports").status_code == 403
        assert clients[role].get("/api/v1/restaurant/staff").status_code == 403
    assert clients["MANAGER"].get("/api/v1/restaurant/items").status_code == 200
    assert clients["MANAGER"].get("/api/v1/restaurant/staff").status_code == 403
