"""Engine-level unit tests, focused on _active_fraction pro-rating."""

from datetime import date

import pytest

from budgeteer.engine import (
    _ANNUAL_PERIOD_DAYS,
    _MONTHLY_PERIOD_DAYS,
    _active_fraction,
    build_timeline,
    compute_ledger,
)
from budgeteer.models import (
    Direction,
    Frequency,
    OneOffCashFlow,
    Phase,
    RecurringCashFlow,
)


def _monthly(name: str, amount: float, start=None, end=None) -> RecurringCashFlow:
    return RecurringCashFlow(
        name, Direction.OUTFLOW, amount, Frequency.MONTHLY, start_date=start, end_date=end
    )


def _annual(name: str, amount: float, start=None, end=None) -> RecurringCashFlow:
    return RecurringCashFlow(
        name, Direction.OUTFLOW, amount, Frequency.ANNUALLY, start_date=start, end_date=end
    )


class TestMonthlyProrating:
    def test_mid_month_start(self):
        cf = _monthly("X", 1000, start=date(2026, 3, 15))
        assert _active_fraction(cf, date(2026, 2, 1)) == 0.0
        assert _active_fraction(cf, date(2026, 3, 1)) == pytest.approx(17 / _MONTHLY_PERIOD_DAYS)
        assert _active_fraction(cf, date(2026, 4, 1)) == pytest.approx(30 / _MONTHLY_PERIOD_DAYS)
        assert _active_fraction(cf, date(2026, 5, 1)) == pytest.approx(31 / _MONTHLY_PERIOD_DAYS)

    def test_mid_month_end(self):
        cf = _monthly("X", 1000, end=date(2026, 3, 15))
        assert _active_fraction(cf, date(2026, 2, 1)) == pytest.approx(28 / _MONTHLY_PERIOD_DAYS)
        assert _active_fraction(cf, date(2026, 3, 1)) == pytest.approx(15 / _MONTHLY_PERIOD_DAYS)
        assert _active_fraction(cf, date(2026, 4, 1)) == 0.0

    def test_mutual_exclusion_no_double_count(self):
        """The bug: A ends mid-March, B starts the next day; together = exactly one month."""
        a = _monthly("A", 1000, end=date(2026, 3, 15))
        b = _monthly("B", 1000, start=date(2026, 3, 16))
        march = date(2026, 3, 1)
        total = 1000 * _active_fraction(a, march) + 1000 * _active_fraction(b, march)
        assert total == pytest.approx(1000 * 31 / _MONTHLY_PERIOD_DAYS)

    def test_same_month_start_and_end(self):
        cf = _monthly("X", 1000, start=date(2026, 3, 5), end=date(2026, 3, 20))
        assert _active_fraction(cf, date(2026, 3, 1)) == pytest.approx(16 / _MONTHLY_PERIOD_DAYS)
        assert _active_fraction(cf, date(2026, 2, 1)) == 0.0
        assert _active_fraction(cf, date(2026, 4, 1)) == 0.0

    def test_full_year_totals_conserved(self):
        """Always-on monthly flow over a non-leap year sums to 365/30.4375 monthly amounts."""
        cf = _monthly("X", 1200)
        phases = [Phase("Y", date(2026, 1, 1), date(2026, 12, 31))]
        ledger = compute_ledger(build_timeline(phases), phases, [cf])
        total = ledger["total_outflow"].sum()
        assert total == pytest.approx(1200 * 365 / _MONTHLY_PERIOD_DAYS)


class TestAnnualProrating:
    def test_full_year(self):
        cf = _annual("X", 12000, start=date(2026, 3, 15))
        # Anchor month is March; non-anchor months contribute 0.
        assert _active_fraction(cf, date(2026, 4, 1)) == 0.0
        assert _active_fraction(cf, date(2026, 1, 1)) == 0.0
        # 2026-03 window = [Mar 15 2026, Mar 14 2027] = 365 days
        assert _active_fraction(cf, date(2026, 3, 1)) == pytest.approx(365 / _ANNUAL_PERIOD_DAYS)
        # 2027-03 window = [Mar 15 2027, Mar 14 2028] = 366 days (covers leap Feb 2028)
        assert _active_fraction(cf, date(2027, 3, 1)) == pytest.approx(366 / _ANNUAL_PERIOD_DAYS)

    def test_partial_year_truncated_by_end_date(self):
        cf = _annual("X", 12000, start=date(2026, 3, 15), end=date(2026, 9, 15))
        # 2026-03 window includes [Mar 15, Sep 15] = 185 days of activity
        assert _active_fraction(cf, date(2026, 3, 1)) == pytest.approx(185 / _ANNUAL_PERIOD_DAYS)
        # No firing in subsequent years
        assert _active_fraction(cf, date(2027, 3, 1)) == 0.0

    def test_partial_year_anchor_not_january(self):
        cf = _annual("X", 12000, start=date(2026, 8, 1), end=date(2027, 2, 1))
        # 2026-08 window = [Aug 1 2026, Jul 31 2027]; overlap = [Aug 1 2026, Feb 1 2027] = 185 days
        assert _active_fraction(cf, date(2026, 8, 1)) == pytest.approx(185 / _ANNUAL_PERIOD_DAYS)
        # 2027-08 window starts Aug 1 2027, after active interval ends
        assert _active_fraction(cf, date(2027, 8, 1)) == 0.0

    def test_no_start_date_defaults_to_january(self):
        cf = _annual("X", 12000, end=date(2026, 6, 30))
        # 2026-01 window = full 2026 calendar year; overlap = [Jan 1, Jun 30] = 181 days
        assert _active_fraction(cf, date(2026, 1, 1)) == pytest.approx(181 / _ANNUAL_PERIOD_DAYS)
        # Non-anchor months: 0
        assert _active_fraction(cf, date(2026, 6, 1)) == 0.0

    def test_leap_day_anchor_clamps(self):
        """Anchor day Feb 29 must not crash when subsequent years have only 28 days."""
        cf = _annual("X", 12000, start=date(2024, 2, 29))
        # Should evaluate without raising and return a positive fraction in Feb of any year
        v_2024 = _active_fraction(cf, date(2024, 2, 1))
        v_2025 = _active_fraction(cf, date(2025, 2, 1))
        assert v_2024 > 0.9
        assert v_2025 > 0.9


class TestOneOffUnchanged:
    def test_one_off_matches_month(self):
        cf = OneOffCashFlow("X", Direction.OUTFLOW, 500, date=date(2026, 3, 15))
        assert _active_fraction(cf, date(2026, 3, 1)) == 1.0
        assert _active_fraction(cf, date(2026, 2, 1)) == 0.0
        assert _active_fraction(cf, date(2026, 4, 1)) == 0.0
