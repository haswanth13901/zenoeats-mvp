"""TaxService abstraction.

MVP uses a single platform-approved rate per restaurant, stored as basis
points. This is deliberately behind an interface: when the launch geography
spans jurisdictions that a flat rate cannot represent, swap the body of
calculate_tax() for Stripe Tax or TaxJar without touching the pricing engine
or the order service.

Texas note: prepared food is taxed at the state rate plus local jurisdiction
rates that vary by address. A flat per-restaurant rate is only defensible for
pickup in a single jurisdiction. Revisit before the delivery release.
"""

from app.core.money import apply_rate_bps
from app.models import Restaurant


class TaxService:
    @staticmethod
    def calculate_tax(restaurant: Restaurant, taxable_base_minor: int) -> int:
        """Tax on the post-discount base, in minor units, rounded HALF_UP."""
        return apply_rate_bps(taxable_base_minor, restaurant.tax_rate_bps)
