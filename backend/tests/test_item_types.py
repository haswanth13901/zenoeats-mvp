"""Item types are the restaurant's own words.

Four fixed ones used to live in the schema, so a tiffin house filed tiffins,
thalis and chaat under "Food" and read a stranger's vocabulary back on its
own menu. They are rows now, named and ordered by the people whose menu it
is, and every rule about them is here.

The one that matters most is deletion. A type is pointed at by items, by
combo slots and by modifier groups, and deleting one carelessly either takes
real menu items with it or leaves them under a heading that no longer exists.
"""

import uuid

import pytest

from app.api.v1.restaurant import (
    ItemTypeIn, ItemTypeUpdateIn, create_item_type, delete_item_type,
    list_item_types, update_item_type,
)
from app.core import errors


class FakeRow:
    """One row of any of the tables involved, told apart by `table`."""

    def __init__(self, table, **fields):
        self.id = uuid.uuid4()
        self.table = table
        self.deleted_at = None
        self.name = fields.pop("name", "")
        self.sort_order = fields.pop("sort_order", 0)
        self.item_type_id = fields.pop("item_type_id", None)
        self.parent_id = fields.pop("parent_id", None)
        self.group_id = fields.pop("group_id", None)
        for key, value in fields.items():
            setattr(self, key, value)


class FakeRestaurant:
    def __init__(self):
        self.id = uuid.uuid4()


class FakeResult:
    def __init__(self, rows, scalar=None):
        self._rows = rows
        self._scalar = scalar

    def scalars(self):
        return self

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar(self):
        return self._scalar

    def scalar_one(self):
        return self._scalar


def _filters_on_parent(statement) -> bool:
    """Whether a statement restricts on parent_id, rather than merely
    selecting it. `select(ItemType)` names every column, so the SELECT list
    says nothing about what is being asked."""
    text = str(statement)
    return "WHERE" in text and "parent_id" in text.split("WHERE", 1)[1]


def _where_parent(statement):
    """The parent a statement is filtering for: a uuid, or None for the top
    level, which is what `parent_id IS NULL` means."""
    ids = [v for v in statement.compile().params.values() if isinstance(v, uuid.UUID)]
    return ids[0] if ids and _filters_on_parent(statement) else None


