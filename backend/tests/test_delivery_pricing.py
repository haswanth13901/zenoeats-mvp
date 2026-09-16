"""What a delivery costs, and what that does to the total.

Two halves. Picking the ring an address falls in, where the interesting part is
the four answers being four answers -- too far, not found, could not ask, and
here is your fee -- because collapsing them leaves a customer retyping a
perfectly good address at a provider that is down.

Then the arithmetic. A fee is charged on top of the food and never folded into
the subtotal, because a subtotal that quietly included delivery would make
every item's share of a refund wrong and would read as a price rise on the
reports. Whether it is taxed is the restaurant's answer under a flat rate and
Stripe's answer under Stripe Tax, which is the whole reason to be on it.
"""

import pytest
from sqlalchemy import text

from tests.test_admin_restaurants import (  # noqa: F401  (fixtures)
    _create,
    _email,
    _owner,
    _set_own_password,
    _staff_client,
    admin_user,
    cleanup,
)
from tests.test_staff_removal import team  # noqa: F401  (fixture)

pytestmark = pytest.mark.integration

# 44 Main St, Chicago. Everything below is measured from here.
ORIGIN = (41.9227, -87.6431)
DELIVERY = "/api/v1/restaurant/delivery"
ZONES = "/api/v1/restaurant/delivery/zones"
LOCATE = "/api/v1/restaurant/delivery/locate"
PROFILE = "/api/v1/restaurant/profile"

ADDRESS = {
    "address_line1": "44 Main St", "address_city": "Chicago",
    "address_state": "IL", "address_postal_code": "60614", "address_country": "US",
}


@pytest.fixture(autouse=True)
def no_rate_limits(monkeypatch):
    from app.core import ratelimit

    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)


@pytest.fixture
def delivering(team, monkeypatch):
    """A restaurant placed at ORIGIN, with three rings, delivery switched on."""
    _place(monkeypatch, *ORIGIN)
    team.owner.patch(PROFILE, json=ADDRESS)
    team.owner.post(LOCATE)
    team.owner.put(ZONES, json={"zones": [
        {"max_miles": 1, "fee_minor": 200},
        {"max_miles": 3, "fee_minor": 400},
        {"max_miles": 6, "fee_minor": 700},
    ]})
    team.owner.patch(DELIVERY, json={"delivery_enabled": True})
    return team


def _place(monkeypatch, lat, lng, answer="ok"):
    from app.services import geocoding

    monkeypatch.setattr(geocoding, "configured", lambda: True)

    def fake(address):
        if answer == "unavailable":
            raise geocoding.GeocodingUnavailable("down")
        if answer == "missing":
            return None
        return geocoding.Point(latitude=lat, longitude=lng)

    monkeypatch.setattr(geocoding, "geocode", fake)


def _restaurant(restaurant_id):
    from app.db.session import tenant_session
    from app.models import Restaurant

    with tenant_session(restaurant_id) as session:
        row = session.get(Restaurant, restaurant_id)
        session.expunge(row)
        return row


def _quote(restaurant_id, address="9 Elsewhere Ave, Chicago IL"):
    from app.db.session import tenant_session
    from app.services import delivery

    with tenant_session(restaurant_id) as session:
        from app.models import Restaurant

        return delivery.quote(session, session.get(Restaurant, restaurant_id), address)


# -------------------------------------------------------- picking a ring ---

def test_an_address_falls_in_the_first_ring_that_reaches_it(delivering, monkeypatch):
    """Sorted ascending, so the first match is also the cheapest that covers
    the distance."""
    # About 0.7 miles north.
    _place(monkeypatch, ORIGIN[0] + 0.01, ORIGIN[1])
    assert _quote(delivering.id).fee_minor == 200

    # About 1.4 miles: past the first ring, inside the second.
    _place(monkeypatch, ORIGIN[0] + 0.02, ORIGIN[1])
    quote = _quote(delivering.id)
    assert quote.fee_minor == 400
    assert 1.2 < quote.miles < 1.6


def test_an_address_on_a_rings_edge_is_inside_it(delivering, monkeypatch):
    """A ring that reaches "up to 3 miles" has to include three miles, or the
    number on the screen means something the customer cannot check."""
    from app.services import geocoding

    origin = geocoding.Point(*ORIGIN)
    # Walk north until just inside three miles.
    north = geocoding.Point(ORIGIN[0] + 0.0433, ORIGIN[1])
    assert geocoding.miles_between(origin, north) < 3.0

    _place(monkeypatch, north.latitude, north.longitude)
    assert _quote(delivering.id).fee_minor == 400


def test_too_far_says_how_far_and_offers_collection(delivering, monkeypatch):
    from app.core.errors import ApiError

    # About 14 miles north, past the 6-mile ring.
    _place(monkeypatch, ORIGIN[0] + 0.2, ORIGIN[1])
    with pytest.raises(ApiError) as raised:
        _quote(delivering.id)

    assert raised.value.status_code == 409
    assert raised.value.code == "OUT_OF_DELIVERY_RANGE"
    assert "collect" in raised.value.detail["message"]
    assert "6 miles" in raised.value.detail["message"]


def test_an_address_that_cannot_be_placed_is_not_the_same_as_too_far(delivering, monkeypatch):
    from app.core.errors import ApiError

    _place(monkeypatch, *ORIGIN, answer="missing")
    with pytest.raises(ApiError) as raised:
        _quote(delivering.id)
    assert raised.value.code == "ADDRESS_NOT_FOUND"


