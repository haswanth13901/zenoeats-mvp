"""The menu API refuses what the builder refuses.

The builder checks names and modifier-group rules before it sends anything,
but the API stored whatever arrived: an item named "   ", a pick-one group
with a minimum of three, a required group asking for more choices than it has
options. The last two make every item offering the group impossible to order.
"""

import pytest

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
def manager(admin_user, cleanup):
    restaurant = _create(admin_user, cleanup)
    email = _email()
    owner, _ = _owner(admin_user, restaurant.id, email)
    _set_own_password(email, "owner password 123")
    client = _staff_client(restaurant.slug)
    client.cookies.set(staff_auth.SESSION_COOKIE, staff_auth.issue_session(owner.user_id))
    return client


def _types(client):
    return {t["name"]: t["id"] for t in client.get("/api/v1/restaurant/item-types").json()}


def _group(client, **overrides):
    body = {
        "name": "Veggies", "selection_type": "MULTI", "is_required": False,
        "min_select": 0, "max_select": 3,
        "options": [{"name": "Lettuce"}, {"name": "Onion"}, {"name": "Pickles"}],
    }
    body.update(overrides)
    return client.post("/api/v1/restaurant/modifier-groups", json=body)


def _message(res):
    return res.json()["detail"]["message"]


# --------------------------------------------------------------- names ---

def test_blank_names_are_refused_where_things_are_created(manager):
    food = _types(manager)["Food"]

    item = manager.post(
        "/api/v1/restaurant/items",
        json={"name": "   ", "item_type_id": food, "base_price_minor": 500},
    )
    assert item.status_code == 422 and _message(item) == "An item needs a name."

    meal = manager.post("/api/v1/restaurant/meals", json={"name": "  "})
    assert meal.status_code == 422 and _message(meal) == "A meal period needs a name."

    assert _group(manager, name="  ").status_code == 422
    blank_option = _group(manager, options=[{"name": "Lettuce"}, {"name": " "}])
    assert blank_option.status_code == 422 and _message(blank_option) == "Every option needs a name."

    assert manager.get("/api/v1/restaurant/items").json() == []
    assert manager.get("/api/v1/restaurant/modifier-groups").json() == []


def test_names_are_stored_trimmed(manager):
    food = _types(manager)["Food"]
    item = manager.post(
        "/api/v1/restaurant/items",
        json={"name": "  Smash Burger ", "item_type_id": food, "base_price_minor": 500,
              "description": "   "},
    )
    assert item.status_code == 201 and item.json()["name"] == "Smash Burger"
    listed = manager.get("/api/v1/restaurant/items").json()[0]
    assert (listed["name"], listed["description"]) == ("Smash Burger", None)

    group = _group(manager, name=" Veggies ", options=[{"name": " Lettuce "}])
    assert group.status_code == 201
    stored = manager.get("/api/v1/restaurant/modifier-groups").json()[0]
    assert (stored["name"], stored["options"][0]["name"]) == ("Veggies", "Lettuce")


# --------------------------------------------------------------- rules ---

@pytest.mark.parametrize(
    "overrides, says",
    [
        ({"options": []}, "needs at least one option"),
        ({"selection_type": "SINGLE", "is_required": True, "min_select": 3, "max_select": 5},
         "is pick-one"),
        ({"selection_type": "SINGLE", "is_required": False, "min_select": 0, "max_select": 2},
         "is pick-one"),
        ({"is_required": True, "min_select": 0, "max_select": 3}, "is required"),
        ({"is_required": False, "min_select": 2, "max_select": 3}, "is optional"),
        ({"is_required": True, "min_select": 4, "max_select": 5}, "has only 3 options"),
        ({"is_required": True, "min_select": 3, "max_select": 2}, "below its minimum"),
    ],
)
def test_a_group_no_customer_could_complete_is_refused(manager, overrides, says):
    res = _group(manager, **overrides)
    assert res.status_code == 422, res.text
    assert says in _message(res)
    assert manager.get("/api/v1/restaurant/modifier-groups").json() == []


@pytest.mark.parametrize(
    "overrides",
    [
        {},  # optional, pick up to three
        {"selection_type": "SINGLE", "is_required": True, "min_select": 1, "max_select": 1},
        {"selection_type": "SINGLE", "is_required": False, "min_select": 0, "max_select": 1},
        {"is_required": True, "min_select": 3, "max_select": 3},
        {"is_required": False, "min_select": 0, "max_select": 10},  # a max above the options is harmless
    ],
)
def test_the_groups_the_builder_makes_are_accepted(manager, overrides):
    assert _group(manager, **overrides).status_code == 201


# ----------------------------------------------------- deleting options ---

def test_an_option_a_required_group_needs_cannot_be_deleted(manager):
    _group(manager, name="Two sauces", is_required=True, min_select=2, max_select=2,
           options=[{"name": "Ketchup"}, {"name": "Mayo"}, {"name": "Mustard"}])
    options = manager.get("/api/v1/restaurant/modifier-groups").json()[0]["options"]

    first = manager.delete(f"/api/v1/restaurant/modifier-options/{options[0]['id']}")
    assert first.status_code == 200  # three down to two still works

    second = manager.delete(f"/api/v1/restaurant/modifier-options/{options[1]['id']}")
    assert second.status_code == 422
    assert "needs at least 2 options" in _message(second)
    assert len(manager.get("/api/v1/restaurant/modifier-groups").json()[0]["options"]) == 2


def test_the_last_option_of_a_group_cannot_be_deleted(manager):
    _group(manager, options=[{"name": "Lettuce"}])
    option = manager.get("/api/v1/restaurant/modifier-groups").json()[0]["options"][0]

    res = manager.delete(f"/api/v1/restaurant/modifier-options/{option['id']}")
    assert res.status_code == 422
    assert "last option" in _message(res)
