"""Database access with mandatory transaction-local tenant context.

Three PostgreSQL roles, per rule 18 of the architecture baseline:

  zenoeats_migrate  owns the schema. Alembic only. Never used at runtime.
  zenoeats_app      request path and tenant-scoped worker execution.
                    Non-owner, NOBYPASSRLS, subject to FORCE RLS.
  zenoeats_system   narrow cross-tenant discovery and the webhook inbox.
                    Non-owner, NOBYPASSRLS, explicit column grants only.

Tenant context is set with SET LOCAL inside a transaction so it is discarded
on commit or rollback and never leaks back into the connection pool.
Session-level SET is prohibited.
"""

from contextlib import contextmanager
from typing import Iterator
from uuid import UUID

from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.config import settings

_app_engine = create_engine(
    settings.DATABASE_URL_APP,
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=True,
    future=True,
)

_system_engine = create_engine(
    settings.DATABASE_URL_SYSTEM,
    pool_size=5,
    max_overflow=5,
    pool_pre_ping=True,
    future=True,
)

AppSessionLocal = sessionmaker(bind=_app_engine, autoflush=False, future=True)
SystemSessionLocal = sessionmaker(bind=_system_engine, autoflush=False, future=True)


@contextmanager
def tenant_session(restaurant_id: UUID) -> Iterator[Session]:
    """Open a zenoeats_app transaction bound to one tenant.

    Everything inside is filtered by FORCE ROW LEVEL SECURITY. A query for
    another tenant's rows returns zero rows at the database layer even if the
    application-level authorization check were removed.
    """
    session = AppSessionLocal()
    try:
        session.begin()
        session.execute(
            text("SELECT set_config('app.current_tenant', :tid, true)"),
            {"tid": str(restaurant_id)},
        )
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


@contextmanager
def system_session() -> Iterator[Session]:
    """Open a zenoeats_system transaction.

    Only for the platform-owned tables (stripe_events, idempotency_keys,
    users, platform_audit_logs) and the declared narrow cross-tenant
    discovery surface. Never used for tenant business mutations: resolve the
    restaurant_id here, then switch to tenant_session() to do the work.
    """
    session = SystemSessionLocal()
    try:
        session.begin()
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def app_engine():
    return _app_engine


def system_engine():
    return _system_engine
