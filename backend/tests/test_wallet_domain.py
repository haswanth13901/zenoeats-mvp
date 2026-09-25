"""A live restaurant's storefront is registered for Apple Pay and Google Pay.

Stripe's PaymentMethodDomain API is replaced by a fake that keeps its
records the way Stripe does -- per connected account -- so what is proved is
what reaches Stripe: the right domain, on the restaurant's own account, once.
"""

from types import SimpleNamespace

import pytest
import stripe

from app.config import settings
from app.services import stripe_service


class FakeDomains:
    """PaymentMethodDomain, per connected account, as stripe-python returns it."""

    def __init__(self):
        self.by_account: dict[str, list] = {}
        self.calls: list[tuple] = []
        self.error: Exception | None = None
        self.apple_after_validate = "active"

    def _record(self, account, domain, enabled=True, apple="active"):
        record = stripe.PaymentMethodDomain.construct_from(
            {
                "id": f"pmd_{len(self.calls)}",
                "object": "payment_method_domain",
                "domain_name": domain,
                "enabled": enabled,
                "apple_pay": {"status": apple,
                              "status_details": {"error_message": "verification failed"}
                              if apple != "active" else None},
                "google_pay": {"status": "active"},
            },
            "sk_test",
        )
        self.by_account.setdefault(account, []).append(record)
        return record

    def list(self, domain_name, limit, stripe_account):
        self.calls.append(("list", stripe_account, domain_name))
        if self.error:
            raise self.error
        found = [r for r in self.by_account.get(stripe_account, []) if r.domain_name == domain_name]
        return SimpleNamespace(data=found[:limit])

    def create(self, domain_name, stripe_account):
        self.calls.append(("create", stripe_account, domain_name))
        return self._record(stripe_account, domain_name)

    def modify(self, id, enabled, stripe_account):
        self.calls.append(("modify", stripe_account, id))
        record = self._find(stripe_account, id)
        record["enabled"] = enabled
        return record

    def validate(self, id, stripe_account):
        self.calls.append(("validate", stripe_account, id))
        record = self._find(stripe_account, id)
        record.apple_pay["status"] = self.apple_after_validate
        return record

    def _find(self, account, id):
        return next(r for r in self.by_account[account] if r.id == id)


@pytest.fixture
def domains(monkeypatch):
    fake = FakeDomains()
    for name in ("list", "create", "modify", "validate"):
        monkeypatch.setattr(stripe.PaymentMethodDomain, name, getattr(fake, name))
    monkeypatch.setattr(settings, "ROOT_DOMAIN", "zenoeats.com")
    monkeypatch.setattr(settings, "STRIPE_SECRET_KEY", "sk_test_fake")
    return fake


def test_the_storefront_is_registered_on_the_restaurants_own_account(domains):
    result = stripe_service.ensure_wallet_domain("acct_spice", "spicehouse")

    assert ("create", "acct_spice", "spicehouse.zenoeats.com") in domains.calls
    assert result == {"domain": "spicehouse.zenoeats.com", "apple_pay": "active",
                      "google_pay": "active", "problem": None}


def test_registering_again_creates_nothing_new(domains):
    stripe_service.ensure_wallet_domain("acct_spice", "spicehouse")
    stripe_service.ensure_wallet_domain("acct_spice", "spicehouse")

    assert [c for c in domains.calls if c[0] == "create"] == [
        ("create", "acct_spice", "spicehouse.zenoeats.com")
    ]


def test_a_disabled_registration_is_switched_back_on(domains):
    domains._record("acct_spice", "spicehouse.zenoeats.com", enabled=False)

    stripe_service.ensure_wallet_domain("acct_spice", "spicehouse")

    assert domains.by_account["acct_spice"][0].enabled is True
    assert not [c for c in domains.calls if c[0] == "create"]


def test_apple_pay_that_is_not_active_is_validated_again(domains):
    domains._record("acct_spice", "spicehouse.zenoeats.com", apple="inactive")

    result = stripe_service.ensure_wallet_domain("acct_spice", "spicehouse")

    assert any(c[0] == "validate" for c in domains.calls)
    assert result["apple_pay"] == "active"


def test_a_failed_validation_says_why(domains):
    domains._record("acct_spice", "spicehouse.zenoeats.com", apple="inactive")
    domains.apple_after_validate = "inactive"

    result = stripe_service.ensure_wallet_domain("acct_spice", "spicehouse")

    assert result["apple_pay"] == "inactive"
    assert result["problem"] == "verification failed"


def test_stripe_being_unreachable_never_raises(domains):
    """Activation must not fail over wallets: cards still work without them."""
    domains.error = stripe.APIConnectionError("connection reset")

    result = stripe_service.ensure_wallet_domain("acct_spice", "spicehouse")

    assert result["apple_pay"] == "unknown"
    assert result["problem"]


def test_a_development_domain_is_left_alone(domains, monkeypatch):
    monkeypatch.setattr(settings, "ROOT_DOMAIN", "zenoeats.local")

    assert stripe_service.ensure_wallet_domain("acct_spice", "spicehouse") is None
    assert domains.calls == []
