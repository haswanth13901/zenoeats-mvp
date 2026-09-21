"""Putting people's identifiers in logs without putting people in logs.

A failed sign-in names an address someone typed -- often a real person who
did nothing, when an attacker is working through a list. Logs are copied to
aggregators, attached to tickets and kept for months, so the address itself
does not belong there. What an investigation needs is to see that the SAME
address keeps failing, and roughly which provider it is on; a masked form and
a short fingerprint give exactly that.
"""

import hashlib
import hmac

from app.config import settings


def email_for_log(email: str | None) -> str:
    """s***@example.com#3f9c1a2b

    The fingerprint is an HMAC keyed with SESSION_SECRET rather than a bare
    hash, so it cannot be reversed by hashing a list of known addresses and
    comparing. The same address gives the same fingerprint for as long as the
    secret is unchanged.
    """
    if not email:
        return "<none>"
    normalized = email.strip().lower()[:320]
    local, sep, domain = normalized.partition("@")
    masked = f"{local[:1]}***@{domain[:64]}" if sep else f"{normalized[:1]}***"
    key = (settings.SESSION_SECRET or "zenoeats-log-fingerprint").encode()
    fingerprint = hmac.new(key, normalized.encode(), hashlib.sha256).hexdigest()[:8]
    return f"{masked}#{fingerprint}"
