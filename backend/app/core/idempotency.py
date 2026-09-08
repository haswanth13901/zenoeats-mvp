"""Durable idempotency for critical mutations.

Required on order creation and PaymentIntent creation. Same actor, same
endpoint, same key:
  - identical request body  -> replay the stored response
  - different request body  -> 409 IDEMPOTENCY_KEY_REUSED

The record is written in the same transaction as the business mutation, so a
crash between "charge succeeded" and "response stored" cannot produce a
duplicate on retry.
"""

import hashlib
import json
from datetime import timedelta
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.core import errors
from app.db.base import utcnow
from app.models import IdempotencyKey


def hash_request(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def lookup(
    session: Session, *, key: str, actor_id: UUID, endpoint: str, request_hash: str
) -> dict | None:
    """Return a stored response for a replay, or None to proceed.

    Raises IDEMPOTENCY_KEY_REUSED when the key was used with a different body.
    """
    row = session.execute(
        select(IdempotencyKey).where(
            IdempotencyKey.key == key,
            IdempotencyKey.actor_id == actor_id,
            IdempotencyKey.endpoint == endpoint,
        )
    ).scalar_one_or_none()

    if row is None:
        return None
    if row.request_hash != request_hash:
        raise errors.idempotency_key_reused()
    if row.expires_at <= utcnow():
        session.delete(row)
        session.flush()
        return None
    return row.response_body


def store(
    session: Session,
    *,
    key: str,
    actor_id: UUID,
    endpoint: str,
    request_hash: str,
    status: int,
    body: dict,
) -> None:
    now = utcnow()
    session.add(
        IdempotencyKey(
            key=key,
            actor_id=actor_id,
            endpoint=endpoint,
            request_hash=request_hash,
            response_status=status,
            response_body=body,
            created_at=now,
            expires_at=now + timedelta(hours=settings.IDEMPOTENCY_TTL_HOURS),
        )
    )
    session.flush()
