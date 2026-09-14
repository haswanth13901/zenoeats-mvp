"""Which address a rate limit is charged to.

The regression this guards: the limiter read the left-most X-Forwarded-For
entry, which the client writes. Rotating a fake value per request made every
login attempt a fresh "IP", so the per-IP limit on staff and admin sign-in
never engaged.
"""

from types import SimpleNamespace

from app.core.ratelimit import _client_ip


def _request(peer: str | None, **headers: str):
    return SimpleNamespace(
        client=SimpleNamespace(host=peer) if peer else None,
        headers={k.lower().replace("_", "-"): v for k, v in headers.items()},
    )


def test_a_client_talking_to_the_api_directly_cannot_choose_its_address():
    req = _request("203.0.113.9", x_forwarded_for="1.2.3.4", x_real_ip="5.6.7.8")
    assert _client_ip(req) == "203.0.113.9"


def test_a_forged_left_most_entry_is_ignored_behind_our_proxy():
    """nginx appends the address it saw; the attacker's value sits to its left."""
    req = _request("172.18.0.5", x_forwarded_for="1.2.3.4, 198.51.100.7")
    assert _client_ip(req) == "198.51.100.7"


def test_x_real_ip_from_our_proxy_wins():
    req = _request("172.18.0.5", x_real_ip="198.51.100.7", x_forwarded_for="1.2.3.4")
    assert _client_ip(req) == "198.51.100.7"


def test_chained_trusted_proxies_are_skipped_from_the_right():
    req = _request("10.0.0.2", x_forwarded_for="1.2.3.4, 198.51.100.7, 10.0.0.9")
    assert _client_ip(req) == "198.51.100.7"


def test_garbage_in_the_headers_falls_back_to_the_socket():
    req = _request("127.0.0.1", x_real_ip="not-an-ip", x_forwarded_for="nonsense")
    assert _client_ip(req) == "127.0.0.1"


def test_no_socket_address_at_all():
    assert _client_ip(_request(None, x_forwarded_for="1.2.3.4")) == "unknown"
