"""What an item comes with, and what that does to the price.

A burger includes lettuce and onion. Two things follow, and they are the same
decision rather than two settings: the customer gets them without asking, and
they add nothing to the bill even where the same option is charged on another
item.

The rule that is easy to get wrong is the second one, because the option
carries a price of its own and the item is the only thing that knows it is
included. Everything here is about that boundary.
"""

import uuid

import pytest

from app.core import errors
from app.services.pricing import price_cart

from test_combo_pricing import (  # the fakes already stand in for this shape
    FakeGroup,
    FakeIncluded,
    FakeItem,
    FakeOption,
    FakeRestaurant,
    FakeSession,
)


class ItemOnlySession(FakeSession):
    """price_cart reads items, then combos. Nothing here orders a combo."""

    def __init__(self, items):
        super().__init__(items, None)


def _line(item, options=()):
    return {
        "menu_item_id": str(item.id),
        "quantity": 1,
        "modifiers": [{"option_id": str(o.id), "quantity": 1} for o in options],
    }


def _burger(includes=(), veggie_prices=None):
    """A burger with four toppings: three free, jalapenos charged."""
    prices = veggie_prices or {"Lettuce": 0, "Onion": 0, "Pickles": 0, "Jalapenos": 50}
    options = {name: FakeOption(name, delta) for name, delta in prices.items()}
    veggies = FakeGroup("Veggies", list(options.values()))
    item = FakeItem(
        "Smash Burger", 1000, groups=[veggies],
        includes=[options[name] for name in includes],
    )
    return item, options


def _price(item, options=()):
    return price_cart(ItemOnlySession([item]), FakeRestaurant(), [_line(item, options)], [])


# --- what included does to the price ---------------------------------------


def test_an_included_option_adds_nothing():
    """Lettuce is part of the burger, not a topping that happens to be free."""
    item, options = _burger(includes=["Lettuce"])
    cart = _price(item, [options["Lettuce"]])
    assert cart.subtotal_minor == 1000


def test_an_included_option_that_normally_costs_money_is_free_on_this_item():
    """The half the old default flag could not do. A burger that comes with
    jalapenos comes with them, at the burger's price."""
    item, options = _burger(includes=["Jalapenos"])
    cart = _price(item, [options["Jalapenos"]])
    assert cart.subtotal_minor == 1000


def test_the_same_option_is_still_charged_on_an_item_that_does_not_include_it():
    """Inclusion is a property of the item. Nothing about the option changed."""
    item, options = _burger()  # includes nothing
    cart = _price(item, [options["Jalapenos"]])
    assert cart.subtotal_minor == 1050


def test_an_extra_beyond_what_is_included_is_charged():
    item, options = _burger(includes=["Lettuce", "Onion"])
    cart = _price(item, [options["Lettuce"], options["Onion"], options["Jalapenos"]])
    assert cart.subtotal_minor == 1050


def test_a_free_extra_beyond_what_is_included_is_still_free():
    """Only priced options cost anything. Pickles are free for everyone."""
    item, options = _burger(includes=["Lettuce"])
    cart = _price(item, [options["Lettuce"], options["Pickles"]])
    assert cart.subtotal_minor == 1000


def test_leaving_an_included_option_off_does_not_make_the_item_cheaper():
    """No onion is a burger without onion, not a discount."""
    item, options = _burger(includes=["Lettuce", "Onion"])
    assert _price(item, [options["Lettuce"]]).subtotal_minor == 1000
    assert _price(item, []).subtotal_minor == 1000


def test_the_receipt_records_what_was_charged_rather_than_what_was_waived():
    """A line snapshot is what the customer paid. An included option shows as
    nothing beside it, not as a price that was taken off later."""
    item, options = _burger(includes=["Jalapenos"])
    cart = _price(item, [options["Jalapenos"]])

    modifier = cart.lines[0].modifiers[0]
    assert modifier.option_name == "Jalapenos"
    assert modifier.unit_price_delta_minor == 0


def test_quantity_multiplies_the_item_but_not_the_inclusion():
    item, options = _burger(includes=["Lettuce"])
    line = _line(item, [options["Lettuce"]])
    line["quantity"] = 3
    cart = price_cart(ItemOnlySession([item]), FakeRestaurant(), [line], [])
    assert cart.subtotal_minor == 3000


# --- what included does not change -----------------------------------------


