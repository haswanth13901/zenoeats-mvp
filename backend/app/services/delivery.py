"""Can this restaurant deliver to this address, and for how much.

One question with four possible answers, and they are deliberately not the
same answer:

  a fee            the address is in a ring, and this is what it costs;
  out of range     the address is real and too far, which no retry will fix;
  not found        the address could not be placed, which retyping might fix;
  not right now    we could not ask, or the restaurant is not set up, which is
                   our problem and not the customer's.

Collapsing those into "delivery unavailable" would leave a customer retyping a
perfectly good address because a provider was down, or waiting for a courier
that was never coming.

Nothing here is charged on trust: the fee comes from the restaurant's own
rings, measured from coordinates the restaurant placed itself, so a customer
cannot influence it beyond giving the address they want food delivered to.
"""

import logging
from dataclasses import dataclass
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import errors
from app.models import DeliveryZone, Restaurant
from app.services import geocoding

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class DeliveryQuote:
    """What an order will carry: the fee, and enough to explain it later.

    The coordinates are not here on purpose. They are borrowed from a
    geocoding provider under terms that allow caching rather than keeping, and
    the distance and fee are what the restaurant and the customer actually
    need. A receipt says "3.2 miles, $4", never a latitude.
    """

    fee_minor: int
    miles: float
    zone_id: UUID


def offered(restaurant: Restaurant) -> bool:
    """Whether to show delivery as a choice at all.

    Not the same as "this address can be delivered to" -- that needs the
    address. This is whether the restaurant is in a state to deliver to
    anywhere: switched on, and with coordinates we still believe.
    """
    return bool(restaurant.delivery_enabled and restaurant.delivery_origin_is_current)


def quote(session: Session, restaurant: Restaurant, address: str) -> DeliveryQuote:
    """Price a delivery to one address, or raise saying why not."""
    if not offered(restaurant):
        # Deliberately vague to the customer, because the reasons -- switched
        # off, or an address the restaurant has not placed since moving -- are
        # the restaurant's business and none of them are actionable here.
        raise errors.ApiError(
            409, "DELIVERY_NOT_OFFERED", "This restaurant is not delivering right now."
        )

    cleaned = " ".join(address.split()).strip()
    if len(cleaned) < 5:
        raise errors.validation_error("Enter the address you would like it delivered to.")

    try:
        point = geocoding.geocode(cleaned)
    except geocoding.GeocodingUnavailable:
        # Ours, not theirs. A customer retyping a correct address because our
        # provider is down is the worst version of this.
        raise errors.ApiError(
            503, "DELIVERY_CHECK_UNAVAILABLE",
            "We could not check that address just now. Try again in a moment, "
            "or choose collection.",
        )
    if point is None:
        raise errors.ApiError(
            422, "ADDRESS_NOT_FOUND",
            "We could not find that address. Check it and try again.",
        )

    origin = geocoding.Point(
        latitude=restaurant.latitude, longitude=restaurant.longitude
    )
    miles = geocoding.miles_between(origin, point)

    zones = list(
        session.execute(
            select(DeliveryZone)
            .where(DeliveryZone.restaurant_id == restaurant.id)
            .order_by(DeliveryZone.max_miles)
        ).scalars()
    )
    if not zones:
        raise errors.ApiError(
            409, "DELIVERY_NOT_OFFERED", "This restaurant is not delivering right now."
        )

    # The first ring that reaches it. Sorted ascending, so the first match is
    # also the cheapest one that covers the distance.
    for zone in zones:
        if miles <= zone.max_miles:
            return DeliveryQuote(
                fee_minor=zone.fee_minor, miles=round(miles, 2), zone_id=zone.id
            )

    furthest = zones[-1].max_miles
    raise errors.ApiError(
        409, "OUT_OF_DELIVERY_RANGE",
        f"That address is about {miles:.1f} miles away, and this restaurant "
        f"delivers up to {_miles_text(furthest)}. You can still collect.",
    )


def _miles_text(miles: float) -> str:
    whole = int(miles)
    return f"{whole} miles" if miles == whole else f"{miles:g} miles"
