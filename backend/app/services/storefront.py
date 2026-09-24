"""Saved presentation and its public projection.

A save locks the tenant root before replacing a set. Two managers saving at
once therefore produce one complete set followed by the other, never a mix
that exceeds the count limit. Keys are accepted before rows change and old
files are released only after every replacement has been attached.
"""

from uuid import uuid4
from sqlalchemy import delete, select

from app.core import errors
from app.db.base import utcnow
from app.models import (
    Item, ItemType, Restaurant, StorefrontBanner, StorefrontCollection, StorefrontCollectionItem,
    StorefrontShortcut, StorefrontShortcutItem,
)
from app.schemas.storefront import StorefrontOut
from app.services import images, maps
from app.services.images import ImageKind
from app.services.menu import load_item_types, load_menu


def require_enabled(restaurant):
    if not restaurant.storefront_customization_enabled:
        raise errors.ApiError(403, "STOREFRONT_DISABLED", "Storefront customisation is not enabled for this restaurant.")


def lock(db, restaurant):
    row = db.execute(select(Restaurant).where(Restaurant.id == restaurant.id).with_for_update().execution_options(populate_existing=True)).scalar_one()
    require_enabled(row)
    return row


def owned(db, model, ident, restaurant):
    row = db.get(model, ident)
    if row is None or row.restaurant_id != restaurant.id or getattr(row, "deleted_at", None) is not None:
        raise errors.validation_error("That storefront target could not be found. Choose it again.")
    return row


def ordered(db, model):
    return list(db.scalars(select(model).order_by(model.sort_order, model.created_at, model.id)))


def banner_dict(row):
    return {key: getattr(row, key) for key in ("id", "image_path", "headline", "subline", "cta_label", "cta_target_kind", "cta_target_id", "is_active", "starts_at", "ends_at",
                                   "focal_x", "focal_y", "zoom")}


def collection_dict(db, row):
    ids = list(db.scalars(select(StorefrontCollectionItem.item_id).where(StorefrontCollectionItem.collection_id == row.id).order_by(StorefrontCollectionItem.sort_order)))
    return {"id": row.id, "title": row.title, "is_active": row.is_active, "item_ids": ids}


def shortcut_dict(db, row):
    ids = list(db.scalars(select(StorefrontShortcutItem.item_id).where(StorefrontShortcutItem.shortcut_id == row.id).order_by(StorefrontShortcutItem.sort_order)))
    return {"id": row.id, "item_type_id": row.item_type_id, "label": row.label, "is_active": row.is_active,
            "image_path": row.image_path, "image_url": images.image_url(row.image_path), "item_ids": ids}


def management(db, restaurant):
    require_enabled(restaurant)
    types = load_item_types(db)
    items = list(db.scalars(select(Item).where(Item.deleted_at.is_(None)).order_by(Item.sort_order, Item.created_at, Item.id)))
    return {
        "storefront_customization_enabled": True,
        "name": restaurant.name, "tagline": restaurant.tagline,
        "currency": restaurant.currency,
        "theme": restaurant.theme, "logo_path": restaurant.logo_path,
        "logo_url": images.image_url(restaurant.logo_path),
        "banner_interval_ms": restaurant.banner_interval_ms,
        # The delivery map: what this restaurant chose, and what it may
        # choose between. An empty list means the platform has set up no
        # styles, and the portal offers no choice rather than a list of one.
        "map_style_key": restaurant.map_style_key,
        "map_pins_themed": restaurant.map_pins_themed,
        "map_styles": maps.choices(),
        "banners": [{**banner_dict(row), "image_url": images.image_url(row.image_path)} for row in ordered(db, StorefrontBanner)],
        "categories": [{"id": t.id, "name": t.name, "parent_id": t.parent_id, "sort_order": t.sort_order,
                        "image_path": t.image_path, "image_url": images.image_url(t.image_path), "show_in_shortcuts": t.show_in_shortcuts,
                        "items": [{"id": i.id, "name": i.name, "is_available": i.is_available} for i in items if i.item_type_id == t.id]} for t in types],
        "collections": [collection_dict(db, row) for row in ordered(db, StorefrontCollection)],
        "shortcuts": [shortcut_dict(db, row) for row in ordered(db, StorefrontShortcut)],
        "menu": load_menu(db, include_empty=True).model_dump(),
    }


def save_theme(db, restaurant, body):
    restaurant = lock(db, restaurant)
    changes = body.model_dump(exclude_unset=True)
    old = restaurant.logo_path
    if "logo_path" in changes:
        changes["logo_path"] = images.accept(changes["logo_path"], restaurant.id, ImageKind.BRANDING)
    for key, value in changes.items():
        setattr(restaurant, key, value)
    db.flush()
    if old != restaurant.logo_path:
        images.release(db, old)
    return management(db, restaurant)


