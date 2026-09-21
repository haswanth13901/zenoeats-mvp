"""A production API refuses to start on a configuration that is unsafe.

Each case is one thing that, left wrong, is an incident rather than a failed
deploy: forgeable operator sessions, customers who cannot sign in, orders
that can never be confirmed.
"""

import pytest
from cryptography.fernet import Fernet

from app.config import Settings
from app.core import startup_checks


def _production(**overrides) -> Settings:
    values = dict(
        ENV="production",
        ROOT_DOMAIN="zenoeats.com",
        DATABASE_URL_APP="postgresql://a",
        DATABASE_URL_SYSTEM="postgresql://s",
        DATABASE_URL_MIGRATE="",
        FIELD_ENCRYPTION_KEY=Fernet.generate_key().decode(),
        SESSION_SECRET="x" * 44,
        CLERK_JWKS_URL="https://clerk.zenoeats.com/.well-known/jwks.json",
        CLERK_ISSUER="https://clerk.zenoeats.com",
        CLERK_SECRET_KEY="sk_live_abc",
        STRIPE_SECRET_KEY="sk_live_abc",
        STRIPE_CONNECT_WEBHOOK_SECRET="whsec_abc",
        ADMIN_USERS="ops@zenoeats.com:aGFzaA==",
        AUTH_DEV_BYPASS=False,
    )
    values.update(overrides)
    # _env_file=None: the developer's own .env must not leak into these cases.
    return Settings(_env_file=None, **values)


def test_a_complete_production_configuration_starts():
    assert startup_checks.configuration_problems(_production()) == []
    startup_checks.enforce(_production())


@pytest.mark.parametrize(
    "overrides, fragment",
    [
        ({"SESSION_SECRET": ""}, "SESSION_SECRET"),
        ({"SESSION_SECRET": "changeme"}, "SESSION_SECRET"),
        ({"FIELD_ENCRYPTION_KEY": "replace_me_with_a_real_fernet_key"}, "FIELD_ENCRYPTION_KEY"),
        ({"AUTH_DEV_BYPASS": True}, "AUTH_DEV_BYPASS"),
        ({"CLERK_JWKS_URL": ""}, "CLERK_JWKS_URL"),
        ({"CLERK_ISSUER": ""}, "CLERK_ISSUER"),
        ({"CLERK_SECRET_KEY": ""}, "CLERK_SECRET_KEY"),
        ({"STRIPE_SECRET_KEY": "sk_test_replace_me"}, "STRIPE_SECRET_KEY"),
        ({"STRIPE_CONNECT_WEBHOOK_SECRET": ""}, "STRIPE_CONNECT_WEBHOOK_SECRET"),
        ({"ADMIN_USERS": ""}, "ADMIN_USERS"),
        ({"ROOT_DOMAIN": "zenoeats.local"}, "ROOT_DOMAIN"),
        ({"DATABASE_URL_MIGRATE": "postgresql://owner"}, "DATABASE_URL_MIGRATE"),
    ],
)
def test_production_refuses_to_start(overrides, fragment):
    with pytest.raises(RuntimeError) as caught:
        startup_checks.enforce(_production(**overrides))
    assert fragment in str(caught.value)


def test_every_problem_is_reported_at_once():
    """Fixing one variable per failed deploy is a slow way to find five."""
    problems = startup_checks.configuration_problems(
        _production(SESSION_SECRET="", CLERK_SECRET_KEY="", ADMIN_USERS="")
    )
    assert len(problems) == 3


def test_development_only_logs():
    startup_checks.enforce(_production(ENV="development", SESSION_SECRET=""))
