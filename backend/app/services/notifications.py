"""The emails Zenoeats itself sends: order confirmations and staff invitations.

Content rules, both from how the rest of the platform treats the same data:

  * The pickup PIN is never in an email. It is what releases the food at the
    counter, and it stays behind sign-in on the order page (core/crypto.py:
    "never put in a notification body"). The email links there instead.

  * A staff invitation never carries the temporary password. The restaurant
    admin passes that on separately, so a forwarded or leaked invitation
    alone does not open the account.

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
from app.models import Order, OrderItem, Restaurant, RestaurantUser, StaffStatus, User
from app.services import clerk_customers, email

log = logging.getLogger(__name__)

ROLE_WORDS = {
    "ADMIN": "an admin",
    "MANAGER": "a manager",
    "KITCHEN": "kitchen staff",
    "CASHIER": "a cashier",
}


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
        "<!doctype html><html><body style=\"margin:0;padding:24px;background:#F5F3EE;"
        "font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#1A1A17\">"
        "<div style=\"max-width:520px;margin:0 auto;background:#fff;border:1px solid #E2DED4;"
        "border-radius:8px;padding:28px\">"
        f"<h1 style=\"font-family:Georgia,serif;font-weight:400;font-size:24px;margin:0 0 16px\">"
        f"{html.escape(title)}</h1>{body_html}</div></body></html>"
    )


# ------------------------------------------------------ order confirmation ---

def compose_order_confirmation(
    *, restaurant_name: str, slug: str, order: Order, customer_name: str | None
) -> tuple[str, str, str]:
    """(subject, html, text) for a paid order."""
    order_url = storefront_url(slug, f"/orders/{order.id}")
    subject = f"Order #{order.order_number} confirmed at {restaurant_name}"
    greeting = f"Hi {customer_name}," if customer_name else "Hi,"

    rows_html, rows_text = [], []
    for item in order.items:
        extras = [m.option_name_snapshot for m in item.modifiers]
        detail = f" ({', '.join(extras)})" if extras else ""
        rows_html.append(
            "<tr><td style=\"padding:6px 0;vertical-align:top\">"
            f"{item.quantity}&times; {html.escape(item.name_snapshot)}"
            f"<span style=\"color:#6E6A61\">{html.escape(detail)}</span></td>"
            "<td style=\"padding:6px 0;text-align:right;vertical-align:top\">"
            f"{money(item.line_total_minor, order.currency)}</td></tr>"
        )
        rows_text.append(
            f"  {item.quantity} x {item.name_snapshot}{detail}  "
            f"{money(item.line_total_minor, order.currency)}"
        )

    totals = [("Subtotal", order.subtotal_minor)]
    if order.discount_minor:
        totals.append(("Discount", -order.discount_minor))
    totals += [("Tax", order.tax_minor), ("Total", order.total_minor)]
    totals_html = "".join(
        f"<tr><td style=\"padding:4px 0;color:#6E6A61\">{label}</td>"
        f"<td style=\"padding:4px 0;text-align:right\">{money(amount, order.currency)}</td></tr>"
        for label, amount in totals
    )

    body = (
        f"<p>{html.escape(greeting)}</p>"
        f"<p>{html.escape(restaurant_name)} has your order and is making it now.</p>"
        "<table style=\"width:100%;border-collapse:collapse;margin:16px 0;"
        "border-top:1px solid #E2DED4;border-bottom:1px solid #E2DED4\">"
        f"{''.join(rows_html)}</table>"
        f"<table style=\"width:100%;border-collapse:collapse\">{totals_html}</table>"
        "<p style=\"margin-top:20px\">Your pickup PIN is on your order page. Show it at the "
        "counter to collect.</p>"
        f"<p><a href=\"{html.escape(order_url)}\" style=\"display:inline-block;background:#B3341F;"
        "color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px\">View your order"
        "</a></p>"
    )
    text = "\n".join(
        [greeting, "", f"{restaurant_name} has your order #{order.order_number} and is making it now.", ""]
        + rows_text
        + [""]
        + [f"  {label}: {money(amount, order.currency)}" for label, amount in totals]
        + ["", "Your pickup PIN is on your order page. Show it at the counter to collect:", order_url]
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
        to = clerk_customers.receipt_address(customer)
        customer_name = (customer.full_name or "").split(" ")[0] or None

    if not to:
        return False

    subject, body_html, body_text = compose_order_confirmation(
        restaurant_name=restaurant_name, slug=slug, order=order, customer_name=customer_name
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
    *, restaurant_name: str, slug: str, role_code: str, has_temporary_password: bool
) -> tuple[str, str, str]:
    sign_in_url = storefront_url(slug, "/manage/login")
    role = ROLE_WORDS.get(role_code, role_code.lower())
    subject = f"You're invited to join {restaurant_name} on Zenoeats"
    if has_temporary_password:
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
        f"<p><a href=\"{html.escape(sign_in_url)}\" style=\"display:inline-block;background:#B3341F;"
        "color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px\">Sign in to "
        f"{html.escape(restaurant_name)}</a></p>"
        "<p style=\"color:#6E6A61;font-size:13px\">If you weren't expecting this, you can "
        "ignore it. The invitation gives no access until it's accepted.</p>"
    )
    text = "\n".join([
        f"{restaurant_name} has invited you to join their team as {role}.",
        "",
        password_line,
        "",
        f"Sign in: {sign_in_url}",
        "",
        "If you weren't expecting this, you can ignore it. The invitation gives no access "
        "until it's accepted.",
    ])
    return subject, _layout(f"Join {restaurant_name}", body), text


def send_staff_invitation(restaurant_id: UUID, membership_id: UUID) -> bool:
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

    subject, body_html, body_text = compose_staff_invitation(
        restaurant_name=restaurant_name, slug=slug, role_code=role_code,
        has_temporary_password=has_temporary_password,
    )
    # Keyed on when the invitation was issued, so re-inviting someone later
    # sends a fresh email while a retried send of the same one does not.
    stamp = invited_at.astimezone(timezone.utc).isoformat() if invited_at else "none"
    return email.send(email.Email(
        to=to, subject=subject, html=body_html, text=body_text,
        idempotency_key=f"staff-invitation/{membership_id}/{stamp}",
    ))
