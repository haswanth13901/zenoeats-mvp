"""Set or change a platform administrator password.

    python scripts/hash_password.py you@example.com            print the entry
    python scripts/hash_password.py you@example.com --write    update ../.env
    python scripts/hash_password.py you@example.com --add      keep existing admins

Prompts for the password without echoing it. The password itself is never
written anywhere -- only an argon2 hash of it, base64 encoded so that the "$"
characters in a raw argon2 hash are not expanded as variables by Docker
Compose.

.env.example is deliberately left alone. It is committed, so a real hash there
would be published in the repository.
"""

import getpass
import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.platform_auth import hash_password  # noqa: E402

ENV_PATH = Path(__file__).resolve().parents[2] / ".env"
MIN_LENGTH = 12


def write_env(entry: str, add: bool) -> None:
    """Replace (or extend) ADMIN_USERS in .env, in place.

    Opened "r+b" rather than "w": on Windows .env carries the Hidden
    attribute, and truncating it with a plain write raises PermissionError.
    """
    if not ENV_PATH.exists():
        raise SystemExit(f"No .env at {ENV_PATH}. Copy .env.example first.")

    with io.open(ENV_PATH, "r+b") as f:
        raw = f.read()
        nl = "\r\n" if b"\r\n" in raw else "\n"
        text = raw.decode("utf-8").replace("\r\n", "\n")

        match = re.search(r"^ADMIN_USERS=(.*)$", text, flags=re.M)
        if match is None:
            raise SystemExit("No ADMIN_USERS line in .env. Add one and retry.")

        email = entry.split(":", 1)[0]
        existing = [e for e in match.group(1).split(";") if e.strip()]
        # Replacing this admin's own entry is a password change, not a
        # duplicate, so drop any entry for the same address either way.
        kept = [e for e in existing if e.split(":", 1)[0].strip().lower() != email]

        if add:
            value = ";".join(kept + [entry])
        else:
            if kept:
                print(f"Replacing all {len(existing)} entries. Use --add to keep the others.")
            value = entry

        text = text[: match.start()] + f"ADMIN_USERS={value}" + text[match.end() :]
        f.seek(0)
        f.write(text.replace("\n", nl).encode("utf-8"))
        f.truncate()


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    if len(args) != 1 or flags - {"--write", "--add"}:
        print(__doc__)
        return 2

    email = args[0].strip().lower()
    password = getpass.getpass("Password: ")
    if password != getpass.getpass("Confirm: "):
        print("Passwords do not match.")
        return 1
    if len(password) < MIN_LENGTH:
        print(f"Use at least {MIN_LENGTH} characters. This guards every restaurant's data.")
        return 1

    entry = f"{email}:{hash_password(password)}"

    if "--write" in flags or "--add" in flags:
        write_env(entry, add="--add" in flags)
        print(f"\nUpdated {ENV_PATH}")
        print("Restart the API for it to take effect.")
    else:
        print("\nAppend to ADMIN_USERS in .env (separate several admins with ';'):\n")
        print(entry + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
