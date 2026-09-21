"""Outgoing email through Resend.

One POST per message. What this module decides is what happens when that
POST does not simply succeed:

  * no RESEND_API_KEY     nothing is sent; the attempt is logged, without the
                          message body or the recipient's full address
  * 429 or 5xx, timeouts  RetryableEmailError, so the Celery task retries
  * any other 4xx         logged and dropped: a rejected sender domain or a
                          malformed address will not fix itself on retry

Every send carries an idempotency key. Resend honours it for 24 hours, so a
task retried after the provider accepted the message but before we heard
back does not deliver it twice.
"""

import logging
from dataclasses import dataclass

import httpx

from app.config import settings
from app.core.logsafe import email_for_log

log = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


class RetryableEmailError(Exception):
    """The provider could not take the message now; try again later."""


@dataclass(frozen=True)
class Email:
    to: str
    subject: str
    html: str
    text: str
    idempotency_key: str


def configured() -> bool:
    """Whether anything will actually be sent.

    For a caller that has to tell a person whether an email is on its way.
    The send itself happens later, on the worker, so this cannot promise
    delivery -- but "no provider is configured" is certain, and saying an
    email went when none can is how a restaurant ended up waiting on
    invitations that were never sent.
    """
    return bool(settings.RESEND_API_KEY)


def send(email: Email) -> bool:
    """Deliver one message. True when the provider accepted it."""
    if not configured():
        log.info(
            "RESEND_API_KEY is not set; not sending %r to %s",
            email.subject, email_for_log(email.to),
        )
        return False

    body = {
        "from": settings.EMAIL_FROM,
        "to": [email.to],
        "subject": email.subject,
        "html": email.html,
        "text": email.text,
    }
    if settings.EMAIL_REPLY_TO:
        body["reply_to"] = settings.EMAIL_REPLY_TO

    try:
        res = httpx.post(
            RESEND_URL,
            json=body,
            headers={
                "Authorization": f"Bearer {settings.RESEND_API_KEY}",
                "Idempotency-Key": email.idempotency_key[:256],
            },
            timeout=10.0,
        )
    except httpx.HTTPError as exc:
        raise RetryableEmailError(f"email provider unreachable: {type(exc).__name__}") from exc

    if res.status_code == 429 or res.status_code >= 500:
        raise RetryableEmailError(f"email provider answered {res.status_code}")
    if res.status_code >= 400:
        # The body names the problem (an unverified domain, say) and carries no
        # secret, so it is worth the log line. The recipient is masked.
        log.error(
            "email %r to %s rejected (%s): %s",
            email.subject, email_for_log(email.to), res.status_code, res.text[:300],
        )
        return False

    log.info("sent %r to %s", email.subject, email_for_log(email.to))
    return True
