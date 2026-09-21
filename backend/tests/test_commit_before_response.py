"""A write is committed before its caller is told it succeeded.

The database session is a dependency with yield, and FastAPI closes those
after the response has been sent -- and after any background task has run. So
the commit landed after the caller already held a 201, and anything that acted
on that answer could look for a row that was not there yet. Found live: an
invited cook signing in a second after the invitation was refused as having no
membership, because queueing the invitation email to Celery took a few seconds
and the commit waited behind it.

scope="function" closes the session as soon as the endpoint returns, before the
response leaves. deps.TenantDb and deps.StaffDb carry that scope, and these
tests fail if an endpoint stops using them.
"""

import uuid

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import text

from app.api import deps
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

SESSION_DEPENDENCIES = {deps.tenant_db, deps.tenant_db_staff}


def _routers():
    from app.api.v1 import orders, portal, restaurant

    return [("orders", orders.router), ("portal", portal.router), ("restaurant", restaurant.router)]


def _session_scopes(dependant):
    """Every scope the session dependency is asked for under one endpoint."""
    for dep in dependant.dependencies:
        if dep.call in SESSION_DEPENDENCIES:
            yield dep.call.__name__, dep.scope
        yield from _session_scopes(dep)


def test_every_endpoint_asks_for_its_session_with_scope_function():
    wrong = []
    for name, router in _routers():
        for route in router.routes:
            if not isinstance(route, APIRoute):
                continue
            for call_name, scope in _session_scopes(route.dependant):
                if scope != "function":
                    wrong.append(f"{name}: {sorted(route.methods)} {route.path} takes "
                                 f"{call_name} with scope {scope!r}")
    assert not wrong, (
        "These endpoints would commit after their response is sent. Use "
        "deps.StaffDb or deps.TenantDb:\n" + "\n".join(wrong)
    )


def test_no_endpoint_mixes_the_two_scopes():
    """FastAPI caches a dependency per request by scope as well as by callable,
    so one endpoint asking both ways would run two transactions at once."""
    mixed = []
    for name, router in _routers():
        for route in router.routes:
            if not isinstance(route, APIRoute):
                continue
            by_call: dict = {}
            for call_name, scope in _session_scopes(route.dependant):
                by_call.setdefault(call_name, set()).add(scope)
            for call_name, scopes in by_call.items():
                if len(scopes) > 1:
                    mixed.append(f"{name}: {route.path} takes {call_name} as {scopes}")
    assert not mixed, "\n".join(mixed)


@pytest.mark.integration
def test_a_background_task_already_sees_what_the_request_wrote(admin_user, cleanup, monkeypatch):
    """The invitation email is queued from a background task, which runs after
    the response. It -- and the invitee signing in behind it -- must find the
    membership the request just wrote."""
    from app.api.v1 import restaurant as restaurant_api
    from app.db.session import tenant_session

    shop = _create(admin_user, cleanup)
    owner_email = _email()
    owner, _ = _owner(admin_user, shop.id, owner_email)
    _set_own_password(owner_email, "owner password 123")

    seen = {}

    def spy(restaurant_id, membership_id, temporary_password=None):
        with tenant_session(restaurant_id) as session:
            seen["status"] = session.execute(
                text("SELECT status FROM restaurant_users WHERE id = :i"), {"i": membership_id}
            ).scalar_one_or_none()

    monkeypatch.setattr(restaurant_api, "_queue_staff_invitation", spy)

    client = _staff_client(shop.slug)
    client.cookies.set(staff_auth.SESSION_COOKIE, staff_auth.issue_session(owner.user_id))
    invited = f"cook-{uuid.uuid4().hex[:8]}@zenoeats.invalid"
    res = client.post("/api/v1/restaurant/staff", json={"email": invited, "role_code": "KITCHEN"})

    assert res.status_code == 201, res.text
    assert seen.get("status") == "INVITED", (
        "the background task ran before the invitation was committed: "
        f"it read {seen.get('status')!r}"
    )

    # And the invitee can sign in straight away, which is what failed live.
    fresh = _staff_client(shop.slug)
    login = fresh.post(
        "/api/v1/restaurant/login",
        json={"email": invited, "password": res.json()["temporary_password"]},
    )
    assert login.status_code == 200, login.text
    assert login.json()["membership_status"] == "INVITED"
