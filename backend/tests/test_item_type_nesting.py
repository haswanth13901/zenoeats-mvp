"""Two levels, held by the database rather than by a promise.

An item type may sit under another one -- Food holding Burgers -- and no
deeper. The cap is a composite foreign key from (parent_id, parent_is_root)
to (id, is_root), both of the second columns generated from parent_id, so a
row can only name a parent that is itself top-level. Migration 0009 sets it
up and explains it.

A fake session cannot see any of that: the rule lives in Postgres, and what
is worth checking is that it holds for the application role, which runs under
FORCE row-level security and is not the owner of the table. So this file
writes real rows and reads real refusals.
"""

import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

from app.api.v1.restaurant import (
    ItemTypeIn, ItemTypeUpdateIn, create_item_type, delete_item_type,
    list_item_types, update_item_type,
)
from app.core import errors
from app.db.session import system_session, tenant_session
from app.models import Item, ItemType, Meal, MealItem, Restaurant, RestaurantStatus
from app.services.menu import load_item_types, load_menu

pytestmark = pytest.mark.integration


def _purge(rid) -> None:
    """Remove everything this fixture put in the database.

    Deepest first, as everywhere else. Item types point at each other now,
    and one statement still clears them: the referential check runs at the
    end of the statement, by which time the subcategory naming a heading is
    gone as well. That is why the platform purge needed no reordering.
    """
    with tenant_session(rid) as session:
        session.execute(text("DELETE FROM meal_items WHERE restaurant_id = :r"), {"r": rid})
        session.execute(text("DELETE FROM menu_items WHERE restaurant_id = :r"), {"r": rid})
        session.execute(text("DELETE FROM item_types WHERE restaurant_id = :r"), {"r": rid})
        session.execute(text("DELETE FROM meals WHERE restaurant_id = :r"), {"r": rid})
        session.execute(text("DELETE FROM restaurants WHERE id = :r"), {"r": rid})


@pytest.fixture
def nested_menu(request):
    """Lunch, with Food split into Burgers and Nuggets, and a flat Drinks.

    Cleanup is registered the moment the restaurant row exists rather than
    written after the yield, so a setup that fails halfway still tidies up.
    """
    slug = f"nest-{uuid.uuid4().hex[:8]}"
    with system_session() as session:
        restaurant = Restaurant(
            slug=slug, name="Nesting", status=RestaurantStatus.ACTIVE.value,
            timezone="UTC", currency="USD",
        )
        session.add(restaurant)
        session.flush()
        rid = restaurant.id

    request.addfinalizer(lambda: _purge(rid))

    ids = {"rid": rid}
    with tenant_session(rid) as session:
        meal = Meal(restaurant_id=rid, name="Lunch")
        session.add(meal)

        food = ItemType(restaurant_id=rid, name="Food", sort_order=0)
        drinks = ItemType(restaurant_id=rid, name="Drinks", sort_order=1)
        session.add_all([food, drinks])
        session.flush()

        burgers = ItemType(
            restaurant_id=rid, name="Burgers", parent_id=food.id, sort_order=0
        )
        nuggets = ItemType(
            restaurant_id=rid, name="Nuggets", parent_id=food.id, sort_order=1
        )
        session.add_all([burgers, nuggets])
        session.flush()

        ids |= {
            "meal": meal.id, "food": food.id, "drinks": drinks.id,
            "burgers": burgers.id, "nuggets": nuggets.id,
        }

    with tenant_session(rid) as session:
        for name, type_key in [
            ("Smash Burger", "burgers"),
            ("Six Nuggets", "nuggets"),
            ("Soup", "food"),
            ("Iced Tea", "drinks"),
        ]:
            item = Item(
                restaurant_id=rid, name=name, item_type_id=ids[type_key],
                base_price_minor=500, currency="USD",
            )
            session.add(item)
            session.flush()
            session.add(MealItem(restaurant_id=rid, meal_id=ids["meal"], item_id=item.id))

    return ids


def test_a_subcategory_can_be_written(nested_menu):
    with tenant_session(nested_menu["rid"]) as session:
        burgers = session.get(ItemType, nested_menu["burgers"])
        assert burgers.parent_id == nested_menu["food"]


def test_the_database_refuses_a_third_level(nested_menu):
    """The cap, as the application role sees it. Nothing in the API needs to
    remember this rule for it to hold."""
    with pytest.raises(IntegrityError):
        with tenant_session(nested_menu["rid"]) as session:
            session.add(
                ItemType(
                    restaurant_id=nested_menu["rid"], name="Sliders",
                    parent_id=nested_menu["burgers"], sort_order=0,
                )
            )
            session.flush()


def test_the_database_refuses_demoting_a_heading_that_has_subcategories(nested_menu):
    """The same cap read from the other end: Food cannot slide under Drinks
    while Burgers and Nuggets still point at it."""
    with pytest.raises(IntegrityError):
        with tenant_session(nested_menu["rid"]) as session:
            food = session.get(ItemType, nested_menu["food"])
            food.parent_id = nested_menu["drinks"]
            session.flush()


def test_the_database_refuses_a_type_filed_under_itself(nested_menu):
    with pytest.raises(IntegrityError):
        with tenant_session(nested_menu["rid"]) as session:
            drinks = session.get(ItemType, nested_menu["drinks"])
            drinks.parent_id = drinks.id
            session.flush()


