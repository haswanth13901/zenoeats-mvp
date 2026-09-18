"""A customer's saved details: name, phone, address.

Checkout requires all three on every order and keeps them on the order as a
snapshot. This is the other copy -- the one offered back next time -- so it is
refreshed whenever someone orders, and never read to decide what an order
says.

Guests get the same treatment. Their row lives exactly as long as their
session, which is long enough for a second order from the same browser not to
ask twice.

Email is deliberately not here. A signed-in customer's comes from Clerk, which
verified it; a guest's is fixed when the session begins. A form field that
could quietly re-address someone's receipts is not a detail worth saving.
"""

from app.db.session import system_session
from app.models import User, UserKind
from app.schemas.api import ContactIn


def save_contact(user_id, contact: ContactIn) -> None:
    """Remember what this customer just ordered with.

    users is a platform table with no tenant policy, so this is the system
    role, in its own short transaction: the order it came from does not
    depend on it, and a failure here must not cost the customer their order.
    """
    with system_session() as session:
        user = session.get(User, user_id)
        if user is None or user.kind not in (UserKind.CUSTOMER.value, UserKind.GUEST.value):
            return
        user.full_name = contact.full_name
        user.phone = contact.phone
        user.address = contact.address
