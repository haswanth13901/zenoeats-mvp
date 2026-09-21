"""Items a restaurant does not charge sales tax on.

The flag is the restaurant's to set per item, and what it changes is the tax
on an order: a cart of A (exempt) and B (taxed) is taxed on B alone, however
the two were put in the cart.
"""

import pytest
from sqlalchemy import select, text

from tests.test_admin_restaurants import (  # noqa: F401  (fixtures)
    _create,
    _email,
    _owner,
    _set_own_password,
    _staff_client,
    admin_user,
    cleanup,
)
from tests.test_staff_removal import team  # noqa: F401  (fixture)

pytestmark = pytest.mark.integration

ITEMS = "/api/v1/restaurant/items"


@pytest.fixture
def kitchen(team):
    """A restaurant on a flat 10% rate, with one meal period to serve from."""
    from app.db.session import system_session, tenant_session
    from app.models import ItemType, Meal

    with system_session() as session:
        session.execute(
            text(
                "UPDATE restaurants SET status = 'ACTIVE', tax_mode = 'FLAT', "
                "tax_rate_bps = 1000 WHERE id = :r"
            ),
            {"r": team.id},
        )
    with tenant_session(team.id) as session:
        team.type_id = str(session.execute(select(ItemType).limit(1)).scalars().first().id)
        meal = Meal(restaurant_id=team.id, name="All day", sort_order=0)
        session.add(meal)
        session.flush()
        team.meal_id = str(meal.id)
    return team


def _add(kitchen, name, price, **extra):
    response = kitchen.owner.post(ITEMS, json={
        "name": name, "item_type_id": kitchen.type_id, "base_price_minor": price,
        "meal_ids": [kitchen.meal_id], **extra,
    })
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _listed(kitchen, item_id):
    return next(i for i in kitchen.owner.get(ITEMS).json() if i["id"] == item_id)


def _price(kitchen, *item_ids):
    from app.db.session import tenant_session
    from app.models import Restaurant
    from app.services.pricing import price_cart

    with tenant_session(kitchen.id) as session:
        return price_cart(
            session, session.get(Restaurant, kitchen.id),
            [{"menu_item_id": i, "quantity": 1, "modifiers": []} for i in item_ids],
        )


def test_items_are_taxed_unless_marked_exempt(kitchen):
    taxed = _add(kitchen, "Smash Burger", 1000)
    exempt = _add(kitchen, "Bottled Water", 500, tax_exempt=True)

    assert _listed(kitchen, taxed)["tax_exempt"] is False
    assert _listed(kitchen, exempt)["tax_exempt"] is True


def test_an_edit_can_switch_the_flag_both_ways(kitchen):
    item = _add(kitchen, "Coffee Beans", 1800)

    assert kitchen.owner.patch(f"{ITEMS}/{item}", json={"tax_exempt": True}).status_code == 200
    assert _listed(kitchen, item)["tax_exempt"] is True

    # An edit that leaves the flag out leaves it alone.
    assert kitchen.owner.patch(f"{ITEMS}/{item}", json={"base_price_minor": 1900}).status_code == 200
    assert _listed(kitchen, item)["tax_exempt"] is True

    assert kitchen.owner.patch(f"{ITEMS}/{item}", json={"tax_exempt": False}).status_code == 200
    assert _listed(kitchen, item)["tax_exempt"] is False


def test_only_the_taxed_item_in_a_cart_is_taxed(kitchen):
    a = _add(kitchen, "Bottled Water", 500, tax_exempt=True)
    b = _add(kitchen, "Smash Burger", 1000)

    cart = _price(kitchen, a, b)
    assert cart.subtotal_minor == 1500
    assert cart.tax_minor == 100  # 10% of B's 10.00, nothing on A
    assert cart.total_minor == 1600

    assert _price(kitchen, a).tax_minor == 0
    assert _price(kitchen, b).tax_minor == 100
