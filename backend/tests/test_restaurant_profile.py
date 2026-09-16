"""A restaurant can edit its own record, and only its admin can.

Until now the only way to fix a trading name, a tagline or a pickup address
was to ask the platform. That is a support ticket for a typo, and it meant the
people who know the business could not correct it.

What the restaurant still cannot do is the interesting part: the subdomain is
printed on tables, the status has its own readiness gate, and the currency is
what existing orders are denominated in, so none of the three is an editable
field here. Nor can a restaurant quietly break its own tax -- the Stripe Tax
gate runs on the result of the edit, which is what stops a cleared city
becoming a wrong tax calculation on the next order.
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

URL = "/api/v1/restaurant/profile"


@pytest.fixture(autouse=True)
def no_rate_limits(monkeypatch):
    from app.core import ratelimit

    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)


def _row(restaurant_id, column):
    from app.db.session import tenant_session

    with tenant_session(restaurant_id) as session:
        return session.execute(
            text(f"SELECT {column} FROM restaurants WHERE id = :i"), {"i": restaurant_id}
        ).scalar_one()


# ------------------------------------------------------------- reading it ---

def test_an_admin_sees_the_profile_and_what_it_cannot_change(team):
    body = team.owner.get(URL).json()

    assert body["name"] and body["slug"] and body["currency"] == "USD"
    assert body["tax_mode"] == "FLAT"
    # Context, not fields: the screen needs these to say why Stripe Tax is
    # unavailable rather than offering a switch that will be refused.
    assert body["stripe_connected"] is False
    assert body["charges_enabled"] is False


@pytest.mark.parametrize("role", ["MANAGER", "KITCHEN", "CASHIER", "DRIVER"])
def test_nobody_but_an_admin_may_read_or_write_it(team, role):
    user_id, _ = team.member(role)
    client = team.client(user_id)

    assert client.get(URL).status_code == 403
    assert client.patch(URL, json={"name": "Renamed by a cook"}).status_code == 403


def test_another_restaurants_admin_sees_their_own(team, admin_user, cleanup):
    """The tenant comes from the Host header and the row from RLS, so the same
    session presented elsewhere cannot reach across."""
    other = _create(admin_user, cleanup)
    other_email = _email()
    owner, _ = _owner(admin_user, other.id, other_email)
    _set_own_password(other_email, "owner password 123")

    from app.core import staff_auth

    client = _staff_client(other.slug)
    client.cookies.set(staff_auth.SESSION_COOKIE, staff_auth.issue_session(owner.user_id))
    assert client.get(URL).json()["slug"] == other.slug


# ------------------------------------------------------------- writing it ---

def test_an_admin_can_correct_the_name_tagline_and_whether_it_is_open(team):
    res = team.owner.patch(URL, json={
        "name": "The Corner Kitchen",
        "tagline": "Since 1998",
        "accepting_orders": False,
    })
    assert res.status_code == 200, res.text
    assert res.json()["name"] == "The Corner Kitchen"

    assert _row(team.id, "name") == "The Corner Kitchen"
    assert _row(team.id, "accepting_orders") is False


def test_only_the_fields_sent_are_touched(team):
    team.owner.patch(URL, json={"name": "First", "tagline": "A tagline"})
    team.owner.patch(URL, json={"name": "Second"})

    assert _row(team.id, "name") == "Second"
    assert _row(team.id, "tagline") == "A tagline"

    # Null is how the tagline is cleared, and it is distinguishable from
    # leaving it out -- which is the whole reason this is a PATCH.
    team.owner.patch(URL, json={"tagline": None})
    assert _row(team.id, "tagline") is None


def test_an_empty_patch_is_refused_rather_than_reported_as_saved(team):
    res = team.owner.patch(URL, json={})
    assert res.status_code == 422
    assert "No changes" in res.json()["detail"]["message"]


def test_the_platforms_fields_are_refused_not_ignored(team):
    """Silently dropping them would read as a save that did nothing."""
    before = _row(team.id, "slug")
    for forbidden in ({"slug": "new-slug"}, {"status": "ACTIVE"}, {"currency": "EUR"}):
        assert team.owner.patch(URL, json=forbidden).status_code == 422
    assert _row(team.id, "slug") == before


def test_a_timezone_must_be_a_real_one(team):
    assert team.owner.patch(URL, json={"timezone": "Mars/Olympus"}).status_code == 422
    assert team.owner.patch(URL, json={"timezone": "Asia/Kolkata"}).status_code == 200
    assert _row(team.id, "timezone") == "Asia/Kolkata"


def test_a_blank_address_line_is_stored_as_nothing(team):
    """Otherwise the Stripe Tax gate below could be satisfied with a space."""
    team.owner.patch(URL, json={"address_line1": "  44 Main St  ", "address_city": "   "})
    assert _row(team.id, "address_line1") == "44 Main St"
    assert _row(team.id, "address_city") is None


def test_the_tax_rate_is_bounded(team):
    assert team.owner.patch(URL, json={"tax_rate_bps": 30001}).status_code == 422
    assert team.owner.patch(URL, json={"tax_rate_bps": -1}).status_code == 422
    assert team.owner.patch(URL, json={"tax_rate_bps": 875}).status_code == 200
    assert _row(team.id, "tax_rate_bps") == 875


# ------------------------------------------------------------ the tax gate ---

def test_stripe_tax_cannot_be_switched_on_without_an_address(team):
    res = team.owner.patch(URL, json={"tax_mode": "STRIPE_TAX"})
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "STRIPE_TAX_NOT_READY"
    assert _row(team.id, "tax_mode") == "FLAT"


def test_a_stripe_tax_restaurant_cannot_clear_the_address_it_taxes_at(team, monkeypatch):
    """The dangerous edit is the quiet one: nothing about deleting a city says
    'your tax will stop calculating', so the refusal has to."""
    from app.services import stripe_tax

    monkeypatch.setattr(stripe_tax, "settings_problems", lambda account: [])
    _connect_stripe(team.id)

    full_address = {
        "address_line1": "44 Main St", "address_city": "Chicago",
        "address_state": "IL", "address_postal_code": "60614", "address_country": "us",
    }
    assert team.owner.patch(URL, json={**full_address, "tax_mode": "STRIPE_TAX"}).status_code == 200
    assert _row(team.id, "address_country") == "US"   # normalised on the way in

    res = team.owner.patch(URL, json={"address_city": ""})
    assert res.status_code == 409
    assert "city" in res.json()["detail"]["message"].lower()
    assert _row(team.id, "address_city") == "Chicago"


def test_a_flat_rate_restaurant_is_never_blocked_by_stripe(team):
    """Its tax needs a number and nothing else, so the gate must not apply."""
    assert team.owner.patch(URL, json={"address_city": "Chicago"}).status_code == 200
    assert team.owner.patch(URL, json={"address_line1": None}).status_code == 200


# ---------------------------------------------------------------- the trail ---

def test_a_profile_change_is_written_down(team):
    team.owner.patch(URL, json={"tax_rate_bps": 625})

    from app.db.session import system_session

    with system_session() as session:
        scope = session.execute(
            text(
                "SELECT scope FROM platform_audit_logs "
                "WHERE action = 'RESTAURANT_UPDATE_PROFILE' AND actor_user_id = :u "
                "ORDER BY created_at DESC LIMIT 1"
            ),
            {"u": team.owner_id},
        ).scalar_one()

    assert scope["restaurant_id"] == str(team.id)
    assert scope["fields"] == ["tax_rate_bps"]


def _connect_stripe(restaurant_id):
    """A connected account, so the Stripe Tax gate gets past 'no account'."""
    from app.db.session import tenant_session

    with tenant_session(restaurant_id) as session:
        session.execute(
            text(
                "INSERT INTO restaurant_payment_accounts "
                "(id, restaurant_id, provider, stripe_account_id, charges_enabled, "
                " payouts_enabled, details_submitted, onboarding_status, created_at, updated_at) "
                "VALUES (gen_random_uuid(), :r, 'STRIPE', :a, true, true, true, 'COMPLETE', "
                " now(), now())"
            ),
            {"r": restaurant_id, "a": f"acct_test_{str(restaurant_id)[:8]}"},
        )
