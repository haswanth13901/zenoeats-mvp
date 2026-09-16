"""Turning an address into a point, and a point into a distance.

Delivery fees here are charged by distance, so a fee is only ever as right as
the coordinates behind it. That makes three things matter more than the
lookup itself:

  Never guess. A provider that cannot place an address returns nothing and the
  caller refuses the delivery. An address quietly resolved to the middle of a
  city would charge the wrong ring, every time, silently.

  Never store what we may only borrow. Google's terms allow caching a result
  for about thirty days, not keeping it. Coordinates live in Redis with that
  TTL; what an order keeps is the distance and the fee, which are ours.

  Never block a checkout on someone else's outage. The lookup has a short
  timeout, and the caller is expected to treat failure as "we cannot offer
  delivery right now" rather than as a free delivery.

Distance is straight-line (haversine), not driving distance. Driving distance
needs a routing API at a different price, and rings drawn on a map are what a
restaurant means when it says "we deliver within three miles" anyway.
"""

import hashlib
import json
import logging
import math
from dataclasses import dataclass

import httpx
from redis.exceptions import RedisError

from app.config import settings

log = logging.getLogger(__name__)

EARTH_RADIUS_MILES = 3958.7613


@dataclass(frozen=True)
class Point:
    latitude: float
    longitude: float


class GeocodingUnavailable(Exception):
    """The provider could not be reached, or is not configured.

    Distinct from "that address does not exist": one is our problem and the
    customer should be asked to try again, the other is theirs and no retry
    will help.
    """


def configured() -> bool:
    """Whether addresses can be placed at all. Delivery depends on it."""
    return bool(settings.GOOGLE_MAPS_API_KEY) and settings.GEOCODING_PROVIDER == "google"


def miles_between(origin: Point, destination: Point) -> float:
    """Great-circle distance in miles.

    Exact enough for delivery rings: the error against a proper geodesic
    calculation is under a tenth of a percent at these distances, which is
    centimetres on a three-mile ring.
    """
    lat1, lon1 = math.radians(origin.latitude), math.radians(origin.longitude)
    lat2, lon2 = math.radians(destination.latitude), math.radians(destination.longitude)
    dlat, dlon = lat2 - lat1, lon2 - lon1

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(a)))


def geocode(address: str) -> Point | None:
    """Place an address, or None if the provider cannot.

    Raises GeocodingUnavailable when the provider is unreachable or
    unconfigured, which a caller must not confuse with a bad address.
    """
    cleaned = " ".join(address.split()).strip()
    if not cleaned:
        return None
    if not configured():
        raise GeocodingUnavailable("No geocoding provider is configured.")

    cached = _cache_get(cleaned)
    if cached is not None:
        # A cached miss is a miss: an address Google could not place an hour
        # ago is not worth asking about again on every keystroke.
        return Point(**cached) if cached else None

    point = _google(cleaned)
    _cache_put(cleaned, point)
    return point


# ------------------------------------------------------------- provider ---

def _google(address: str) -> Point | None:
    try:
        response = httpx.get(
            "https://maps.googleapis.com/maps/api/geocode/json",
            params={"address": address, "key": settings.GOOGLE_MAPS_API_KEY},
            timeout=settings.GEOCODE_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        body = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        # The address is not named in the log: it is a customer's home.
        log.warning("geocoding request failed: %s", exc)
        raise GeocodingUnavailable("Could not reach the geocoding service.") from exc

    status = body.get("status")
    if status == "ZERO_RESULTS":
        return None
    if status != "OK":
        # OVER_QUERY_LIMIT, REQUEST_DENIED and INVALID_REQUEST are all our
        # problem rather than the customer's, and all mean the same thing to
        # them: delivery cannot be quoted right now.
        log.error("geocoding provider answered %s", status)
        raise GeocodingUnavailable("The geocoding service refused the request.")

    results = body.get("results") or []
    if not results:
        return None
    location = results[0].get("geometry", {}).get("location", {})
    try:
        return Point(latitude=float(location["lat"]), longitude=float(location["lng"]))
    except (KeyError, TypeError, ValueError):
        log.error("geocoding provider returned an unreadable location")
        raise GeocodingUnavailable("The geocoding service returned nothing usable.")


# ---------------------------------------------------------------- cache ---
#
# Keyed by a hash of the address rather than the address itself, so a Redis
# instance someone can read is not also a list of customers' homes. Failures
# are swallowed in both directions: a cache that is down should cost money in
# lookups, not turn delivery off.

def _cache_key(address: str) -> str:
    digest = hashlib.sha256(address.lower().encode()).hexdigest()
    return f"geocode:{digest}"


def _cache_get(address: str) -> dict | None:
    try:
        from app.core.ratelimit import runtime_redis

        raw = runtime_redis().get(_cache_key(address))
    except (RedisError, OSError):
        return None
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


def _cache_put(address: str, point: Point | None) -> None:
    try:
        from app.core.ratelimit import runtime_redis

        runtime_redis().setex(
            _cache_key(address),
            settings.GEOCODE_CACHE_TTL_SECONDS,
            json.dumps({"latitude": point.latitude, "longitude": point.longitude}
                       if point else {}),
        )
    except (RedisError, OSError):
        pass
