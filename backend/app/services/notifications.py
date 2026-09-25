"""The emails Zenoeats itself sends: order confirmations and staff invitations.

Content rules, both from how the rest of the platform treats the same data:

  * The pickup PIN is never in an email. It is what releases the food at the
    counter, and it stays behind sign-in on the order page (core/crypto.py:
    "never put in a notification body"). The email links there instead.

  * A staff invitation carries the temporary password it issued, so the new
    member can sign in without the admin passing it on by hand. That was a
    decision, not an oversight: it means whoever reads the email can sign in
    first. What bounds it is that the password must be replaced at first
    sign-in and stops working then -- so it is only ever sent while that is
    still pending, and never for a login that already has its own password.

  * Everything a restaurant or customer typed -- item names, the restaurant's
    name, notes -- is HTML-escaped before it goes into a message.
"""

import html
import logging
from datetime import timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.config import settings
from app.db.base import utcnow
from app.db.session import system_session, tenant_session
from app.core import guest_auth
from app.models import (
    Order, OrderItem, Restaurant, RestaurantUser, StaffStatus, User, UserKind,
)
from app.services import clerk_customers, email

log = logging.getLogger(__name__)

ROLE_WORDS = {
    "ADMIN": "an admin",
    "MANAGER": "a manager",
    "KITCHEN": "kitchen staff",
    "CASHIER": "a cashier",
    "DRIVER": "a driver",
    "IT_SUPPORT": "IT support",
}

# The design tokens for transactional email (design-tokens.json, "emails").
# Inline styles and a table layout, because mail clients ignore stylesheets
# and many ignore max-width on a div. No webfonts, images or SVG: nothing
# that needs a request to render, and nothing a client may strip.
_PAPER = "#F7F4EF"
_CARD = "#FFFFFF"
_LINE = "#DDDCD3"
_INK = "#252620"
_MUTED = "#67695F"
_CTA = "#A83E2A"
_BODY_FONT = "system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif"


def _button(href: str, label_html: str) -> str:
    """The one call to action: an ordinary link, which the plain-text part repeats."""
    return (
        f"<p style=\"margin:24px 0 0\"><a href=\"{html.escape(href)}\" "
        f"style=\"display:inline-block;background:{_CTA};color:#FFFFFF;text-decoration:none;"
        f"font-weight:600;padding:12px 20px;border-radius:10px\">{label_html}</a></p>"
    )


def storefront_url(slug: str, path: str = "/") -> str:
    base = settings.STOREFRONT_URL_TEMPLATE.format(slug=slug, root_domain=settings.ROOT_DOMAIN)
    return base.rstrip("/") + path


def money(amount_minor: int, currency: str) -> str:
    sign = "-" if amount_minor < 0 else ""
    whole, cents = divmod(abs(amount_minor), 100)
    if currency.upper() == "USD":
        return f"{sign}${whole:,}.{cents:02d}"
    return f"{sign}{whole:,}.{cents:02d} {currency.upper()}"


def _layout(title: str, body_html: str) -> str:
    return (
        "<!doctype html><html><head><meta name=\"viewport\" "
        "content=\"width=device-width,initial-scale=1\"></head>"
        f"<body style=\"margin:0;padding:0;background:{_PAPER}\">"
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
        f"style=\"background:{_PAPER}\"><tr><td align=\"center\" style=\"padding:24px 16px\">"
        "<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" "
        f"style=\"max-width:600px;background:{_CARD};border:1px solid {_LINE};border-radius:14px\">"
        f"<tr><td style=\"padding:30px 28px;font-family:{_BODY_FONT};font-size:15px;"
        f"line-height:1.55;color:{_INK};text-align:left\">"
        "<h1 style=\"font-family:Georgia,'Times New Roman',serif;font-weight:400;"
        f"font-size:30px;line-height:1.2;margin:0 0 20px;color:{_INK}\">"
        f"{html.escape(title)}</h1>{body_html}"
        "</td></tr></table></td></tr></table></body></html>"
    )


# ------------------------------------------------------ order confirmation ---

