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
class Outcome:
    """What became of one attempt, for a caller that has to tell a person.

    `status` is SENT, FAILED or NOT_CONFIGURED. `problem` is written for a
    restaurant admin -- never the provider's raw reply, which can name the
    platform's own accounts; that goes to the log instead.
    """

    status: str
    problem: str | None = None

    @property
    def sent(self) -> bool:
        return self.status == "SENT"


def _problem(status_code: int, reply: str) -> str:
    """The provider's refusal, in words fit for the admin who sent the invite."""
    lowered = reply.lower()
    if "testing emails" in lowered or "verify a domain" in lowered:
        return (
            "Not delivered: until a sending domain is verified with the email provider, "
            "it only delivers to the platform's own address."
        )
    if status_code in (401, 403) and ("api key" in lowered or "api_key" in lowered):
        return "Not delivered: the email provider did not accept Zenoeats' credentials."
    if status_code == 422 or ("invalid" in lowered and "email" in lowered):
        return "Not delivered: the email provider says this address is not valid."
    return f"Not delivered: the email provider refused it (HTTP {status_code})."


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
    return deliver(email).sent


def deliver(email: Email) -> Outcome:
    """Deliver one message, and say what happened in a form a person can read.

    Raises RetryableEmailError for the cases worth trying again; everything
    else is an answer.
    """
    if not configured():
        log.info(
            "RESEND_API_KEY is not set; not sending %r to %s",
            email.subject, email_for_log(email.to),
        )
        return Outcome("NOT_CONFIGURED", "Not sent: email is not set up on this server.")

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
        return Outcome("FAILED", _problem(res.status_code, res.text))

    log.info("sent %r to %s", email.subject, email_for_log(email.to))
    return Outcome("SENT")
