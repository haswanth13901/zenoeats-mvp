"""Editing a meal period, and an item's name, price and kind.

Both trim before storing, so a name of nothing but spaces is refused rather
than saved as a blank heading, and neither touches anything but its own row.

A meal period also carries the hours it is served, and those are a pair: the
tests below pin that half a range is refused wherever it would come from, an
edit naming one side included, because the rule is about what the row ends up
holding rather than about what the request happened to mention.

An item edit reaches every meal period serving it, because there is one item
rather than a copy per period. That is the point of the shape, and it is what
makes the partial-update rule below matter more than it used to: a stray
blanked description is now blanked everywhere at once.
"""

import uuid
from datetime import time

import pytest

from app.api.v1.restaurant import (
    ItemUpdateIn, MealUpdateIn, update_item, update_meal,
)
from app.core import errors


class FakeRow:
    def __init__(self, name, description="Cheddar", base_price_minor=1095,
                 item_type=None):
        self.id = uuid.uuid4()
        self.name = name
        self.item_type_id = item_type.id if item_type else None
        self.description = description
        self.base_price_minor = base_price_minor
        self.starts_at = None
        self.ends_at = None
        self.deleted_at = None


class FakeType:
    def __init__(self, name, parent=None):
        self.id = uuid.uuid4()
        self.name = name
        self.parent_id = parent.id if parent else None
        self.deleted_at = None


class FakeDb:
    def __init__(self, rows):
        self.rows = rows

    def get(self, _model, row_id):
        return next((r for r in self.rows if r.id == row_id), None)


def test_rename_trims_surrounding_whitespace():
    row = FakeRow("Brekfast")
    db = FakeDb([row])

    update_meal(row.id, MealUpdateIn(name="  Breakfast  "), restaurant=None, db=db)

    assert row.name == "Breakfast"


def test_rename_refuses_a_name_of_only_whitespace():
    row = FakeRow("Breakfast")
    db = FakeDb([row])

    with pytest.raises(errors.ApiError):
        update_meal(row.id, MealUpdateIn(name="   "), restaurant=None, db=db)

    assert row.name == "Breakfast", "the old name was lost to a rejected rename"


def test_renaming_a_deleted_meal_period_is_refused():
    row = FakeRow("Breakfast")
    row.deleted_at = "already gone"
    db = FakeDb([row])

    with pytest.raises(errors.ApiError):
        update_meal(row.id, MealUpdateIn(name="Brunch"), restaurant=None, db=db)


def test_hours_are_set_as_a_pair():
    row = FakeRow("Breakfast")
    db = FakeDb([row])

    update_meal(
        row.id,
        MealUpdateIn(starts_at=time(7, 0), ends_at=time(11, 0)),
        restaurant=None,
        db=db,
    )

    assert (row.starts_at, row.ends_at) == (time(7, 0), time(11, 0))
    assert row.name == "Breakfast", "setting hours renamed the period"


def test_an_end_before_the_start_is_allowed_and_means_the_next_day():
    """Late night is the period most likely to want hours at all, so the
    range that crosses midnight cannot be the one that is refused."""
    row = FakeRow("Late night")
    db = FakeDb([row])

    update_meal(
        row.id,
        MealUpdateIn(starts_at=time(22, 0), ends_at=time(2, 0)),
        restaurant=None,
        db=db,
    )

    assert (row.starts_at, row.ends_at) == (time(22, 0), time(2, 0))


def test_setting_only_a_start_is_refused():
    row = FakeRow("Breakfast")
    db = FakeDb([row])

    with pytest.raises(errors.ApiError):
        update_meal(row.id, MealUpdateIn(starts_at=time(7, 0)), restaurant=None, db=db)

    assert row.starts_at is None, "half a range was stored"


def test_an_edit_naming_one_side_completes_the_stored_pair():
    """The rule is about what the row ends up holding, not about what the
    request mentioned: moving breakfast's end later is one field."""
    row = FakeRow("Breakfast")
    row.starts_at, row.ends_at = time(7, 0), time(11, 0)
    db = FakeDb([row])

    update_meal(row.id, MealUpdateIn(ends_at=time(11, 30)), restaurant=None, db=db)

    assert (row.starts_at, row.ends_at) == (time(7, 0), time(11, 30))


def test_clearing_one_side_of_a_stored_pair_is_refused():
    row = FakeRow("Breakfast")
    row.starts_at, row.ends_at = time(7, 0), time(11, 0)
    db = FakeDb([row])

    with pytest.raises(errors.ApiError):
        update_meal(row.id, MealUpdateIn(ends_at=None), restaurant=None, db=db)

    assert row.ends_at == time(11, 0), "the stored end was lost to a rejected edit"