class FakeDb:
    """Answers the handful of reads these endpoints make.

    Deliberately shape-aware rather than a full query engine: what is under
    test is which rows a rule protects, so the fake has to honour "which
    table" and "which type", and nothing more.
    """

    def __init__(self, rows):
        self.rows = rows

    def _of(self, table):
        return [r for r in self.rows if r.table == table and r.deleted_at is None]

    def get(self, _model, row_id):
        return next((r for r in self.rows if r.id == row_id), None)

    def execute(self, statement):
        text = str(statement)
        entity = statement.column_descriptions[0]["entity"]
        model = entity.__name__ if entity is not None else ""

        # The two aggregate reads: how many items per type, and the highest
        # sort order. Recognised by what the statement selects.
        if "count" in text.lower() and "menu_items" in text.lower():
            counts = {}
            for item in self._of("item"):
                counts[item.item_type_id] = counts.get(item.item_type_id, 0) + 1
            if "GROUP BY" in text:
                return FakeResult(list(counts.items()))
            # A count for one type, used by the deletion guard.
            wanted = getattr(self, "_counting_type", None)
            return FakeResult([], scalar=counts.get(wanted, 0))
        if "max" in text.lower():
            # Scoped to one level: sort_order means "among my siblings", so a
            # new subcategory goes last under its parent rather than last on
            # the whole menu.
            parent = _where_parent(statement)
            orders = [t.sort_order for t in self._of("type") if t.parent_id == parent]
            return FakeResult([], scalar=max(orders) if orders else None)

        if model == "ItemType":
            rows = sorted(self._of("type"), key=lambda t: (t.sort_order, str(t.id)))
            params = statement.compile().params
            ids = [v for v in params.values() if isinstance(v, uuid.UUID)]

            # "What is filed under this type." The only ItemType read that
            # matches on a uuid rather than excluding one, so it is taken
            # first -- read as an exclusion it would return every type but
            # the parent, and deleting anything would look unsafe.
            if _filters_on_parent(statement):
                return FakeResult(
                    [t for t in rows if t.parent_id == _where_parent(statement)]
                )

            # The duplicate-name check filters on lower(name), and the rename
            # form of it excludes the row being renamed. Both have to be
            # honoured or every name reads as taken and every rename fails.
            wanted = next(
                (v for v in params.values() if isinstance(v, str)), None
            )
            if wanted is not None:
                rows = [t for t in rows if t.name.lower() == wanted.lower()]
            if ids:
                rows = [t for t in rows if t.id not in set(ids)]
            return FakeResult(rows)
        # The live combos with a slot asking for one type, by name: what stops
        # a heading being demoted. A deleted combo's slots stay behind and must
        # not count.
        if model == "Combo":
            wanted = next(
                (v for v in statement.compile().params.values()
                 if isinstance(v, uuid.UUID)), None
            )
            live = {c.id: c for c in self._of("combo")}
            return FakeResult(sorted({
                live[slot.combo_id].name
                for slot in self._of("slot")
                if slot.item_type_id == wanted and getattr(slot, "combo_id", None) in live
            }))
        # Slots and links are read two ways: counted, to refuse demoting a
        # heading something is built on, and listed, to take them with a
        # deletion. Both filter on one type, which is the only uuid in play.
        for model_name, table in (("ComboSlot", "slot"), ("ModifierGroupItemType", "link")):
            if model != model_name:
                continue
            rows = self._of(table)
            wanted = next(
                (v for v in statement.compile().params.values()
                 if isinstance(v, uuid.UUID)), None
            )
            if wanted is not None:
                rows = [r for r in rows if r.item_type_id == wanted]
            if "count" in text.lower():
                return FakeResult([], scalar=len(rows))
            return FakeResult(rows)
        if model == "Item":
            return FakeResult(self._of("item"))
        return FakeResult([])

    def add(self, row):
        self.rows.append(row)

    def delete(self, row):
        self.rows.remove(row)

    def flush(self):
        pass


def _menu():
    """Two types. Food has an item on it; Drinks has nothing."""
    food = FakeRow("type", name="Food", sort_order=0)
    drinks = FakeRow("type", name="Drinks", sort_order=1)
    burger = FakeRow("item", name="Smash Burger", item_type_id=food.id)
    db = FakeDb([food, drinks, burger])
    return food, drinks, burger, db


def _count_for(db, type_id):
    """The deletion guard counts items of one type; the fake needs telling
    which one is being asked about."""
    db._counting_type = type_id


# --- naming ----------------------------------------------------------------


def test_a_type_is_created_with_the_name_it_was_given():
    _food, _drinks, _burger, db = _menu()

    made = create_item_type(
        ItemTypeIn(name="Tiffins"), restaurant=FakeRestaurant(), db=db
    )

    assert made["name"] == "Tiffins"


def test_a_new_type_goes_to_the_end_of_the_menu():
    """A type added today is not usually meant to jump above the food."""
    _food, _drinks, _burger, db = _menu()

    made = create_item_type(
        ItemTypeIn(name="Tiffins"), restaurant=FakeRestaurant(), db=db
    )

    assert made["sort_order"] == 2


def test_a_name_is_trimmed_before_it_is_stored():
    _food, _drinks, _burger, db = _menu()
    made = create_item_type(
        ItemTypeIn(name="  Tiffins  "), restaurant=FakeRestaurant(), db=db
    )
    assert made["name"] == "Tiffins"


def test_a_name_of_nothing_but_spaces_is_refused():
    _food, _drinks, _burger, db = _menu()
    with pytest.raises(errors.ApiError):
        create_item_type(ItemTypeIn(name="   "), restaurant=FakeRestaurant(), db=db)


def test_a_duplicate_name_is_refused():
    """Two headings called Drinks is a menu nobody can read."""
    _food, _drinks, _burger, db = _menu()

    with pytest.raises(errors.ApiError) as caught:
        create_item_type(ItemTypeIn(name="Drinks"), restaurant=FakeRestaurant(), db=db)
    assert "already" in str(caught.value.detail).lower()


