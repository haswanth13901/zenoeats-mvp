"""The ADMIN_USERS hasher runs where there is no configuration yet.

A new server needs an ADMIN_USERS entry before its .env is complete, and
the hasher used to import the settings, which refuse to load without one.
"""

import os
import subprocess
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]


def test_the_hasher_imports_no_settings():
    """In a clean interpreter with no environment at all."""
    probe = (
        "import sys; import app.core.admin_password as a; "
        "assert 'app.config' not in sys.modules, 'imported the settings'; "
        "print(a.hash_password('x' * 16))"
    )
    result = subprocess.run(
        [sys.executable, "-c", probe], cwd=BACKEND, capture_output=True, text=True,
        env={"PATH": os.environ.get("PATH", ""), "PYTHONPATH": str(BACKEND)},
    )
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip()


def test_its_hashes_sign_in(monkeypatch):
    from app.core import admin_password, platform_auth

    entry = f"ops@zenoeats.com:{admin_password.hash_password('correct-horse-battery')}"
    monkeypatch.setattr(platform_auth.settings, "ADMIN_USERS", entry)

    assert platform_auth.authenticate("ops@zenoeats.com", "correct-horse-battery")
    assert platform_auth.authenticate("ops@zenoeats.com", "wrong-horse-battery") is None
