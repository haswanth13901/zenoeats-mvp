"""Generate an ADMIN_USERS entry.

    python scripts/hash_password.py you@example.com

Prompts for the password without echoing it, then prints the line to paste
into .env. The password is never written to disk or shell history.
"""

import getpass
import sys

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1]))

# Not platform_auth: that reads the settings, which a new server cannot
# satisfy until it has the very entry this script makes.
from app.core.admin_password import hash_password  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    email = sys.argv[1].strip().lower()
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Confirm: "):
        print("Passwords do not match.")
        return 1
    if len(password) < 12:
        print("Use at least 12 characters. This guards every restaurant's data.")
        return 1
    print("\nAppend to ADMIN_USERS in .env (separate several admins with ';'):\n")
    print(f"{email}:{hash_password(password)}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