def compose_order_confirmation(
    *,
    restaurant_name: str,
    slug: str,
    order: Order,
    customer_name: str | None,
    for_guest: bool = False,
) -> tuple[str, str, str]:
    """(subject, html, text) for a paid order.

    A guest's copy carries a view token on the order link. Their session is a
    cookie in one browser, so without it this email -- opened on a laptop, or
    after clearing the browser -- would lead to "we can't find that order",
    and the pickup PIN it promises would be unreachable.
    """
    path = f"/orders/{order.id}"
    if for_guest:
        # In the fragment, never the query. A browser does not send the part
        # after "#" to any server, so the token stays out of every access log
        # and Referer on the way; the page reads it from there and hands it to
        # the API in a header.
        path += f"#t={guest_auth.issue_order_token(order.id)}"
    order_url = storefront_url(slug, path)
    subject = f"Order #{order.order_number} confirmed at {restaurant_name}"
    greeting = f"Hi {customer_name}," if customer_name else "Hi,"

    rows_html, rows_text = [], []
    for item in order.items:
        extras = [m.option_name_snapshot for m in item.modifiers]
        detail = f" ({', '.join(extras)})" if extras else ""
        rows_html.append(
            "<tr><td style=\"padding:8px 0;vertical-align:top\">"
            f"{item.quantity}&times; {html.escape(item.name_snapshot)}"
            f"<span style=\"color:{_MUTED}\">{html.escape(detail)}</span></td>"
            "<td style=\"padding:8px 0 8px 16px;text-align:right;vertical-align:top;"
            "white-space:nowrap\">"
            f"{money(item.line_total_minor, order.currency)}</td></tr>"
        )
        rows_text.append(
            f"  {item.quantity} x {item.name_snapshot}{detail}  "
            f"{money(item.line_total_minor, order.currency)}"
        )

    delivering = order.fulfillment_type == "DELIVERY"
    totals = [("Subtotal", order.subtotal_minor)]
    if order.discount_minor:
        totals.append(("Discount", -order.discount_minor))
    # Without its fee a delivery's figures would not add up to its total.
    if order.delivery_fee_minor:
        totals.append(("Delivery fee", order.delivery_fee_minor))
    totals += [("Tax", order.tax_minor), ("Total", order.total_minor)]
    def total_row(label: str, amount: int) -> str:
        # The total is the one figure that is ink and bold; the rest are its parts.
        weight = "font-weight:600" if label == "Total" else f"color:{_MUTED}"
        return (
            f"<tr><td style=\"padding:4px 0;{weight}\">{label}</td>"
            f"<td style=\"padding:4px 0;text-align:right;{weight}\">"
            f"{money(amount, order.currency)}</td></tr>"
        )

    totals_html = "".join(total_row(label, amount) for label, amount in totals)

    # A delivery has no PIN: nobody collects it at a counter. Promising one
    # sends the customer looking for something that does not exist.
    next_step = (
        "Your order page shows its progress, and where your driver is once it is on the way."
        if delivering
        else "Your pickup PIN is on your order page. Show it at the counter to collect."
    )

    body = (
        f"<p>{html.escape(greeting)}</p>"
        f"<p>{html.escape(restaurant_name)} has your order and is making it now.</p>"
        "<table role=\"presentation\" style=\"width:100%;border-collapse:collapse;margin:20px 0;"
        f"border-top:1px solid {_LINE};border-bottom:1px solid {_LINE};font-size:14px\">"
        f"{''.join(rows_html)}</table>"
        "<table role=\"presentation\" style=\"width:100%;border-collapse:collapse;font-size:14px\">"
        f"{totals_html}</table>"
        f"<p style=\"margin-top:20px\">{html.escape(next_step)}</p>"
        + _button(order_url, "View your order")
    )
    text = "\n".join(
        [greeting, "", f"{restaurant_name} has your order #{order.order_number} and is making it now.", ""]
        + rows_text
        + [""]
        + [f"  {label}: {money(amount, order.currency)}" for label, amount in totals]
        + ["", f"{next_step[:-1]}:", order_url]
    )
    return subject, _layout(f"Order #{order.order_number} confirmed", body), text


def send_order_confirmation(restaurant_id: UUID, order_id: UUID) -> bool:
    """Send the confirmation for a paid order, once. True when sent now."""
    with tenant_session(restaurant_id) as session:
        order = session.execute(
            select(Order)
            .where(Order.id == order_id)
            .options(selectinload(Order.items).selectinload(OrderItem.modifiers))
        ).scalar_one_or_none()
        restaurant = session.get(Restaurant, restaurant_id)
        if order is None or restaurant is None:
            return False
        if order.confirmation_email_sent_at is not None or order.paid_at is None:
            return False
        restaurant_name, slug = restaurant.name, restaurant.slug
        customer_id = order.customer_user_id
        session.expunge_all()

    with system_session() as session:
        customer = session.get(User, customer_id)
        if customer is None:
            return False
        to = order.contact_email or clerk_customers.receipt_address(customer)
        customer_name = (order.contact_name or customer.full_name or "").split(" ")[0] or None
        for_guest = customer.kind == UserKind.GUEST.value

    if not to:
        return False

    subject, body_html, body_text = compose_order_confirmation(
        restaurant_name=restaurant_name, slug=slug, order=order,
        customer_name=customer_name, for_guest=for_guest,
    )
    sent = email.send(email.Email(
        to=to, subject=subject, html=body_html, text=body_text,
        idempotency_key=f"order-confirmation/{order_id}",
    ))
    if sent:
        with tenant_session(restaurant_id) as session:
            row = session.get(Order, order_id)
            if row is not None and row.confirmation_email_sent_at is None:
                row.confirmation_email_sent_at = utcnow()
    return sent


