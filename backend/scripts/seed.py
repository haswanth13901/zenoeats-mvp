"""Seed a demo restaurant with the menu structure from the spec.

    Meal: Lunch
      Category "Burgers"      kind=FOOD
        Item "Smash Burger"   -> Veggies (MULTI), Sauce add-ons (MULTI)
      Category "Cold Drinks"  kind=BEVERAGE
        Item "Iced Tea"       -> Ice level (SINGLE, required)
      Category "Sides & Sauces" kind=SAUCE
        Item "Garlic Aioli"

Run:  docker compose exec api python scripts/seed.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import text  # noqa: E402

from app.db.base import utcnow  # noqa: E402
from app.db.session import system_session, tenant_session  # noqa: E402
from app.models import (  # noqa: E402
    Category, CategoryKind, Item, ItemModifierGroup, Meal, ModifierGroup,
    ModifierOption, Restaurant, RestaurantOrderCounter,
    RestaurantPaymentAccount, RestaurantStatus, RestaurantUser, SelectionType,
    StaffRole, StaffStatus, User,
)

SLUG = "spicehouse"


def main() -> None:
    with system_session() as session:
        existing = session.execute(
            text("SELECT id FROM restaurants WHERE slug = :s"), {"s": SLUG}
        ).first()
        if existing:
            print(f"Restaurant '{SLUG}' already exists ({existing.id}). Nothing to do.")
            return

        restaurant = Restaurant(
            slug=SLUG,
            name="Spice House",
            status=RestaurantStatus.ACTIVE.value,
            timezone="America/Chicago",
            currency="USD",
            tax_rate_bps=825,  # 8.25% flat. Replace with Stripe Tax for real.
            tagline="Wood-fired burgers and cold drinks",
        )
        session.add(restaurant)
        session.flush()
        rid = restaurant.id

        session.add(
            RestaurantOrderCounter(
                restaurant_id=rid, next_order_number=1001, updated_at=utcnow()
            )
        )

        admin = User(
            clerk_user_id="user_dev_superadmin",
            email="admin@zenoeats.local",
            full_name="Platform Admin",
            is_platform_admin=True,
        )
        owner = User(
            clerk_user_id="user_dev_owner",
            email="owner@spicehouse.local",
            full_name="Restaurant Owner",
        )
        customer = User(
            clerk_user_id="user_dev_customer",
            email="customer@example.com",
            full_name="Sam Customer",
        )
        session.add_all([admin, owner, customer])
        session.flush()
        owner_id = owner.id

    with tenant_session(rid) as session:
        session.add(
            RestaurantUser(
                restaurant_id=rid, user_id=owner_id,
                role_code=StaffRole.ADMIN.value, status=StaffStatus.ACTIVE.value,
                invited_at=utcnow(), accepted_at=utcnow(),
            )
        )
        # Placeholder Connect account. Replace with a real acct_ id from
        # Stripe test mode before running a payment.
        session.add(
            RestaurantPaymentAccount(
                restaurant_id=rid,
                stripe_account_id="acct_REPLACE_WITH_TEST_ACCOUNT",
                charges_enabled=True,
                payouts_enabled=True,
                details_submitted=True,
                onboarding_status="COMPLETE",
            )
        )

        lunch = Meal(restaurant_id=rid, name="Lunch", sort_order=1)
        session.add(lunch)
        session.flush()

        burgers = Category(restaurant_id=rid, meal_id=lunch.id, name="Burgers",
                           kind=CategoryKind.FOOD.value, sort_order=1)
        drinks = Category(restaurant_id=rid, meal_id=lunch.id, name="Cold Drinks",
                          kind=CategoryKind.BEVERAGE.value, sort_order=2)
        sauces = Category(restaurant_id=rid, meal_id=lunch.id, name="Sides & Sauces",
                          kind=CategoryKind.SAUCE.value, sort_order=3)
        session.add_all([burgers, drinks, sauces])
        session.flush()

        # --- Reusable modifier groups -----------------------------------
        veggies = ModifierGroup(
            restaurant_id=rid, name="Veggies",
            selection_type=SelectionType.MULTI.value, is_required=False,
            min_select=0, max_select=5, applies_to_kind=CategoryKind.FOOD.value,
        )
        sauce_adds = ModifierGroup(
            restaurant_id=rid, name="Sauce add-ons",
            selection_type=SelectionType.MULTI.value, is_required=False,
            min_select=0, max_select=3, applies_to_kind=CategoryKind.FOOD.value,
        )
        ice = ModifierGroup(
            restaurant_id=rid, name="Ice level",
            selection_type=SelectionType.SINGLE.value, is_required=True,
            min_select=1, max_select=1, applies_to_kind=CategoryKind.BEVERAGE.value,
        )
        session.add_all([veggies, sauce_adds, ice])
        session.flush()

        for i, (name, delta) in enumerate([
            ("Lettuce", 0), ("Tomato", 0), ("Red onion", 0),
            ("Pickles", 0), ("Jalapenos", 50),
        ]):
            session.add(ModifierOption(restaurant_id=rid, group_id=veggies.id,
                                       name=name, price_delta_minor=delta, sort_order=i))

        for i, (name, delta) in enumerate([
            ("Garlic aioli", 75), ("Chipotle mayo", 75), ("House hot sauce", 50),
        ]):
            session.add(ModifierOption(restaurant_id=rid, group_id=sauce_adds.id,
                                       name=name, price_delta_minor=delta, sort_order=i))

        for i, (name, default) in enumerate([
            ("Light", False), ("Regular", True), ("Heavy", False),
        ]):
            session.add(ModifierOption(restaurant_id=rid, group_id=ice.id, name=name,
                                       price_delta_minor=0, is_default=default, sort_order=i))
        session.flush()

        # --- Items -------------------------------------------------------
        smash = Item(restaurant_id=rid, category_id=burgers.id, name="Smash Burger",
                     description="Two seared patties, aged cheddar, house sauce.",
                     base_price_minor=1095, currency="USD", sort_order=1)
        crispy = Item(restaurant_id=rid, category_id=burgers.id, name="Crispy Chicken",
                      description="Buttermilk-brined thigh, slaw, pickles.",
                      base_price_minor=1195, currency="USD", sort_order=2)
        tea = Item(restaurant_id=rid, category_id=drinks.id, name="Iced Tea",
                   description="Brewed hourly. Unsweetened.",
                   base_price_minor=350, currency="USD", sort_order=1)
        lemonade = Item(restaurant_id=rid, category_id=drinks.id, name="Lemonade",
                        description="Fresh-squeezed, not too sweet.",
                        base_price_minor=425, currency="USD", sort_order=2)
        aioli = Item(restaurant_id=rid, category_id=sauces.id, name="Garlic Aioli",
                     description="Two-ounce cup.",
                     base_price_minor=100, currency="USD", sort_order=1)
        session.add_all([smash, crispy, tea, lemonade, aioli])
        session.flush()

        links = [
            (smash, veggies, 0), (smash, sauce_adds, 1),
            (crispy, veggies, 0), (crispy, sauce_adds, 1),
            (tea, ice, 0), (lemonade, ice, 0),
        ]
        for item, group, order in links:
            session.add(ItemModifierGroup(restaurant_id=rid, item_id=item.id,
                                          group_id=group.id, sort_order=order))

    print(f"Seeded '{SLUG}' ({rid})")
    print("  Portal:  http://spicehouse.zenoeats.local:8080")
    print("  Dev customer token (AUTH_DEV_BYPASS): user_dev_customer")
    print("  Dev owner token:                      user_dev_owner")
    print("  Dev super admin token:                user_dev_superadmin")
    print()
    print("  Next: replace acct_REPLACE_WITH_TEST_ACCOUNT with a real Stripe")
    print("  test-mode connected account before attempting a payment.")


if __name__ == "__main__":
    main()
