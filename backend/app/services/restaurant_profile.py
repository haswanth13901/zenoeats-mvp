"""The rules a restaurant profile edit must respect, wherever it comes from.

Two portals write the restaurants row: the platform's Super Admin screen and
the restaurant's own Settings screen. They must apply the same rules, because
the dangerous edits are the quiet ones -- a restaurant that clears its street
is a restaurant whose tax silently stops calculating -- and a rule enforced in
only one of two callers is not a rule.

So the normalising and the Stripe Tax gate live here, and both callers go
through them. What differs between the two is which fields they accept at all,
and that stays with each caller's schema.
"""

import json

from sqlalchemy import text

from app.core import errors
from app.services import stripe_tax

# Changing any of these can change what a customer is charged in tax, so they
# are checked together: the gate asks "would the result still calculate?",
# not "did you touch tax or did you touch the address?".
TAX_AND_ADDRESS_FIELDS = (
    "tax_mode", "tax_code", "address_line1", "address_line2", "address_city",
    "address_state", "address_postal_code", "address_country",
)


def tax_fields(source) -> dict:
    """The tax and address attributes of a Restaurant or a row mapping."""
    get = source.get if isinstance(source, dict) or hasattr(source, "keys") else (
        lambda name: getattr(source, name)
    )
    return {name: get(name) for name in TAX_AND_ADDRESS_FIELDS}


def stripe_tax_blockers(restaurant_view, stripe_account_id: str | None) -> list[str]:
    """Why a restaurant cannot calculate tax through Stripe; empty when it can.

    Called outside any database transaction: it asks Stripe for the connected
    account's tax settings, and a network call must never hold a connection
    from the narrow system pool (rule 6).
    """
    blockers = [f"Pickup address is missing the {part}." for part in
                stripe_tax.address_problems(restaurant_view)]
    if not stripe_account_id:
        blockers.append("No Stripe connected account.")
    else:
        blockers.extend(stripe_tax.settings_problems(stripe_account_id))
    return blockers


def normalize(changes: dict) -> dict:
    """Tidy a PATCH's values and refuse the ones that cannot be cleared.

    An empty address line means "there isn't one", so it is stored as NULL --
    otherwise a restaurant can satisfy the Stripe Tax gate with a space bar.
    Tax mode and tax code have no "none": every order needs both.
    """
    if changes.get("currency"):
        changes["currency"] = changes["currency"].upper()
    if changes.get("address_country"):
        changes["address_country"] = changes["address_country"].upper()
    for field in TAX_AND_ADDRESS_FIELDS:
        if isinstance(changes.get(field), str):
            changes[field] = changes[field].strip() or None
    if "tax_mode" in changes and changes["tax_mode"] is None:
        raise errors.validation_error("Choose a tax mode.")
    if "tax_code" in changes and changes["tax_code"] is None:
        raise errors.validation_error("A tax code is required.")
    return changes


def guard_stripe_tax(current, changes: dict, stripe_account_id: str | None) -> None:
    """Refuse an edit that would leave a Stripe Tax restaurant unable to tax.

    It runs on the *result* of the edit, not on the edit: switching Stripe Tax
    on without an address and deleting the city of a restaurant already on it
    are the same failure, and both are caught here. A flat-rate restaurant is
    never blocked -- its tax needs nothing but a number.
    """
    if not any(field in changes for field in TAX_AND_ADDRESS_FIELDS):
        return

    from types import SimpleNamespace

    prospective = {**tax_fields(current), **{
        field: value for field, value in changes.items() if field in TAX_AND_ADDRESS_FIELDS
    }}
    if prospective["tax_mode"] != "STRIPE_TAX":
        return

    blockers = stripe_tax_blockers(SimpleNamespace(**prospective), stripe_account_id)
    if blockers:
        raise errors.ApiError(409, "STRIPE_TAX_NOT_READY", " ".join(blockers))


def audit(session, actor_user_id, action: str, scope: dict) -> None:
    """Record who changed what.

    The platform audit log takes staff edits too. A restaurant admin changing
    their own tax rate is exactly the kind of thing someone will later need to
    account for, and "the restaurant did it, not us" is only provable if it
    was written down at the time.
    """
    session.execute(
        text(
            """
            INSERT INTO platform_audit_logs
                (id, actor_user_id, action, scope, correlation_id, created_at)
            VALUES (gen_random_uuid(), :actor, :action, CAST(:scope AS jsonb),
                    gen_random_uuid()::text, now())
            """
        ),
        {"actor": str(actor_user_id), "action": action, "scope": json.dumps(scope)},
    )
