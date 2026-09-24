"""Editing the modifier library: group names and kinds, option names, prices.

Two rules differ from the rest of the menu.

The sign: a modifier's price change may be negative -- "no cheese -0.50" is
the documented exception to the non-negative money constraint -- so nothing
here may quietly clamp it to zero.

The empty list: a group offered on no particular type is offered on every
type. So an empty applies_to_type_ids is a real value and has to be told
apart from the field not being sent, which is what the partial-update rule
below is guarding.
"""

import uuid

import pytest

from app.api.v1.restaurant import (
    ModifierGroupUpdateIn, ModifierOptionUpdateIn, delete_modifier_group,
    delete_modifier_option, update_modifier_group, update_modifier_option,
)
from app.core import errors


class FakeRow:
    def __init__(self, name, price_delta_minor=0, kind="Option"):
        self.id = uuid.uuid4()
        self.name = name
        self.price_delta_minor = price_delta_minor
        self.calories_delta = None
        self.deleted_at = None
        self.group_id = None
        self.item_type_id = None
        # Groups only: an optional pick-several group, as the builder makes by
        # default. The group update answers with its rules.
        self.selection_type = "MULTI"
        self.is_required = False
        self.min_select = 0
        self.max_select = 1
        # Item types only. A group is offered for top-level types, so the
        # endpoint reads this on every type it is handed.
        self.parent_id = None
        self.kind = kind
        self.type_links = []


class FakeDb:
    """Answers `get` from a table of rows, and `execute` by the model asked
    for. The WHERE clauses are the database's business; what is under test is
    which rows end up stamped, and which type links end up on a group."""

    def __init__(self, rows):
        self.rows = rows
        self._pending = []

    def get(self, _model, row_id):
        return next((r for r in self.rows if r.id == row_id), None)

    def execute(self, statement):
        model = statement.column_descriptions[0]["entity"].__name__
        # Matched by shape, not by a marker, because the endpoint adds real
        # ModifierGroupItemType rows to this table and they have to come back
        # out of it on the next read.
        if model == "ModifierGroupItemType":
            self._pending = [r for r in self.rows if _is_link(r)]
        elif model == "ItemType":
            self._pending = [r for r in self.rows if getattr(r, "kind", None) == "Type"]
        else:
            self._pending = [
                r for r in self.rows
                if getattr(r, "kind", None) == "Option"
                and r.group_id and r.deleted_at is None
            ]
        return self

    def scalars(self):
        return self

    def all(self):
        return self._pending

    def first(self):
        return self._pending[0] if self._pending else None

    def add(self, row):
        self.rows.append(row)

    def delete(self, row):
        self.rows.remove(row)

    def flush(self):
        pass


FOOD = FakeRow("Food", kind="Type")
DRINKS = FakeRow("Drinks", kind="Type")
SIDES = FakeRow("Sides", kind="Type")


def _link(group, item_type):
    row = FakeRow(f"{group.name}->{item_type.name}", kind="Link")
    row.group_id = group.id
    row.item_type_id = item_type.id
    return row


def _group():
    """One group, offered for Food, with two options."""
    group = FakeRow("Sauce add-ons", kind="Group")
    aioli = FakeRow("Garlic aioli", 75)
    hot = FakeRow("House hot sauce", 50)
    aioli.group_id = hot.group_id = group.id

    link = _link(group, FOOD)
    db = FakeDb([group, aioli, hot, FOOD, DRINKS, SIDES, link])
    # The relationship the endpoint reads back after editing. The fake keeps
    # it in step with the rows it holds, which is what the database does.
    group.type_links = [r for r in db.rows if r.kind == "Link" and r.group_id == group.id]
    return group, aioli, hot, db


def _is_link(row) -> bool:
    """A group-to-type link, whether this test built it or the endpoint did."""
    return (
        getattr(row, "group_id", None) is not None
        and getattr(row, "item_type_id", None) is not None
    )


def _types_of(db, group):
    return [r.item_type_id for r in db.rows if _is_link(r) and r.group_id == group.id]


class FakeRestaurant:
    def __init__(self):
        self.id = uuid.uuid4()


def test_renaming_a_group_trims_and_refuses_blank():
    group, _a, _h, db = _group()

    update_modifier_group(
        group.id, ModifierGroupUpdateIn(name="  Sauces  "),
        restaurant=FakeRestaurant(), db=db,
    )
    assert group.name == "Sauces"

    with pytest.raises(errors.ApiError):
        update_modifier_group(
            group.id, ModifierGroupUpdateIn(name="   "),
            restaurant=FakeRestaurant(), db=db,
        )
    assert group.name == "Sauces", "the old name was lost to a rejected rename"


def test_a_group_can_be_offered_on_several_types_at_once():
    """The feature the single column could not hold: one Size group on both
    drinks and sides, rather than two libraries to keep in step."""
    group, _a, _h, db = _group()

    update_modifier_group(
        group.id,
        ModifierGroupUpdateIn(applies_to_type_ids=[DRINKS.id, SIDES.id]),
        restaurant=FakeRestaurant(), db=db,
    )

    assert _types_of(db, group) == [DRINKS.id, SIDES.id]


