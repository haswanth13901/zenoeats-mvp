"""What a combo slot may ask for, and what may fill it.

A slot asks for a top-level type -- a food, a drink -- and every item of that
type can fill it. That is the whole reason subcategories are a display idea:
a restaurant that splits Food into Burgers and Nuggets still sells one meal
deal offering both, rather than two deals each offering half of what the one
they replaced did.

So two rules, and they are the same rule read from either end. A slot cannot
ask for a subcategory, and an item is matched to a slot by its top-level
type rather than by the subcategory it is filed in.
"""

import uuid

import pytest

from app.api.v1.restaurant import ComboSlotIn, _set_combo_slots
from app.core import errors


class FakeType:
    def __init__(self, name, parent=None):
        self.id = uuid.uuid4()
        self.name = name
        self.parent_id = parent.id if parent else None
        self.deleted_at = None


class FakeItem:
    def __init__(self, name, item_type):
        self.id = uuid.uuid4()
        self.name = name
        self.item_type_id = item_type.id
        self.deleted_at = None


class FakeMealLink:
    def __init__(self, item):
        self.item_id = item.id


class FakeCombo:
    def __init__(self):
        self.id = uuid.uuid4()
        self.meal_id = uuid.uuid4()
        self.slots = []


class FakeRestaurant:
    def __init__(self):
        self.id = uuid.uuid4()


class FakeResult:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return self

    def all(self):
        return self._rows


class FakeDb:
    """Answers the two reads the slot builder makes: which items the period
    serves, and what any given row is. Added rows are kept so a test can see
    the slots and choices that were written."""

    def __init__(self, rows):
        self.rows = {row.id: row for row in rows}
        self.added = []

    def get(self, _model, row_id):
        return self.rows.get(row_id)

    def execute(self, statement):
        model = statement.column_descriptions[0]["entity"].__name__
        if model == "MealItem":
            return FakeResult(
                [FakeMealLink(r) for r in self.rows.values() if isinstance(r, FakeItem)]
            )
        return FakeResult([])

    def add(self, row):
        self.added.append(row)
        row.id = uuid.uuid4()
        self.rows[row.id] = row

    def flush(self):
        pass


def _menu():
    """Food, split into Burgers and Nuggets, plus a flat Drinks."""
    food = FakeType("Food")
    burgers = FakeType("Burgers", parent=food)
    nuggets = FakeType("Nuggets", parent=food)
    drinks = FakeType("Drinks")
    smash = FakeItem("Smash Burger", burgers)
    nugs = FakeItem("Six Nuggets", nuggets)
    tea = FakeItem("Iced Tea", drinks)
    db = FakeDb([food, burgers, nuggets, drinks, smash, nugs, tea])
    return food, burgers, drinks, smash, nugs, tea, db


def _choices(db):
    """The item ids written into slots, in the order they were written."""
    return [row.item_id for row in db.added if hasattr(row, "item_id")]


def test_an_item_in_a_subcategory_fills_its_headings_slot():
    """The point of the whole design. A burger is a food, so a slot asking
    for a food takes it."""
    food, _burgers, drinks, smash, _nugs, tea, db = _menu()

    _set_combo_slots(
        db, FakeRestaurant(), FakeCombo(),
        [
            ComboSlotIn(item_type_id=food.id, item_ids=[smash.id]),
            ComboSlotIn(item_type_id=drinks.id, item_ids=[tea.id]),
        ],
    )

    assert smash.id in _choices(db)


def test_two_subcategories_fill_the_same_slot():
    """One meal deal offering burgers or nuggets, which is what splitting
    Food into two top-level types could not express: a slot holds one type,
    so the deal would have had to become two."""
    food, _burgers, drinks, smash, nugs, tea, db = _menu()

    _set_combo_slots(
        db, FakeRestaurant(), FakeCombo(),
        [
            ComboSlotIn(item_type_id=food.id, item_ids=[smash.id, nugs.id]),
            ComboSlotIn(item_type_id=drinks.id, item_ids=[tea.id]),
        ],
    )

    assert {smash.id, nugs.id} <= set(_choices(db))


def test_a_slot_cannot_ask_for_a_subcategory():
    """Asking for Burgers would narrow the deal every time the menu was
    subdivided further, and no combo means to do that."""
    _food, burgers, _drinks, smash, _nugs, _tea, db = _menu()

    with pytest.raises(errors.ApiError) as caught:
        _set_combo_slots(
            db, FakeRestaurant(), FakeCombo(),
            [ComboSlotIn(item_type_id=burgers.id, item_ids=[smash.id])],
        )

    message = str(caught.value.detail)
    assert "Burgers" in message
    assert "top-level" in message


def test_an_item_of_another_heading_still_cannot_fill_a_slot():
    """Matching by the top-level type loosens the rule exactly as far as the
    subcategories of that type, and no further. A drink in the food slot
    would let a combo demand two drinks and read as a meal."""
    food, _burgers, _drinks, _smash, _nugs, tea, db = _menu()

    with pytest.raises(errors.ApiError) as caught:
        _set_combo_slots(
            db, FakeRestaurant(), FakeCombo(),
            [ComboSlotIn(item_type_id=food.id, item_ids=[tea.id])],
        )

    assert "not filed under Food" in str(caught.value.detail)


def test_a_flat_menu_matches_exactly_as_it_did():
    """The case every existing restaurant is in. An item with no subcategory
    is its own top-level type, so the check is the comparison it always was."""
    _food, _burgers, drinks, _smash, _nugs, tea, db = _menu()

    _set_combo_slots(
        db, FakeRestaurant(), FakeCombo(),
        [ComboSlotIn(item_type_id=drinks.id, item_ids=[tea.id])],
    )

    assert _choices(db) == [tea.id]
