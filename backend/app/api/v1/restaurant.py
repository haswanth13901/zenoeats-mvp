"""Restaurant staff API: menu management and the live order board.

Every endpoint runs under the tenant-scoped session. Even if the role check
were removed, RLS would return zero rows for another restaurant's data.
"""

from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from app.api.deps import (
    current_restaurant, get_current_user, require_staff, tenant_db,
)
from app.core import errors
from app.db.base import utcnow
from app.db.session import system_session
from app.models import (
    Category, CategoryKind, Item, ItemModifierGroup, Meal, ModifierGroup,
    ModifierOption, Order, OrderItem, OrderStatus, Payment, Restaurant,
    RestaurantUser, SelectionType, StaffRole, StaffStatus, User,
)
from app.services.orders import transition

router = APIRouter(prefix="/restaurant", tags=["restaurant"])

MANAGE = require_staff(StaffRole.ADMIN, StaffRole.MANAGER)
KITCHEN = require_staff(StaffRole.ADMIN, StaffRole.MANAGER, StaffRole.KITCHEN, StaffRole.CASHIER)


class MealIn(BaseModel):
    name: str = Field(max_length=120)
    sort_order: int = 0


class CategoryIn(BaseModel):
    meal_id: UUID
    name: str = Field(max_length=120)
    kind: CategoryKind = CategoryKind.FOOD
    sort_order: int = 0


class ItemIn(BaseModel):
    category_id: UUID
    name: str = Field(max_length=180)
    description: str | None = None
    base_price_minor: int = Field(ge=0)
    sort_order: int = 0
    modifier_group_ids: list[UUID] = Field(default_factory=list)


class OptionIn(BaseModel):
    name: str = Field(max_length=180)
    price_delta_minor: int = 0
    is_default: bool = False
    sort_order: int = 0


class ModifierGroupIn(BaseModel):
    name: str = Field(max_length=180)
    selection_type: SelectionType = SelectionType.MULTI
    is_required: bool = False
    min_select: int = Field(default=0, ge=0)
    max_select: int = Field(default=1, ge=1)
    applies_to_kind: CategoryKind | None = None
    options: list[OptionIn] = Field(default_factory=list)


@router.post("/meals", status_code=201)
def create_meal(
    body: MealIn,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(MANAGE),
):
    meal = Meal(restaurant_id=restaurant.id, name=body.name, sort_order=body.sort_order)
    db.add(meal)
    db.flush()
    return {"id": str(meal.id), "name": meal.name}


@router.post("/categories", status_code=201)
def create_category(
    body: CategoryIn,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(MANAGE),
):
    if db.get(Meal, body.meal_id) is None:
        raise errors.validation_error("That meal does not exist.")
    category = Category(
        restaurant_id=restaurant.id, meal_id=body.meal_id, name=body.name,
        kind=body.kind.value, sort_order=body.sort_order,
    )
    db.add(category)
    db.flush()
    return {"id": str(category.id), "name": category.name, "kind": category.kind}


@router.post("/modifier-groups", status_code=201)
def create_modifier_group(
    body: ModifierGroupIn,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(MANAGE),
):
    """Reusable across items. Define "Ice level" once, attach it to every
    beverage."""
    if body.max_select < body.min_select:
        raise errors.validation_error("max_select cannot be below min_select.")

    group = ModifierGroup(
        restaurant_id=restaurant.id, name=body.name,
        selection_type=body.selection_type.value, is_required=body.is_required,
        min_select=body.min_select, max_select=body.max_select,
        applies_to_kind=body.applies_to_kind.value if body.applies_to_kind else None,
    )
    db.add(group)
    db.flush()

    for option in body.options:
        db.add(
            ModifierOption(
                restaurant_id=restaurant.id, group_id=group.id, name=option.name,
                price_delta_minor=option.price_delta_minor,
                is_default=option.is_default, sort_order=option.sort_order,
            )
        )
    db.flush()
    return {"id": str(group.id), "name": group.name}


@router.get("/modifier-groups")
def list_modifier_groups(
    kind: CategoryKind | None = None,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(MANAGE),
):
    """The reusable library. Filtered by kind so adding a beverage surfaces
    Ice level rather than Veggies."""
    query = select(ModifierGroup).where(ModifierGroup.deleted_at.is_(None))
    if kind:
        query = query.where(
            (ModifierGroup.applies_to_kind == kind.value)
            | (ModifierGroup.applies_to_kind.is_(None))
        )
    groups = db.execute(query.options(selectinload(ModifierGroup.options))).scalars().all()
    return [
        {
            "id": str(g.id), "name": g.name, "selection_type": g.selection_type,
            "is_required": g.is_required, "min_select": g.min_select,
            "max_select": g.max_select, "applies_to_kind": g.applies_to_kind,
            "options": [
                {"id": str(o.id), "name": o.name, "price_delta_minor": o.price_delta_minor}
                for o in g.options if o.deleted_at is None
            ],
        }
        for g in groups
    ]


