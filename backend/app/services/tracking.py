"""Where a delivery driver is, and how long until they arrive.

Two facts, both short-lived, both in Redis and never in Postgres.

  Where the driver is. Sent every few seconds by the driver's phone while
  they have an order on the road, and overwritten each time. It is someone's
  live position, so it is kept only as long as it is useful: a few minutes
  after the phone stops sending, it is gone. Keyed by driver rather than by
  order, because one driver carrying two orders is in one place, and both
  customers should see the same dot.

  How long until they arrive. Asked of Google's Routes API from the driver's
  position to the customer's, at most once per DELIVERY_ETA_REFRESH_SECONDS
  per order however many tabs are polling -- each ask is billed -- and after
  the tracking page's response has gone, never on its path.

Everything here fails open. Redis down or Google slow means the customer sees
the timeline without a dot or an arrival time, never an error page.
"""

import json
import logging
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

import httpx
from redis.exceptions import RedisError

from app.config import settings
from app.services import geocoding
from app.services.geocoding import Point

log = logging.getLogger(__name__)

ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes"

# How long a position survives after the last one arrived. Longer than the
# staleness cut-off, so a brief gap in reporting does not lose it, and short
# enough that a driver's position is not kept once the delivery is over.
_LOCATION_TTL_SECONDS = 10 * 60
_ETA_TTL_SECONDS = 10 * 60


@dataclass(frozen=True)
class DriverLocation:
    latitude: float
    longitude: float
    heading: float | None
    recorded_at: datetime


@dataclass(frozen=True)
class Eta:
    seconds: int
    computed_at: datetime


def _redis():
    from app.core.ratelimit import runtime_redis

    return runtime_redis()


def _location_key(restaurant_id, driver_user_id) -> str:
    return f"tracking:driver:{restaurant_id}:{driver_user_id}"


def _eta_key(order_id) -> str:
    return f"tracking:eta:{order_id}"


# ------------------------------------------------------------ location ---

def record_location(
    restaurant_id: UUID,
    driver_user_id: UUID,
    latitude: float,
    longitude: float,
    heading: float | None,
) -> bool:
    """Keep the driver's latest position. False if it could not be kept."""
    payload = json.dumps({
        "latitude": latitude, "longitude": longitude, "heading": heading, "at": time.time(),
    })
    try:
        _redis().setex(_location_key(restaurant_id, driver_user_id), _LOCATION_TTL_SECONDS, payload)
        return True
    except (RedisError, OSError):
        log.warning("driver location not stored: runtime redis unavailable")
        return False


def current_location(restaurant_id: UUID, driver_user_id: UUID) -> DriverLocation | None:
    """The driver's position, if one arrived recently enough to be true."""
    try:
        raw = _redis().get(_location_key(restaurant_id, driver_user_id))
    except (RedisError, OSError):
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
        at = float(data["at"])
        location = DriverLocation(
            latitude=float(data["latitude"]),
            longitude=float(data["longitude"]),
            heading=None if data.get("heading") is None else float(data["heading"]),
            recorded_at=datetime.fromtimestamp(at, tz=timezone.utc),
        )
    except (ValueError, KeyError, TypeError):
        return None
    if time.time() - at > settings.DRIVER_LOCATION_STALE_SECONDS:
        return None
    return location


def destination(address: str | None) -> Point | None:
    """The customer's coordinates, from the geocoding cache only.

    Checkout placed this address minutes ago, so the cache has it. A miss is
    answered with nothing rather than a lookup, because this runs on every
    poll of the tracking page.
    """
    return geocoding.cached_point(address) if address else None


# ----------------------------------------------------------------- ETA ---

def current_eta(order_id: UUID) -> Eta | None:
    try:
        raw = _redis().get(_eta_key(order_id))
    except (RedisError, OSError):
        return None
    if not raw:
        return None
    try:
        data = json.loads(raw)
        return Eta(
            seconds=int(data["seconds"]),
            computed_at=datetime.fromtimestamp(float(data["at"]), tz=timezone.utc),
        )
    except (ValueError, KeyError, TypeError):
        return None


def eta_configured() -> bool:
    return bool(settings.GOOGLE_MAPS_API_KEY)


def refresh_eta(order_id: UUID, origin: Point, target: Point) -> None:
    """Ask Google how long the drive is, unless someone asked very recently.

    A background task: runs after the response has been sent and its
    transaction has closed. The claim is taken before the call, so twenty
    open tabs make one request, not twenty.
    """
    try:
        claimed = _redis().set(
            f"{_eta_key(order_id)}:claim", "1", nx=True, ex=settings.DELIVERY_ETA_REFRESH_SECONDS
        )
    except (RedisError, OSError):
        # Unlike the payment reconciler, fail closed: without Redis there is
        # no throttle, and an unthrottled billed call per poll is the one
        # thing this must not do.
        return
    if not claimed:
        return

    seconds = drive_seconds(origin, target)
    if seconds is None:
        return
    try:
        _redis().setex(
            _eta_key(order_id), _ETA_TTL_SECONDS, json.dumps({"seconds": seconds, "at": time.time()})
        )
    except (RedisError, OSError):
        pass


def drive_seconds(origin: Point, target: Point) -> int | None:
    """Driving time with current traffic, or None if Google cannot say.

    The key travels in a header, not the URL, so no exception text can carry
    it. The body names a customer's home, so nothing from a failure is logged
    beyond its kind.
    """
    if not eta_configured():
        return None

    def waypoint(point: Point) -> dict:
        return {"location": {"latLng": {"latitude": point.latitude, "longitude": point.longitude}}}

    failure = None
    try:
        res = httpx.post(
            ROUTES_URL,
            headers={
                "X-Goog-Api-Key": settings.GOOGLE_MAPS_API_KEY,
                "X-Goog-FieldMask": "routes.duration",
            },
            json={
                "origin": waypoint(origin),
                "destination": waypoint(target),
                "travelMode": "DRIVE",
                "routingPreference": "TRAFFIC_AWARE",
            },
            timeout=settings.ROUTES_TIMEOUT_SECONDS,
        )
        res.raise_for_status()
        routes = res.json().get("routes") or []
        duration = (routes[0].get("duration") if routes else None) or ""
    except httpx.HTTPStatusError as exc:
        failure = f"HTTP {exc.response.status_code}"
    except (httpx.HTTPError, ValueError) as exc:
        failure = type(exc).__name__
    if failure is not None:
        log.warning("routes request failed: %s", failure)
        return None

    # "754s" -- a protobuf Duration, as JSON.
    if not duration.endswith("s"):
        return None
    try:
        return max(0, round(float(duration[:-1])))
    except ValueError:
        return None