def test_the_same_type_twice_is_stored_once():
    group, _a, _h, db = _group()

    update_modifier_group(
        group.id,
        ModifierGroupUpdateIn(applies_to_type_ids=[SIDES.id, SIDES.id, DRINKS.id]),
        restaurant=FakeRestaurant(), db=db,
    )

    assert _types_of(db, group) == [SIDES.id, DRINKS.id]


def test_clearing_the_types_offers_the_group_everywhere():
    """An empty list is a value, not an omission. Sending it has to widen the
    group rather than be ignored as "nothing to do"."""
    group, _a, _h, db = _group()

    update_modifier_group(
        group.id, ModifierGroupUpdateIn(applies_to_type_ids=[]),
        restaurant=FakeRestaurant(), db=db,
    )

    assert _types_of(db, group) == []


def test_renaming_a_group_leaves_its_types_alone():
    """The regression the partial-update rule guards: reading the attribute
    directly cannot tell an omitted list from an empty one, so every rename
    would quietly offer the group on everything."""
    group, _a, _h, db = _group()

    update_modifier_group(
        group.id, ModifierGroupUpdateIn(name="Sauces"),
        restaurant=FakeRestaurant(), db=db,
    )

    assert _types_of(db, group) == [FOOD.id]


def test_a_type_that_does_not_exist_is_refused():
    """Ids come from the client, so one that names nothing has to be caught
    before it becomes a link to nowhere."""
    group, _a, _h, db = _group()

    with pytest.raises(errors.ApiError):
        update_modifier_group(
            group.id, ModifierGroupUpdateIn(applies_to_type_ids=[uuid.uuid4()]),
            restaurant=FakeRestaurant(), db=db,
        )


def test_deleting_a_group_stamps_its_options():
    group, aioli, hot, db = _group()

    delete_modifier_group(group.id, restaurant=None, db=db)

    assert group.deleted_at is not None
    assert aioli.deleted_at is not None, "option left alive under a deleted group"
    assert hot.deleted_at is not None
    assert group.deleted_at == aioli.deleted_at == hot.deleted_at


def test_deleting_one_option_leaves_the_group_and_its_siblings():
    group, aioli, hot, db = _group()

    delete_modifier_option(aioli.id, restaurant=None, db=db)

    assert aioli.deleted_at is not None
    assert hot.deleted_at is None
    assert group.deleted_at is None


def test_a_negative_price_change_is_accepted():
    """The whole reason modifiers get their own parser and their own schema."""
    _g, aioli, _h, db = _group()

    update_modifier_option(
        aioli.id, ModifierOptionUpdateIn(price_delta_minor=-50), restaurant=None, db=db
    )

    assert aioli.price_delta_minor == -50


def test_updating_only_the_price_leaves_the_name_alone():
    _g, aioli, _h, db = _group()

    update_modifier_option(
        aioli.id, ModifierOptionUpdateIn(price_delta_minor=125), restaurant=None, db=db
    )

    assert aioli.price_delta_minor == 125
    assert aioli.name == "Garlic aioli"


def test_updating_only_the_name_leaves_the_price_alone():
    _g, aioli, _h, db = _group()

    update_modifier_option(
        aioli.id, ModifierOptionUpdateIn(name="  Aioli  "), restaurant=None, db=db
    )

    assert aioli.name == "Aioli"
    assert aioli.price_delta_minor == 75


def test_a_blank_option_name_is_refused():
    _g, aioli, _h, db = _group()

    with pytest.raises(errors.ApiError):
        update_modifier_option(aioli.id, ModifierOptionUpdateIn(name=" "), restaurant=None, db=db)

    assert aioli.name == "Garlic aioli"


def test_a_null_price_change_is_refused_rather_than_stored():
    """`"price_delta_minor": null` is a client bug, not a request to charge
    nothing. Zero says that, and says it unambiguously."""
    _g, aioli, _h, db = _group()

    with pytest.raises(errors.ApiError):
        update_modifier_option(
            aioli.id, ModifierOptionUpdateIn(price_delta_minor=None), restaurant=None, db=db
        )

    assert aioli.price_delta_minor == 75


def test_a_group_cannot_be_offered_for_a_subcategory():
    """Named against Burgers it would have to be named again against Nuggets,
    and again against every subcategory added afterwards -- which is the
    duplication subcategories exist to avoid. The builder matches an item by
    its top-level type, so offering it for Food covers both."""
    group, _a, _h, db = _group()
    burgers = FakeRow("Burgers", kind="Type")
    burgers.parent_id = FOOD.id
    db.rows.append(burgers)

    with pytest.raises(errors.ApiError) as caught:
        update_modifier_group(
            group.id,
            ModifierGroupUpdateIn(applies_to_type_ids=[burgers.id]),
            restaurant=FakeRestaurant(), db=db,
        )

    assert "subcategory" in str(caught.value.detail).lower()
