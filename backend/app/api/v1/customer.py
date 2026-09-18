"""The customer's own page: their details, their orders, their favourites.

All of it is scoped twice. RLS confines every read to the restaurant whose
storefront this is, so a profile on one restaurant's subdomain shows that
restaurant's orders and favourites and nobody else's. And every query names
the caller, so it shows theirs.

Details and orders are open to guests as well as signed-in customers: a guest
session is a real identity for as long as it lasts, and showing it its own
order is no different from the tracking page doing so. Favourites are not. A
guest session lasts about as long as one checkout, and a saved list that
vanished with it would be worse than none, so saving one asks for an account.
"""

from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session, selectinload

from app.api.deps import TenantDb, current_restaurant, get_current_user
from app.core import errors
from app.core.ratelimit import per_user
from app.models import (
    CustomerFavourite, Item, Order, OrderStatus, Restaurant, User, UserKind,
)
from app.schemas.api import ContactIn, CustomerSessionOut
from app.services import clerk_customers, customer_profile

router = APIRouter(prefix="/customer", tags=["customer"])

# Orders nobody paid for are not history: an abandoned checkout expired, and
# one still awaiting payment is on the checkout page, not behind the customer.
_UNPAID = (OrderStatus.PENDING_PAYMENT.value, OrderStatus.EXPIRED.value)


def _session_out(user: User) -> CustomerSessionOut:
    return CustomerSessionOut(
        email=user.email,
        full_name=user.full_name,
        phone=user.phone,
        address=user.address,
        email_pending=clerk_customers.has_placeholder_email(user),
        is_guest=user.kind == UserKind.GUEST.value,
    )


# ------------------------------------------------------------- details ---

@router.put(
    "/profile",
    response_model=CustomerSessionOut,
    dependencies=[Depends(per_user("customer_profile", limit=30))],
)
def update_profile(
    body: ContactIn,
    user: User = Depends(get_current_user),
    _restaurant: Restaurant = Depends(current_restaurant),
):
    """Save name, phone and address.

    The same three checkout requires and the same rules, because these are
    what checkout offers back. Email is not editable here: a signed-in
    customer's belongs to Clerk, which verified it, and a guest's is where
    their receipts already went.

    Orders already placed keep the details they were placed with.
    """
    customer_profile.save_contact(user.id, body)
    user.full_name, user.phone, user.address = body.full_name, body.phone, body.address
    return _session_out(user)


@router.post(
    "/profile/email-sync",
    response_model=CustomerSessionOut,
    dependencies=[Depends(per_user("customer_email_sync", limit=10))],
)
def sync_verified_email(
    user: User = Depends(get_current_user),
    _restaurant: Restaurant = Depends(current_restaurant),
):
    """Read the caller's verified primary email from Clerk; never accept one
    from the browser. Contact details and placed orders are unaffected."""
    if user.kind != UserKind.CUSTOMER.value or not user.clerk_user_id:
        raise errors.ApiError(403, "ACCOUNT_REQUIRED", "Sign in to change your email.")
    profile = clerk_customers.fetch_profile(user.clerk_user_id)
    if profile is None:
        raise errors.ApiError(503, "EMAIL_SYNC_UNAVAILABLE", "Your email could not be confirmed. Try again.")
    if (profile.clerk_user_id != user.clerk_user_id or not profile.email or
            not profile.email_verified):
        raise errors.ApiError(409, "EMAIL_UNVERIFIED", "Verify your new email before saving it.")
    from app.db.session import system_session

    with system_session() as db:
        current = db.get(User, user.id)
        if current is None or not current.is_active or current.deleted_at is not None:
            raise errors.ApiError(403, "ACCOUNT_INACTIVE", "This account is not active.")
        current.email = profile.email
    user.email = profile.email
    return _session_out(user)


# -------------------------------------------------------------- orders ---

class OrderSummaryOut(BaseModel):
    order_id: UUID
    order_number: int
    status: str
    fulfillment_type: str
    currency: str
    total_minor: int
    created_at: datetime
    # "2× Smash Burger", with a meal deal as one line under its own name.
    lines: list[str]


class OrderHistoryOut(BaseModel):
    orders: list[OrderSummaryOut]
    # Pass as `before` for the next page. Null when there is none.
    next_before: datetime | None