def test_a_duplicate_differing_only_in_case_is_refused():
    """"Drinks" and "drinks" are the same heading to a customer."""
    _food, _drinks, _burger, db = _menu()

    with pytest.raises(errors.ApiError):
        create_item_type(ItemTypeIn(name="DRINKS"), restaurant=FakeRestaurant(), db=db)


def test_renaming_a_type_to_its_own_name_is_allowed():
    """Otherwise editing the sort order of a type would fail on its own name."""
    _food, drinks, _burger, db = _menu()

    update_item_type(
        drinks.id, ItemTypeUpdateIn(name="Drinks", sort_order=5),
        restaurant=FakeRestaurant(), db=db,
    )

    assert (drinks.name, drinks.sort_order) == ("Drinks", 5)


def test_renaming_a_type_onto_another_name_is_refused():
    food, _drinks, _burger, db = _menu()

    with pytest.raises(errors.ApiError):
        update_item_type(
            food.id, ItemTypeUpdateIn(name="Drinks"), restaurant=FakeRestaurant(), db=db
        )
    assert food.name == "Food", "the old name was lost to a rejected rename"


def test_renaming_a_type_reaches_every_item_of_it_at_once():
    """The point of the type being a row. Correcting "Drinks" to "Beverages"
    is one edit, and no item moves."""
    food, _drinks, burger, db = _menu()

    update_item_type(
        food.id, ItemTypeUpdateIn(name="Mains"), restaurant=FakeRestaurant(), db=db
    )

    assert food.name == "Mains"
    assert burger.item_type_id == food.id


def test_a_type_that_does_not_exist_cannot_be_edited():
    _food, _drinks, _burger, db = _menu()
    with pytest.raises(errors.ApiError):
        update_item_type(
            uuid.uuid4(), ItemTypeUpdateIn(name="Nope"),
            restaurant=FakeRestaurant(), db=db,
        )


# --- ordering --------------------------------------------------------------


def test_the_list_reads_in_the_order_the_restaurant_set():
    food, drinks, _burger, db = _menu()
    food.sort_order, drinks.sort_order = 1, 0

    listed = list_item_types(restaurant=FakeRestaurant(), db=db)

    assert [t["name"] for t in listed] == ["Drinks", "Food"]


def test_the_list_says_how_many_items_each_type_holds():
    """So the builder can warn before asking to delete one, and so the type
    strip can say how many are filed under each."""
    _food, _drinks, _burger, db = _menu()

    listed = {t["name"]: t["items"] for t in list_item_types(restaurant=FakeRestaurant(), db=db)}

    assert listed == {"Food": 1, "Drinks": 0}


def test_the_count_follows_an_item_that_changes_type():
    """One count goes down and the other goes up. The portal reads these
    numbers straight onto the type strip, so a stale one shows a type as
    empty while its items are on screen underneath."""
    food, drinks, burger, db = _menu()
    burger.item_type_id = drinks.id

    listed = {t["name"]: t["items"] for t in list_item_types(restaurant=FakeRestaurant(), db=db)}

    assert listed == {"Food": 0, "Drinks": 1}


def test_a_new_item_is_counted_immediately():
    _food, drinks, _burger, db = _menu()
    db.rows.append(FakeRow("item", name="Hash Brown", item_type_id=drinks.id))

    listed = {t["name"]: t["items"] for t in list_item_types(restaurant=FakeRestaurant(), db=db)}

    assert listed["Drinks"] == 1


def test_a_deleted_item_stops_being_counted():
    """The count is of items that exist, not of rows that survive a soft
    delete, or a type could never be emptied enough to remove."""
    food, _drinks, burger, db = _menu()
    burger.deleted_at = "2026-01-01"

    listed = {t["name"]: t["items"] for t in list_item_types(restaurant=FakeRestaurant(), db=db)}

    assert listed["Food"] == 0


# --- deletion --------------------------------------------------------------


