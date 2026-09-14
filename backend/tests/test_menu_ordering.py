"""The menu must read back in the same order every time.

Regression cover for items rearranging themselves. Nothing sets sort_order,
so every row in a menu carries 0, and a sort of nothing but ties has no
defined result. Postgres returns tied rows in scan order and an UPDATE
rewrites the row at the end of the heap, so marking one item sold out sent it
to the bottom of its list -- on the storefront as much as in the builder.

Requires a live database: the bug is in what Postgres returns, so a fake
session cannot see it.
"""

import uuid

import pytest
from sqlalchemy import text

from app.db.session import system_session, tenant_session
from app.models import Item, ItemType, Meal, MealItem, Restaurant, RestaurantStatus
from app.services.menu import load_menu

pytestmark = pytest.mark.integration

# Forty, not four.
#
# The size is the test. With a handful of rows Postgres sorts them by a path
# that happens to preserve input order, so a four-item menu passes with the
# tiebreaker removed and guards nothing. Forty is past that threshold: without
# the tiebreaker the toggled row lands at the end of the list, which is the
# reported bug exactly.
NAMES = [f"Coffee {i:02d}" for i in range(40)]


def _purge(rid) -> None:
    """Remove everything this fixture put in the database.

    Deepest first, because each table below points at the one after it.
    """
    with tenant_session(rid) as session:
        session.execute(text("DELETE FROM meal_items WHERE restaurant_id = :r"), {"r": rid})
        session.execute(text("DELETE FROM menu_items WHERE restaurant_id = :r"), {"r": rid})
        session.execute(text("DELETE FROM item_types WHERE restaurant_id = :r"), {"r": rid})
        session.execute(text("DELETE FROM meals WHERE restaurant_id = :r"), {"r": rid})
        session.execute(text("DELETE FROM restaurants WHERE id = :r"), {"r": rid})


@pytest.fixture
def coffee_menu(request):
    """One meal period serving forty items, every one added with the default
    sort_order of 0, which is exactly how the portal adds them.

    This writes a real restaurant to a real database, so the cleanup is
    registered the moment that row exists rather than left to the code after
    the yield. Teardown written after a yield only runs if the fixture got
    there: a setup that failed halfway -- which is what a schema change does
    to it -- left a restaurant behind on every run, and they accumulated
    silently in the dev database until somebody noticed six of them.
    """
    slug = f"order-{uuid.uuid4().hex[:8]}"
    with system_session() as session:
        restaurant = Restaurant(
            slug=slug, name="Ordering", status=RestaurantStatus.ACTIVE.value,
            timezone="UTC", currency="USD",
        )
        session.add(restaurant)
        session.flush()
        rid = restaurant.id

    # Before anything else can fail. Registered rather than written after the
    # yield, so it runs however this fixture ends.
    request.addfinalizer(lambda: _purge(rid))

    with tenant_session(rid) as session:
        meal = Meal(restaurant_id=rid, name="Breakfast")
        session.add(meal)
        # An item cannot exist without a type, so the vocabulary comes first,
        # exactly as it does when a restaurant is created.
        drinks = ItemType(restaurant_id=rid, name="Drinks", sort_order=0)
        session.add(drinks)
        session.flush()
        meal_id, type_id = meal.id, drinks.id

    # One transaction per item, because created_at defaults to now(), which is
    # the transaction clock rather than the statement clock. Adding them all in
    # one session would stamp them identically and leave id to decide -- stable,
    # but not the creation order a menu builder is entitled to. The portal
    # creates them one request at a time, and this mirrors that.
    #
    # The item and the link that serves it are written together, which is what
    # the create-item endpoint does. The link carries the timestamp the reader
    # sorts on, so writing them apart would be testing a sequence the portal
    # never produces.
    for name in NAMES:
        with tenant_session(rid) as session:
            item = Item(
                restaurant_id=rid, name=name, item_type_id=type_id,
                base_price_minor=200, currency="USD",
            )
            session.add(item)
            session.flush()
            session.add(
                MealItem(restaurant_id=rid, meal_id=meal_id, item_id=item.id)
            )

    return rid


def _item_names(rid) -> list[str]:
    with tenant_session(rid) as session:
        menu = load_menu(session, include_empty=True)
    return [item.name for item in menu.meals[0].sections[0].items]


def test_items_keep_their_order_when_one_is_marked_sold_out(coffee_menu):
    rid = coffee_menu
    before = _item_names(rid)
    assert before == NAMES, "items did not come back in the order they were created"

    # The kitchen's sold-out toggle: an UPDATE on one row, nothing else.
    with tenant_session(rid) as session:
        session.execute(
            text("UPDATE menu_items SET is_available = false WHERE name = :n"),
            {"n": NAMES[5]},
        )

    after = _item_names(rid)
    assert after == before, (
        f"marking an item sold out moved it from position {before.index(NAMES[5])} "
        f"to {after.index(NAMES[5])}"
    )


def test_repeated_reads_agree(coffee_menu):
    """Ties used to resolve to whatever the scan produced, which is stable
    enough to pass by luck. Reading several times makes that harder."""
    rid = coffee_menu
    assert _item_names(rid) == _item_names(rid) == _item_names(rid) == NAMES


def test_a_renamed_item_stays_where_it_was(coffee_menu):
    """Any UPDATE moves the row in the heap, not just the availability one, so
    editing a name or a price has to leave the order alone too."""
    rid = coffee_menu
    with tenant_session(rid) as session:
        session.execute(
            text("UPDATE menu_items SET name = 'Long Black' WHERE name = :n"),
            {"n": NAMES[5]},
        )

    expected = [*NAMES]
    expected[5] = "Long Black"
    assert _item_names(rid) == expected