def _lines(order: Order) -> list[str]:
    lines: list[str] = []
    seen_combos: set[int] = set()
    for item in order.items:
        if item.combo_group is not None:
            if item.combo_group in seen_combos:
                continue
            seen_combos.add(item.combo_group)
            lines.append(f"{item.quantity}× {item.combo_name_snapshot or 'Combo'}")
        else:
            lines.append(f"{item.quantity}× {item.name_snapshot}")
    return lines


@router.get("/orders", response_model=OrderHistoryOut)
def order_history(
    before: datetime | None = None,
    limit: int = Query(default=20, ge=1, le=50),
    user: User = Depends(get_current_user),
    _restaurant: Restaurant = Depends(current_restaurant),
    db: Session = TenantDb,
):
    """This customer's paid orders here, newest first.

    Paged by time rather than by offset, so an order placed while someone is
    scrolling cannot push a row onto two pages.
    """
    query = (
        select(Order)
        .where(Order.customer_user_id == user.id, Order.status.not_in(_UNPAID))
        .order_by(Order.created_at.desc())
        .limit(limit + 1)
        .options(selectinload(Order.items))
    )
    if before is not None:
        query = query.where(Order.created_at < before)

    rows = db.execute(query).scalars().all()
    page = rows[:limit]
    return OrderHistoryOut(
        orders=[
            OrderSummaryOut(
                order_id=o.id,
                order_number=o.order_number,
                status=o.status,
                fulfillment_type=o.fulfillment_type,
                currency=o.currency,
                total_minor=o.total_minor,
                created_at=o.created_at,
                lines=_lines(o),
            )
            for o in page
        ],
        next_before=page[-1].created_at if len(rows) > limit else None,
    )


# ---------------------------------------------------------- favourites ---

class FavouriteOut(BaseModel):
    item_id: UUID
    # Today's name. Price, photo and availability come from the menu the page
    # already has, which is also how it knows whether the item is served now.
    name: str
    saved_at: datetime


def _account_holder(user: User = Depends(get_current_user)) -> User:
    if user.kind != UserKind.CUSTOMER.value:
        raise errors.ApiError(
            403, "ACCOUNT_REQUIRED", "Sign in or create an account to save favourites."
        )
    return user


@router.get("/favourites", response_model=list[FavouriteOut])
def favourites(
    user: User = Depends(_account_holder),
    _restaurant: Restaurant = Depends(current_restaurant),
    db: Session = TenantDb,
):
    """Saved items, most recent first. Items taken off the menu for good are
    left out; the link stays, so nothing has to be cleaned up."""
    rows = db.execute(
        select(CustomerFavourite, Item.name)
        .join(Item, Item.id == CustomerFavourite.item_id)
        .where(CustomerFavourite.user_id == user.id, Item.deleted_at.is_(None))
        .order_by(CustomerFavourite.created_at.desc())
    ).all()
    return [
        FavouriteOut(item_id=fav.item_id, name=name, saved_at=fav.created_at)
        for fav, name in rows
    ]


@router.put(
    "/favourites/{item_id}",
    status_code=204,
    dependencies=[Depends(per_user("customer_favourite", limit=60))],
)
def save_favourite(
    item_id: UUID,
    user: User = Depends(_account_holder),
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = TenantDb,
):
    """Save an item. Saving one already saved is the same answer, not an
    error: a double tap on a heart should not say anything went wrong."""
    item = db.get(Item, item_id)
    # RLS has already hidden other restaurants' items, so "not here" and
    # "not anywhere" are one answer.
    if item is None or item.deleted_at is not None:
        raise errors.ApiError(404, "ITEM_NOT_FOUND", "That item is not on this menu.")

    db.execute(
        insert(CustomerFavourite)
        .values(restaurant_id=restaurant.id, user_id=user.id, item_id=item.id)
        .on_conflict_do_nothing(constraint="uq_customer_favourite")
    )
    return Response(status_code=204)


@router.delete(
    "/favourites/{item_id}",
    status_code=204,
    dependencies=[Depends(per_user("customer_favourite", limit=60))],
)
def remove_favourite(
    item_id: UUID,
    user: User = Depends(_account_holder),
    _restaurant: Restaurant = Depends(current_restaurant),
    db: Session = TenantDb,
):
    """Unsave an item. Removing one that is not saved is the same answer."""
    fav = db.execute(
        select(CustomerFavourite).where(
            CustomerFavourite.user_id == user.id, CustomerFavourite.item_id == item_id
        )
    ).scalar_one_or_none()
    if fav is not None:
        db.delete(fav)
    return Response(status_code=204)