def test_a_type_still_on_items_is_refused():
    """Deleting it would take real menu items with it, or leave them under a
    heading that no longer exists."""
    food, _drinks, _burger, db = _menu()
    _count_for(db, food.id)

    with pytest.raises(errors.ApiError) as caught:
        delete_item_type(food.id, restaurant=FakeRestaurant(), db=db)

    message = str(caught.value.detail)
    assert "1 item is" in message, message
    assert "Food" in message
    assert food.deleted_at is None


def test_the_refusal_counts_the_items_so_the_answer_is_actionable():
    food, _drinks, _burger, db = _menu()
    db.rows.append(FakeRow("item", name="Crispy Chicken", item_type_id=food.id))
    _count_for(db, food.id)

    with pytest.raises(errors.ApiError) as caught:
        delete_item_type(food.id, restaurant=FakeRestaurant(), db=db)

    assert "2 items are" in str(caught.value.detail)


def test_a_type_nothing_uses_is_deleted():
    _food, drinks, _burger, db = _menu()
    _count_for(db, drinks.id)

    delete_item_type(drinks.id, restaurant=FakeRestaurant(), db=db)

    assert drinks.deleted_at is not None


def test_deleting_a_type_is_soft_so_nothing_points_at_a_missing_row():
    _food, drinks, _burger, db = _menu()
    _count_for(db, drinks.id)

    delete_item_type(drinks.id, restaurant=FakeRestaurant(), db=db)

    assert drinks in db.rows, "the row was removed rather than stamped"


def test_deleting_a_type_takes_the_combo_slots_that_asked_for_it():
    """A slot asking for a type nobody can fill is a combo nobody can order."""
    _food, drinks, _burger, db = _menu()
    slot = FakeRow("slot", item_type_id=drinks.id)
    db.rows.append(slot)
    _count_for(db, drinks.id)

    delete_item_type(drinks.id, restaurant=FakeRestaurant(), db=db)

    assert slot not in db.rows


def test_deleting_a_type_takes_the_modifier_group_links_that_named_it():
    _food, drinks, _burger, db = _menu()
    link = FakeRow("link", item_type_id=drinks.id, group_id=uuid.uuid4())
    db.rows.append(link)
    _count_for(db, drinks.id)

    delete_item_type(drinks.id, restaurant=FakeRestaurant(), db=db)

    assert link not in db.rows


def test_deleting_a_type_leaves_other_types_alone():
    food, drinks, _burger, db = _menu()
    _count_for(db, drinks.id)

    delete_item_type(drinks.id, restaurant=FakeRestaurant(), db=db)

    assert food.deleted_at is None


def test_deleting_a_type_twice_is_refused():
    _food, drinks, _burger, db = _menu()
    _count_for(db, drinks.id)
    delete_item_type(drinks.id, restaurant=FakeRestaurant(), db=db)

    with pytest.raises(errors.ApiError):
        delete_item_type(drinks.id, restaurant=FakeRestaurant(), db=db)


def test_a_deleted_type_frees_its_name_for_reuse():
    """The unique rule covers live types only, which is what makes a rename
    after a deletion possible."""
    _food, drinks, _burger, db = _menu()
    _count_for(db, drinks.id)
    delete_item_type(drinks.id, restaurant=FakeRestaurant(), db=db)

    made = create_item_type(ItemTypeIn(name="Drinks"), restaurant=FakeRestaurant(), db=db)

    assert made["name"] == "Drinks"


# --- subcategories ---------------------------------------------------------
#
# A type may sit under another one: Food holding Burgers and Nuggets. Two
# levels and no more, and the nesting is a heading on the storefront and
# nothing else -- combos and modifier groups read the top-level type, which
# is what stops a subdivided menu from splitting a meal deal in two.


def _nested():
    """Food with Burgers under it, and Drinks left flat."""
    food = FakeRow("type", name="Food", sort_order=0)
    burgers = FakeRow("type", name="Burgers", sort_order=0, parent_id=food.id)
    drinks = FakeRow("type", name="Drinks", sort_order=1)
    return food, burgers, drinks, FakeDb([food, burgers, drinks])