@router.post("/items", status_code=201)
def create_item(
    body: ItemIn,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(MANAGE),
):
    if db.get(Category, body.category_id) is None:
        raise errors.validation_error("That category does not exist.")

    item = Item(
        restaurant_id=restaurant.id, category_id=body.category_id, name=body.name,
        description=body.description, base_price_minor=body.base_price_minor,
        currency=restaurant.currency, sort_order=body.sort_order,
    )
    db.add(item)
    db.flush()

    for index, group_id in enumerate(body.modifier_group_ids):
        if db.get(ModifierGroup, group_id) is None:
            raise errors.validation_error("Unknown modifier group.")
        db.add(
            ItemModifierGroup(
                restaurant_id=restaurant.id, item_id=item.id,
                group_id=group_id, sort_order=index,
            )
        )
    db.flush()
    return {"id": str(item.id), "name": item.name}


@router.patch("/items/{item_id}/availability")
def set_item_availability(
    item_id: UUID,
    is_available: bool,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(KITCHEN),
):
    """Manual sold-out toggle. Overrides everything else."""
    item = db.get(Item, item_id)
    if item is None:
        raise errors.validation_error("No such item.")
    item.is_available = is_available
    return {"id": str(item.id), "is_available": is_available}


@router.get("/orders")
def order_board(
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(KITCHEN),
):
    """The live board. Polled every few seconds by the kitchen screen.

    PENDING_PAYMENT orders are deliberately excluded: nobody has paid, and
    showing them to the kitchen would start food on an unconfirmed order.
    """
    active = [
        OrderStatus.AUTO_ACCEPTED.value,
        OrderStatus.PREPARING.value,
        OrderStatus.READY_FOR_PICKUP.value,
    ]
    orders = db.execute(
        select(Order)
        .where(Order.status.in_(active))
        .order_by(Order.created_at)
        .options(selectinload(Order.items).selectinload(OrderItem.modifiers))
    ).scalars().all()

    return [
        {
            "order_id": str(o.id),
            "order_number": o.order_number,
            "status": o.status,
            "total_minor": o.total_minor,
            "currency": o.currency,
            "created_at": o.created_at.isoformat(),
            "customer_note": o.customer_note,
            "items": [
                {
                    "name": i.name_snapshot,
                    "quantity": i.quantity,
                    "note": i.item_note,
                    "modifiers": [
                        f"{m.group_name_snapshot}: {m.option_name_snapshot}"
                        for m in i.modifiers
                    ],
                }
                for i in o.items
            ],
        }
        for o in orders
    ]


@router.post("/orders/{order_id}/ready")
def mark_ready(
    order_id: UUID,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(KITCHEN),
):
    order = db.get(Order, order_id)
    if order is None:
        raise errors.order_not_found()
    transition(order, OrderStatus.READY_FOR_PICKUP.value)
    return {"order_id": str(order.id), "status": order.status}


@router.post("/orders/{order_id}/complete")
def complete_order(
    order_id: UUID,
    pin: str,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(KITCHEN),
):
    """Hand the food over. PIN verified server side, five attempts then lock.

    Failed attempts are counted on the order row so the lock survives a page
    refresh or a different staff device.
    """
    from app.core.crypto import decrypt_field

    order = db.get(Order, order_id)
    if order is None:
        raise errors.order_not_found()
    if order.pickup_pin_failed_attempts >= 5:
        raise errors.ApiError(423, "PIN_LOCKED", "Too many attempts. A manager must override.")
    if order.pickup_pin_encrypted is None:
        raise errors.order_state_conflict("This order has no pickup PIN.")

    if decrypt_field(order.pickup_pin_encrypted) != pin.strip():
        order.pickup_pin_failed_attempts += 1
        raise errors.ApiError(400, "PIN_INVALID", "That PIN does not match.")

    payment = db.execute(select(Payment).where(Payment.order_id == order.id)).scalar_one_or_none()
    if payment is None or payment.succeeded_at is None:
        raise errors.payment_not_confirmed("This order has not been paid.")

    transition(order, OrderStatus.COMPLETED.value)
    order.completed_at = utcnow()
    return {"order_id": str(order.id), "status": order.status}


# ---------------------------------------------------------------- staff ----

class StaffInviteIn(BaseModel):
    email: str = Field(max_length=320)
    role_code: StaffRole


@router.get("/staff")
def list_staff(
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(require_staff(StaffRole.ADMIN)),
):
    rows = db.execute(
        select(RestaurantUser).where(RestaurantUser.revoked_at.is_(None))
    ).scalars().all()

    user_ids = [r.user_id for r in rows]
    emails = {}
    if user_ids:
        with system_session() as sys_db:
            for u in sys_db.execute(select(User).where(User.id.in_(user_ids))).scalars():
                emails[u.id] = (u.email, u.full_name)

    return [
        {
            "id": str(r.id),
            "email": emails.get(r.user_id, ("unknown", None))[0],
            "full_name": emails.get(r.user_id, (None, None))[1],
            "role_code": r.role_code,
            "status": r.status,
            "invited_at": r.invited_at.isoformat() if r.invited_at else None,
            "accepted_at": r.accepted_at.isoformat() if r.accepted_at else None,
        }
        for r in rows
    ]


