"""Housekeeping for tables that only ever grow.

  idempotency_keys   A key is only useful until it expires. Expired rows were
                     deleted solely when the same key happened to be reused,
                     which almost never happens, so the table kept every key
                     ever sent.

  stripe_events      Webhook inboxes. A row matters until it is processed;
  clerk_events       after that it is a record of a delivery, kept for
                     WEBHOOK_EVENT_RETENTION_DAYS. Rows still RECEIVED or
                     FAILED are never removed -- they are work, or evidence
                     of a problem someone has to look at. The audit trail of
                     what operators did lives in platform_audit_logs, which
                     this never touches.

Runs as zenoeats_app. None of these tables carries a restaurant_id or a
row-level security policy, and zenoeats_system deliberately has no DELETE on
them. Deletes go in batches so a large backlog never holds a long lock on a
table the webhook path writes to.
"""

import logging
from contextlib import contextmanager
from datetime import timedelta
from typing import Iterator

from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import settings
from app.db.base import utcnow
from app.db.session import AppSessionLocal

log = logging.getLogger(__name__)

BATCH_SIZE = 5_000
# Bounded so one run cannot monopolise a worker; the next run picks up the rest.
MAX_BATCHES_PER_TABLE = 20

SETTLED_EVENT_STATUSES = ("PROCESSED", "IGNORED")


@contextmanager
def _platform_transaction() -> Iterator[Session]:
    session = AppSessionLocal()
    try:
        session.begin()
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _delete_in_batches(table: str, where: str, params: dict) -> int:
    removed = 0
    for _ in range(MAX_BATCHES_PER_TABLE):
        with _platform_transaction() as session:
            result = session.execute(
                text(
                    f"DELETE FROM {table} WHERE id IN "
                    f"(SELECT id FROM {table} WHERE {where} LIMIT :batch)"
                ),
                {**params, "batch": BATCH_SIZE},
            )
        count = result.rowcount or 0
        removed += count
        if count < BATCH_SIZE:
            break
    return removed


def sweep() -> dict[str, int]:
    removed = {
        "idempotency_keys": _delete_in_batches(
            "idempotency_keys", "expires_at <= :now", {"now": utcnow()}
        )
    }

    days = settings.WEBHOOK_EVENT_RETENTION_DAYS
    if days > 0:
        cutoff = utcnow() - timedelta(days=days)
        for table in ("stripe_events", "clerk_events"):
            removed[table] = _delete_in_batches(
                table,
                f"status IN {SETTLED_EVENT_STATUSES!r} AND received_at < :cutoff",
                {"cutoff": cutoff},
            )

    if any(removed.values()):
        log.info("retention sweep removed %s", removed)
    return removed
