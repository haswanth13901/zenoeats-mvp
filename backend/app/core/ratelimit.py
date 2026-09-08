"""Fixed-window rate limiting on the redis-runtime instance.

Section 23: this is the cache/limiter instance, deliberately separate from
the Celery broker. It runs allkeys-lru and holds nothing durable, so cache
pressure here can never evict a queued payment webhook.

Design notes:

  * Fixed window, not a token bucket. A window boundary lets through at most
    2x the limit in the worst case, which is fine for abuse control and costs
    one round trip instead of a Lua script.

  * FAIL OPEN. If Redis is unreachable the limiter logs and allows the
    request. A limiter outage must not stop a restaurant taking orders --
    losing revenue to protect against hypothetical abuse is the wrong trade
    for this business. The log line is the signal to go fix Redis.

  * Keys carry the window start, so they expire on their own and no sweeper
    is needed.
"""

import logging
import time
from typing import Callable

from fastapi import Depends, Request
from redis import Redis
from redis.exceptions import RedisError

from app.api.deps import get_current_user
from app.config import settings
from app.core import errors
from app.models import User

log = logging.getLogger(__name__)

_client: Redis | None = None


def runtime_redis() -> Redis:
    """Lazy singleton. Built on first use so importing this module never
    opens a socket (tests and Alembic import the app without Redis)."""
    global _client
    if _client is None:
        _client = Redis.from_url(
            settings.REDIS_RUNTIME_URL,
            socket_timeout=0.25,
            socket_connect_timeout=0.25,
            decode_responses=True,
        )
    return _client


def _client_ip(request: Request) -> str:
    """Left-most X-Forwarded-For entry, else the socket address.

    Only trustworthy because the origin is not directly reachable: nginx
    rewrites this header and the firewall allows only the proxy (18.2). If
    the app is ever exposed directly, this becomes spoofable.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def _consume(bucket: str, limit: int, window_seconds: int) -> None:
    now = int(time.time())
    key = f"rl:{bucket}:{now // window_seconds}"
    try:
        redis = runtime_redis()
        pipe = redis.pipeline()
        pipe.incr(key)
        pipe.expire(key, window_seconds)
        count, _ = pipe.execute()
    except RedisError:
        log.warning("rate limiter unavailable, allowing request on %s", bucket, exc_info=True)
        return

    if count > limit:
        log.info("rate limit hit on %s (%s/%s)", bucket, count, limit)
        raise errors.ApiError(
            429, "RATE_LIMITED", "Too many requests. Wait a moment and try again."
        )


def per_ip(name: str, limit: int, window_seconds: int = 60) -> Callable:
    """Limit by client address. For endpoints reachable without a session."""

    def dependency(request: Request) -> None:
        _consume(f"{name}:ip:{_client_ip(request)}", limit, window_seconds)

    return dependency


def per_user(name: str, limit: int, window_seconds: int = 60) -> Callable:
    """Limit by authenticated user.

    Keyed on the Clerk-verified user id, so it cannot be shaken off by
    rotating IPs, and one abusive account cannot exhaust the budget of
    everyone behind the same NAT.
    """

    def dependency(user: User = Depends(get_current_user)) -> None:
        _consume(f"{name}:user:{user.id}", limit, window_seconds)

    return dependency
