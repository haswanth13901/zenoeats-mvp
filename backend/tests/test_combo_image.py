"""A combo's own photograph.

A meal deal used to borrow a photo from whichever item inside it had one, so
"Burger Meal" advertised a bare burger. It can now carry its own; without
one it still borrows, which is what every combo did before.
"""

import pytest
from sqlalchemy import select

from app.api.v1.restaurant import ComboIn, ComboSlotIn, ComboUpdateIn, create_combo, update_combo
from app.core import errors
from app.db.session import tenant_session
from app.models import Combo, Item, Meal, Restaurant
from app.services import images
from app.services.images import ImageKind
from app.services.menu import load_menu
from tests.test_storefront import photo, tenants  # noqa: F401

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def clear_combos(tenants):
    """The storefront fixture knows nothing about combos, and menu_items
    cannot be deleted while a slot still points at one."""
    yield
    from sqlalchemy import text

    for rid, _, _ in tenants:
        with tenant_session(rid) as db:
            for table in ("combo_slot_items", "combo_slots", "combos"):
                db.execute(text(f"DELETE FROM {table} WHERE restaurant_id = :r"), {"r": rid})


def _meal(db):
    return db.scalar(select(Meal.id))


def _new(db, rid, tid, iid, **extra):
    return create_combo(
        ComboIn(meal_id=_meal(db), name="Burger Meal",
                slots=[ComboSlotIn(item_type_id=tid, item_ids=[iid])], **extra),
        restaurant=db.get(Restaurant, rid), db=db,
    )


def test_a_combo_keeps_its_own_photo_and_shows_it_to_customers(tenants, tmp_path):
    rid, tid, iid = tenants[0]
    key = photo(rid, ImageKind.ITEMS)
    with tenant_session(rid) as db:
        created = _new(db, rid, tid, iid, image_path=key)
        combo = db.get(Combo, created["id"])
        assert combo.image_path == key

        [meal] = load_menu(db, include_empty=False).meals
        assert meal.combos[0].image_url == images.image_url(key)


def test_without_one_the_customer_menu_says_so_rather_than_guessing(tenants):
    """The page borrows an item's photo; the combo itself reports none."""
    rid, tid, iid = tenants[0]
    with tenant_session(rid) as db:
        _new(db, rid, tid, iid)
        [meal] = load_menu(db, include_empty=False).meals
        assert meal.combos[0].image_url is None


def test_replacing_the_photo_deletes_the_old_file_and_clearing_it_removes_it(tenants, tmp_path):
    rid, tid, iid = tenants[0]
    first, second = photo(rid, ImageKind.ITEMS), photo(rid, ImageKind.ITEMS)
    with tenant_session(rid) as db:
        created = _new(db, rid, tid, iid, image_path=first)
        update_combo(created["id"], ComboUpdateIn(image_path=second),
                     restaurant=db.get(Restaurant, rid), db=db)
    assert not (tmp_path / first).exists()
    assert (tmp_path / second).exists()

    with tenant_session(rid) as db:
        out = update_combo(created["id"], ComboUpdateIn(image_path=None),
                           restaurant=db.get(Restaurant, rid), db=db)
        assert out["image_url"] is None
    assert not (tmp_path / second).exists()


def test_a_photo_an_item_still_shows_survives_the_combo_losing_it(tenants, tmp_path):
    """Refcounted, like every other picture: one row dropping a key must not
    take the file from another row still pointing at it."""
    rid, tid, iid = tenants[0]
    key = photo(rid, ImageKind.ITEMS)
    with tenant_session(rid) as db:
        db.get(Item, iid).image_path = key
        created = _new(db, rid, tid, iid, image_path=key)
        update_combo(created["id"], ComboUpdateIn(image_path=None),
                     restaurant=db.get(Restaurant, rid), db=db)
    assert (tmp_path / key).exists()


def test_another_restaurants_photo_or_a_made_up_key_is_refused(tenants):
    rid, tid, iid = tenants[0]
    other_rid, _, _ = tenants[1]
    theirs = photo(other_rid, ImageKind.ITEMS)
    missing = f"restaurants/{rid}/items/{'c' * 32}.webp"
    with tenant_session(rid) as db:
        for key in (theirs, missing):
            with pytest.raises(errors.ApiError):
                _new(db, rid, tid, iid, image_path=key)


def test_a_photo_of_the_wrong_kind_is_refused(tenants):
    """Keys carry their kind, so a category tile cannot become a combo card."""
    rid, tid, iid = tenants[0]
    with tenant_session(rid) as db:
        with pytest.raises(errors.ApiError):
            _new(db, rid, tid, iid, image_path=photo(rid, ImageKind.CATEGORIES))
