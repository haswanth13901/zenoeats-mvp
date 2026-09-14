"""Every failure answers in one shape, and says what was wrong.

The regression this guards is a blank number field in the menu builder
reading as "Something went wrong." FastAPI answers a schema violation with a
list of error objects under `detail`, which is not the {code, message}
envelope the rest of this API uses -- so the client could not read it and
fell back to the message it shows when it understands nothing at all.

A caller who mistyped one field deserves to be told which field. That is what
the handler in main.py normalises, and what this pins down.
"""

import pytest

from app.core.errors import request_validation_message


def test_the_field_that_failed_is_named():
    message = request_validation_message([
        {"loc": ("body", "max_select"), "msg": "Input should be a valid integer"},
    ])
    assert "max select" in message
    assert "Input should be a valid integer" in message


def test_the_container_is_not_treated_as_part_of_the_field_name():
    """"body" says where the field arrived, not which field it is."""
    message = request_validation_message([{"loc": ("body", "name"), "msg": "Field required"}])
    assert message == "name: Field required"


def test_a_field_inside_a_list_is_numbered_from_one():
    """A caller counting their own rows starts at one. Zero-based indexes are
    an implementation detail of the parser, not of the form they filled in."""
    message = request_validation_message([
        {"loc": ("body", "options", 0, "name"), "msg": "Field required"},
    ])
    assert message == "options #1 name: Field required"


def test_several_failures_are_all_reported():
    message = request_validation_message([
        {"loc": ("body", "name"), "msg": "Field required"},
        {"loc": ("body", "max_select"), "msg": "Input should be greater than 0"},
    ])
    assert "name: Field required" in message
    assert "max select: Input should be greater than 0" in message


def test_a_flood_of_failures_is_cut_to_something_readable():
    """Twenty lines of validation text is not a message, it is a wall. The
    rest come back on the next attempt."""
    message = request_validation_message([
        {"loc": ("body", f"field_{i}"), "msg": "Field required"} for i in range(20)
    ])
    assert message.count(";") == 2, message


def test_an_error_with_no_location_still_says_something_usable():
    assert request_validation_message([{"msg": "Value error, cart is empty"}]) == (
        "Value error, cart is empty"
    )


def test_no_errors_at_all_is_never_an_empty_message():
    assert request_validation_message([]) == "The request was not valid."


@pytest.mark.integration
def test_the_api_answers_a_bad_body_in_the_usual_envelope():
    """End to end, because the point is the shape a client receives. Marked
    integration: resolving the tenant from the Host header opens a database
    session before the body is ever looked at."""
    from fastapi.testclient import TestClient

    from app.main import app

    with TestClient(app) as client:
        # A line with no item on it. Not an empty cart: that is schema-valid
        # now that a cart may be nothing but combos, and it is refused later
        # by pricing, through the ordinary error path rather than this one.
        response = client.post(
            "/api/v1/orders/quote",
            headers={"Host": "spicehouse.zenoeats.local"},
            json={"items": [{"quantity": 1}]},
        )

    assert response.status_code == 422
    body = response.json()
    assert body["code"] == "VALIDATION_ERROR"
    assert "menu item id" in body["message"], body["message"]
    assert body["message"] != "Something went wrong.", (
        "a malformed request came back as an unreadable generic failure"
    )


# --- unhandled faults ------------------------------------------------------
#
# The other half of "say what went wrong". A schema violation now names its
# field; a fault nobody anticipated used to name nothing at all, which meant a
# screen failing because the API was running stale code was indistinguishable
# from one failing for any other reason.


def _fault_response(env: str):
    """The 500 handler alone, driven by a route that raises on purpose.

    A separate app rather than the real one: what is under test is what the
    handler says, and the real app would need something genuinely broken to
    say it.
    """
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.config import settings
    from app.main import unhandled

    app = FastAPI()
    app.add_exception_handler(Exception, unhandled)

    @app.get("/boom")
    def boom():
        raise RuntimeError("relation menu_categories does not exist")

    original = settings.ENV
    settings.ENV = env
    try:
        # raise_server_exceptions=False so the handler answers rather than the
        # client re-raising the fault at us.
        with TestClient(app, raise_server_exceptions=False) as client:
            return client.get("/boom")
    finally:
        settings.ENV = original


def test_development_says_what_actually_broke():
    body = _fault_response("development").json()
    assert body["code"] == "INTERNAL_ERROR"
    assert "RuntimeError" in body["message"]
    assert "relation menu_categories does not exist" in body["message"]


def test_production_says_nothing_about_the_fault():
    """An exception can carry a query, a path, or a value someone typed."""
    body = _fault_response("production").json()
    assert "RuntimeError" not in body["message"]
    assert "menu_categories" not in body["message"]
    assert body["message"].startswith("Something went wrong.")


def test_an_unrecognised_env_is_treated_as_production():
    """The check names development rather than excluding production, so a
    typo in ENV fails closed."""
    body = _fault_response("prod").json()
    assert "RuntimeError" not in body["message"]


def test_every_fault_carries_a_reference_that_appears_in_the_message():
    """The message on screen and the line in the log have to be the same
    incident, or a report of one cannot be looked up as the other."""
    for env in ("development", "production"):
        body = _fault_response(env).json()
        assert body["reference"], env
        assert body["reference"] in body["message"], env


def test_two_faults_are_told_apart():
    first = _fault_response("production").json()["reference"]
    second = _fault_response("production").json()["reference"]
    assert first != second
