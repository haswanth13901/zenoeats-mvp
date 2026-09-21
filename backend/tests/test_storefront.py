"""Presentation cannot weaken tenant isolation or create another catalog.

These tests use real tenant transactions for the promises that a mock cannot
prove: RLS, rollback, and deleting an image only after its last owner commits.
"""
import io
import uuid
from datetime import timedelta

import pytest
from PIL import Image
from pydantic import ValidationError
from sqlalchemy import select, text
from sqlalchemy.exc import DBAPIError

from app.core.errors import ApiError
from app.db.base import utcnow
from app.db.session import system_session, tenant_session
from app.models import Restaurant, ItemType, Item, Meal, MealItem, StorefrontBanner, StorefrontCollection, StorefrontCollectionItem
from app.schemas.storefront import Theme, ThemePatch, BannerIn, BannersIn, CollectionIn, CollectionsIn, CategoryPatch
from app.services import images, storefront
from app.services.images import ImageKind
from app.services.menu import load_menu


@pytest.mark.parametrize("value", [1999, 10001, None, 5000.5])
def test_interval_bounds(value):
    with pytest.raises(ValidationError):
        ThemePatch(banner_interval_ms=value)


def test_low_contrast_names_the_pair():
    with pytest.raises(ValidationError, match="Cream text on hero"):
        Theme(brand="#174D39", hero="#FFFFFF", accent="#F1C958", paper="#FAF8F2")
    assert Theme(brand="#174D39", hero="#102A1D", accent="#F1C958", paper="#FAF8F2")


def test_counts_dates_and_duplicates():
    with pytest.raises(ValidationError):
        BannersIn(banners=[{"image_path": "a"}] * 9)
    with pytest.raises(ValidationError):
        CollectionsIn(collections=[{"title": "a", "item_ids": []}] * 7)
    with pytest.raises(ValidationError):
        CollectionIn(title="a", item_ids=[uuid.uuid4() for _ in range(13)])
    ident = uuid.uuid4()
    with pytest.raises(ValidationError):
        CollectionIn(title="a", item_ids=[ident, ident])
    with pytest.raises(ValidationError):
        BannerIn(image_path="a", starts_at=utcnow(), ends_at=utcnow() - timedelta(days=1))
    with pytest.raises(ValidationError):
        BannerIn(image_path="a", cta_target_kind="item")


@pytest.mark.parametrize("framing", [
    {"focal_x": -1}, {"focal_x": 101}, {"focal_y": -1}, {"focal_y": 101},
    {"zoom": 99}, {"zoom": 201}, {"zoom": 150.5}, {"focal_x": None},
])
def test_framing_bounds(framing):
    with pytest.raises(ValidationError):
        BannerIn(image_path="a", **framing)


def test_framing_defaults_match_the_framing_banners_already_had():
    banner = BannerIn(image_path="a")
    assert (banner.focal_x, banner.focal_y, banner.zoom) == (50, 60, 100)


@pytest.fixture
def tenants(tmp_path, monkeypatch):
    monkeypatch.setattr(images.settings, "IMAGES_DIR", tmp_path)
    ids = [uuid.uuid4(), uuid.uuid4()]
    with system_session() as db:
        for ident in ids:
            db.add(Restaurant(id=ident, slug=f"storefront-{ident.hex}", name="Test", status="ACTIVE", storefront_customization_enabled=True))
    data = []
    for ident in ids:
        with tenant_session(ident) as db:
            kind = ItemType(restaurant_id=ident, name="Food")
            meal = Meal(restaurant_id=ident, name="Lunch")
            db.add_all([kind, meal]); db.flush()
            item = Item(restaurant_id=ident, item_type_id=kind.id, name="Dish", base_price_minor=100, currency="USD")
            db.add(item); db.flush()
            db.add(MealItem(restaurant_id=ident, meal_id=meal.id, item_id=item.id))
            data.append((ident, kind.id, item.id))
    yield data
    for ident in ids:
        with tenant_session(ident) as db:
            for table in ("storefront_collection_items", "storefront_banners", "storefront_collections", "meal_items", "menu_items", "meals", "item_types", "restaurants"):
                column = "id" if table == "restaurants" else "restaurant_id"
                db.execute(text(f"DELETE FROM {table} WHERE {column} = :id"), {"id": ident})


def photo(ident, kind=ImageKind.BANNERS):
    buffer = io.BytesIO(); Image.new("RGB", (20, 20)).save(buffer, "PNG")
    key = images.new_key(ident, kind)
    images.storage().save(key, images.process(buffer.getvalue(), kind))
    return key


@pytest.mark.integration
def test_gate_menu_and_public_filtering(tenants):
    rid, tid, iid = tenants[0]
    key = photo(rid)
    with tenant_session(rid) as db:
        restaurant = db.get(Restaurant, rid)
        original = load_menu(db, include_empty=False).model_dump()
        storefront.save_collections(db, restaurant, CollectionsIn(collections=[CollectionIn(title="Popular", item_ids=[iid])]))
        storefront.save_banners(db, restaurant, BannersIn(banners=[BannerIn(image_path=key), BannerIn(image_path=key, is_active=False), BannerIn(image_path=key, ends_at=utcnow()-timedelta(days=1))]))
        storefront.save_category(db, restaurant, tid, CategoryPatch(show_in_shortcuts=False))
        public = storefront.public(db, restaurant)
        assert len(public.banners) == 1
        assert public.collections[0].item_ids == [iid]
        assert not public.categories[str(tid)].show_in_shortcuts
        assert load_menu(db, include_empty=False).model_dump() == original
        restaurant.storefront_customization_enabled = False
        assert storefront.public(db, restaurant) is None
        for call in (lambda: storefront.management(db, restaurant), lambda: storefront.save_theme(db, restaurant, ThemePatch()), lambda: storefront.save_banners(db, restaurant, BannersIn(banners=[])), lambda: storefront.save_collections(db, restaurant, CollectionsIn(collections=[])), lambda: storefront.save_category(db, restaurant, tid, CategoryPatch())):
            db.flush()
            with pytest.raises(ApiError) as exc:
                call()
            assert exc.value.status_code == 403
        restaurant.storefront_customization_enabled = True
        db.get(Item, iid).deleted_at = utcnow(); db.flush()
        assert storefront.public(db, restaurant).collections == []


