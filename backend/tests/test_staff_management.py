"""A restaurant admin can change a team member's role and reset a password.

Neither was possible from the portal. Changing a role meant removing someone
and inviting them again; a forgotten password could only be reset by the
super admin, because re-inviting leaves an existing login alone.

The reset is the dangerous one, so most of this file is about what it refuses:
your own password, another admin's, and a login shared with another
restaurant -- which would repeat the takeover the staff invitation allowed.
"""

from concurrent.futures import ThreadPoolExecutor

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
from tests.test_staff_removal import team  # noqa: F401  (fixture)

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def no_rate_limits(monkeypatch):
    from app.core import ratelimit

    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)


def _role(client, membership_id, role):
    return client.patch(f"/api/v1/restaurant/staff/{membership_id}", json={"role_code": role})


def _reset(client, membership_id):
    return client.post(f"/api/v1/restaurant/staff/{membership_id}/reset-password")


def _hash(user_id):
    from app.db.session import system_session

    with system_session() as session:
        return session.execute(
            text("SELECT password_hash FROM users WHERE id = :u"), {"u": user_id}
        ).scalar_one()


# ---------------------------------------------------------------- roles ---

def test_a_role_change_takes_effect_on_the_next_request(team):
    cook_id, cook = team.member("KITCHEN")
    cook_client = team.client(cook_id)
    assert cook_client.get("/api/v1/restaurant/reports").status_code == 403

    res = _role(team.owner, cook, "MANAGER")
    assert res.status_code == 200, res.text
    assert res.json()["role_code"] == "MANAGER"
    assert cook_client.get("/api/v1/restaurant/reports").status_code == 200

    assert _role(team.owner, cook, "CASHIER").status_code == 200
    assert cook_client.get("/api/v1/restaurant/reports").status_code == 403


def test_an_invitation_can_offer_a_different_role(team):
    _, invited = team.member("KITCHEN", status="INVITED")
    res = _role(team.owner, invited, "MANAGER")
    assert res.status_code == 200
    assert res.json() == {"id": str(invited), "role_code": "MANAGER", "status": "INVITED"}


def test_your_own_role_is_not_yours_to_change(team):
    _, second_admin = team.member("ADMIN")
    res = _role(team.owner, team.owner_membership, "MANAGER")
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "CANNOT_CHANGE_OWN_ROLE"
    assert team.active_admins() == 2
    assert team.status(second_admin) == "ACTIVE"


def test_bad_role_or_member_is_refused(team):
    _, cook = team.member("KITCHEN")
    assert _role(team.owner, cook, "OWNER").status_code == 422
    assert team.owner.delete(f"/api/v1/restaurant/staff/{cook}").status_code == 200
    assert _role(team.owner, cook, "MANAGER").status_code == 422  # removed


def test_two_admins_demoting_each_other_at_once_leave_one(team):
    """The same race removal has, through the other door."""
    from app.db.session import tenant_session

    for _ in range(5):
        a_user, a = team.member("ADMIN")
        b_user, b = team.member("ADMIN")
        with tenant_session(team.id) as session:
            session.execute(
                text("UPDATE restaurant_users SET status = 'REVOKED', revoked_at = now() "
                     "WHERE role_code = 'ADMIN' AND id NOT IN (:a, :b)"),
                {"a": a, "b": b},
            )

        with ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(_role, team.client(a_user), b, "KITCHEN")
            second = pool.submit(_role, team.client(b_user), a, "KITCHEN")
            codes = sorted([first.result().status_code, second.result().status_code])

        assert codes.count(200) == 1, codes
        assert team.active_admins() == 1


# ------------------------------------------------------ password resets ---

def test_a_reset_issues_a_new_password_and_ends_every_session(team):
    cook_id, cook = team.member("KITCHEN")
    signed_in = team.client(cook_id)
    assert signed_in.get("/api/v1/restaurant/orders").status_code == 200
    before = _hash(cook_id)

    res = _reset(team.owner, cook)
    assert res.status_code == 200, res.text
    temporary = res.json()["temporary_password"]
    assert temporary and _hash(cook_id) != before

    # The session from before the reset is over, on every device.
    assert signed_in.get("/api/v1/restaurant/orders").status_code == 401

    from app.db.session import system_session

    with system_session() as session:
        email = session.execute(
            text("SELECT email FROM users WHERE id = :u"), {"u": cook_id}
        ).scalar_one()
    fresh = team.client(cook_id)  # a cookie jar with nothing in it
    fresh.cookies.clear()
    login = fresh.post("/api/v1/restaurant/login", json={"email": email, "password": temporary})
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True
    old = fresh.post("/api/v1/restaurant/login", json={"email": email, "password": "staff password 12"})
    assert old.status_code == 401


def test_a_reset_is_refused_for_yourself_and_for_another_admin(team):
    res = _reset(team.owner, team.owner_membership)
    assert res.status_code == 409 and res.json()["detail"]["code"] == "CANNOT_RESET_OWN_PASSWORD"

    admin_id, admin = team.member("ADMIN")
    before = _hash(admin_id)
    res = _reset(team.owner, admin)
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "ADMIN_PASSWORD_RESET_BY_SUPPORT"
    assert _hash(admin_id) == before


def test_a_login_shared_with_another_restaurant_is_not_reset(team, admin_user, cleanup):
    """Resetting it would let this admin sign in at the other restaurant as
    that person: the takeover the invitation used to allow."""
    from app.db.base import utcnow
    from app.db.session import tenant_session
    from app.models import RestaurantUser

    cook_id, cook = team.member("KITCHEN")

    other = _create(admin_user, cleanup)
    with tenant_session(other.id) as session:
        session.add(RestaurantUser(
            restaurant_id=other.id, user_id=cook_id, role_code="MANAGER", status="ACTIVE",
            invited_at=utcnow(), accepted_at=utcnow(),
        ))
    before = _hash(cook_id)

    res = _reset(team.owner, cook)
    assert res.status_code == 409
    assert res.json()["detail"]["code"] == "LOGIN_SHARED_WITH_ANOTHER_RESTAURANT"
    assert _hash(cook_id) == before

    # Once they leave the other restaurant, the login is this one's alone again.
    with tenant_session(other.id) as session:
        session.execute(
            text("UPDATE restaurant_users SET status = 'REVOKED', revoked_at = now() "
                 "WHERE user_id = :u"),
            {"u": cook_id},
        )
    assert _reset(team.owner, cook).status_code == 200


def test_the_system_role_reads_only_who_and_whether_of_memberships():
    """Migration 0017 opens two columns, and nothing that says where or what."""
    from app.db.session import system_session

    with system_session() as session:
        def can(column, privilege="SELECT"):
            return session.execute(
                text("SELECT has_column_privilege('zenoeats_system', 'restaurant_users', "
                     ":c, :p)"),
                {"c": column, "p": privilege},
            ).scalar_one()

        assert can("user_id") and can("status")
        assert not can("restaurant_id")
        assert not can("role_code")
        assert not can("status", "UPDATE")