def test_a_subcategory_can_be_promoted_back_to_a_heading(nested_menu):
    """Always allowed. Nothing structural points at a subcategory, so there
    is nothing to break on the way out."""
    with tenant_session(nested_menu["rid"]) as session:
        session.get(ItemType, nested_menu["nuggets"]).parent_id = None

    with tenant_session(nested_menu["rid"]) as session:
        assert session.get(ItemType, nested_menu["nuggets"]).parent_id is None


def test_the_type_list_reads_each_heading_followed_by_its_own(nested_menu):
    with tenant_session(nested_menu["rid"]) as session:
        assert [t.name for t in load_item_types(session)] == [
            "Food", "Burgers", "Nuggets", "Drinks",
        ]


def test_a_subcategorys_items_read_as_a_block_inside_its_heading(nested_menu):
    with tenant_session(nested_menu["rid"]) as session:
        menu = load_menu(session, include_empty=False)

    sections = menu.meals[0].sections
    assert [s.label for s in sections] == ["Food", "Drinks"]

    food = sections[0]
    # Filed on the heading itself, and read before its subcategories.
    assert [i.name for i in food.items] == ["Soup"]
    assert [g.label for g in food.groups] == ["Burgers", "Nuggets"]
    assert [i.name for i in food.groups[0].items] == ["Smash Burger"]


def test_a_flat_heading_still_sends_no_groups(nested_menu):
    """The shape every existing menu is in, and the one most will stay in."""
    with tenant_session(nested_menu["rid"]) as session:
        menu = load_menu(session, include_empty=False)

    drinks = menu.meals[0].sections[1]
    assert drinks.groups == []
    assert [i.name for i in drinks.items] == ["Iced Tea"]


# --- the endpoints, against a real database --------------------------------
#
# The unit tests above these cover the rules with a fake session, which is
# where the sentences a manager reads are worth pinning down. What a fake
# cannot check is the SQL: the sibling ordering reads `parent_id IS NULL`,
# which is a different statement from `parent_id = :id` and is built from the
# same expression.


def test_a_new_heading_is_ordered_against_the_other_headings(nested_menu):
    """Not against the whole list. Food and Drinks are the headings, so the
    next one is third -- the two subcategories do not push it to fifth."""
    rid = nested_menu["rid"]
    with tenant_session(rid) as session:
        restaurant = session.get(Restaurant, rid)
        made = create_item_type(ItemTypeIn(name="Sides"), restaurant=restaurant, db=session)

        assert made["sort_order"] == 2
        assert made["parent_id"] is None


def test_a_new_subcategory_is_ordered_against_its_siblings(nested_menu):
    """Burgers is 0 and Nuggets is 1, so the next one under Food is 2."""
    rid = nested_menu["rid"]
    with tenant_session(rid) as session:
        restaurant = session.get(Restaurant, rid)
        made = create_item_type(
            ItemTypeIn(name="Wraps", parent_id=nested_menu["food"]),
            restaurant=restaurant, db=session,
        )

        assert made["sort_order"] == 2
        assert made["parent_id"] == str(nested_menu["food"])


def test_the_endpoint_refuses_a_third_level_before_the_database_does(nested_menu):
    """A constraint violation reaches the builder as a 500. This is the same
    rule, said in a sentence, and it has to fire first."""
    rid = nested_menu["rid"]
    with tenant_session(rid) as session:
        restaurant = session.get(Restaurant, rid)
        with pytest.raises(errors.ApiError):
            create_item_type(
                ItemTypeIn(name="Sliders", parent_id=nested_menu["burgers"]),
                restaurant=restaurant, db=session,
            )


def test_the_endpoint_refuses_deleting_a_heading_that_has_subcategories(nested_menu):
    rid = nested_menu["rid"]
    with tenant_session(rid) as session:
        restaurant = session.get(Restaurant, rid)
        with pytest.raises(errors.ApiError) as caught:
            delete_item_type(nested_menu["food"], restaurant=restaurant, db=session)

        assert "Burgers" in str(caught.value.detail)


def test_the_listed_types_read_in_menu_order_with_their_parents(nested_menu):
    rid = nested_menu["rid"]
    with tenant_session(rid) as session:
        restaurant = session.get(Restaurant, rid)
        listed = list_item_types(restaurant=restaurant, db=session)

    assert [t["name"] for t in listed] == ["Food", "Burgers", "Nuggets", "Drinks"]
    assert [t["parent_id"] for t in listed] == [
        None, str(nested_menu["food"]), str(nested_menu["food"]), None,
    ]
    # Direct counts: Soup sits on Food, the burger and the nuggets do not.
    assert [t["items"] for t in listed] == [1, 1, 1, 1]


def test_refiling_a_heading_under_another_one_goes_through(nested_menu):
    rid = nested_menu["rid"]
    with tenant_session(rid) as session:
        restaurant = session.get(Restaurant, rid)
        update_item_type(
            nested_menu["drinks"], ItemTypeUpdateIn(parent_id=nested_menu["food"]),
            restaurant=restaurant, db=session,
        )

    with tenant_session(rid) as session:
        assert session.get(ItemType, nested_menu["drinks"]).parent_id == nested_menu["food"]
