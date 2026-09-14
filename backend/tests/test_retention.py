"""The retention sweep removes exactly what has stopped mattering.

Against the real database, because the point is which rows survive: an
expired idempotency key goes, a live one stays; a year-old processed webhook
goes, a year-old failed one stays for someone to look at.
"""

import uuid
from datetime import timedelta

import pytest
from sqlalchemy import text

from app.config import settings
from app.db.base import utcnow
from app.services import retention

pytestmark = pytest.mark.integration


def _exists(table: str, row_id) -> bool:
    with retention._platform_transaction() as session:
        return session.execute(
            text(f"SELECT 1 FROM {table} WHERE id = :id"), {"id": row_id}
        ).first() is not None


def _idempotency_key(expires_at) -> uuid.UUID:
    row_id = uuid.uuid4()
    with retention._platform_transaction() as session:
        session.execute(
            text(
                "INSERT INTO idempotency_keys (id, key, actor_id, endpoint, request_hash, "
                "created_at, expires_at) VALUES (:id, :key, :actor, 'test', 'h', now(), :exp)"
            ),
            {"id": row_id, "key": uuid.uuid4().hex, "actor": uuid.uuid4(), "exp": expires_at},
        )
    return row_id


def _stripe_event(status: str, received_at) -> uuid.UUID:
    row_id = uuid.uuid4()
    with retention._platform_transaction() as session:
        session.execute(
            text(
                "INSERT INTO stripe_events (id, stripe_event_id, type, payload, status, "
                "received_at, attempts) VALUES (:id, :eid, 'test', '{}'::jsonb, :status, :at, 0)"
            ),
            {"id": row_id, "eid": f"evt_test_{uuid.uuid4().hex}", "status": status, "at": received_at},
        )
    return row_id


def test_expired_idempotency_keys_go_and_live_ones_stay():
    expired = _idempotency_key(utcnow() - timedelta(minutes=1))
    live = _idempotency_key(utcnow() + timedelta(hours=1))

    retention.sweep()

    assert not _exists("idempotency_keys", expired)
    assert _exists("idempotency_keys", live)
    retention.sweep()  # idempotent


def test_only_old_settled_webhook_deliveries_are_removed(monkeypatch):
    monkeypatch.setattr(settings, "WEBHOOK_EVENT_RETENTION_DAYS", 30)
    old = utcnow() - timedelta(days=31)
    recent = utcnow() - timedelta(days=1)

    old_processed = _stripe_event("PROCESSED", old)
    old_ignored = _stripe_event("IGNORED", old)
    old_failed = _stripe_event("FAILED", old)
    old_received = _stripe_event("RECEIVED", old)
    recent_processed = _stripe_event("PROCESSED", recent)

    try:
        retention.sweep()

        assert not _exists("stripe_events", old_processed)
        assert not _exists("stripe_events", old_ignored)
        # Work not done, and evidence of a problem, are never swept away.
        assert _exists("stripe_events", old_failed)
        assert _exists("stripe_events", old_received)
        assert _exists("stripe_events", recent_processed)
    finally:
        with retention._platform_transaction() as session:
            session.execute(
                text("DELETE FROM stripe_events WHERE id IN (:a, :b, :c)"),
                {"a": old_failed, "b": old_received, "c": recent_processed},
            )


def test_zero_retention_keeps_every_webhook_delivery(monkeypatch):
    monkeypatch.setattr(settings, "WEBHOOK_EVENT_RETENTION_DAYS", 0)
    ancient = _stripe_event("PROCESSED", utcnow() - timedelta(days=4000))
    try:
        retention.sweep()
        assert _exists("stripe_events", ancient)
    finally:
        with retention._platform_transaction() as session:
            session.execute(text("DELETE FROM stripe_events WHERE id = :id"), {"id": ancient})
