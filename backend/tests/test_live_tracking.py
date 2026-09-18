"""Following a delivery from payment to the door.

The driver's phone sends its position while it carries an order; the
customer's order page reads back the steps so far, the driver's first name,
the map points and, while the order is on the road, where the driver is and
how long until they arrive.

What is guarded hardest is when a position exists at all: never for a driver
who is not carrying anything, never to a customer before their food has left
the kitchen, and never once the phone has gone quiet.
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
from tests.test_deliveries import _assign, shop  # noqa: F401  (fixture)

pytestmark = pytest.mark.integration

ADDRESS = "12 Oak Street, flat 3"
RESTAURANT = (41.9227, -87.6431)
HOME = (41.9427, -87.6431)
LOCATION = "/api/v1/restaurant/driver/location"


@pytest.fixture(autouse=True)
def no_rate_limits(monkeypatch):
    from app.core import ratelimit

    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)


def _open(shop):
    """Customers only reach an ACTIVE restaurant, and host resolution
    remembers the draft it saw for a few seconds."""
    from app.api import deps
    from app.db.session import system_session

    with system_session() as session:
        session.execute(text("UPDATE restaurants SET status = 'ACTIVE' WHERE id = :r"), {"r": shop.id})
    deps._tenant_cache.clear()


@pytest.fixture
def journey(shop):
    """A paid order, placed restaurant and home, assigned to Dana."""
    from app.db.session import tenant_session
    from app.services import geocoding

    _open(shop)
    with tenant_session(shop.id) as session:
        session.execute(
            text("UPDATE restaurants SET latitude = :la, longitude = :lo WHERE id = :r"),
            {"la": RESTAURANT[0], "lo": RESTAURANT[1], "r": shop.id},
        )
    # Checkout would have placed the address; the tracking page only ever
    # reads that cached answer.
    geocoding._cache_put(ADDRESS, geocoding.Point(*HOME))

    shop.order_id = shop.order()
    assert _assign(shop.manager, shop.order_id, shop.driver_membership, ADDRESS).status_code == 200
    with tenant_session(shop.id) as session:
        shop.customer_id = session.execute(
            text("SELECT customer_user_id FROM orders WHERE id = :o"), {"o": shop.order_id}
        ).scalar_one()
    return shop


@pytest.fixture
def as_customer(journey):
    from app.api.deps import optional_current_user
    from app.db.session import system_session
    from app.main import app
    from app.models import User

    with system_session() as session:
        customer = session.get(User, journey.customer_id)
        session.expunge(customer)
    app.dependency_overrides[optional_current_user] = lambda: customer
    client = _staff_client(journey.slug)
    yield lambda: client.get(f"/api/v1/orders/{journey.order_id}").json()
    app.dependency_overrides.pop(optional_current_user, None)


def _ready_and_picked_up(shop):
    assert shop.kitchen.post(f"/api/v1/restaurant/orders/{shop.order_id}/ready").status_code == 200
    assert shop.driver.post(f"/api/v1/restaurant/orders/{shop.order_id}/picked-up").status_code == 200


def _send(client, lat=HOME[0] - 0.01, lng=HOME[1], heading=90):
    return client.post(LOCATION, json={"latitude": lat, "longitude": lng, "heading": heading})


# ------------------------------------------------------ the driver's side ---

def test_a_driver_with_nothing_on_the_road_is_not_tracked(journey):
    """Assigned is not enough: the food has not left the kitchen."""
    res = _send(journey.driver)
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "NOT_ON_A_DELIVERY"


def test_a_driver_on_the_road_shares_their_position(journey):
    _ready_and_picked_up(journey)
    res = _send(journey.driver)
    assert res.status_code == 200
    assert res.json() == {"sharing": True, "orders": 1}


def test_carrying_someone_elses_order_is_not_carrying_one(journey):
    _ready_and_picked_up(journey)
    assert _send(journey.other_driver).status_code == 409


def test_a_position_off_the_map_is_refused(journey):
    _ready_and_picked_up(journey)
    assert _send(journey.driver, lat=91).status_code == 422
    assert _send(journey.driver, heading=400).status_code == 422


def test_the_kitchen_cannot_send_a_position(journey):
    _ready_and_picked_up(journey)
    assert _send(journey.kitchen).status_code == 403


# ---------------------------------------------------- the customer's side ---

def test_a_collection_has_no_tracking(shop):
    from app.api.deps import optional_current_user
    from app.db.session import system_session, tenant_session
    from app.main import app
    from app.models import User

    _open(shop)
    order_id = shop.order()
    with tenant_session(shop.id) as session:
        customer_id = session.execute(
            text("SELECT customer_user_id FROM orders WHERE id = :o"), {"o": order_id}
        ).scalar_one()
    with system_session() as session:
        customer = session.get(User, customer_id)
        session.expunge(customer)
    app.dependency_overrides[optional_current_user] = lambda: customer
    try:
        body = _staff_client(shop.slug).get(f"/api/v1/orders/{order_id}").json()
    finally:
        app.dependency_overrides.pop(optional_current_user, None)
    assert body["tracking"] is None
    assert body["pickup_pin"]


def test_before_pickup_the_customer_sees_the_steps_and_the_map_but_no_driver_dot(journey, as_customer):
    # A position recorded for Dana from some other order must not show here yet.
    from app.services import tracking

    tracking.record_location(journey.id, journey.driver_id, 1.0, 2.0, None)

    body = as_customer()
    t = body["tracking"]
    assert [s["step"] for s in t["steps"]] == ["PAID", "DRIVER_ASSIGNED"]
    assert t["driver_name"] == "Dana"
    assert t["restaurant"] == {"latitude": RESTAURANT[0], "longitude": RESTAURANT[1]}
    assert t["destination"] == {"latitude": HOME[0], "longitude": HOME[1]}
    assert t["driver_location"] is None
    # No PIN at a doorstep.
    assert body["pickup_pin"] is None


def test_on_the_road_the_customer_sees_where_the_driver_is(journey, as_customer):
    _ready_and_picked_up(journey)
    _send(journey.driver, lat=41.93, lng=-87.64, heading=45)

    t = as_customer()["tracking"]
    assert [s["step"] for s in t["steps"]] == ["PAID", "DRIVER_ASSIGNED", "READY", "PICKED_UP"]
    assert t["driver_location"]["latitude"] == pytest.approx(41.93)
    assert t["driver_location"]["heading"] == 45


def test_a_phone_that_went_quiet_shows_no_driver(journey, as_customer, monkeypatch):
    from app.config import settings

    _ready_and_picked_up(journey)
    _send(journey.driver)
    monkeypatch.setattr(settings, "DRIVER_LOCATION_STALE_SECONDS", -1)
    assert as_customer()["tracking"]["driver_location"] is None


def test_once_delivered_the_dot_is_gone_and_the_last_step_is_there(journey, as_customer):
    _ready_and_picked_up(journey)
    _send(journey.driver)
    assert journey.driver.post(f"/api/v1/restaurant/orders/{journey.order_id}/delivered").status_code == 200

    t = as_customer()["tracking"]
    assert t["steps"][-1]["step"] == "DELIVERED"
    assert t["driver_location"] is None


def test_the_arrival_time_is_asked_for_once_and_then_read_back(journey, as_customer, monkeypatch):
    """Billed per ask, so twenty polls inside the refresh window are one ask."""
    from app.core.ratelimit import runtime_redis
    from app.services import tracking

    runtime_redis().delete(f"tracking:eta:{journey.order_id}", f"tracking:eta:{journey.order_id}:claim")
    asked = []
    monkeypatch.setattr(tracking, "eta_configured", lambda: True)
    monkeypatch.setattr(tracking, "drive_seconds", lambda a, b: asked.append((a, b)) or 540)

    _ready_and_picked_up(journey)
    _send(journey.driver)

    # The first poll schedules the ask after its response; the next reads it.
    assert as_customer()["tracking"]["eta_seconds"] is None
    assert as_customer()["tracking"]["eta_seconds"] == 540
    as_customer()
    assert len(asked) == 1
    origin, target = asked[0]
    assert (target.latitude, target.longitude) == HOME


# ---------------------------------------------------------- Google Routes ---

def test_a_routes_duration_is_read_as_whole_seconds(monkeypatch):
    import httpx

    from app.config import settings
    from app.services import tracking
    from app.services.geocoding import Point

    monkeypatch.setattr(settings, "GOOGLE_MAPS_API_KEY", "server-key")
    sent = {}

    def fake_post(url, headers, json, timeout):
        sent.update(url=url, headers=headers)
        return httpx.Response(
            200, json={"routes": [{"duration": "754.4s"}]}, request=httpx.Request("POST", url)
        )

    monkeypatch.setattr(httpx, "post", fake_post)
    assert tracking.drive_seconds(Point(1, 2), Point(3, 4)) == 754
    # The key goes in a header, where no exception text can carry it.
    assert "server-key" not in sent["url"]
    assert sent["headers"]["X-Goog-Api-Key"] == "server-key"


def test_a_failed_routes_call_is_no_arrival_time(monkeypatch):
    import httpx

    from app.config import settings
    from app.services import tracking
    from app.services.geocoding import Point

    monkeypatch.setattr(settings, "GOOGLE_MAPS_API_KEY", "server-key")
    monkeypatch.setattr(
        httpx, "post",
        lambda url, **k: httpx.Response(403, request=httpx.Request("POST", url)),
    )
    assert tracking.drive_seconds(Point(1, 2), Point(3, 4)) is None
