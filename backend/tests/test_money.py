"""Money arithmetic. No floats, deterministic rounding."""

import pytest

from app.core.money import apply_rate_bps, format_minor


def test_tax_rounds_half_up():
    # 8.25% of $10.95 = 90.3375 cents -> 90
    assert apply_rate_bps(1095, 825) == 90
    # Exact .5 boundary must round up, not to even.
    # 5% of $0.10 = 0.5 cents -> 1
    assert apply_rate_bps(10, 500) == 1


def test_zero_rate_and_zero_base():
    assert apply_rate_bps(0, 825) == 0
    assert apply_rate_bps(5000, 0) == 0


def test_no_float_drift_across_many_lines():
    # The classic float failure: 0.1 + 0.2 != 0.3. In minor units this is
    # exact by construction.
    total = sum(apply_rate_bps(999, 825) for _ in range(1000))
    assert total == 82 * 1000
    assert isinstance(total, int)


def test_negative_inputs_rejected():
    with pytest.raises(ValueError):
        apply_rate_bps(-1, 825)
    with pytest.raises(ValueError):
        apply_rate_bps(100, -1)


def test_format_is_presentation_only():
    assert format_minor(1095, "USD") == "10.95 USD"
    assert format_minor(5, "USD") == "0.05 USD"
