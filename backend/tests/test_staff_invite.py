"""A restaurant's staff invitation never touches an existing account's password.

Inviting an address used to reissue the password of any staff login that had
not yet replaced its temporary one, and hand it to the restaurant that sent
the invitation. A brand-new owner is exactly such a login -- so the admin of
one restaurant could invite another restaurant's new owner, receive a working
password, and sign in to that restaurant as its ADMIN.
"""

import pytest
from sqlalchemy import text

from app.core import staff_auth

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


@pytest.fixture(autouse=True)
def no_rate_limits(monkeypatch):
    from app.core import ratelimit

    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)


def _signed_in(slug, email):
    """A staff client for an account that has already chosen its password."""
    from app.db.session import system_session

    with system_session() as session:
        user_id = session.execute(
            text("SELECT id FROM users WHERE email = :e AND kind = 'STAFF'"), {"e": email}
        ).scalar_one()
    client = _staff_client(slug)
    client.cookies.set(staff_auth.SESSION_COOKIE, staff_auth.issue_session(user_id))
    return client


def _password_hash(email):
    from app.db.session import system_session

    with system_session() as session:
        return session.execute(
            text("SELECT password_hash FROM users WHERE email = :e AND kind = 'STAFF'"), {"e": email}
        ).scalar_one()


def test_another_restaurant_cannot_take_over_a_new_owner(admin_user, cleanup):
    attacker = _create(admin_user, cleanup)
    victim = _create(admin_user, cleanup)

    attacker_owner = _email()
    _owner(admin_user, attacker.id, attacker_owner)
    _set_own_password(attacker_owner, "attacker password 123")

    # The victim's owner has been issued a temporary password but not used it.
    victim_owner = _email()
    issued, _ = _owner(admin_user, victim.id, victim_owner)
    before = _password_hash(victim_owner)

    invite = _signed_in(attacker.slug, attacker_owner).post(
        "/api/v1/restaurant/staff", json={"email": victim_owner, "role_code": "CASHIER"}
    )
    assert invite.status_code == 201, invite.text
    assert invite.json()["temporary_password"] is None

    # Nothing about the victim's account changed.
    assert _password_hash(victim_owner) == before
    login = _staff_client(victim.slug).post(
        "/api/v1/restaurant/login",
        json={"email": victim_owner, "password": issued.temporary_password},
    )
    assert login.status_code == 200
    assert login.json()["role_code"] == "ADMIN"


def test_inviting_an_active_member_is_refused_and_changes_nothing(admin_user, cleanup):
    restaurant = _create(admin_user, cleanup)
    owner = _email()
    _owner(admin_user, restaurant.id, owner)
    _set_own_password(owner, "owner password 123")

    # A second admin, still holding a temporary password.
    colleague = _email()
    client = _signed_in(restaurant.slug, owner)
    first = client.post("/api/v1/restaurant/staff", json={"email": colleague, "role_code": "ADMIN"})
    assert first.status_code == 201 and first.json()["temporary_password"]
    from app.db.session import tenant_session

    with tenant_session(restaurant.id) as session:
        session.execute(
            text("UPDATE restaurant_users SET status = 'ACTIVE' WHERE id = :i"),
            {"i": first.json()["id"]},
        )
    before = _password_hash(colleague)

    again = client.post("/api/v1/restaurant/staff", json={"email": colleague, "role_code": "KITCHEN"})
    assert again.status_code == 409
    assert _password_hash(colleague) == before


def test_a_new_address_still_gets_a_temporary_password(admin_user, cleanup):
    restaurant = _create(admin_user, cleanup)
    owner = _email()
    _owner(admin_user, restaurant.id, owner)
    _set_own_password(owner, "owner password 123")

    invite = _signed_in(restaurant.slug, owner).post(
        "/api/v1/restaurant/staff", json={"email": _email(), "role_code": "KITCHEN"}
    )
    assert invite.status_code == 201
    assert invite.json()["temporary_password"]


def test_the_super_admin_can_give_a_passwordless_invitee_a_login(admin_user, cleanup):
    """A placeholder account is never given a password by a restaurant, so the
    super admin reset has to reach it or the invitee could never sign in."""
    from app.api.v1.admin import reset_owner_password
    from app.db.session import system_session
    from app.models import User, UserKind
    from app.schemas.api import CreateOwnerIn

    restaurant = _create(admin_user, cleanup)
    owner = _email()
    _owner(admin_user, restaurant.id, owner)
    _set_own_password(owner, "owner password 123")

    placeholder = _email()
    with system_session() as session:
        session.add(User(kind=UserKind.STAFF.value, email=placeholder))

    invite = _signed_in(restaurant.slug, owner).post(
        "/api/v1/restaurant/staff", json={"email": placeholder, "role_code": "KITCHEN"}
    )
    assert invite.status_code == 201
    assert invite.json()["temporary_password"] is None

    out = reset_owner_password(restaurant.id, CreateOwnerIn(email=placeholder), admin=admin_user)
    assert out.temporary_password
    login = _staff_client(restaurant.slug).post(
        "/api/v1/restaurant/login", json={"email": placeholder, "password": out.temporary_password}
    )
    assert login.status_code == 200
    assert login.json()["membership_status"] == "INVITED"
