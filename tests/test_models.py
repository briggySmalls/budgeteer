from datetime import date

import pytest

from budgeteer.models import (
    Direction,
    Frequency,
    LiquidityActual,
    OneOffCashFlow,
    Phase,
    RecurringCashFlow,
)


class TestPhase:
    def test_valid_phase(self):
        p = Phase("Test Phase", date(2026, 1, 1), date(2026, 6, 30))
        assert p.name == "Test Phase"
        assert p.start_date == date(2026, 1, 1)
        assert p.end_date == date(2026, 6, 30)

    def test_end_before_start_raises(self):
        with pytest.raises(ValueError, match="must be after start_date"):
            Phase("Bad", date(2026, 6, 30), date(2026, 1, 1))

    def test_equal_dates_raises(self):
        with pytest.raises(ValueError, match="must be after start_date"):
            Phase("Bad", date(2026, 1, 1), date(2026, 1, 1))


class TestRecurringCashFlow:
    def test_valid_monthly(self):
        cf = RecurringCashFlow("Salary", Direction.INFLOW, 5000.0, Frequency.MONTHLY)
        assert cf.frequency == Frequency.MONTHLY
        assert cf.start_date is None
        assert cf.end_date is None

    def test_valid_annually_with_dates(self):
        cf = RecurringCashFlow(
            "Insurance",
            Direction.OUTFLOW,
            1200.0,
            Frequency.ANNUALLY,
            start_date=date(2026, 3, 1),
            end_date=date(2028, 3, 1),
        )
        assert cf.frequency == Frequency.ANNUALLY
        assert cf.start_date == date(2026, 3, 1)

    def test_unbounded_start(self):
        cf = RecurringCashFlow(
            "Rent",
            Direction.OUTFLOW,
            1800.0,
            Frequency.MONTHLY,
            end_date=date(2027, 12, 31),
        )
        assert cf.start_date is None
        assert cf.end_date == date(2027, 12, 31)

    def test_negative_amount_raises(self):
        with pytest.raises(ValueError, match="must be non-negative"):
            RecurringCashFlow("Bad", Direction.INFLOW, -100.0)

    def test_end_before_start_raises(self):
        with pytest.raises(ValueError, match="must be after start_date"):
            RecurringCashFlow(
                "Bad",
                Direction.OUTFLOW,
                100.0,
                Frequency.MONTHLY,
                start_date=date(2027, 1, 1),
                end_date=date(2026, 1, 1),
            )


class TestOneOffCashFlow:
    def test_valid(self):
        cf = OneOffCashFlow("Moving Costs", Direction.OUTFLOW, 3000.0, date=date(2026, 12, 1))
        assert cf.date == date(2026, 12, 1)

    def test_missing_date_raises(self):
        with pytest.raises(ValueError, match="date is required"):
            OneOffCashFlow("Bad", Direction.OUTFLOW, 3000.0)

    def test_negative_amount_raises(self):
        with pytest.raises(ValueError, match="must be non-negative"):
            OneOffCashFlow("Bad", Direction.OUTFLOW, -100.0, date=date(2026, 1, 1))


class TestLiquidityActual:
    def test_valid(self):
        a = LiquidityActual(date=date(2026, 3, 15), amount=42000.0)
        assert a.date == date(2026, 3, 15)
        assert a.amount == 42000.0

    def test_negative_amount_allowed(self):
        a = LiquidityActual(date=date(2026, 3, 15), amount=-500.0)
        assert a.amount == -500.0

    def test_frozen(self):
        a = LiquidityActual(date=date(2026, 3, 15), amount=1000.0)
        with pytest.raises(AttributeError):
            a.amount = 2000.0  # type: ignore[misc]
