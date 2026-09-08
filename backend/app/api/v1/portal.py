"""Public portal: branding and menu for the resolved restaurant.

No authentication required. RLS still applies, so an unauthenticated read
cannot reach another tenant's catalog.
"""

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import TenantContext, current_restaurant, resolve_tenant, tenant_db
from app.config import settings
from app.models import (
    Category, Item, ItemModifierGroup, Meal, ModifierGroup, Restaurant,
    RestaurantPaymentAccount,
)
from app.schemas.api import (
    CategoryOut, ItemOut, MealOut, MenuOut, ModifierGroupOut, OptionOut, PortalOut,
)

router = APIRouter(tags=["portal"])


@router.get("/portal", response_model=PortalOut)
def get_portal(
    tenant: TenantContext = Depends(resolve_tenant),
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
):
    account = db.execute(select(RestaurantPaymentAccount)).scalar_one_or_none()
    return PortalOut(
        restaurant_id=restaurant.id,
        slug=restaurant.slug,
        name=restaurant.name,
        tagline=restaurant.tagline,
        currency=restaurant.currency,
        is_orderable=restaurant.is_orderable,
        accepting_orders=restaurant.accepting_orders,
        stripe_publishable_key=settings.STRIPE_PUBLISHABLE_KEY,
        stripe_account_id=account.stripe_account_id if account else None,
    )


@router.get("/menu", response_model=MenuOut)
def get_menu(
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
):
    meals = db.execute(
        select(Meal)
        .where(Meal.is_active.is_(True), Meal.deleted_at.is_(None))
        .order_by(Meal.sort_order, Meal.name)
        .options(
            selectinload(Meal.categories)
            .selectinload(Category.items)
            .selectinload(Item.modifier_links)
            .selectinload(ItemModifierGroup.group)
            .selectinload(ModifierGroup.options)
        )
    ).scalars().all()

    out: list[MealOut] = []
    for meal in meals:
        categories: list[CategoryOut] = []
        for category in meal.categories:
            if category.deleted_at is not None:
                continue
            items: list[ItemOut] = []
            for item in category.items:
                if item.deleted_at is not None:
                    continue
                groups: list[ModifierGroupOut] = []
                for link in sorted(item.modifier_links, key=lambda l: l.sort_order):
                    group = link.group
                    if group.deleted_at is not None:
                        continue
                    groups.append(
                        ModifierGroupOut(
                            id=group.id,
                            name=group.name,
                            selection_type=group.selection_type,
                            is_required=group.is_required,
                            min_select=group.min_select,
                            max_select=group.max_select,
                            options=[
                                OptionOut(
                                    id=o.id,
                                    name=o.name,
                                    price_delta_minor=o.price_delta_minor,
                                    is_default=o.is_default,
                                    is_available=o.is_available,
                                )
                                for o in sorted(group.options, key=lambda o: o.sort_order)
                                if o.deleted_at is None
                            ],
                        )
                    )
                items.append(
                    ItemOut(
                        id=item.id,
                        name=item.name,
                        description=item.description,
                        base_price_minor=item.base_price_minor,
                        currency=item.currency,
                        is_available=item.is_available,
                        image_path=item.image_path,
                        modifier_groups=groups,
                    )
                )
            if items:
                categories.append(
                    CategoryOut(id=category.id, name=category.name, kind=category.kind, items=items)
                )
        if categories:
            out.append(MealOut(id=meal.id, name=meal.name, categories=categories))

    return MenuOut(meals=out)