def test_a_type_can_be_created_under_another_one():
    food, _burgers, _drinks, db = _nested()

    made = create_item_type(
        ItemTypeIn(name="Nuggets", parent_id=food.id), restaurant=FakeRestaurant(), db=db
    )

    assert made["parent_id"] == str(food.id)


def test_a_type_created_without_a_parent_is_a_heading_of_its_own():
    """The ordinary case. Leaving it out is not the same as being told to
    nest something."""
    _food, _drinks, _burger, db = _menu()

    made = create_item_type(ItemTypeIn(name="Tiffins"), restaurant=FakeRestaurant(), db=db)

    assert made["parent_id"] is None


def test_a_new_subcategory_goes_last_among_its_siblings_not_last_on_the_menu():
    """sort_order is read within the level it sits on. Ordered against the
    whole menu, a new subcategory would sort below the headings after it."""
    food, _burgers, _drinks, db = _nested()

    made = create_item_type(
        ItemTypeIn(name="Nuggets", parent_id=food.id), restaurant=FakeRestaurant(), db=db
    )

    assert made["sort_order"] == 1, "ordered against the whole menu, not its siblings"


def test_a_subcategory_cannot_hold_a_subcategory():
    """Two levels. A third would make every structural read a walk, and no
    menu heading needs to say Food, then Burgers, then Sliders."""
    _food, burgers, _drinks, db = _nested()

    with pytest.raises(errors.ApiError) as caught:
        create_item_type(
            ItemTypeIn(name="Sliders", parent_id=burgers.id),
            restaurant=FakeRestaurant(), db=db,
        )

    assert "two levels" in str(caught.value.detail).lower()


def test_a_type_cannot_be_filed_under_itself():
    _food, _burgers, drinks, db = _nested()

    with pytest.raises(errors.ApiError):
        update_item_type(
            drinks.id, ItemTypeUpdateIn(parent_id=drinks.id),
            restaurant=FakeRestaurant(), db=db,
        )


def test_a_subcategory_name_is_still_unique_across_the_whole_restaurant():
    """The item form offers one flat list, so the same word under two
    headings is a choice nobody can make correctly."""
    food, _burgers, _drinks, db = _nested()

    with pytest.raises(errors.ApiError):
        create_item_type(
            ItemTypeIn(name="Drinks", parent_id=food.id),
            restaurant=FakeRestaurant(), db=db,
        )


def test_a_heading_can_be_filed_under_another_one():
    food, _burgers, drinks, db = _nested()

    update_item_type(
        drinks.id, ItemTypeUpdateIn(parent_id=food.id), restaurant=FakeRestaurant(), db=db
    )

    assert drinks.parent_id == food.id


def test_a_subcategory_can_be_promoted_back_to_a_heading():
    """Always allowed: nothing structural was pointing at it while it was a
    subcategory, so there is nothing to break on the way out."""
    _food, burgers, _drinks, db = _nested()

    update_item_type(
        burgers.id, ItemTypeUpdateIn(parent_id=None), restaurant=FakeRestaurant(), db=db
    )

    assert burgers.parent_id is None


def test_leaving_the_parent_out_of_an_update_does_not_move_the_type():
    """Only what is sent is applied, which is what lets an explicit null mean
    promote this rather than being indistinguishable from silence."""
    food, burgers, _drinks, db = _nested()

    update_item_type(
        burgers.id, ItemTypeUpdateIn(name="Patties"), restaurant=FakeRestaurant(), db=db
    )

    assert burgers.parent_id == food.id


def test_a_heading_with_subcategories_cannot_be_filed_under_a_third():
    food, _burgers, drinks, db = _nested()

    with pytest.raises(errors.ApiError) as caught:
        update_item_type(
            food.id, ItemTypeUpdateIn(parent_id=drinks.id),
            restaurant=FakeRestaurant(), db=db,
        )

    message = str(caught.value.detail)
    assert "Burgers" in message, "the message did not say what was in the way"
    assert food.parent_id is None


