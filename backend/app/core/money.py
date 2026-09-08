"""Money is integer minor units everywhere. No floats. Ever.

Rule 22 of the architecture baseline: all monetary values use integer minor
units with explicit currency codes; floating point arithmetic is prohibited.
"""

from decimal import ROUND_HALF_UP, Decimal


def apply_rate_bps(amount_minor: int, rate_bps: int) -> int:
    """Apply a basis-point rate to a minor-unit amount, rounding HALF_UP.

    10000 bps = 100%. 825 bps = 8.25%.
    Uses Decimal so the rounding boundary is deterministic and auditable.
    """
    if amount_minor < 0:
        raise ValueError("amount_minor must be non-negative")
    if rate_bps < 0:
        raise ValueError("rate_bps must be non-negative")
    raw = Decimal(amount_minor) * Decimal(rate_bps) / Decimal(10000)
    return int(raw.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def format_minor(amount_minor: int, currency: str = "USD") -> str:
    """Display helper. Presentation only, never used in calculations."""
    sign = "-" if amount_minor < 0 else ""
    a = abs(amount_minor)
    return f"{sign}{a // 100}.{a % 100:02d} {currency}"