# ------------------------------------------------------- staff invitation ---

def compose_staff_invitation(
    *, restaurant_name: str, slug: str, role_code: str, has_temporary_password: bool,
    temporary_password: str | None = None,
) -> tuple[str, str, str]:
    sign_in_url = storefront_url(slug, "/manage/login")
    role = ROLE_WORDS.get(role_code, role_code.lower())
    subject = f"You're invited to join {restaurant_name} on Zenoeats"
    password_html = ""
    if temporary_password:
        password_line = (
            "Sign in with the temporary password below. You'll choose your own the first time "
            "you sign in (this one stops working then), and then accept the invitation."
        )
        password_html = (
            f"<p style=\"margin:16px 0 0;color:{_MUTED};font-size:13px\">Temporary password</p>"
            "<p style=\"margin:4px 0 0;font-family:ui-monospace,Menlo,Consolas,monospace;"
            "font-size:20px;letter-spacing:1px\">"
            f"{html.escape(temporary_password)}</p>"
        )
    elif has_temporary_password:
        password_line = (
            "Your manager will give you a temporary password. You'll choose your own the first "
            "time you sign in, then accept the invitation."
        )
    else:
        password_line = (
            "Sign in with the Zenoeats staff password you already use, then accept the invitation."
        )

    body = (
        f"<p>{html.escape(restaurant_name)} has invited you to join their team as "
        f"{html.escape(role)}.</p>"
        f"<p>{html.escape(password_line)}</p>"
        + password_html
        + _button(sign_in_url, f"Sign in to {html.escape(restaurant_name)}")
        + f"<p style=\"color:{_MUTED};font-size:13px;margin-top:24px\">If you weren't expecting "
        "this, you can "
        "ignore it. The invitation gives no access until it's accepted.</p>"
    )
    text = "\n".join([
        f"{restaurant_name} has invited you to join their team as {role}.",
        "",
        password_line,
        *(["", f"Temporary password: {temporary_password}"] if temporary_password else []),
        "",
        f"Sign in: {sign_in_url}",
        "",
        "If you weren't expecting this, you can ignore it. The invitation gives no access "
        "until it's accepted.",
    ])
    return subject, _layout(f"Join {restaurant_name}", body), text


def send_staff_invitation(
    restaurant_id: UUID, membership_id: UUID, temporary_password: str | None = None
) -> bool:
    with tenant_session(restaurant_id) as session:
        membership = session.get(RestaurantUser, membership_id)
        restaurant = session.get(Restaurant, restaurant_id)
        if membership is None or restaurant is None:
            return False
        if membership.status != StaffStatus.INVITED.value:
            return False  # accepted or revoked since; nothing to invite to
        user_id, role_code = membership.user_id, membership.role_code
        invited_at = membership.invited_at
        restaurant_name, slug = restaurant.name, restaurant.slug

    with system_session() as session:
        user = session.get(User, user_id)
        if user is None:
            return False
        to, has_temporary_password = user.email, bool(user.must_change_password)

    # Only while it still works. A retry can run long after the invitation --
    # by then they may have signed in and chosen their own, and a stale
    # password in an inbox is a thing to leave out, not to resend.
    subject, body_html, body_text = compose_staff_invitation(
        restaurant_name=restaurant_name, slug=slug, role_code=role_code,
        has_temporary_password=has_temporary_password,
        temporary_password=temporary_password if has_temporary_password else None,
    )
    # Keyed on when the invitation was issued, so re-inviting someone later
    # -- or resending it -- sends a fresh email while a retried send of the
    # same one does not.
    stamp = invited_at.astimezone(timezone.utc).isoformat() if invited_at else "none"
    outcome = email.deliver(email.Email(
        to=to, subject=subject, html=body_html, text=body_text,
        idempotency_key=f"staff-invitation/{membership_id}/{stamp}",
    ))
    record_invitation_outcome(restaurant_id, membership_id, outcome, invited_at)
    return outcome.sent


def record_invitation_outcome(
    restaurant_id: UUID, membership_id: UUID, outcome: "email.Outcome", invited_at=None,
) -> None:
    """Note on the membership what became of its invitation email, for the
    team list. Only if the invitation is still the one this email was for: a
    resend issued while this one was in flight owns the status now, and an
    older attempt finishing late must not overwrite it."""
    with tenant_session(restaurant_id) as session:
        membership = session.get(RestaurantUser, membership_id)
        if membership is None:
            return
        if invited_at is not None and membership.invited_at != invited_at:
            return
        membership.invitation_email_status = outcome.status
        membership.invitation_email_at = utcnow()
        membership.invitation_email_problem = outcome.problem[:200] if outcome.problem else None
