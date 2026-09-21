"""The presentation switch is a platform decision, never a staff capability."""

import pytest
from sqlalchemy import select, text

from app.api.v1.admin import update_restaurant
from app.db.session import system_session, tenant_session
from app.models import ItemType, Restaurant
from app.schemas.api import UpdateRestaurantIn
from tests.test_admin_restaurants import admin_user, cleanup  # noqa: F401
from tests.test_staff_removal import team  # noqa: F401

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def no_rate_limits(monkeypatch):
    from app.core import ratelimit
    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)


def requests(client, type_id):
    return [
        client.get("/api/v1/restaurant/storefront"),
        client.patch("/api/v1/restaurant/storefront/theme", json={"theme": None}),
        client.put("/api/v1/restaurant/storefront/banners", json={"banners": []}),
        client.patch(f"/api/v1/restaurant/item-types/{type_id}/storefront", json={"show_in_shortcuts": False}),
        client.put("/api/v1/restaurant/storefront/collections", json={"collections": []}),
    ]


@pytest.mark.parametrize("role", ["ADMIN", "MANAGER", "KITCHEN", "CASHIER", "DRIVER"])
def test_every_endpoint_enforces_the_role_and_gate(team, role, admin_user):
    user, _ = team.member(role)
    client = team.client(user)
    with tenant_session(team.id) as db:
        type_id = db.scalar(select(ItemType.id))
    assert all(response.status_code == 403 for response in requests(client, type_id))
    result = update_restaurant(team.id, UpdateRestaurantIn(storefront_customization_enabled=True), admin_user)
    assert result.storefront_customization_enabled
    expected = 200 if role in ("ADMIN", "MANAGER") else 403
    for response in requests(client, type_id):
        assert response.status_code == expected, response.text
    assert client.get("/api/v1/restaurant/me").json()["storefront_customization_enabled"]
    with system_session() as db:
        scope = db.execute(text("SELECT scope FROM platform_audit_logs WHERE action = 'SUPER_ADMIN_UPDATE_RESTAURANT' AND scope->>'restaurant_id' = :id ORDER BY created_at DESC"), {"id": str(team.id)}).scalar()
        assert "storefront_customization_enabled" in scope["fields"]
    # Even an owner cannot smuggle the switch through the restaurant profile.
    assert team.owner.patch("/api/v1/restaurant/profile", json={"storefront_customization_enabled": False}).status_code == 422


def test_gate_off_portal_is_null_and_upload_is_refused(team):
    with tenant_session(team.id) as db:
        db.get(Restaurant, team.id).status = "ACTIVE"
    public = team.owner.get("/api/v1/portal")
    assert public.status_code == 200, public.text
    assert public.json()["storefront"] is None
    upload = team.owner.post("/api/v1/restaurant/images?kind=banners", files={"file": ("photo.png", b"unused", "image/png")})
    assert upload.status_code == 403
