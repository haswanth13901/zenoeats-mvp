"""What a choice adds to a dish, in calories.

Large fries are not a second dish: they are the same dish with more calories.
So the figure lives on the option beside its price change, and the item keeps
stating what it contains as it comes.
"""

import pytest
from pydantic import ValidationError

from app.api.v1.restaurant import (
    ModifierGroupIn,
    ModifierOptionUpdateIn,
    OptionIn,
    create_modifier_group,
    create_modifier_option,
    update_modifier_option,
)
from app.db.session import tenant_session
from app.models import ModifierOption, Restaurant
from tests.test_storefront import tenants  # noqa: F401

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def clear_groups(tenants):
    """The storefront fixture knows nothing about modifier groups, and a
    restaurant cannot be deleted while one still points at it."""
    yield
    from sqlalchemy import text

    for rid, _, _ in tenants:
        with tenant_session(rid) as db:
            for table in ("item_modifier_groups", "item_included_options",
                          "modifier_group_item_types", "modifier_options", "modifier_groups"):
                db.execute(text(f"DELETE FROM {table} WHERE restaurant_id = :r"), {"r": rid})


def _group(db, rid, *options):
    return create_modifier_group(
        ModifierGroupIn(name="Size", selection_type="SINGLE", is_required=True,
                        min_select=1, max_select=1, options=list(options)),
        restaurant=db.get(Restaurant, rid), db=db,
    )


def _options(db, group_id):
    return {o.name: o for o in db.query(ModifierOption).filter_by(group_id=group_id).all()}


def test_a_size_states_what_it_adds_and_a_free_choice_states_nothing(tenants):
    rid, _, _ = tenants[0]
    with tenant_session(rid) as db:
        group = _group(
            db, rid,
            OptionIn(name="Small", price_delta_minor=0, calories_delta=0),
            OptionIn(name="Large", price_delta_minor=50, calories_delta=230),
            OptionIn(name="No salt", price_delta_minor=0),
        )
        options = _options(db, group["id"])
        assert options["Small"].calories_delta == 0
        assert options["Large"].calories_delta == 230
        # Stated as nothing, which is not the same as stated zero.
        assert options["No salt"].calories_delta is None


def test_a_choice_may_take_calories_off(tenants):
    """The same exception the price makes: "no cheese" is a decrement."""
    rid, _, _ = tenants[0]
    with tenant_session(rid) as db:
        group = _group(db, rid, OptionIn(name="Regular", price_delta_minor=0))
        created = create_modifier_option(
            group["id"], OptionIn(name="No cheese", price_delta_minor=-50, calories_delta=-90),
            restaurant=db.get(Restaurant, rid), db=db,
        )
        assert db.get(ModifierOption, created["id"]).calories_delta == -90


def test_an_edit_can_state_a_change_and_take_it_back_off(tenants):
    rid, _, _ = tenants[0]
    with tenant_session(rid) as db:
        restaurant = db.get(Restaurant, rid)
        group = _group(db, rid, OptionIn(name="Medium", price_delta_minor=35))
        option = _options(db, group["id"])["Medium"]

        out = update_modifier_option(option.id, ModifierOptionUpdateIn(calories_delta=130),
                                     restaurant=restaurant, db=db)
        assert out["calories_delta"] == 130
        # An edit that says nothing about calories leaves them alone.
        out = update_modifier_option(option.id, ModifierOptionUpdateIn(name="Medium size"),
                                     restaurant=restaurant, db=db)
        assert out["calories_delta"] == 130
        out = update_modifier_option(option.id, ModifierOptionUpdateIn(calories_delta=None),
                                     restaurant=restaurant, db=db)
        assert out["calories_delta"] is None


def test_the_customer_menu_carries_what_each_choice_adds(tenants):
    rid, tid, iid = tenants[0]
    from app.api.v1.restaurant import ItemUpdateIn, update_item
    from app.services.menu import load_menu

    with tenant_session(rid) as db:
        restaurant = db.get(Restaurant, rid)
        group = _group(
            db, rid,
            OptionIn(name="Small", price_delta_minor=0, calories_delta=0),
            OptionIn(name="Large", price_delta_minor=50, calories_delta=230),
        )
        update_item(iid, ItemUpdateIn(calories=310, modifier_group_ids=[group["id"]]),
                    restaurant=restaurant, db=db)

        [meal] = load_menu(db, include_empty=False).meals
        [item] = [i for s in meal.sections for i in s.items]
        assert item.calories == 310
        [sizes] = item.modifier_groups
        assert {o.name: o.calories_delta for o in sizes.options} == {"Small": 0, "Large": 230}


@pytest.mark.parametrize("value", [-20001, 20001])
def test_a_change_beyond_what_a_dish_can_be_is_refused(value):
    with pytest.raises(ValidationError):
        OptionIn(name="Absurd", calories_delta=value)
    with pytest.raises(ValidationError):
        ModifierOptionUpdateIn(calories_delta=value)


def test_the_database_refuses_one_too(tenants):
    from sqlalchemy import text
    from sqlalchemy.exc import IntegrityError

    rid, _, _ = tenants[0]
    with tenant_session(rid) as db:
        group = _group(db, rid, OptionIn(name="Regular", price_delta_minor=0))
        option_id = _options(db, group["id"])["Regular"].id
    with pytest.raises(IntegrityError):
        with tenant_session(rid) as db:
            db.execute(text("UPDATE modifier_options SET calories_delta = 99999 WHERE id = :i"),
                       {"i": option_id})
