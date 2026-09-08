"""Selective application-level field encryption.

Used for the pickup PIN, which must be recoverable for display to the
authenticated customer (so it is encrypted, not hashed). Never logged, never
placed in a URL, never put in a notification body.
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
