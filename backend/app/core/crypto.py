"""Selective application-level field encryption.

Used for the pickup PIN, which must be recoverable for display to the
authenticated customer (so it is encrypted, not hashed). Never logged, never
placed in a URL, never put in a notification body.

Also seals a staff member's temporary password for the few seconds it spends
in the Celery queue on its way into their invitation email. The database
keeps only its hash; this is what stops the broker's on-disk log keeping it
in plain text.
"""

import secrets

from cryptography.fernet import Fernet

from app.config import settings

_fernet = Fernet(settings.FIELD_ENCRYPTION_KEY.encode())


def encrypt_field(plaintext: str) -> str:
    return _fernet.encrypt(plaintext.encode()).decode()


def decrypt_field(ciphertext: str) -> str:
    return _fernet.decrypt(ciphertext.encode()).decode()


def generate_pickup_pin() -> str:
    """Cryptographically random 6-digit pickup PIN."""
    return f"{secrets.randbelow(1_000_000):06d}"