@pytest.mark.integration
@pytest.mark.integration
def test_framing_is_saved_and_published(tenants):
    rid = tenants[0][0]
    key = photo(rid)
    with tenant_session(rid) as db:
        restaurant = db.get(Restaurant, rid)
        storefront.save_banners(db, restaurant, BannersIn(banners=[
            BannerIn(image_path=key, focal_x=20, focal_y=85, zoom=160),
        ]))
        saved = storefront.management(db, restaurant)["banners"][0]
        assert (saved["focal_x"], saved["focal_y"], saved["zoom"]) == (20, 85, 160)
        shown = storefront.public(db, restaurant).banners[0]
        assert (shown.focal_x, shown.focal_y, shown.zoom) == (20, 85, 160)


def test_shown_collection_needs_an_item(tenants):
    rid, _tid, iid = tenants[0]
    with tenant_session(rid) as db:
        restaurant = db.get(Restaurant, rid)
        with pytest.raises(ApiError, match="Choose at least one item"):
            storefront.save_collections(db, restaurant, CollectionsIn(collections=[CollectionIn(title="Popular", item_ids=[])]))
        saved = storefront.save_collections(db, restaurant, CollectionsIn(collections=[CollectionIn(title="Later", is_active=False, item_ids=[])]))
        assert saved["collections"][0]["item_ids"] == []
        assert storefront.public(db, restaurant).collections == []
        # Re-saving the same collection with an item publishes it.
        ident = saved["collections"][0]["id"]
        storefront.save_collections(db, restaurant, CollectionsIn(collections=[CollectionIn(id=ident, title="Later", item_ids=[iid])]))
        assert [c.item_ids for c in storefront.public(db, restaurant).collections] == [[iid]]


@pytest.mark.integration
def test_other_tenant_targets_and_keys_are_refused(tenants):
    rid, _, _ = tenants[0]
    other, _, item = tenants[1]
    with tenant_session(rid) as db:
        r = db.get(Restaurant, rid)
        for key in (photo(other), photo(rid, ImageKind.ITEMS)):
            with pytest.raises(ApiError, match="could not be found"):
                storefront.save_banners(db, r, BannersIn(banners=[BannerIn(image_path=key)]))
        with pytest.raises(ApiError):
            storefront.save_banners(db, r, BannersIn(banners=[BannerIn(image_path=photo(rid), cta_target_kind="item", cta_target_id=item)]))
        with pytest.raises(ApiError):
            storefront.save_collections(db, r, CollectionsIn(collections=[CollectionIn(title="Wrong", item_ids=[item])]))


@pytest.mark.integration
def test_shared_banner_file_released_after_last_commit(tenants):
    rid, _, _ = tenants[0]
    key = photo(rid)
    with tenant_session(rid) as db:
        storefront.save_banners(db, db.get(Restaurant, rid), BannersIn(banners=[BannerIn(image_path=key), BannerIn(image_path=key)]))
    with tenant_session(rid) as db:
        r = db.get(Restaurant, rid)
        row = storefront.ordered(db, StorefrontBanner)[0]
        storefront.save_banners(db, r, BannersIn(banners=[BannerIn(**storefront.banner_dict(row))]))
    assert images.storage().exists(key)
    with tenant_session(rid) as db:
        storefront.save_banners(db, db.get(Restaurant, rid), BannersIn(banners=[]))
        assert images.storage().exists(key)
    assert not images.storage().exists(key)


@pytest.mark.integration
@pytest.mark.parametrize("model", [StorefrontBanner, StorefrontCollection, StorefrontCollectionItem])
def test_rls_blocks_read_update_delete_and_insert(tenants, model):
    a, _, _ = tenants[0]
    b, _, item = tenants[1]
    with tenant_session(b) as db:
        r = db.get(Restaurant, b)
        storefront.save_collections(db, r, CollectionsIn(collections=[CollectionIn(title="Private", item_ids=[item])]))
        storefront.save_banners(db, r, BannersIn(banners=[BannerIn(image_path=photo(b))]))
        collection = storefront.ordered(db, StorefrontCollection)[0].id
    table = model.__tablename__
    with tenant_session(a) as db:
        assert list(db.scalars(select(model))) == []
        assert db.execute(text(f"DELETE FROM {table} WHERE restaurant_id = :b"), {"b": b}).rowcount == 0
        if model != StorefrontCollectionItem:
            assert db.execute(text(f"UPDATE {table} SET sort_order = 9 WHERE restaurant_id = :b"), {"b": b}).rowcount == 0
    with pytest.raises(DBAPIError):
        with tenant_session(a) as db:
            if model == StorefrontBanner:
                row = model(restaurant_id=b, image_path="forged")
            elif model == StorefrontCollection:
                row = model(restaurant_id=b, title="forged")
            else:
                row = model(restaurant_id=b, collection_id=collection, item_id=item)
            db.add(row); db.flush()