def test_clearing_both_leaves_the_hours_unsaid():
    row = FakeRow("Breakfast")
    row.starts_at, row.ends_at = time(7, 0), time(11, 0)
    db = FakeDb([row])

    update_meal(
        row.id, MealUpdateIn(starts_at=None, ends_at=None), restaurant=None, db=db
    )

    assert (row.starts_at, row.ends_at) == (None, None)


def test_equal_start_and_end_is_refused():
    """It reads as either nothing or a full day, and guessing which would be
    wrong half the time."""
    row = FakeRow("Breakfast")
    db = FakeDb([row])

    with pytest.raises(errors.ApiError):
        update_meal(
            row.id,
            MealUpdateIn(starts_at=time(7, 0), ends_at=time(7, 0)),
            restaurant=None,
            db=db,
        )

    assert row.starts_at is None


def test_a_rename_leaves_the_hours_alone():
    """The regression this guards: resolving the pair on every edit must read
    what is stored, or renaming a period would clear its hours."""
    row = FakeRow("Brekfast")
    row.starts_at, row.ends_at = time(7, 0), time(11, 0)
    db = FakeDb([row])

    update_meal(row.id, MealUpdateIn(name="Breakfast"), restaurant=None, db=db)

    assert (row.starts_at, row.ends_at) == (time(7, 0), time(11, 0))


def test_updating_only_the_price_leaves_the_name_and_description_alone():
    """The regression this guards: reading body.name directly cannot tell
    "set this to null" apart from "left it out", so a price edit blanked the
    description every time."""
    item = FakeRow("Smash Burger")
    db = FakeDb([item])

    update_item(item.id, ItemUpdateIn(base_price_minor=1195), restaurant=None, db=db)

    assert item.base_price_minor == 1195
    assert item.name == "Smash Burger"
    assert item.description == "Cheddar"


def test_updating_an_item_trims_its_name():
    item = FakeRow("Smash Burger")
    db = FakeDb([item])

    update_item(item.id, ItemUpdateIn(name="  Smash Burger Deluxe  "), restaurant=None, db=db)

    assert item.name == "Smash Burger Deluxe"
    assert item.base_price_minor == 1095


def test_updating_an_item_to_a_blank_name_is_refused():
    item = FakeRow("Smash Burger")
    db = FakeDb([item])

    with pytest.raises(errors.ApiError):
        update_item(item.id, ItemUpdateIn(name="   "), restaurant=None, db=db)

    assert item.name == "Smash Burger"


def test_clearing_a_description_is_stored_as_null_not_an_empty_string():
    item = FakeRow("Smash Burger")
    db = FakeDb([item])

    update_item(item.id, ItemUpdateIn(description="  "), restaurant=None, db=db)

    assert item.description is None


def test_a_free_item_is_allowed_but_a_negative_price_is_not():
    item = FakeRow("Smash Burger")
    db = FakeDb([item])

    update_item(item.id, ItemUpdateIn(base_price_minor=0), restaurant=None, db=db)
    assert item.base_price_minor == 0

    with pytest.raises(ValueError):
        ItemUpdateIn(base_price_minor=-1)


def test_changing_the_type_moves_the_item_to_another_heading():
    """The type lives on the item, so it is editable -- correcting a drink
    filed as food is a one-field fix rather than a re-creation."""
    food, drinks = FakeType("Food"), FakeType("Drinks")
    item = FakeRow("Iced Tea", item_type=food)
    db = FakeDb([item, drinks])

    update_item(item.id, ItemUpdateIn(item_type_id=drinks.id), restaurant=None, db=db)

    assert item.item_type_id == drinks.id


def test_an_edit_that_does_not_mention_the_type_leaves_it_alone():
    drinks = FakeType("Drinks")
    item = FakeRow("Iced Tea", item_type=drinks)
    db = FakeDb([item, drinks])

    update_item(item.id, ItemUpdateIn(base_price_minor=375), restaurant=None, db=db)

    assert item.item_type_id == drinks.id
    assert item.base_price_minor == 375


def test_a_type_that_does_not_exist_is_refused():
    """An id from the client naming nothing must not land on the row."""
    food = FakeType("Food")
    item = FakeRow("Iced Tea", item_type=food)
    db = FakeDb([item, food])

    with pytest.raises(errors.ApiError):
        update_item(item.id, ItemUpdateIn(item_type_id=uuid.uuid4()), restaurant=None, db=db)

    assert item.item_type_id == food.id
