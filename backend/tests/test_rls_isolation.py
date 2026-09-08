"""Mandatory negative RLS test (section 19.2).

Executes at the database layer as tenant A while requesting tenant B's data,
with application authorization entirely out of the picture. The query must
return zero protected rows.

If this test ever passes trivially because RLS was disabled, the privilege
assertions below will catch it.

Requires a live database. Run with:
    docker compose exec api pytest tests/test_rls_isolation.py -v
"""

import uuid

import pytest
from sqlalchemy import text

from app.db.base import utcnow
from app.db.session import system_session, tenant_session
from app.models import Meal, Restaurant, RestaurantStatus

pytestmark = pytest.mark.integration


@pytest.fixture
def two_tenants():
    a_slug = f"rls-a-{uuid.uuid4().hex[:8]}"
    b_slug = f"rls-b-{uuid.uuid4().hex[:8]}"
    with system_session() as session:
        a = Restaurant(slug=a_slug, name="Tenant A", status=RestaurantStatus.ACTIVE.value,
                       timezone="UTC", currency="USD")
        b = Restaurant(slug=b_slug, name="Tenant B", status=RestaurantStatus.ACTIVE.value,
                       timezone="UTC", currency="USD")
        session.add_all([a, b])
        session.flush()
        ids = (a.id, b.id)

    with tenant_session(ids[1]) as session:
        session.add(Meal(restaurant_id=ids[1], name="Tenant B Secret Menu"))

    yield ids

    # Cleanup runs as the tenant role, not the system role. zenoeats_system
    # deliberately has no grant on meals and no DELETE on restaurants -- that
    # narrow surface is exactly what test_system_role_cannot_mutate_tenant_
    # business_tables asserts, so the fixture has to respect it too. Tearing
    # down through system_session raised InsufficientPrivilege, which left
    # every fixture restaurant behind on a real database.
    for rid in ids:
        with tenant_session(rid) as session:
            session.execute(text("DELETE FROM meals WHERE restaurant_id = :r"), {"r": rid})
            session.execute(text("DELETE FROM restaurants WHERE id = :r"), {"r": rid})


def test_tenant_a_cannot_read_tenant_b_rows(two_tenants):
    """The core negative test. No application filter, no WHERE clause on
    restaurant_id. RLS alone must return nothing."""
    a_id, b_id = two_tenants

    with tenant_session(a_id) as session:
        rows = session.execute(
            text("SELECT id, name FROM meals WHERE restaurant_id = :b"), {"b": b_id}
        ).all()
        assert rows == [], "RLS leak: tenant A read tenant B's menu"

        # Also unfiltered: A should see only its own rows, which is none.
        all_rows = session.execute(text("SELECT count(*) FROM meals")).scalar_one()
        assert all_rows == 0


def test_tenant_a_cannot_write_into_tenant_b(two_tenants):
    """WITH CHECK must block a forged restaurant_id on insert."""
    from sqlalchemy.exc import ProgrammingError

    a_id, b_id = two_tenants
    with pytest.raises(Exception) as exc_info:
        with tenant_session(a_id) as session:
            session.execute(
                text(
                    "INSERT INTO meals (id, restaurant_id, name, sort_order, is_active, "
                    "created_at, updated_at) "
                    "VALUES (gen_random_uuid(), :b, 'injected', 0, true, now(), now())"
                ),
                {"b": b_id},
            )
    assert "row-level security" in str(exc_info.value).lower() or isinstance(
        exc_info.value, ProgrammingError
    )


def test_tenant_root_is_scoped(two_tenants):
    a_id, b_id = two_tenants
    with tenant_session(a_id) as session:
        assert session.get(Restaurant, b_id) is None
        assert session.get(Restaurant, a_id) is not None


def test_no_runtime_role_has_bypassrls():
    """CI privilege gate. Rule 18."""
    with system_session() as session:
        rows = session.execute(
            text(
                "SELECT rolname, rolbypassrls FROM pg_roles "
                "WHERE rolname IN ('zenoeats_app','zenoeats_system','zenoeats_migrate')"
            )
        ).all()
    assert len(rows) == 3, "expected all three roles to exist"
    for role in rows:
        assert role.rolbypassrls is False, f"{role.rolname} has BYPASSRLS"


def test_app_role_is_not_a_table_owner():
    """zenoeats_app must be a non-owner so FORCE RLS binds it."""
    with system_session() as session:
        owners = session.execute(
            text(
                "SELECT tablename, tableowner FROM pg_tables "
                "WHERE schemaname = 'public'"
            )
        ).all()
    for row in owners:
        assert row.tableowner not in ("zenoeats_app", "zenoeats_system"), (
            f"{row.tablename} is owned by a runtime role"
        )


def test_system_role_cannot_mutate_tenant_business_tables():
    """System-role allowlist gate. Discovery only, no tenant mutation."""
    with system_session() as session:
        can_update = session.execute(
            text("SELECT has_table_privilege('zenoeats_system', 'orders', 'UPDATE')")
        ).scalar_one()
        assert can_update is False, "system role must not be able to UPDATE orders"

        can_insert = session.execute(
            text("SELECT has_table_privilege('zenoeats_system', 'menu_items', 'INSERT')")
        ).scalar_one()
        assert can_insert is False, "system role must not be able to INSERT menu items"