def test_a_provider_that_is_down_is_our_problem_not_the_customers(delivering, monkeypatch):
    """The worst version of this is a customer retyping a correct address
    because our provider is down."""
    from app.core.errors import ApiError

    _place(monkeypatch, *ORIGIN, answer="unavailable")
    with pytest.raises(ApiError) as raised:
        _quote(delivering.id)

    assert raised.value.status_code == 503
    assert raised.value.code == "DELIVERY_CHECK_UNAVAILABLE"
    assert "collection" in raised.value.detail["message"]


def test_a_restaurant_that_is_not_delivering_says_so_without_saying_why(team, monkeypatch):
    """Switched off, or moved and not placed again: neither is actionable by
    the customer, so neither is spelled out to them."""
    from app.core.errors import ApiError

    _place(monkeypatch, *ORIGIN)
    with pytest.raises(ApiError) as raised:
        _quote(team.id)
    assert raised.value.code == "DELIVERY_NOT_OFFERED"


def test_moving_the_restaurant_stops_quotes_immediately(delivering, monkeypatch):
    from app.core.errors import ApiError

    delivering.owner.patch(PROFILE, json={"address_line1": "9 Elm Road"})

    _place(monkeypatch, ORIGIN[0] + 0.01, ORIGIN[1])
    with pytest.raises(ApiError) as raised:
        _quote(delivering.id)
    assert raised.value.code == "DELIVERY_NOT_OFFERED"


def test_a_blank_address_is_refused_before_anything_is_looked_up(delivering, monkeypatch):
    from app.core.errors import ApiError

    _place(monkeypatch, *ORIGIN)
    with pytest.raises(ApiError) as raised:
        _quote(delivering.id, address="  x ")
    assert raised.value.status_code == 422


def test_offered_is_about_the_restaurant_not_an_address(delivering):
    from app.services import delivery

    assert delivery.offered(_restaurant(delivering.id)) is True
    delivering.owner.patch(DELIVERY, json={"delivery_enabled": False})
    assert delivery.offered(_restaurant(delivering.id)) is False


# ------------------------------------------------------------ the total ---

def test_the_fee_is_charged_on_top_and_stays_out_of_the_subtotal(delivering):
    """A subtotal quietly including delivery would make every item's share of
    a refund wrong."""
    cart = _price(delivering.id, fee=400)
    plain = _price(delivering.id, fee=0)

    assert cart.subtotal_minor == plain.subtotal_minor
    assert cart.delivery_fee_minor == 400
    assert cart.total_minor == plain.total_minor + 400


def test_a_flat_rate_restaurant_does_not_tax_the_fee_by_default(delivering):
    """Default off: a fee taxed that should not have been is money taken from
    a customer who did not owe it."""
    assert _price(delivering.id, fee=400).tax_minor == _price(delivering.id, fee=0).tax_minor


def test_a_flat_rate_restaurant_can_say_its_state_taxes_delivery(delivering):
    delivering.owner.patch(DELIVERY, json={"delivery_fee_taxable": True})

    taxed = _price(delivering.id, fee=400)
    untaxed = _price(delivering.id, fee=0)
    # 8.25% of the 400 fee, on top of the tax on the food.
    assert taxed.tax_minor == untaxed.tax_minor + 33
    assert taxed.total_minor == untaxed.total_minor + 400 + 33


def test_the_switch_and_the_tax_answer_do_not_overwrite_each_other(delivering):
    delivering.owner.patch(DELIVERY, json={"delivery_fee_taxable": True})
    body = delivering.owner.patch(DELIVERY, json={"delivery_enabled": False}).json()

    assert body["delivery_fee_taxable"] is True
    assert body["delivery_enabled"] is False


def test_an_empty_delivery_patch_is_refused(delivering):
    assert delivering.owner.patch(DELIVERY, json={}).status_code == 422


def test_a_negative_fee_cannot_be_smuggled_into_a_total(delivering):
    """Nothing sends one today, but a fee is money and money clamps at zero."""
    assert _price(delivering.id, fee=-500).delivery_fee_minor == 0


def _price(restaurant_id, fee):
    """Price a one-item cart with a delivery fee attached."""
    from app.db.session import tenant_session
    from app.models import Item, Restaurant
    from app.services.pricing import price_cart
    from sqlalchemy import select

    with tenant_session(restaurant_id) as session:
        restaurant = session.get(Restaurant, restaurant_id)
        item = next(
            (i for i in session.execute(select(Item)).scalars() if i.meal_links), None
        )
        if item is None:
            item = _an_item(session, restaurant_id)
        return price_cart(
            session, restaurant,
            [{"menu_item_id": item.id, "quantity": 1, "note": None, "modifiers": []}],
            delivery_fee_minor=fee,
        )


def _an_item(session, restaurant_id):
    """An item that is actually on the menu.

    The meal-period link is not decoration: pricing refuses an item that no
    period serves, because a cart outlives a menu edit.
    """
    from app.models import Item, ItemType, Meal, MealItem
    from sqlalchemy import select

    item_type = session.execute(select(ItemType).limit(1)).scalars().first()
    item = Item(
        restaurant_id=restaurant_id, item_type_id=item_type.id, name="Smash Burger",
        base_price_minor=1200, is_available=True,
    )
    session.add(item)
    session.flush()

    meal = Meal(restaurant_id=restaurant_id, name="All day", sort_order=0)
    session.add(meal)
    session.flush()
    session.add(MealItem(restaurant_id=restaurant_id, meal_id=meal.id, item_id=item.id))
    session.flush()
    session.refresh(item)
    return item
