"""The ADMIN_USERS hash format, and nothing that needs configuration.

Kept apart from platform_auth, which reads the settings as it is imported.
scripts/hash_password.py uses only this, so it runs on a bare image: a new
server generating its first ADMIN_USERS entry has no .env the settings would
accept yet, and needing one to make the other was a loop.
"""

import base64

from argon2 import PasswordHasher

hasher = PasswordHasher()


def hash_password(password: str) -> str:
    """Produce a value for ADMIN_USERS. Used by scripts/hash_password.py.

    Base64 encoded, because a raw argon2 hash is hostile to .env files: it
    looks like "$argon2id$v=19$m=65536,t=3,p=4$salt$digest". Docker Compose
    expands the "$" segments as variable references and substitutes empty
    strings, so containers silently receive a corrupted hash while a native
    run sees the correct one -- the same credentials working in one mode and
    failing in the other. Base64 has no character any layer treats specially.
    """
    return base64.b64encode(hasher.hash(password).encode()).decode()
