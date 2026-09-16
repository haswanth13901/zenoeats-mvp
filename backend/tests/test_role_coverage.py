"""Every restaurant endpoint says which staff roles may call it.

A role check is something each endpoint opts into, with a dependency. An
endpoint added without one would still be confined to its own restaurant by
row-level security, but any signed-in member -- a kitchen login -- could call
it. Nothing caught that. This walks the staff router and fails on:

  * an endpoint with no role check that is not one of the few sign-in
    endpoints that run before a role can exist;
  * an endpoint whose roles differ from the table below, so widening one --
    opening cancel to the floor, say -- is a deliberate edit here, next to
    the README's role tables, rather than a one-word change nobody reviews.

No database or server: it reads the dependency tree FastAPI builds.
"""

from fastapi.routing import APIRoute

from app.api import deps

# ALL is the floor: every role that works in the restaurant. DRIVER is not
# one of them -- a driver sees the orders assigned to them and no more of the
# portal -- so it appears only under DELIVERY.
ALL = frozenset({"ADMIN", "MANAGER", "KITCHEN", "CASHIER"})
MANAGERS = frozenset({"ADMIN", "MANAGER"})
ADMIN = frozenset({"ADMIN"})
DELIVERY = frozenset({"ADMIN", "MANAGER", "DRIVER"})
# Everyone who has a login here, drivers included: your own name and your
# own sign-in address belong to you whatever you do at the restaurant.
EVERYONE = frozenset({"ADMIN", "MANAGER", "KITCHEN", "CASHIER", "DRIVER"})

# Kept in step with "Staff roles" in README.md and with
# web/src/features/restaurant/nav.ts.
EXPECTED = {
    # The floor: the board, handing over with a PIN, and stock.
    ("GET", "/restaurant/orders"): ALL,
    ("GET", "/restaurant/orders/history"): ALL,
    ("POST", "/restaurant/orders/{order_id}/ready"): ALL,
    ("POST", "/restaurant/orders/{order_id}/complete"): ALL,
    ("GET", "/restaurant/stock"): ALL,
    ("PATCH", "/restaurant/items/{item_id}/availability"): ALL,
    # Delivery: a driver's own orders, and the two steps of running one.
    ("GET", "/restaurant/deliveries"): DELIVERY,
    ("POST", "/restaurant/orders/{order_id}/picked-up"): DELIVERY,
    ("POST", "/restaurant/orders/{order_id}/delivered"): DELIVERY,
    # Managers: the exceptions to the counter's rules.
    ("POST", "/restaurant/orders/{order_id}/assign-driver"): MANAGERS,
    ("POST", "/restaurant/orders/{order_id}/unassign-driver"): MANAGERS,
    ("GET", "/restaurant/drivers"): MANAGERS,
    ("POST", "/restaurant/orders/{order_id}/override-complete"): MANAGERS,
    ("POST", "/restaurant/orders/{order_id}/cancel"): MANAGERS,
    # Managers: reports and the whole menu builder.
    ("GET", "/restaurant/reports"): MANAGERS,
    ("POST", "/restaurant/images"): MANAGERS,
    ("GET", "/restaurant/menu"): MANAGERS,
    ("POST", "/restaurant/meals"): MANAGERS,
    ("PATCH", "/restaurant/meals/{meal_id}"): MANAGERS,
    ("DELETE", "/restaurant/meals/{meal_id}"): MANAGERS,
    ("POST", "/restaurant/meals/{meal_id}/items"): MANAGERS,
    ("DELETE", "/restaurant/meals/{meal_id}/items/{item_id}"): MANAGERS,
    ("GET", "/restaurant/combos"): MANAGERS,
    ("POST", "/restaurant/combos"): MANAGERS,
    ("PATCH", "/restaurant/combos/{combo_id}"): MANAGERS,
    ("DELETE", "/restaurant/combos/{combo_id}"): MANAGERS,
    ("GET", "/restaurant/modifier-groups"): MANAGERS,
    ("POST", "/restaurant/modifier-groups"): MANAGERS,
    ("PATCH", "/restaurant/modifier-groups/{group_id}"): MANAGERS,
    ("DELETE", "/restaurant/modifier-groups/{group_id}"): MANAGERS,
    ("POST", "/restaurant/modifier-groups/{group_id}/options"): MANAGERS,
    ("PATCH", "/restaurant/modifier-options/{option_id}"): MANAGERS,
    ("DELETE", "/restaurant/modifier-options/{option_id}"): MANAGERS,
    ("GET", "/restaurant/item-types"): MANAGERS,
    ("POST", "/restaurant/item-types"): MANAGERS,
    ("PATCH", "/restaurant/item-types/{type_id}"): MANAGERS,
    ("DELETE", "/restaurant/item-types/{type_id}"): MANAGERS,
    ("GET", "/restaurant/items"): MANAGERS,
    ("POST", "/restaurant/items"): MANAGERS,
    ("PATCH", "/restaurant/items/{item_id}"): MANAGERS,
    ("DELETE", "/restaurant/items/{item_id}"): MANAGERS,
    # Admins: who is on the team.
    ("GET", "/restaurant/staff"): ADMIN,
    ("POST", "/restaurant/staff"): ADMIN,
    ("DELETE", "/restaurant/staff/{membership_id}"): ADMIN,
    ("PATCH", "/restaurant/staff/{membership_id}"): ADMIN,
    ("POST", "/restaurant/staff/{membership_id}/reset-password"): ADMIN,
    # ...and the restaurant's own record. A manager runs the service; the
    # trading name, the address tax is sourced at and the tax rate itself are
    # the owner's to answer for.
    ("GET", "/restaurant/profile"): ADMIN,
    ("PATCH", "/restaurant/profile"): ADMIN,
    # Your own account, which is nobody's business but yours.
    ("PATCH", "/restaurant/me"): EVERYONE,
    ("POST", "/restaurant/change-email"): EVERYONE,
}

