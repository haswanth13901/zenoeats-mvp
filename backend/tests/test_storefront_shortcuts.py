"""Shortcuts the restaurant builds: a category, its own label, chosen items."""

import pytest
from sqlalchemy import select

from app.core import errors
from app.db.session import tenant_session
from app.models import Item, ItemType, Restaurant, StorefrontShortcut
from app.schemas.storefront import ShortcutIn, ShortcutsIn
from app.services import images, storefront
from app.services.images import ImageKind
from tests.test_storefront import photo, tenants  # noqa: F401

pytestmark = pytest.mark.integration


def _extra(db, rid, tid, name="Second dish", type_name=None, parent=None):
    """Another item, in the given category or in a new one."""
    if type_name:
        kind = ItemType(restaurant_id=rid, name=type_name, parent_id=parent)
        db.add(kind)
        db.flush()
        tid = kind.id
    item = Item(restaurant_id=rid, item_type_id=tid, name=name, base_price_minor=200, currency="USD")
    db.add(item)
    db.flush()
    return tid, item.id


def _save(db, rid, *shortcuts):
    return storefront.save_shortcuts(db, db.get(Restaurant, rid), ShortcutsIn(shortcuts=list(shortcuts)))


def test_a_shortcut_shows_its_label_photo_and_only_the_chosen_items(tenants):
    rid, tid, iid = tenants[0]
    key = photo(rid, ImageKind.CATEGORIES)
    with tenant_session(rid) as db:
        _, unchosen = _extra(db, rid, tid)
        saved = _save(db, rid, ShortcutIn(item_type_id=tid, label="Our favourites", image_path=key, item_ids=[iid]))
        assert saved["shortcuts"][0]["label"] == "Our favourites"
        assert saved["shortcuts"][0]["item_ids"] == [iid]

        public = storefront.public(db, db.get(Restaurant, rid))
        [shortcut] = public.shortcuts
        assert shortcut.label == "Our favourites"
        assert shortcut.item_type_id == tid
        assert shortcut.item_ids == [iid]  # the unticked dish stays off it
        assert unchosen not in shortcut.item_ids
        assert shortcut.image_url == images.image_url(key)


def test_items_from_a_subcategory_count_and_other_categories_do_not(tenants):
    rid, tid, iid = tenants[0]
    with tenant_session(rid) as db:
        _, burger = _extra(db, rid, tid, "Smash", type_name="Burgers", parent=tid)
        _, drink = _extra(db, rid, tid, "Cola", type_name="Drinks")
        _save(db, rid, ShortcutIn(item_type_id=tid, label="Food", item_ids=[iid, burger]))
        with pytest.raises(errors.ApiError) as refused:
            _save(db, rid, ShortcutIn(item_type_id=tid, label="Food", item_ids=[drink]))
        assert "Cola" in refused.value.detail["message"]


def test_another_restaurants_category_or_item_is_refused(tenants):
    rid, tid, iid = tenants[0]
    other_rid, other_tid, other_iid = tenants[1]
    with tenant_session(rid) as db:
        with pytest.raises(errors.ApiError):
            _save(db, rid, ShortcutIn(item_type_id=other_tid, label="Theirs", item_ids=[iid]))
        with pytest.raises(errors.ApiError):
            _save(db, rid, ShortcutIn(item_type_id=tid, label="Mine", item_ids=[other_iid]))
        with pytest.raises(errors.ApiError):
            _save(db, rid, ShortcutIn(item_type_id=tid, label="Mine", item_ids=[iid],
                                      image_path=photo(other_rid, ImageKind.CATEGORIES)))


def test_a_shown_shortcut_needs_an_item_but_a_hidden_one_may_wait(tenants):
    rid, tid, _ = tenants[0]
    with tenant_session(rid) as db:
        with pytest.raises(errors.ApiError):
            _save(db, rid, ShortcutIn(item_type_id=tid, label="Empty", item_ids=[]))
        saved = _save(db, rid, ShortcutIn(item_type_id=tid, label="Later", is_active=False, item_ids=[]))
        assert saved["shortcuts"][0]["is_active"] is False
        assert storefront.public(db, db.get(Restaurant, rid)).shortcuts == []


def test_order_is_kept_and_a_removed_shortcut_takes_its_photo_with_it(tenants, tmp_path):
    rid, tid, iid = tenants[0]
    key = photo(rid, ImageKind.CATEGORIES)
    with tenant_session(rid) as db:
        first = _save(db, rid,
                      ShortcutIn(item_type_id=tid, label="A", image_path=key, item_ids=[iid]),
                      ShortcutIn(item_type_id=tid, label="B", item_ids=[iid]))
        a, b = first["shortcuts"]
        swapped = _save(db, rid, ShortcutIn(id=b["id"], item_type_id=tid, label="B", item_ids=[iid]),
                        ShortcutIn(id=a["id"], item_type_id=tid, label="A", image_path=key, item_ids=[iid]))
        assert [s["label"] for s in swapped["shortcuts"]] == ["B", "A"]
        _save(db, rid, ShortcutIn(id=b["id"], item_type_id=tid, label="B", item_ids=[iid]))
        assert db.scalar(select(StorefrontShortcut).where(StorefrontShortcut.id == a["id"])) is None
    assert not (tmp_path / key).exists()


def test_an_item_off_the_menu_drops_out_and_an_empty_shortcut_disappears(tenants):
    rid, tid, iid = tenants[0]
    with tenant_session(rid) as db:
        _, second = _extra(db, rid, tid)  # never put on a meal period
        _save(db, rid, ShortcutIn(item_type_id=tid, label="Only unserved", item_ids=[second]),
              ShortcutIn(item_type_id=tid, label="Mixed", item_ids=[second, iid]))
        public = storefront.public(db, db.get(Restaurant, rid))
        assert [(s.label, s.item_ids) for s in public.shortcuts] == [("Mixed", [iid])]


def test_the_endpoint_is_gated_like_the_rest_of_the_storefront(tenants):
    rid, tid, iid = tenants[0]
    with tenant_session(rid) as db:
        db.get(Restaurant, rid).storefront_customization_enabled = False
    with tenant_session(rid) as db:
        with pytest.raises(errors.ApiError) as refused:
            _save(db, rid, ShortcutIn(item_type_id=tid, label="Food", item_ids=[iid]))
        assert refused.value.status_code == 403
