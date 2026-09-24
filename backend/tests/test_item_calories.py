"""What a dish contains, in calories.

Optional, and null rather than zero where a restaurant has not worked it out:
"no figure" and "nothing in it" are different claims, and only one of them is
safe to show a customer counting calories.
"""

import pytest
from pydantic import ValidationError

from app.api.v1.restaurant import ItemIn, ItemUpdateIn, create_item, update_item
from app.db.session import tenant_session
from app.models import Item, Restaurant
from app.services.menu import load_menu
from tests.test_storefront import tenants  # noqa: F401

pytestmark = pytest.mark.integration


def _new(db, rid, tid, **extra):
    return create_item(
        ItemIn(name="Dish with a figure", item_type_id=tid, base_price_minor=500, **extra),
        restaurant=db.get(Restaurant, rid), db=db,
    )


def test_a_figure_is_stored_and_reaches_the_customer_menu(tenants):
    rid, tid, iid = tenants[0]
    with tenant_session(rid) as db:
        db.get(Item, iid).calories = 540
        [meal] = load_menu(db, include_empty=False).meals
        [section] = meal.sections
        assert [i.calories for i in section.items] == [540]


def test_an_item_with_no_figure_says_none_rather_than_zero(tenants):
    rid, tid, iid = tenants[0]
    with tenant_session(rid) as db:
        created = _new(db, rid, tid)
        assert db.get(Item, created["id"]).calories is None
        [meal] = load_menu(db, include_empty=False).meals
        assert all(i.calories is None for s in meal.sections for i in s.items)


def test_zero_is_a_figure_a_restaurant_may_state(tenants):
    """A black coffee really is nothing, and saying so is not the same as
    saying nothing."""
    rid, tid, _ = tenants[0]
    with tenant_session(rid) as db:
        created = _new(db, rid, tid, calories=0)
        assert db.get(Item, created["id"]).calories == 0


def test_an_edit_can_set_a_figure_and_take_it_off_again(tenants):
    rid, tid, iid = tenants[0]
    with tenant_session(rid) as db:
        restaurant = db.get(Restaurant, rid)
        out = update_item(iid, ItemUpdateIn(calories=720), restaurant=restaurant, db=db)
        assert out["calories"] == 720
        # Another edit that says nothing about calories leaves them alone.
        out = update_item(iid, ItemUpdateIn(name="Renamed"), restaurant=restaurant, db=db)
        assert out["calories"] == 720
        out = update_item(iid, ItemUpdateIn(calories=None), restaurant=restaurant, db=db)
        assert out["calories"] is None


@pytest.mark.parametrize("value", [-1, 20001])
def test_a_figure_outside_what_a_dish_can_be_is_refused(value):
    with pytest.raises(ValidationError):
        ItemIn(name="Dish", item_type_id="00000000-0000-0000-0000-000000000001",
               base_price_minor=100, calories=value)
    with pytest.raises(ValidationError):
        ItemUpdateIn(calories=value)


def test_the_database_refuses_one_too_even_without_the_schema(tenants):
    from sqlalchemy.exc import IntegrityError
    from sqlalchemy import text

    rid, _, iid = tenants[0]
    with pytest.raises(IntegrityError):
        with tenant_session(rid) as db:
            db.execute(text("UPDATE menu_items SET calories = 99999 WHERE id = :i"), {"i": iid})
