"""Wrong passwords are counted against the account, not only the address.

The per-address limit alone let a password list spread over many addresses
guess at one owner's account without end. Each test here gets its own
budget size and turns the per-address limit off, so what is measured is the
account budget and nothing else.
"""

import uuid

import pytest

from app.core import ratelimit

from tests.test_admin_restaurants import (  # noqa: F401  (fixtures)
    _create,
    _email,
    _owner,
    _set_own_password,
    _staff_client,
    admin_user,
    cleanup,
)

pytestmark = pytest.mark.integration

PASSWORD = "the right password 12"


@pytest.fixture(autouse=True)
def small_budget(monkeypatch):
    # Every address is a different one as far as the per-address limit knows.
    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)
    monkeypatch.setattr(ratelimit, "SIGN_IN_FAILURES_PER_ACCOUNT", 3)


@pytest.fixture
def owner(admin_user, cleanup):
    restaurant = _create(admin_user, cleanup)
    email = _email()
    _owner(admin_user, restaurant.id, email)
    _set_own_password(email, PASSWORD)
    return restaurant.slug, email


def _sign_in(slug, email, password):
    return _staff_client(slug).post(
        "/api/v1/restaurant/login", json={"email": email, "password": password}
    )


def test_a_spent_account_refuses_even_the_right_password(owner):
    slug, email = owner
    for _ in range(3):
        assert _sign_in(slug, email, "wrong password 1234").status_code == 401

    res = _sign_in(slug, email, PASSWORD)
    assert res.status_code == 429
    assert res.json()["detail"]["code"] == "RATE_LIMITED"


def test_the_right_password_is_never_counted(owner):
    slug, email = owner
    for _ in range(5):
        assert _sign_in(slug, email, PASSWORD).status_code == 200


def test_one_account_being_attacked_leaves_the_others_alone(owner, admin_user, cleanup):
    slug, email = owner
    for _ in range(3):
        _sign_in(slug, email, "wrong password 1234")
    assert _sign_in(slug, email, PASSWORD).status_code == 429

    other = _email()
    second = _create(admin_user, cleanup)
    _owner(admin_user, second.id, other)
    _set_own_password(other, PASSWORD)
    assert _sign_in(second.slug, other, PASSWORD).status_code == 200


def test_an_unknown_address_is_answered_exactly_like_a_real_one(owner):
    """Otherwise the budget itself would say which addresses are accounts."""
    slug, email = owner
    ghost = f"nobody-{uuid.uuid4().hex[:8]}@zenoeats.invalid"
    real = [_sign_in(slug, email, "wrong password 1234") for _ in range(4)]
    fake = [_sign_in(slug, ghost, "wrong password 1234") for _ in range(4)]

    assert [r.status_code for r in real] == [401, 401, 401, 429]
    assert [r.status_code for r in fake] == [401, 401, 401, 429]
    assert real[0].json() == fake[0].json()
    assert real[3].json() == fake[3].json()


def test_the_budget_is_kept_under_a_key_that_is_not_the_address():
    bucket = ratelimit._account_bucket("staff_login", "Owner@Example.com ")
    assert "example" not in bucket.lower()
    assert bucket == ratelimit._account_bucket("staff_login", "owner@example.com")


def test_admin_sign_in_has_the_same_account_budget(monkeypatch):
    from fastapi.testclient import TestClient

    from app.main import app

    email = f"not-an-admin-{uuid.uuid4().hex[:8]}@zenoeats.invalid"
    client = TestClient(app, base_url="http://admin.zenoeats.local")
    codes = [
        client.post("/api/v1/admin/login", json={"email": email, "password": "wrong password 1234"}).status_code
        for _ in range(4)
    ]
    assert codes == [401, 401, 401, 429]