def test_an_included_option_still_counts_towards_the_maximum():
    """A burger that comes with two of three allowed toppings leaves room for
    one more, not for three."""
    item, options = _burger(includes=["Lettuce", "Onion"])
    item.modifier_links[0].group.max_select = 3

    # Three is fine, four is one too many.
    _price(item, [options["Lettuce"], options["Onion"], options["Pickles"]])
    with pytest.raises(errors.ApiError) as caught:
        _price(
            item,
            [options["Lettuce"], options["Onion"], options["Pickles"], options["Jalapenos"]],
        )
    assert "at most" in str(caught.value.detail)


def test_an_included_option_satisfies_a_required_group():
    """The customer did choose it; it arrived chosen."""
    regular = FakeOption("Regular")
    ice = FakeGroup("Ice level", [regular, FakeOption("Light")],
                    required=True, selection="SINGLE")
    tea = FakeItem("Iced Tea", 300, groups=[ice], includes=[regular])

    cart = _price(tea, [regular])
    assert cart.subtotal_minor == 300


def test_a_required_group_is_still_required_when_the_included_one_is_removed():
    """Inclusion changes the price, never the rules. Taking off the only
    choice in a required group leaves the group unanswered."""
    regular = FakeOption("Regular")
    ice = FakeGroup("Ice level", [regular], required=True, selection="SINGLE")
    tea = FakeItem("Iced Tea", 300, groups=[ice], includes=[regular])

    with pytest.raises(errors.ApiError) as caught:
        _price(tea, [])
    assert "Ice level" in str(caught.value.detail)


def test_an_option_the_item_does_not_offer_is_refused_however_it_is_included():
    """A stale inclusion cannot smuggle an option past the group check."""
    stray = FakeOption("Truffle oil", 400)
    item, _options = _burger()
    item.included_links = [FakeIncluded(stray)]

    with pytest.raises(errors.ApiError):
        _price(item, [stray])


def test_including_nothing_prices_exactly_as_before():
    """The common case, and the one every existing item is in."""
    item, options = _burger()
    assert _price(item, []).subtotal_minor == 1000
    assert _price(item, [options["Lettuce"]]).subtotal_minor == 1000
    assert _price(item, [options["Jalapenos"]]).subtotal_minor == 1050


# --- against the real database ---------------------------------------------
#
# The fakes above cannot see this class of bug. These sessions are
# autoflush=False, so a row added but not flushed is invisible to the next
# query, and the endpoint reads back the groups it just attached to decide
# which options an item may come with. A fake that answers from a list has no
# such step and no such failure.


@pytest.mark.integration
def test_a_new_item_can_offer_a_group_and_come_with_its_options_in_one_request():
    """The regression: ticking Veggies and its lettuce on a new item was
    refused with "Lettuce belongs to a group this item does not offer", about
    the group ticked seconds earlier in the same request."""
    from sqlalchemy import text

    from app.api.v1.restaurant import (
        ItemIn, ModifierGroupIn, OptionIn, create_item, create_modifier_group,
        list_item_types, list_items,
    )
    from app.db.session import system_session, tenant_session
    from app.models import Restaurant

    with system_session() as session:
        rid = session.execute(
            text("SELECT id FROM restaurants WHERE slug = 'spicehouse'")
        ).scalar_one()

    with tenant_session(rid) as session:
        restaurant = session.get(Restaurant, rid)
        item_type = list_item_types(restaurant=restaurant, db=session)[0]

        group = create_modifier_group(
            ModifierGroupIn(
                name=f"Toppings {uuid.uuid4().hex[:6]}",
                selection_type="MULTI", min_select=0, max_select=3,
                options=[OptionIn(name="Lettuce"), OptionIn(name="Bacon",
                                                            price_delta_minor=150)],
            ),
            restaurant=restaurant, db=session,
        )
        session.flush()
        session.expire_all()

        from app.api.v1.restaurant import list_modifier_groups

        made = next(
            g for g in list_modifier_groups(restaurant=restaurant, db=session)
            if g["id"] == group["id"]
        )
        lettuce = next(o for o in made["options"] if o["name"] == "Lettuce")

        # One request: the group and what the item comes with, together.
        item = create_item(
            ItemIn(
                name="Spicy Chicken Burger", item_type_id=uuid.UUID(item_type["id"]),
                base_price_minor=400,
                modifier_group_ids=[uuid.UUID(group["id"])],
                included_option_ids=[uuid.UUID(lettuce["id"])],
            ),
            restaurant=restaurant, db=session,
        )
        session.flush()
        session.expire_all()

        row = next(
            i for i in list_items(restaurant=restaurant, db=session)
            if i["id"] == item["id"]
        )
        assert [g["id"] for g in row["modifier_groups"]] == [group["id"]]
        assert row["included_option_ids"] == [lettuce["id"]]

        # Nothing here outlives the test.
        session.rollback()