# Before a role exists, each for a stated reason, and each with the identity
# check it does need. None means it needs no session at all.
NO_ROLE = {
    ("POST", "/restaurant/login"): None,  # how a session is obtained
    ("POST", "/restaurant/logout"): None,  # clears the cookie, whoever holds it
    # Ends the caller's own sessions everywhere; a temporary password may too.
    ("POST", "/restaurant/logout-everywhere"): deps.current_staff_user,
    ("GET", "/restaurant/me"): deps.current_staff_user,  # a temporary password must reach it
    ("POST", "/restaurant/change-password"): deps.current_staff_user,  # likewise
    # An invitee is INVITED, not yet a member with a role; this is how they become one.
    ("POST", "/restaurant/staff/accept"): deps.current_staff_user_ready,
}


def _calls(dependant):
    """Every callable in an endpoint's dependency tree."""
    for dep in dependant.dependencies:
        yield dep.call
        yield from _calls(dep)


def _endpoints():
    from app.api.v1.restaurant import router

    for route in router.routes:
        if isinstance(route, APIRoute):
            for method in route.methods:
                yield (method, route.path), list(_calls(route.dependant))


def test_every_endpoint_has_exactly_the_roles_it_is_meant_to():
    unchecked, wrong = [], []

    for key, calls in _endpoints():
        roles = [c.staff_roles for c in calls if hasattr(c, "staff_roles")]
        if key in NO_ROLE:
            if roles:
                wrong.append(f"{key} is listed as needing no role but checks {roles}")
            continue
        if not roles:
            unchecked.append(key)
        elif key not in EXPECTED:
            wrong.append(f"{key} is new: add it to EXPECTED with the roles {sorted(roles[0])}")
        elif set(roles) != {EXPECTED[key]}:
            wrong.append(
                f"{key} admits {[sorted(r) for r in roles]}, expected {sorted(EXPECTED[key])}"
            )

    if unchecked:
        wrong.insert(0, (
            f"Endpoints with no role check: {unchecked}. Depend on MANAGE, ANY_STAFF or "
            "STAFF_ADMIN, or add the endpoint to NO_ROLE with the reason it needs none."
        ))
    # One assertion, so a single run lists every problem rather than the first.
    assert not wrong, "\n".join(wrong)


def test_the_endpoints_without_a_role_still_check_who_is_calling():
    found = dict(_endpoints())

    for key, identity in NO_ROLE.items():
        assert key in found, f"{key} no longer exists; remove it from NO_ROLE"
        if identity is not None:
            assert identity in found[key], f"{key} no longer requires {identity.__name__}"


def test_the_tables_name_only_real_endpoints():
    """A stale entry would let the table drift from the router unnoticed."""
    found = {key for key, _ in _endpoints()}
    assert not set(EXPECTED) - found, f"Not endpoints any more: {set(EXPECTED) - found}"
