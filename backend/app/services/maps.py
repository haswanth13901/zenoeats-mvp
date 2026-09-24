"""Which map a customer sees, and in whose colours.

Google applies a map style server-side, by Map ID: a style is created once in
the Cloud console and attached to an ID, and the browser asks for that ID.
Style JSON sent from the browser is ignored whenever a Map ID is in use, and
the tracking map needs one for its Advanced Markers -- so a restaurant
choosing "Dark" is choosing between Map IDs the platform has set up, not
sending colours of its own.

Everything the platform draws on top of the map -- the three pins -- is ours
to colour, and follows the restaurant's palette instead.
"""

import json
import logging

from app.config import settings

log = logging.getLogger(__name__)

# A style the restaurant has not chosen, and the one every restaurant gets
# until the platform configures more.
DEFAULT_LABEL = "The platform's map"


def styles() -> list[dict]:
    """The styles a restaurant may choose between, from GOOGLE_MAPS_MAP_STYLES.

    Malformed configuration is logged and treated as none: a restaurant's map
    falling back to the platform's own is a far smaller failure than a
    storefront page that will not load.
    """
    raw = (settings.GOOGLE_MAPS_MAP_STYLES or "").strip()
    if not raw:
        return []
    try:
        parsed = json.loads(raw)
        return [
            {"key": str(s["key"])[:32], "label": str(s["label"])[:60], "map_id": str(s["map_id"])}
            for s in parsed
            if s.get("key") and s.get("label") and s.get("map_id")
        ]
    except (ValueError, TypeError, AttributeError):
        log.warning("GOOGLE_MAPS_MAP_STYLES is not a list of {key,label,map_id}; ignoring it")
        return []


def choices() -> list[dict]:
    """The same list for the portal's picker, without the Map IDs.

    A Map ID is not a secret -- it ships to every browser that opens a map --
    but the portal has no use for one, and a list of ids invites a page to
    start choosing its own.
    """
    return [{"key": s["key"], "label": s["label"]} for s in styles()]


def map_id_for(key: str | None) -> str:
    """The Map ID to open a restaurant's map with.

    An unknown key falls back to the platform's map rather than failing: a
    style withdrawn from the configuration should leave a restaurant with a
    plain map, not with no map at all.
    """
    if key:
        for style in styles():
            if style["key"] == key:
                return style["map_id"]
    return settings.GOOGLE_MAPS_MAP_ID
