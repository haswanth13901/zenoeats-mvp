"""The platform CSV export cannot carry a formula into a spreadsheet.

A restaurant's name is typed by its own owner. Written into the export as
it stands, "=HYPERLINK(...)" runs when a platform admin opens the file.
"""

import csv
import io

import pytest
from sqlalchemy import text

from tests.test_admin_restaurants import _create, admin_user, cleanup  # noqa: F401  (fixtures)

pytestmark = pytest.mark.integration

PAYLOADS = [
    '=HYPERLINK("https://evil.example","Open")',
    "+SUM(1,2)",
    "-2+3",
    "@SUM(A1)",
    "\tTabbed",
    "\rReturned",
]


def _rename(restaurant_id, name):
    from app.db.session import tenant_session

    with tenant_session(restaurant_id) as session:
        session.execute(
            text("UPDATE restaurants SET name = :n WHERE id = :r"), {"n": name, "r": restaurant_id}
        )


def _export(admin_user):
    from app.api.v1.admin import platform_reports_csv

    body = platform_reports_csv(admin=admin_user).body.decode()
    return {row["slug"]: row for row in csv.DictReader(io.StringIO(body))}


@pytest.mark.parametrize("payload", PAYLOADS)
def test_a_name_that_is_a_formula_is_exported_as_text(admin_user, cleanup, payload):
    restaurant = _create(admin_user, cleanup)
    _rename(restaurant.id, payload)

    cell = _export(admin_user)[restaurant.slug]["restaurant"]
    assert cell == "'" + payload


def test_an_ordinary_name_is_exported_unchanged(admin_user, cleanup):
    restaurant = _create(admin_user, cleanup)
    _rename(restaurant.id, "Tom & Jerry's - Downtown")

    assert _export(admin_user)[restaurant.slug]["restaurant"] == "Tom & Jerry's - Downtown"
