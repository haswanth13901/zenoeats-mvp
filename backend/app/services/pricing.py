"""Server-authoritative cart repricing.

Rule 3: all prices, modifiers and availability are recalculated and validated
server-side at checkout. The browser cart is an input, never an authority.
The client sends ids and quantities. It never sends prices, and any price it
does send is ignored.
"""

from dataclasses import dataclass, field
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.core import errors
from app.models import (
    Item, ItemModifierGroup, ModifierGroup, ModifierOption, Restaurant,
    SelectionType,
)
from app.services.tax import TaxService


@dataclass
class PricedModifier:
    option_id: UUID
    group_name: str
    option_name: str
    unit_price_delta_minor: int
    quantity: int


@dataclass
class PricedLine:
    menu_item_id: UUID
    name: str
    unit_price_minor: int      # base + modifier deltas, for one unit
    quantity: int
    line_total_minor: int
    note: str | None = None
    modifiers: list[PricedModifier] = field(default_factory=list)


@dataclass
class PricedCart:
    currency: str
    subtotal_minor: int
    discount_minor: int
    tax_minor: int
    total_minor: int
    lines: list[PricedLine]


def price_cart(
    session: Session,
    restaurant: Restaurant,
    raw_lines: list[dict],
) -> PricedCart:
    """Validate and price a cart. Raises ApiError on any invalid input.

    raw_lines: [{"menu_item_id": uuid, "quantity": int, "note": str|None,
                 "modifiers": [{"option_id": uuid, "quantity": int}]}]
    """
    if not raw_lines:
        raise errors.validation_error("Cart is empty.")
    if sum(int(l.get("quantity", 0)) for l in raw_lines) > settings.MAX_ITEMS_PER_ORDER:
        raise errors.validation_error("Too many items in one order.")

    item_ids = {UUID(str(l["menu_item_id"])) for l in raw_lines}

    # RLS already scopes this to the current tenant. The explicit
    # restaurant_id predicate is belt and braces, and it keeps the index in
    # play.
    items = session.execute(
        select(Item)
        .where(
            Item.id.in_(item_ids),
            Item.restaurant_id == restaurant.id,
            Item.deleted_at.is_(None),
        )
        .options(
            selectinload(Item.modifier_links)
            .selectinload(ItemModifierGroup.group)
            .selectinload(ModifierGroup.options)
        )
    ).scalars().all()
    items_by_id = {i.id: i for i in items}

    missing = item_ids - set(items_by_id)
    if missing:
        raise errors.item_unavailable("An item in your cart no longer exists.")

    priced_lines: list[PricedLine] = []
    subtotal = 0

    for raw in raw_lines:
        item = items_by_id[UUID(str(raw["menu_item_id"]))]
        quantity = int(raw.get("quantity", 0))

        if quantity < 1:
            raise errors.validation_error(f"Quantity for {item.name} must be at least 1.")
        if not item.is_available:
            raise errors.item_unavailable(f"{item.name} is sold out.")
        if item.currency != restaurant.currency:
            raise errors.validation_error("Mixed currencies in one cart.")

        selected = _validate_modifiers(item, raw.get("modifiers") or [])

        unit_price = item.base_price_minor + sum(
            m.unit_price_delta_minor * m.quantity for m in selected
        )
        if unit_price < 0:
            # Modifier deltas may be negative, but a line can never be.
            unit_price = 0

        line_total = unit_price * quantity
        subtotal += line_total

        note = (raw.get("note") or None)
        if note and len(note) > 280:
            raise errors.validation_error("Item note is too long.")

        priced_lines.append(
            PricedLine(
                menu_item_id=item.id,
                name=item.name,
                unit_price_minor=unit_price,
                quantity=quantity,
                line_total_minor=line_total,
                note=note,
                modifiers=selected,
            )
        )

    discount = 0  # Promotions are deferred. The field stays so the order
                  # snapshot shape does not change when they land.
    taxable_base = max(subtotal - discount, 0)
    tax = TaxService.calculate_tax(restaurant, taxable_base)
    total = taxable_base + tax

    return PricedCart(
        currency=restaurant.currency,
        subtotal_minor=subtotal,
        discount_minor=discount,
        tax_minor=tax,
        total_minor=total,
        lines=priced_lines,
    )


def _validate_modifiers(item: Item, raw_modifiers: list[dict]) -> list[PricedModifier]:
    """Enforce the group rules the restaurant configured.

    Checks that every selected option belongs to a group actually attached to
    this item, that required groups are satisfied, that SINGLE groups get
    exactly one selection, and that min/max are respected.
    """
    groups_by_id: dict[UUID, ModifierGroup] = {}
    option_lookup: dict[UUID, tuple[ModifierGroup, ModifierOption]] = {}

    for link in item.modifier_links:
        group = link.group
        if group.deleted_at is not None:
            continue
        groups_by_id[group.id] = group
        for option in group.options:
            if option.deleted_at is None:
                option_lookup[option.id] = (group, option)

    selected: list[PricedModifier] = []
    per_group_count: dict[UUID, int] = {gid: 0 for gid in groups_by_id}

    seen: set[UUID] = set()
    for raw in raw_modifiers:
        option_id = UUID(str(raw["option_id"]))
        quantity = int(raw.get("quantity", 1))

        if quantity < 1:
            raise errors.validation_error("Modifier quantity must be at least 1.")
        if option_id in seen:
            raise errors.validation_error("Duplicate modifier option in one line.")
        seen.add(option_id)

        found = option_lookup.get(option_id)
        if found is None:
            # Either the option does not exist, belongs to another tenant, or
            # is not attached to this item. All three are the same answer.
            raise errors.item_unavailable("That option is not available on this item.")

        group, option = found
        if not option.is_available:
            raise errors.item_unavailable(f"{option.name} is unavailable.")

        per_group_count[group.id] += quantity
        selected.append(
            PricedModifier(
                option_id=option.id,
                group_name=group.name,
                option_name=option.name,
                unit_price_delta_minor=option.price_delta_minor,
                quantity=quantity,
            )
        )

    for group_id, group in groups_by_id.items():
        count = per_group_count[group_id]

        if group.is_required and count == 0:
            raise errors.validation_error(f"Choose an option for {group.name}.")
        if count == 0:
            continue
        if group.selection_type == SelectionType.SINGLE.value and count != 1:
            raise errors.validation_error(f"Choose exactly one option for {group.name}.")
        if count < group.min_select and group.is_required:
            raise errors.validation_error(
                f"Choose at least {group.min_select} for {group.name}."
            )
        if count > group.max_select:
            raise errors.validation_error(
                f"Choose at most {group.max_select} for {group.name}."
            )

    return selected