def save_map(db, restaurant, body):
    """The delivery map's style and pins.

    A style the platform has not configured is refused rather than stored:
    the portal only ever sends a key it was offered, so an unknown one is a
    stale page or a hand-written request, and storing it would leave the
    restaurant looking at a setting that does nothing.
    """
    restaurant = lock(db, restaurant)
    changes = body.model_dump(exclude_unset=True)
    key = changes.get("map_style_key")
    if key and key not in {style["key"] for style in maps.choices()}:
        raise errors.validation_error("That map style is not available. Reload the storefront.")
    for field, value in changes.items():
        setattr(restaurant, field, value)
    db.flush()
    return management(db, restaurant)


def save_category(db, restaurant, ident, body):
    restaurant = lock(db, restaurant)
    row = owned(db, ItemType, ident, restaurant)
    changes = body.model_dump(exclude_unset=True)
    old = row.image_path
    if "image_path" in changes:
        changes["image_path"] = images.accept(changes["image_path"], restaurant.id, ImageKind.CATEGORIES)
    for key, value in changes.items():
        setattr(row, key, value)
    db.flush()
    if row.image_path != old:
        images.release(db, old)
    return management(db, restaurant)


def unique_ids(entries):
    ids = [e.id for e in entries if e.id]
    if len(ids) != len(set(ids)):
        raise errors.validation_error("Each saved row may appear only once.")


def save_banners(db, restaurant, body):
    restaurant = lock(db, restaurant)
    unique_ids(body.banners)
    existing = {r.id: r for r in ordered(db, StorefrontBanner)}
    old_keys = {r.image_path for r in existing.values()}
    targets = {"item": Item, "item_type": ItemType, "collection": StorefrontCollection}
    for entry in body.banners:
        if entry.id and entry.id not in existing:
            raise errors.validation_error("That banner could not be found. Reload the storefront.")
        images.accept(entry.image_path, restaurant.id, ImageKind.BANNERS)
        if entry.cta_target_kind != "menu":
            owned(db, targets[entry.cta_target_kind], entry.cta_target_id, restaurant)
    keep = set()
    for position, entry in enumerate(body.banners):
        row = existing.get(entry.id)
        if row is None:
            row = StorefrontBanner(id=uuid4(), restaurant_id=restaurant.id)
            db.add(row)
        for key, value in entry.model_dump(exclude={"id"}).items():
            setattr(row, key, value)
        row.sort_order = position
        keep.add(row.id)
    for ident, row in existing.items():
        if ident not in keep:
            db.delete(row)
    db.flush()
    for key in old_keys:
        images.release(db, key)
    return management(db, restaurant)


def save_collections(db, restaurant, body):
    restaurant = lock(db, restaurant)
    unique_ids(body.collections)
    existing = {r.id: r for r in ordered(db, StorefrontCollection)}
    for entry in body.collections:
        if entry.id and entry.id not in existing:
            raise errors.validation_error("That collection could not be found. Reload the storefront.")
        # The storefront leaves out a collection with nothing in it, so a
        # shown one saved empty would read "saved" here and appear nowhere.
        # Hidden, it may wait empty while the manager decides what goes in.
        if entry.is_active and not entry.item_ids:
            raise errors.validation_error(
                f"Choose at least one item for “{entry.title}”, or turn off Show collection."
            )
        for ident in entry.item_ids:
            owned(db, Item, ident, restaurant)
    # Remove links first, while their parent still exists. Links have no
    # identity of their own; the collection keeps its id for banner targets.
    db.execute(delete(StorefrontCollectionItem))
    keep = set()
    for position, entry in enumerate(body.collections):
        row = existing.get(entry.id)
        if row is None:
            row = StorefrontCollection(id=uuid4(), restaurant_id=restaurant.id)
            db.add(row)
        row.title, row.is_active, row.sort_order = entry.title, entry.is_active, position
        keep.add(row.id)
        db.flush()
        for order, ident in enumerate(entry.item_ids):
            db.add(StorefrontCollectionItem(collection_id=row.id, item_id=ident, restaurant_id=restaurant.id, sort_order=order))
    for ident, row in existing.items():
        if ident not in keep:
            db.delete(row)
    db.flush()
    return management(db, restaurant)