def test_a_heading_a_combo_asks_for_cannot_become_a_subcategory():
    """Combos are built from top-level types. Demoting one would leave a slot
    asking for something a combo may not ask for."""
    food, _burgers, drinks, db = _nested()
    combo = FakeRow("combo", name="Burger Meal")
    db.rows += [combo, FakeRow("slot", item_type_id=drinks.id, combo_id=combo.id)]

    with pytest.raises(errors.ApiError) as caught:
        update_item_type(
            drinks.id, ItemTypeUpdateIn(parent_id=food.id),
            restaurant=FakeRestaurant(), db=db,
        )

    assert "a choice in 1 combo (Burger Meal)" in str(caught.value.detail)
    assert drinks.parent_id is None


def test_a_deleted_combos_leftover_slot_does_not_hold_a_heading_back():
    """A deleted combo keeps its slots. Counting them made a type that had ever
    been in a combo impossible to file under anything."""
    from datetime import datetime, timezone

    food, _burgers, drinks, db = _nested()
    gone = FakeRow("combo", name="Old Meal", deleted_at=datetime.now(timezone.utc))
    db.rows += [gone, FakeRow("slot", item_type_id=drinks.id, combo_id=gone.id)]

    update_item_type(
        drinks.id, ItemTypeUpdateIn(parent_id=food.id), restaurant=FakeRestaurant(), db=db,
    )
    assert drinks.parent_id == food.id


def test_a_heading_a_modifier_group_is_offered_for_cannot_become_a_subcategory():
    food, _burgers, drinks, db = _nested()
    db.rows.append(FakeRow("link", item_type_id=drinks.id, group_id=uuid.uuid4()))

    with pytest.raises(errors.ApiError) as caught:
        update_item_type(
            drinks.id, ItemTypeUpdateIn(parent_id=food.id),
            restaurant=FakeRestaurant(), db=db,
        )

    assert "modifier" in str(caught.value.detail).lower()
    assert drinks.parent_id is None


def test_a_heading_with_subcategories_cannot_be_deleted():
    """Its subcategories hold the items, and removing the heading leaves them
    with nothing to appear under."""
    food, _burgers, _drinks, db = _nested()
    _count_for(db, food.id)

    with pytest.raises(errors.ApiError) as caught:
        delete_item_type(food.id, restaurant=FakeRestaurant(), db=db)

    assert "Burgers" in str(caught.value.detail)
    assert food.deleted_at is None


def test_a_heading_whose_subcategories_are_gone_can_be_deleted():
    food, burgers, _drinks, db = _nested()
    burgers.deleted_at = "2026-01-01"
    _count_for(db, food.id)

    delete_item_type(food.id, restaurant=FakeRestaurant(), db=db)

    assert food.deleted_at is not None


def test_a_subcategory_with_no_items_is_deleted_like_any_other_type():
    _food, burgers, _drinks, db = _nested()
    _count_for(db, burgers.id)

    delete_item_type(burgers.id, restaurant=FakeRestaurant(), db=db)

    assert burgers.deleted_at is not None


def test_the_list_reads_each_heading_followed_by_its_own_subcategories():
    """Flat, but in the order the menu reads, so the builder can indent
    without a second request."""
    _food, _burgers, _drinks, db = _nested()

    listed = list_item_types(restaurant=FakeRestaurant(), db=db)

    assert [t["name"] for t in listed] == ["Food", "Burgers", "Drinks"]


def test_the_list_says_which_heading_each_subcategory_sits_under():
    food, _burgers, _drinks, db = _nested()

    listed = {
        t["name"]: t["parent_id"]
        for t in list_item_types(restaurant=FakeRestaurant(), db=db)
    }

    assert listed == {"Food": None, "Burgers": str(food.id), "Drinks": None}


def test_the_count_on_a_heading_is_its_own_items_not_its_subcategories():
    """It is the number the deletion rule reads. Rolled up, a heading with
    nothing filed on it would report itself as in use."""
    _food, burgers, _drinks, db = _nested()
    db.rows.append(FakeRow("item", name="Smash Burger", item_type_id=burgers.id))

    listed = {
        t["name"]: t["items"]
        for t in list_item_types(restaurant=FakeRestaurant(), db=db)
    }

    assert listed["Food"] == 0
    assert listed["Burgers"] == 1
