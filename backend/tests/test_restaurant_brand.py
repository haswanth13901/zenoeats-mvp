"""The restaurant's logo and name, set in Settings and shown to customers.

The brand is identity, not theme: it is shown whether or not the platform has
switched storefront customization on, so a restaurant on the plain storefront
can still replace the initial in the header with its own logo.
"""

import io

import pytest
from PIL import Image
from sqlalchemy import text

from app.db.session import tenant_session
from app.models import Restaurant
from tests.test_admin_restaurants import admin_user, cleanup  # noqa: F401
from tests.test_staff_removal import team  # noqa: F401

pytestmark = pytest.mark.integration


@pytest.fixture(autouse=True)
def no_rate_limits(monkeypatch):
    from app.core import ratelimit

    monkeypatch.setattr(ratelimit, "_consume", lambda *a, **k: None)


@pytest.fixture(autouse=True)
def image_dir(monkeypatch, tmp_path):
    from app.services import images

    monkeypatch.setattr(images.settings, "IMAGES_DIR", tmp_path)
    return tmp_path


def _png(size=(64, 64)):
    buffer = io.BytesIO()
    Image.new("RGBA", size, (10, 120, 60, 255)).save(buffer, "PNG")
    return buffer.getvalue()


def _upload(client, kind="branding"):
    res = client.post(
        f"/api/v1/restaurant/images?kind={kind}",
        files={"file": ("logo.png", _png(), "image/png")},
    )
    assert res.status_code == 201, res.text
    return res.json()["image_path"]


def _activate(restaurant_id):
    with tenant_session(restaurant_id) as db:
        db.get(Restaurant, restaurant_id).status = "ACTIVE"


def test_the_brand_is_set_in_settings_and_shown_without_customization(team, image_dir):
    _activate(team.id)
    logo = _upload(team.owner)
    lettering = _upload(team.owner)

    res = team.owner.patch("/api/v1/restaurant/profile", json={
        "logo_path": logo, "brand_name_image_path": lettering, "brand_name_font": "playfair",
    })
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["logo_path"] == logo and body["logo_url"]
    assert body["brand_name_image_path"] == lettering and body["brand_name_image_url"]
    assert body["brand_name_font"] == "playfair"

    portal = team.owner.get("/api/v1/portal").json()
    assert portal["storefront"] is None  # customization is still off
    assert portal["brand"] == {
        "logo_url": body["logo_url"],
        "name_image_url": body["brand_name_image_url"],
        "name_font": "playfair",
    }


def test_a_restaurant_with_no_brand_shows_the_default(team):
    _activate(team.id)
    assert team.owner.get("/api/v1/portal").json()["brand"] == {
        "logo_url": None, "name_image_url": None, "name_font": "default",
    }


def test_replacing_a_logo_deletes_the_old_file_and_clearing_it_goes_back(team, image_dir):
    first = _upload(team.owner)
    assert team.owner.patch("/api/v1/restaurant/profile", json={"logo_path": first}).status_code == 200
    second = _upload(team.owner)
    assert team.owner.patch("/api/v1/restaurant/profile", json={"logo_path": second}).status_code == 200
    assert not (image_dir / first).exists()
    assert (image_dir / second).exists()

    cleared = team.owner.patch("/api/v1/restaurant/profile", json={"logo_path": None})
    assert cleared.status_code == 200 and cleared.json()["logo_url"] is None
    assert not (image_dir / second).exists()


def test_the_same_file_as_logo_and_lettering_survives_losing_one(team, image_dir):
    key = _upload(team.owner)
    team.owner.patch("/api/v1/restaurant/profile", json={"logo_path": key, "brand_name_image_path": key})
    assert team.owner.patch("/api/v1/restaurant/profile", json={"logo_path": None}).status_code == 200
    assert (image_dir / key).exists()


def test_another_restaurants_image_or_a_made_up_key_is_refused(team, admin_user, cleanup):
    from tests.test_admin_restaurants import _create

    other = _create(admin_user, cleanup)
    foreign = f"restaurants/{other.id}/branding/{'a' * 32}.webp"
    missing = f"restaurants/{team.id}/branding/{'b' * 32}.webp"
    item_photo = _upload(team.owner, kind="items")
    for key in (foreign, missing, item_photo):
        for field in ("logo_path", "brand_name_image_path"):
            res = team.owner.patch("/api/v1/restaurant/profile", json={field: key})
            assert res.status_code == 422, (field, key, res.text)


@pytest.mark.parametrize("font", ["comic_sans", None, ""])
def test_only_a_listed_font_is_accepted(team, font):
    res = team.owner.patch("/api/v1/restaurant/profile", json={"brand_name_font": font})
    assert res.status_code == 422


def test_the_database_refuses_an_unlisted_font(team):
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        with tenant_session(team.id) as db:
            db.execute(
                text("UPDATE restaurants SET brand_name_font = 'papyrus' WHERE id = :r"),
                {"r": team.id},
            )


@pytest.mark.parametrize("role, allowed", [
    ("ADMIN", True), ("IT_SUPPORT", True), ("MANAGER", False), ("KITCHEN", False),
])
def test_only_settings_roles_change_the_brand(team, role, allowed):
    user, _ = team.member(role)
    res = team.client(user).patch("/api/v1/restaurant/profile", json={"brand_name_font": "lora"})
    assert (res.status_code == 200) is allowed, res.text