def save_shortcuts(db, restaurant, body):
    """Replace the shortcut row.

    A shortcut may only show items filed under its own category, or under
    one of that category's subcategories: "Burgers" pointing at a drink would
    scroll a customer to a section that says one thing and holds another.
    """
    restaurant = lock(db, restaurant)
    unique_ids(body.shortcuts)
    existing = {r.id: r for r in ordered(db, StorefrontShortcut)}
    old_keys = {r.image_path for r in existing.values()}
    types = {t.id: t for t in load_item_types(db)}
    for entry in body.shortcuts:
        if entry.id and entry.id not in existing:
            raise errors.validation_error("That shortcut could not be found. Reload the storefront.")
        if entry.item_type_id not in types:
            raise errors.validation_error("That category could not be found. Choose it again.")
        images.accept(entry.image_path, restaurant.id, ImageKind.CATEGORIES)
        if entry.is_active and not entry.item_ids:
            raise errors.validation_error(
                f"Choose at least one item for “{entry.label}”, or turn off Show shortcut."
            )
        family = {entry.item_type_id} | {t.id for t in types.values() if t.parent_id == entry.item_type_id}
        for ident in entry.item_ids:
            item = owned(db, Item, ident, restaurant)
            if item.item_type_id not in family:
                raise errors.validation_error(
                    f"“{item.name}” is not in the category of “{entry.label}”. Choose items from that category."
                )
    db.execute(delete(StorefrontShortcutItem))
    keep = set()
    for position, entry in enumerate(body.shortcuts):
        row = existing.get(entry.id)
        if row is None:
            row = StorefrontShortcut(id=uuid4(), restaurant_id=restaurant.id)
            db.add(row)
        row.item_type_id, row.label, row.image_path = entry.item_type_id, entry.label, entry.image_path
        row.is_active, row.sort_order = entry.is_active, position
        keep.add(row.id)
        db.flush()
        for order, ident in enumerate(entry.item_ids):
            db.add(StorefrontShortcutItem(shortcut_id=row.id, item_id=ident, restaurant_id=restaurant.id, sort_order=order))
    for ident, row in existing.items():
        if ident not in keep:
            db.delete(row)
    db.flush()
    for key in old_keys:
        images.release(db, key)
    return management(db, restaurant)


def public(db, restaurant):
    if not restaurant.storefront_customization_enabled:
        return None
    menu = load_menu(db, include_empty=False)
    visible_items = {i.id for meal in menu.meals for section in meal.sections for i in [*section.items, *[i for group in section.groups for i in group.items]]}
    types = load_item_types(db)
    visible_types = {section.item_type_id for meal in menu.meals for section in meal.sections}
    visible_types.update(group.item_type_id for meal in menu.meals for section in meal.sections for group in section.groups)
    collections = []
    for row in ordered(db, StorefrontCollection):
        if row.is_active:
            data = collection_dict(db, row)
            data["item_ids"] = [ident for ident in data["item_ids"] if ident in visible_items]
            if data["item_ids"]:
                collections.append(data)
    visible_collections = {c["id"] for c in collections}
    type_photos = {t.id: t.image_path for t in types}
    shortcuts = []
    for row in ordered(db, StorefrontShortcut):
        if not row.is_active or row.item_type_id not in type_photos:
            continue
        data = shortcut_dict(db, row)
        item_ids = [ident for ident in data["item_ids"] if ident in visible_items]
        if item_ids:
            shortcuts.append({"id": row.id, "item_type_id": row.item_type_id, "label": row.label, "item_ids": item_ids,
                              "image_url": images.image_url(row.image_path or type_photos[row.item_type_id])})
    now = utcnow()
    banners = []
    for row in ordered(db, StorefrontBanner):
        if not row.is_active or (row.starts_at and row.starts_at > now) or (row.ends_at and row.ends_at <= now):
            continue
        data = banner_dict(row)
        valid = {"item": visible_items, "item_type": visible_types, "collection": visible_collections}
        # A previously valid target can leave the menu after the banner was
        # saved. Keep the photograph, but make its action a useful menu jump.
        if row.cta_target_kind != "menu" and row.cta_target_id not in valid[row.cta_target_kind]:
            data.update(cta_target_kind="menu", cta_target_id=None)
        data["image_url"] = images.image_url(row.image_path)
        banners.append(data)
    return StorefrontOut(theme=restaurant.theme, logo_url=images.image_url(restaurant.logo_path),
        banner_interval_ms=restaurant.banner_interval_ms, banners=banners,
        categories={str(t.id): {"image_url": images.image_url(t.image_path), "show_in_shortcuts": t.show_in_shortcuts, "sort_order": n} for n, t in enumerate(types)},
        collections=collections, shortcuts=shortcuts)
