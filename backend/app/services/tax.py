"""TaxService: how much tax an order carries, per the restaurant's tax mode.

  FLAT        tax_rate_bps applied to the post-discount total. Simple and
              wrong for most real menus: prepared food is taxed at state plus
              county, city and district rates that vary street by street.

  STRIPE_TAX  Stripe Tax calculates on the restaurant's own connected account,
              for the pickup address, with the restaurant's product tax code.
              See services/stripe_tax.py.

The pricing engine calls calculate() and never needs to know which it got.
"""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core import errors
from app.core.money import apply_rate_bps
from app.models import Restaurant, RestaurantPaymentAccount, TaxMode


@dataclass(frozen=True)
class TaxLine:
    """One priced line: its total in minor units (quantity included) and the
    quantity, which some jurisdictions' per-item thresholds depend on."""
    amount_minor: int
    quantity: int


@dataclass(frozen=True)
class TaxResult:
    tax_minor: int
    # The Stripe Tax calculation the amount came from; None under FLAT.
    calculation_id: str | None = None


def allocate_discount(amounts: list[int], discount_minor: int) -> list[int]:
    """Spread a cart-level discount over line amounts, in exact minor units.

    Stripe Tax has no discount field: each line must carry what was actually
    charged for it. The discount is shared in proportion to each line's
    amount, with the rounding leftovers handed out largest-remainder first,
    so the lines always add up to exactly subtotal minus discount.
    """
    total = sum(amounts)
    discount = max(0, min(discount_minor, total))
    if discount == 0 or total == 0:
        return list(amounts)

    shares = []
    for index, amount in enumerate(amounts):
        exact = amount * discount
        shares.append((exact // total, exact % total, index))

    allocated = sum(whole for whole, _, _ in shares)
    leftover = discount - allocated
    # Largest remainder first; ties go to the earlier line, for determinism.
    order = sorted(shares, key=lambda s: (-s[1], s[2]))
    bonus = {index for _, _, index in order[:leftover]}

    return [
        amount - whole - (1 if index in bonus else 0)
        for (whole, _, index), amount in zip(shares, amounts)
    ]


class TaxService:
    @staticmethod
    def calculate(
        session: Session,
        restaurant: Restaurant,
        lines: list[TaxLine],
        discount_minor: int,
    ) -> TaxResult:
        amounts = allocate_discount([line.amount_minor for line in lines], discount_minor)

        if restaurant.tax_mode != TaxMode.STRIPE_TAX.value:
            return TaxResult(tax_minor=apply_rate_bps(sum(amounts), restaurant.tax_rate_bps))

        # Imported here: stripe_tax pulls in the Stripe client and Redis, which
        # a flat-rate restaurant never needs.
        from app.services import stripe_tax

        account = session.execute(select(RestaurantPaymentAccount)).scalar_one_or_none()
        if account is None:
            raise errors.payment_provider_unavailable(
                "This restaurant is not set up for card payments."
            )
        return stripe_tax.calculate(
            restaurant,
            account.stripe_account_id,
            [TaxLine(amount_minor=a, quantity=line.quantity) for a, line in zip(amounts, lines)],
        )
