"""Agreement to the terms survives the order it was given with.

The checkout page says, above the button, that continuing means agreeing. A
checkbox on a form answers that question only while the form is on screen;
what is asked later is whether a named person agreed, and to what wording.

These run against the real database because the point is what is on the row
afterwards, not what the endpoint returned.
"""

import uuid

import pytest
from sqlalchemy import text

from app.services import terms

from tests.test_admin_restaurants import (  # noqa: F401  (fixtures)
    admin_user,
    cleanup,
)
from tests.test_checkout_contact import (  # noqa: F401  (fixtures and helpers)
    CONTACT,
    _guest,
    _order,
    shop,
)
from tests.test_staff_removal import team  # noqa: F401  (fixture)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def no_rate_limits(monkeypatch):
    from app.core import ratelimit

    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)


def _customer(order_id):
    """The columns that record the agreement, for whoever placed this order."""
    from app.db.session import system_session

    with system_session() as session:
        return session.execute(
            text(
                "SELECT u.terms_accepted_at, u.terms_version "
                "FROM users u JOIN orders o ON o.customer_user_id = u.id "
                "WHERE o.id = :o"
            ),
            {"o": order_id},
        ).mappings().one()


def test_placing_an_order_records_the_agreement(shop):
    res = _order(_guest(shop), shop, contact=CONTACT)
    assert res.status_code == 201, res.text

    row = _customer(res.json()["order_id"])
    assert row["terms_version"] == terms.CURRENT_VERSION
    assert row["terms_accepted_at"] is not None


def test_the_recorded_moment_is_not_overwritten_by_later_orders(shop):
    """Re-agreeing to wording already agreed to is not a new agreement, and
    rewriting the timestamp would quietly move the date it happened."""
    client = _guest(shop)
    first = _order(client, shop, contact=CONTACT)
    assert first.status_code == 201, first.text
    stamped = _customer(first.json()["order_id"])["terms_accepted_at"]

    second = _order(client, shop, contact=CONTACT)
    assert second.status_code == 201, second.text
    assert _customer(second.json()["order_id"])["terms_accepted_at"] == stamped


def test_new_wording_is_recorded_on_the_next_order(shop, monkeypatch):
    """When the terms change, the next order re-agrees. Otherwise the record
    says someone agreed to wording they were never shown."""
    client = _guest(shop)
    first = _order(client, shop, contact=CONTACT)
    assert first.status_code == 201, first.text
    before = _customer(first.json()["order_id"])

    monkeypatch.setattr(terms, "CURRENT_VERSION", "2099-01-01")
    second = _order(client, shop, contact=CONTACT)
    assert second.status_code == 201, second.text

    after = _customer(second.json()["order_id"])
    assert after["terms_version"] == "2099-01-01"
    assert after["terms_accepted_at"] > before["terms_accepted_at"]


def test_an_order_still_goes_through_when_the_record_cannot_be_written(shop, monkeypatch):
    """An order the customer agreed to and is about to pay for must not fail
    because the note about it could not be saved."""
    def explode(*_args, **_kwargs):
        raise RuntimeError("the database said no")

    monkeypatch.setattr(terms, "system_session", explode)
    res = _order(_guest(shop), shop, contact=CONTACT)
    assert res.status_code == 201, res.text
    assert _customer(res.json()["order_id"])["terms_version"] is None


def test_the_two_columns_are_written_together_or_not_at_all(shop):
    """A timestamp naming no wording is not evidence of anything, so the
    database refuses the pair half-filled however it is reached."""
    import sqlalchemy.exc

    from app.db.session import system_session

    res = _order(_guest(shop), shop, contact=CONTACT)
    user_id = uuid.UUID(str(_customer_id(res.json()["order_id"])))

    with pytest.raises(sqlalchemy.exc.IntegrityError):
        with system_session() as session:
            session.execute(
                text("UPDATE users SET terms_version = NULL WHERE id = :u"),
                {"u": user_id},
            )


def _customer_id(order_id):
    from app.db.session import system_session

    with system_session() as session:
        return session.execute(
            text("SELECT customer_user_id FROM orders WHERE id = :o"), {"o": order_id}
        ).scalar_one()
