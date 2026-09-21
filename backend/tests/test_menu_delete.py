"""What deleting removes, now that items own themselves.

The rule that changed: a meal period used to own everything filed under it,
so deleting Breakfast deleted the coffee -- including the coffee Lunch was
also selling. A period is now a list of what it serves, so deleting it drops
the listing and leaves the items alone.

Deleting an item still has to reach every listing of it. A link pointing at a
soft-deleted item is a menu row nobody can order from, and the reader would
have to filter it out on every read forever.

The cascades are hand-written because they mix a stamped column with deleted
rows, and ON DELETE can do neither selectively. Nothing in the schema
enforces them, so if they regress the rows survive unreachable.
"""

import uuid

import pytest

from app.api.v1.restaurant import delete_item, delete_meal, remove_meal_item
from app.core import errors


class FakeRow:
    def __init__(self, **fields):
        self.id = uuid.uuid4()
        self.deleted_at = None
        for key, value in fields.items():
            setattr(self, key, value)


def _equality_filters(statement) -> dict:
    """The `column == value` pairs in a statement's WHERE clause.

    The fake below has to honour these. Every cascade here is defined by
    which rows it selects -- the links of one period, not of every period --
    so a fake that returned the whole table would pass whatever the code did
    with it.

    Only equality is read. `deleted_at IS NULL` has no bound value and is
    skipped, which is why the row filter checks it separately.
    """
    clause = statement.whereclause
    if clause is None:
        return {}
    filters = {}
    for part in getattr(clause, "clauses", [clause]):
        left, right = getattr(part, "left", None), getattr(part, "right", None)
        if left is not None and hasattr(right, "value"):
            filters[left.key] = right.value
    return filters


class FakeDb:
    """Answers `get` from a table of rows, and `execute` by matching the model
    in the statement and the equality filters in its WHERE clause."""

    def __init__(self, rows):
        self.rows = rows
        self._pending = []

    def get(self, _model, row_id):
        return next((r for r in self.rows if r.id == row_id), None)

    def execute(self, statement):
        name = statement.column_descriptions[0]["entity"].__name__
        filters = _equality_filters(statement)
        self._pending = [
            r for r in self.rows
            if r.kind == name
            and r.deleted_at is None
            and all(getattr(r, key, None) == value for key, value in filters.items())
        ]
        return self

    def scalars(self):
        return self

    def all(self):
        return self._pending

    def first(self):
        return self._pending[0] if self._pending else None

    def delete(self, row):
        self.rows.remove(row)


def _menu():
    """One item on two periods, which is the arrangement every rule here is
    about. Breakfast and Lunch both serve the coffee; only Lunch has a
    burger."""
    breakfast = FakeRow(kind="Meal", name="Breakfast")
    lunch = FakeRow(kind="Meal", name="Lunch")
    coffee = FakeRow(kind="Item", name="Black Coffee")
    burger = FakeRow(kind="Item", name="Smash Burger")
    links = [
        FakeRow(kind="MealItem", meal_id=breakfast.id, item_id=coffee.id),
        FakeRow(kind="MealItem", meal_id=lunch.id, item_id=coffee.id),
        FakeRow(kind="MealItem", meal_id=lunch.id, item_id=burger.id),
    ]
    db = FakeDb([breakfast, lunch, coffee, burger, *links])
    return breakfast, lunch, coffee, burger, db


def _links(db):
    return [r for r in db.rows if r.kind == "MealItem"]


def test_deleting_a_meal_period_keeps_the_items_it_served():
    """The regression this guards is the old cascade: dropping Breakfast used
    to delete the coffee, and Lunch lost it too."""
    breakfast, _lunch, coffee, _burger, db = _menu()

    delete_meal(breakfast.id, restaurant=None, db=db)

    assert breakfast.deleted_at is not None
    assert coffee.deleted_at is None, "deleting a period deleted the item it served"


def test_deleting_a_meal_period_drops_only_its_own_listings():
    breakfast, lunch, coffee, _burger, db = _menu()

    delete_meal(breakfast.id, restaurant=None, db=db)

    remaining = {(link.meal_id, link.item_id) for link in _links(db)}
    assert (breakfast.id, coffee.id) not in remaining
    assert (lunch.id, coffee.id) in remaining, "the other period stopped serving it too"


def test_deleting_a_meal_period_twice_is_refused():
    breakfast, _lunch, _coffee, _burger, db = _menu()
    delete_meal(breakfast.id, restaurant=None, db=db)

    with pytest.raises(errors.ApiError):
        delete_meal(breakfast.id, restaurant=None, db=db)


def test_deleting_an_item_takes_it_off_every_period():
    breakfast, lunch, coffee, _burger, db = _menu()

    delete_item(coffee.id, restaurant=None, db=db)

    assert coffee.deleted_at is not None
    served = {link.item_id for link in _links(db)}
    assert coffee.id not in served, "a deleted item was left listed on a menu"
    assert breakfast.deleted_at is None and lunch.deleted_at is None


def test_deleting_an_item_leaves_the_other_items_listed():
    _breakfast, lunch, coffee, burger, db = _menu()

    delete_item(coffee.id, restaurant=None, db=db)

    assert burger.deleted_at is None
    assert (lunch.id, burger.id) in {(link.meal_id, link.item_id) for link in _links(db)}


def test_deleting_an_item_twice_is_refused():
    _breakfast, _lunch, coffee, _burger, db = _menu()
    delete_item(coffee.id, restaurant=None, db=db)

    with pytest.raises(errors.ApiError):
        delete_item(coffee.id, restaurant=None, db=db)


def test_removing_an_item_from_one_period_keeps_it_everywhere_else():
    """The everyday edit: coffee comes off lunch, stays on breakfast, and is
    still an item."""
    breakfast, lunch, coffee, _burger, db = _menu()

    remove_meal_item(lunch.id, coffee.id, restaurant=None, db=db)

    assert coffee.deleted_at is None
    remaining = {(link.meal_id, link.item_id) for link in _links(db)}
    assert (lunch.id, coffee.id) not in remaining
    assert (breakfast.id, coffee.id) in remaining


def test_removing_an_item_that_is_not_on_the_period_is_refused():
    breakfast, _lunch, _coffee, burger, db = _menu()

    with pytest.raises(errors.ApiError):
        remove_meal_item(breakfast.id, burger.id, restaurant=None, db=db)
