"""Which map a customer sees, and in whose colours.

Google colours a map one of two ways: from a Map ID set up in its Cloud
console, or from a style array sent with the map. It ignores the array
whenever a Map ID is in use, and a Map ID is what Advanced Markers need.

The tracking map therefore uses neither a Map ID nor Advanced Markers. The
browser sends one of the styles below (web/src/features/storefront/mapStyles
.ts holds the colours) and draws its pins as ordinary markers, so a
restaurant recolours its map from its own portal and nobody opens a console.

This module is the server's half of that: the keys a restaurant may choose
between, so a stale page cannot store one the storefront does not know how to
draw.
"""

# Keys, not colours: what each one looks like belongs with the map that draws
# it. They must match MAP_STYLES in web/src/features/storefront/mapStyles.ts.
STYLE_KEYS = ("standard", "light", "dark", "palette")


def is_style(key: str | None) -> bool:
    """Whether this is a style the storefront can draw. Null is standard."""
    return key is None or key in STYLE_KEYS
