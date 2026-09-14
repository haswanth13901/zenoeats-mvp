"""Canonical API error codes. Mirrors Appendix D of the architecture baseline."""

from fastapi import HTTPException


class ApiError(HTTPException):
    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(
            status_code=status_code,
            detail={"code": code, "message": message},
        )
        self.code = code


def tenant_scope_denied(msg="Not authorized for this restaurant."):
    return ApiError(403, "TENANT_SCOPE_DENIED", msg)


def order_not_found(msg="Order not found."):
    return ApiError(404, "ORDER_NOT_FOUND", msg)


def order_state_conflict(msg="Order is not in a state that allows this."):
    return ApiError(409, "ORDER_STATE_CONFLICT", msg)


def idempotency_key_reused(msg="Idempotency key reused with a different request."):
    return ApiError(409, "IDEMPOTENCY_KEY_REUSED", msg)


def item_unavailable(msg="An item or option is no longer available."):
    return ApiError(409, "ITEM_UNAVAILABLE", msg)


def price_changed(msg="Prices changed. Refresh the cart and confirm again."):
    return ApiError(409, "PRICE_CHANGED", msg)


def payment_provider_unavailable(msg="Payment provider is unavailable. Try again."):
    return ApiError(503, "PAYMENT_PROVIDER_UNAVAILABLE", msg)


def payment_not_confirmed(msg="Payment is not confirmed yet."):
    return ApiError(409, "PAYMENT_NOT_CONFIRMED", msg)


def restaurant_not_orderable(msg="This restaurant is not accepting orders."):
    return ApiError(409, "RESTAURANT_NOT_ORDERABLE", msg)


def validation_error(msg: str):
    return ApiError(422, "VALIDATION_ERROR", msg)


# Locations that say where in the request a field sits, not which field it is.
# "body max select" reads worse than "max select" and tells the caller nothing.
_CONTAINERS = {"body", "query", "path", "header", "cookie"}


def request_validation_message(raw_errors) -> str:
    """Turn FastAPI's list of validation errors into one readable sentence.

    Without this the framework answers a schema violation with a list of
    objects under `detail`, and every client that expects the usual
    {code, message} envelope falls back to whatever it says when it cannot
    read a response -- which in the portal was "Something went wrong.", for a
    blank number field.

    So the shape is normalised and the field is named. Three errors is enough
    to act on; a form that has more will surface them again on the next try.
    """
    parts: list[str] = []
    for error in list(raw_errors)[:3]:
        location = [
            f"#{part + 1}" if isinstance(part, int) else str(part)
            for part in error.get("loc", ())
            if part not in _CONTAINERS
        ]
        field = " ".join(location).replace("_", " ").strip()
        detail = error.get("msg") or "is not valid"
        parts.append(f"{field}: {detail}" if field else detail)

    if not parts:
        return "The request was not valid."
    return "; ".join(parts)