@router.post("/staff", status_code=201)
def invite_staff(
    body: StaffInviteIn,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    membership: RestaurantUser = Depends(require_staff(StaffRole.ADMIN)),
):
    """Create an INVITED membership.

    Rule 27: this never grants access. The row sits at INVITED until the
    target account signs in and accepts. An email that already belongs to a
    global Zenoeats customer is not silently promoted to staff.
    """
    email = body.email.strip().lower()

    with system_session() as sys_db:
        user = sys_db.execute(select(User).where(User.email == email)).scalar_one_or_none()
        if user is None:
            # Placeholder identity. The Clerk webhook reconciles it to a real
            # clerk_user_id when the person signs up.
            user = User(clerk_user_id=f"pending:{email}", email=email, is_active=True)
            sys_db.add(user)
            sys_db.flush()
        target_user_id = user.id

    existing = db.execute(
        select(RestaurantUser).where(RestaurantUser.user_id == target_user_id)
    ).scalar_one_or_none()

    if existing and existing.status == StaffStatus.ACTIVE.value:
        raise errors.ApiError(409, "ALREADY_STAFF", "That person is already on the team.")
    if existing:
        existing.role_code = body.role_code.value
        existing.status = StaffStatus.INVITED.value
        existing.invited_at = utcnow()
        existing.revoked_at = None
        db.flush()
        return {"id": str(existing.id), "status": existing.status}

    invite = RestaurantUser(
        restaurant_id=restaurant.id,
        user_id=target_user_id,
        role_code=body.role_code.value,
        status=StaffStatus.INVITED.value,
        invited_by_user_id=membership.user_id,
        invited_at=utcnow(),
    )
    db.add(invite)
    db.flush()
    return {"id": str(invite.id), "status": invite.status, "email": email}


@router.post("/staff/accept")
def accept_invitation(
    user: User = Depends(get_current_user),
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
):
    """The invitee accepts. This is the only path from INVITED to ACTIVE."""
    invite = db.execute(
        select(RestaurantUser).where(
            RestaurantUser.user_id == user.id,
            RestaurantUser.status == StaffStatus.INVITED.value,
        )
    ).scalar_one_or_none()
    if invite is None:
        raise errors.ApiError(404, "NO_PENDING_INVITE", "No pending invitation here.")

    invite.status = StaffStatus.ACTIVE.value
    invite.accepted_at = utcnow()
    return {"id": str(invite.id), "role_code": invite.role_code, "status": invite.status}


@router.delete("/staff/{membership_id}")
def revoke_staff(
    membership_id: UUID,
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(require_staff(StaffRole.ADMIN)),
):
    invite = db.get(RestaurantUser, membership_id)
    if invite is None:
        raise errors.validation_error("No such membership.")
    invite.status = StaffStatus.REVOKED.value
    invite.revoked_at = utcnow()
    return {"id": str(invite.id), "status": invite.status}


# --------------------------------------------------------------- reports ---

@router.get("/reports")
def restaurant_reports(
    restaurant: Restaurant = Depends(current_restaurant),
    db: Session = Depends(tenant_db),
    _=Depends(MANAGE),
):
    """This restaurant's own numbers. Tenant-scoped by RLS, so there is no
    way for this query to reach another restaurant's orders even if the
    WHERE clause were dropped."""
    totals = db.execute(
        text(
            """
            SELECT count(*) FILTER (WHERE paid_at IS NOT NULL)        AS orders_paid,
                   COALESCE(sum(total_minor) FILTER (WHERE paid_at IS NOT NULL), 0) AS gross,
                   COALESCE(sum(tax_minor)   FILTER (WHERE paid_at IS NOT NULL), 0) AS tax,
                   count(*) FILTER (WHERE status = 'PENDING_PAYMENT') AS pending,
                   count(*) FILTER (WHERE status = 'EXPIRED')         AS expired,
                   count(*) FILTER (WHERE status = 'COMPLETED')       AS completed
            FROM orders
            """
        )
    ).mappings().one()

    top_items = db.execute(
        text(
            """
            SELECT oi.name_snapshot AS name,
                   sum(oi.quantity) AS units,
                   sum(oi.line_total_minor) AS revenue
            FROM order_items oi
            JOIN orders o ON o.id = oi.order_id
            WHERE o.paid_at IS NOT NULL
            GROUP BY oi.name_snapshot
            ORDER BY units DESC
            LIMIT 10
            """
        )
    ).mappings().all()

    paid = totals["orders_paid"] or 0
    gross = int(totals["gross"] or 0)
    return {
        "currency": restaurant.currency,
        "orders_paid": paid,
        "orders_completed": totals["completed"],
        "orders_pending_payment": totals["pending"],
        "orders_expired": totals["expired"],
        "gross_revenue_minor": gross,
        "tax_collected_minor": int(totals["tax"] or 0),
        "average_order_value_minor": gross // paid if paid else 0,
        "top_items": [
            {"name": r["name"], "units": r["units"], "revenue_minor": int(r["revenue"])}
            for r in top_items
        ],
    }
