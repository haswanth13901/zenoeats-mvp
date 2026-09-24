"""Which map a restaurant's customers open, and in whose colours.

Google applies a map style by Map ID, so a restaurant chooses between the
styles the platform set up rather than sending colours of its own. What the
platform draws on top -- the pins -- follows the restaurant's palette, and
that is a switch it owns.
"""

import json

import pytest

from app.config import settings
from app.core import errors
from app.db.session import tenant_session
from app.models import Restaurant
from app.schemas.storefront import MapPatch
from app.services import maps, storefront
from tests.test_storefront import tenants  # noqa: F401

pytestmark = pytest.mark.integration

CONFIGURED = json.dumps([
    {"key": "dark", "label": "Dark", "map_id": "dark-map-id"},
    {"key": "light", "label": "Light", "map_id": "light-map-id"},
])


@pytest.fixture
def platform_styles(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_MAPS_MAP_STYLES", CONFIGURED)
    monkeypatch.setattr(settings, "GOOGLE_MAPS_MAP_ID", "platform-map-id")


def _save(db, rid, **changes):
    return storefront.save_map(db, db.get(Restaurant, rid), MapPatch(**changes))


# --- what the platform offers --------------------------------------------

def test_with_nothing_configured_there_is_nothing_to_choose(monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_MAPS_MAP_STYLES", "")
    assert maps.choices() == []


def test_the_portal_is_offered_keys_and_labels_but_no_map_ids(platform_styles):
    assert maps.choices() == [
        {"key": "dark", "label": "Dark"},
        {"key": "light", "label": "Light"},
    ]


def test_configuration_that_cannot_be_read_leaves_the_platform_map(monkeypatch):
    """A typo in an env var must not take every restaurant's map down."""
    monkeypatch.setattr(settings, "GOOGLE_MAPS_MAP_STYLES", "{not json")
    monkeypatch.setattr(settings, "GOOGLE_MAPS_MAP_ID", "platform-map-id")
    assert maps.choices() == []
    assert maps.map_id_for("dark") == "platform-map-id"


# --- what a restaurant chooses -------------------------------------------

def test_a_chosen_style_decides_the_map_a_customer_opens(platform_styles, tenants):
    rid, _, _ = tenants[0]
    with tenant_session(rid) as db:
        saved = _save(db, rid, map_style_key="dark")
        assert saved["map_style_key"] == "dark"
    assert maps.map_id_for("dark") == "dark-map-id"


def test_no_choice_and_a_withdrawn_one_both_open_the_platform_map(platform_styles):
    assert maps.map_id_for(None) == "platform-map-id"
    # The style was configured when it was chosen and is not any more.
    assert maps.map_id_for("retired") == "platform-map-id"


def test_a_style_the_platform_never_offered_is_refused(platform_styles, tenants):
    rid, _, _ = tenants[0]
    with tenant_session(rid) as db:
        with pytest.raises(errors.ApiError):
            _save(db, rid, map_style_key="midnight")


def test_the_pins_follow_the_palette_until_the_restaurant_says_otherwise(tenants):
    rid, _, _ = tenants[0]
    with tenant_session(rid) as db:
        assert db.get(Restaurant, rid).map_pins_themed is True
        assert _save(db, rid, map_pins_themed=False)["map_pins_themed"] is False


def test_choosing_a_style_leaves_the_pin_switch_alone(platform_styles, tenants):
    """Only the fields sent are applied, as everywhere else in this editor."""
    rid, _, _ = tenants[0]
    with tenant_session(rid) as db:
        _save(db, rid, map_pins_themed=False)
        saved = _save(db, rid, map_style_key="light")
        assert saved["map_pins_themed"] is False
        assert saved["map_style_key"] == "light"


def test_the_gate_covers_it_like_the_rest_of_the_storefront(tenants):
    rid, _, _ = tenants[0]
    with tenant_session(rid) as db:
        db.get(Restaurant, rid).storefront_customization_enabled = False
    with tenant_session(rid) as db:
        with pytest.raises(errors.ApiError) as refused:
            _save(db, rid, map_pins_themed=False)
        assert refused.value.status_code == 403
