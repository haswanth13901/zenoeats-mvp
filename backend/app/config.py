from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# The .env file lives at the repository root, not inside backend/. Resolving
# it from this file's location means alembic, uvicorn, celery and pytest all
# find the same configuration regardless of which directory they run from.
#
# Inside Docker this path resolves to a file that does not exist, which is
# correct: compose passes the same values as real environment variables via
# env_file:, and pydantic-settings reads those first.
ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    # --- Platform ---------------------------------------------------------
    ENV: str = "development"
    ROOT_DOMAIN: str = "zenoeats.local"
    LOG_LEVEL: str = "INFO"

    # --- Database ---------------------------------------------------------
    # Request-path role. Non-owner, NOBYPASSRLS, FORCE RLS applies.
    DATABASE_URL_APP: str
    # Narrow cross-tenant discovery role for workers and the webhook inbox.
    DATABASE_URL_SYSTEM: str
    # Alembic only. Owns the schema. Never used by runtime code.
    DATABASE_URL_MIGRATE: str

    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 10

    # --- Redis / Celery ---------------------------------------------------
    CELERY_BROKER_URL: str = "redis://redis-broker:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://redis-broker:6379/1"
    # Cache and rate limiting. A separate instance from the broker on
    # purpose: this one evicts under pressure, the broker never does.
    REDIS_RUNTIME_URL: str = "redis://redis-runtime:6379/0"

    # --- Clerk ------------------------------------------------------------
    CLERK_JWKS_URL: str = ""
    CLERK_ISSUER: str = ""
    CLERK_WEBHOOK_SECRET: str = ""
    # Set true only for local development without a Clerk instance.
    AUTH_DEV_BYPASS: bool = False

    # --- Stripe -----------------------------------------------------------
    STRIPE_SECRET_KEY: str = ""
    STRIPE_PUBLISHABLE_KEY: str = ""
    STRIPE_CONNECT_WEBHOOK_SECRET: str = ""

    # --- Crypto -----------------------------------------------------------
    # Fernet key. Generate with:
    #   python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    FIELD_ENCRYPTION_KEY: str

    # --- Order policy -----------------------------------------------------
    PENDING_PAYMENT_TTL_MINUTES: int = 30
    IDEMPOTENCY_TTL_HOURS: int = 24
    MAX_ITEMS_PER_ORDER: int = 50

    CORS_ORIGINS: str = "*"


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()