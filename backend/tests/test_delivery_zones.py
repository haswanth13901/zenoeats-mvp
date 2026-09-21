"""Where a restaurant delivers, and what it charges by distance.

The groundwork for a customer choosing delivery and paying for it: the
restaurant's own address placed on a map, and rings around it with a fee each.

Two things this file is mostly about. A fee is only ever as right as the
coordinates behind it, so delivery refuses to switch on until there is
something to quote with -- and an address edited afterwards drops the
coordinates rather than going on measuring from the old premises. Nothing
about editing a street says "your delivery fees are now wrong", so the code
has to say it instead.

No test here reaches Google. The provider is faked; what is tested is what we
do with its answers, including the answer "I cannot".
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
def placed(team, monkeypatch):
    """A restaurant with an address, placed on the map, and one ring."""
    _fake_geocoder(monkeypatch, lat=41.9227, lng=-87.6431)
    team.owner.patch(PROFILE, json=ADDRESS)
    team.owner.post(LOCATE)
    team.owner.put(ZONES, json={"zones": [{"max_miles": 3, "fee_minor": 400}]})
    return team


def _fake_geocoder(monkeypatch, lat=41.9227, lng=-87.6431, answer="ok"):
    """Stand in for Google. `answer` is ok, missing, or unavailable."""
    from app.services import geocoding

    monkeypatch.setattr(geocoding, "configured", lambda: True)

    def fake(address):
        if answer == "unavailable":
            raise geocoding.GeocodingUnavailable("Could not reach the geocoding service.")
        if answer == "missing":
            return None
        return geocoding.Point(latitude=lat, longitude=lng)

    monkeypatch.setattr(geocoding, "geocode", fake)


# ------------------------------------------------------------- distance ---

def test_the_distance_between_two_points_is_about_right():
    """Checked against a known pair. The Loop to O'Hare is about 15.7 miles as
    the crow flies -- the ~17 miles people quote is the drive, which is the
    difference this whole approach accepts."""
    from app.services.geocoding import Point, miles_between

    loop = Point(41.8781, -87.6298)
    ohare = Point(41.9742, -87.9073)

    assert 15.0 < miles_between(loop, ohare) < 16.5
    assert miles_between(loop, loop) == 0


# ---------------------------------------------------------- placing it ---

def test_placing_the_restaurant_stores_where_it_is(team, monkeypatch):
    _fake_geocoder(monkeypatch, lat=41.9227, lng=-87.6431)
    team.owner.patch(PROFILE, json=ADDRESS)

    body = team.owner.post(LOCATE).json()
    assert (round(body["latitude"], 4), round(body["longitude"], 4)) == (41.9227, -87.6431)
    assert body["origin_is_current"] is True
    assert body["geocoded_address"].startswith("44 Main St")


def test_an_address_the_map_does_not_know_is_refused(team, monkeypatch):
    _fake_geocoder(monkeypatch, answer="missing")
    team.owner.patch(PROFILE, json=ADDRESS)

    res = team.owner.post(LOCATE)
    assert res.status_code == 422
    assert res.json()["detail"]["code"] == "ADDRESS_NOT_FOUND"


def test_a_provider_that_is_down_is_not_a_bad_address(team, monkeypatch):
    """One is our problem and worth retrying; the other is the customer's and
    is not. They must not answer the same way."""
    _fake_geocoder(monkeypatch, answer="unavailable")
    team.owner.patch(PROFILE, json=ADDRESS)

    res = team.owner.post(LOCATE)
    assert res.status_code == 503
    assert res.json()["detail"]["code"] == "GEOCODING_UNAVAILABLE"


def test_there_is_nothing_to_place_without_an_address(team, monkeypatch):
    _fake_geocoder(monkeypatch)
    assert team.owner.post(LOCATE).status_code == 422


def test_moving_the_restaurant_forgets_where_it_was(placed):
    """The dangerous one. Coordinates left behind after an address change
    would charge every customer the distance to the old premises, and nothing
    about editing a street says so."""
    assert placed.owner.get(DELIVERY).json()["origin_is_current"] is True

    placed.owner.patch(PROFILE, json={"address_line1": "9 Elm Road"})

    body = placed.owner.get(DELIVERY).json()
    assert body["latitude"] is None
    assert body["origin_is_current"] is False
    assert body["delivery_available"] is False
    assert "Place the restaurant on the map" in " ".join(body["blockers"])


def test_editing_something_that_is_not_the_address_leaves_it_placed(placed):
    placed.owner.patch(PROFILE, json={"tagline": "Now with delivery"})
    assert placed.owner.get(DELIVERY).json()["origin_is_current"] is True


# --------------------------------------------------------------- rings ---

def test_rings_come_back_in_order_whatever_order_they_were_sent(placed):
    body = placed.owner.put(ZONES, json={"zones": [
        {"max_miles": 5, "fee_minor": 700},
        {"max_miles": 1.5, "fee_minor": 300},
        {"max_miles": 3, "fee_minor": 500},
    ]}).json()

    assert [z["max_miles"] for z in body["zones"]] == [1.5, 3, 5]
    assert [z["fee_minor"] for z in body["zones"]] == [300, 500, 700]


def test_saving_the_set_replaces_it(placed):
    placed.owner.put(ZONES, json={"zones": [
        {"max_miles": 2, "fee_minor": 300}, {"max_miles": 4, "fee_minor": 600},
    ]})
    body = placed.owner.put(ZONES, json={"zones": [{"max_miles": 2, "fee_minor": 350}]}).json()

    assert len(body["zones"]) == 1
    assert body["zones"][0]["fee_minor"] == 350


def test_two_rings_cannot_end_at_the_same_distance(placed):
    """The band between them would be empty and the cheaper one unreachable."""
    res = placed.owner.put(ZONES, json={"zones": [
        {"max_miles": 3, "fee_minor": 400}, {"max_miles": 3, "fee_minor": 600},
    ]})
    assert res.status_code == 422
    assert "same distance" in res.json()["detail"]["message"]


def test_a_free_ring_is_allowed_and_a_negative_one_is_not(placed):
    assert placed.owner.put(ZONES, json={
        "zones": [{"max_miles": 1, "fee_minor": 0}]
    }).status_code == 200
    assert placed.owner.put(ZONES, json={
        "zones": [{"max_miles": 1, "fee_minor": -100}]
    }).status_code == 422
    assert placed.owner.put(ZONES, json={
        "zones": [{"max_miles": 0, "fee_minor": 100}]
    }).status_code == 422


def test_there_is_a_limit_to_how_many_rings(placed):
    too_many = [{"max_miles": n, "fee_minor": 100} for n in range(1, 11)]
    assert placed.owner.put(ZONES, json={"zones": too_many}).status_code == 422


# ------------------------------------------------------ the switch ---

def test_delivery_will_not_switch_on_without_somewhere_to_measure_from(team, monkeypatch):
    _fake_geocoder(monkeypatch)
    team.owner.patch(PROFILE, json=ADDRESS)
    team.owner.put(ZONES, json={"zones": [{"max_miles": 3, "fee_minor": 400}]})

    res = team.owner.patch(DELIVERY, json={"delivery_enabled": True})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "DELIVERY_NOT_READY"
    assert team.owner.get(DELIVERY).json()["delivery_enabled"] is False


def test_delivery_will_not_switch_on_without_a_ring_to_charge(team, monkeypatch):
    _fake_geocoder(monkeypatch)
    team.owner.patch(PROFILE, json=ADDRESS)
    team.owner.post(LOCATE)

    res = team.owner.patch(DELIVERY, json={"delivery_enabled": True})
    assert res.status_code == 409
    assert "ring" in res.json()["detail"]["message"]


def test_with_both_it_switches_on(placed):
    body = placed.owner.patch(DELIVERY, json={"delivery_enabled": True}).json()

    assert body["delivery_enabled"] is True
    assert body["delivery_available"] is True
    assert body["blockers"] == []


def test_the_last_ring_cannot_be_removed_while_delivery_is_on(placed):
    placed.owner.patch(DELIVERY, json={"delivery_enabled": True})

    res = placed.owner.put(ZONES, json={"zones": []})
    assert res.status_code == 409
    assert len(placed.owner.get(DELIVERY).json()["zones"]) == 1

    # Off first, then it is allowed.
    placed.owner.patch(DELIVERY, json={"delivery_enabled": False})
    assert placed.owner.put(ZONES, json={"zones": []}).status_code == 200


def test_switching_off_never_argues(placed):
    placed.owner.patch(DELIVERY, json={"delivery_enabled": True})
    assert placed.owner.patch(DELIVERY, json={"delivery_enabled": False}).status_code == 200


def test_a_restaurant_that_moves_stops_delivering_until_it_is_placed_again(placed):
    """Switched on stays switched on, but nothing is quoted from a position we
    no longer believe: the safe way round is no delivery, not a wrong fee."""
    placed.owner.patch(DELIVERY, json={"delivery_enabled": True})
    placed.owner.patch(PROFILE, json={"address_line1": "9 Elm Road"})

    body = placed.owner.get(DELIVERY).json()
    assert body["delivery_enabled"] is True
    assert body["delivery_available"] is False


def test_the_screen_is_told_when_no_provider_is_configured(team, monkeypatch):
    """Otherwise it offers a button that cannot work."""
    from app.services import geocoding

    monkeypatch.setattr(geocoding, "configured", lambda: False)
    assert team.owner.get(DELIVERY).json()["geocoding_configured"] is False


# ---------------------------------------------------------------- who ---

@pytest.mark.parametrize("role", ["MANAGER", "KITCHEN", "CASHIER", "DRIVER"])
def test_only_an_admin_may_see_or_change_any_of_it(team, role):
    user_id, _ = team.member(role)
    client = team.client(user_id)

    assert client.get(DELIVERY).status_code == 403
    assert client.patch(DELIVERY, json={"delivery_enabled": True}).status_code == 403
    assert client.post(LOCATE).status_code == 403
    assert client.put(ZONES, json={"zones": []}).status_code == 403


def test_rings_belong_to_one_restaurant(placed, admin_user, cleanup, monkeypatch):
    """RLS, not a filter someone remembered to write."""
    from app.core import staff_auth

    other = _create(admin_user, cleanup)
    other_email = _email()
    owner, _ = _owner(admin_user, other.id, other_email)
    _set_own_password(other_email, "owner password 123")

    client = _staff_client(other.slug)
    client.cookies.set(staff_auth.SESSION_COOKIE, staff_auth.issue_session(owner.user_id))

    assert client.get(DELIVERY).json()["zones"] == []
    assert len(placed.owner.get(DELIVERY).json()["zones"]) == 1


def test_the_rows_carry_the_tenant(placed):
    from app.db.session import tenant_session

    with tenant_session(placed.id) as session:
        owners = session.execute(
            text("SELECT DISTINCT restaurant_id FROM delivery_zones")
        ).scalars().all()
    assert owners == [placed.id]
