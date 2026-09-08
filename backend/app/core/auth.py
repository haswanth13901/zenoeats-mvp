"""Clerk session verification.

Clerk owns credentials, sessions, email verification, password reset and MFA.
It does not own authorization. We verify the JWT signature against Clerk's
JWKS, extract the subject, and then resolve every permission from our own
tables. Rule 9 stands: hiding UI controls is never sufficient, and neither is
trusting a claim the client sent us.

In particular org_id in the token is a hint. It is never the tenant key.
"""

import logging
from dataclasses import dataclass

import jwt
from jwt import PyJWKClient

from app.config import settings

log = logging.getLogger(__name__)

_jwk_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    global _jwk_client
    if _jwk_client is None:
        if not settings.CLERK_JWKS_URL:
            raise RuntimeError("CLERK_JWKS_URL is not configured")
        _jwk_client = PyJWKClient(settings.CLERK_JWKS_URL, cache_keys=True)
    return _jwk_client


@dataclass(frozen=True)
class ClerkPrincipal:
    clerk_user_id: str
    email: str | None
    org_id: str | None
    org_role: str | None


class AuthError(Exception):
    pass


def verify_clerk_token(token: str) -> ClerkPrincipal:
    if settings.AUTH_DEV_BYPASS:
        # Local development escape hatch. The token is read as a bare Clerk
        # user id. Guarded by an env flag that must never be true outside
        # development; startup refuses to boot with it on in production.
        return ClerkPrincipal(clerk_user_id=token, email=None, org_id=None, org_role=None)

    try:
        signing_key = _jwks().get_signing_key_from_jwt(token)
        claims = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            issuer=settings.CLERK_ISSUER or None,
            options={
                "verify_aud": False,
                "require": ["exp", "iat", "sub"],
            },
            leeway=10,
        )
    except jwt.PyJWTError as exc:
        log.info("clerk token rejected: %s", type(exc).__name__)
        raise AuthError("Invalid or expired session.") from exc

    return ClerkPrincipal(
        clerk_user_id=claims["sub"],
        email=claims.get("email"),
        org_id=claims.get("org_id"),
        org_role=claims.get("org_role"),
    )
