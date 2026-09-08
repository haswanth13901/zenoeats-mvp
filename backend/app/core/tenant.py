"""Hostname to restaurant resolution.

Section 2.2: a restaurant subdomain is resolved by the application, not by
creating a DNS record per restaurant. Wildcard DNS points *.zenoeats.com at
the origin and we map the leading label to a restaurant.

The client may send a restaurant id. We never authorize from it.
"""

from app.config import settings

RESERVED_SLUGS = {
    "www", "api", "admin", "app", "media", "static", "assets",
    "mail", "staging", "dev", "internal", "status", "docs",
}


def extract_slug(host_header: str | None) -> str | None:
    """Pull the restaurant slug out of a Host header.

    spicehouse.zenoeats.com          -> "spicehouse"
    spicehouse.zenoeats.local:8080   -> "spicehouse"
    zenoeats.com                     -> None (platform root)
    """
    if not host_header:
        return None

    host = host_header.split(":")[0].strip().lower().rstrip(".")
    root = settings.ROOT_DOMAIN.lower()

    if host == root or not host.endswith(f".{root}"):
        return None

    label = host[: -(len(root) + 1)]
    if "." in label or not label or label in RESERVED_SLUGS:
        return None
    return label
