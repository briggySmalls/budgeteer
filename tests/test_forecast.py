"""Integration tests: ODS file -> ingest -> engine -> assert on numbers.

Each test defines a financial scenario, writes a temp ODS file,
runs the full pipeline, and checks phase-level totals and balances.
"""

from datetime import date

import pandas as pd
import pytest

from budgeteer.engine import (
    _ANNUAL_PERIOD_DAYS,
    _MONTHLY_PERIOD_DAYS,
    aggregate_by_phase,
    aggregate_cashflows_in_period,
    build_timeline,
    compute_ledger,
)
from budgeteer.ingest import load_inputs
from budgeteer.models import (
    Direction,
    EngineError,
    Frequency,
    LiquidityActual,
    OneOffCashFlow,
    Phase,
    RecurringCashFlow,
)
from budgeteer.odswriter import write_ods


def run_forecast(tmp_path, actuals=None, **kwargs):
    """Write an ODS file from kwargs and run the full pipeline."""
    path = tmp_path / "model.ods"
    write_ods(path, actuals=[(a.date, a.amount) for a in actuals] if actuals else None, **kwargs)
    phases, flows, loaded_actuals = load_inputs(path)
    timeline = build_timeline(phases)
    ledger = compute_ledger(timeline, phases, flows, loaded_actuals or None)
    agg = aggregate_by_phase(ledger)
    return ledger, agg


def _d(v):
    if v is None or isinstance(v, date):
        return v
    return date.fromisoformat(v)


def phase(name, start, end):
    return (name, _d(start), _d(end))


def _recurring(name, amount, frequency, start, end):
    direction = "Inflow" if amount >= 0 else "Outflow"
    return (name, direction, abs(amount), frequency, _d(start), _d(end))


def monthly(name, amount, start=None, end=None):
    return _recurring(name, amount, "Monthly", start, end)


def annually(name, amount, start=None, end=None):
    return _recurring(name, amount, "Annually", start, end)


def one_off(name, amount, on):
    direction = "Inflow" if amount >= 0 else "Outflow"
    return (name, direction, abs(amount), _d(on))


def actual(amount, on):
    return LiquidityActual(date=_d(on), amount=amount)


class TestTemplateScenario:
    """The default template: 3 phases, salary->break->new role."""

    def test_full_pipeline(self, tmp_path):
        # fmt: off
        ledger, agg = run_forecast(
            tmp_path,
            actuals=[actual(50_000, "2026-06-01")],
            phases=[
                phase("Current Job",  "2026-06-01", "2026-11-30"),
                phase("Career Break", "2026-12-01", "2027-02-28"),
                phase("New Role",     "2027-03-01", "2027-11-30"),
            ],
            recurring=[
                monthly("Salary",     +5000, "2026-06-01", "2026-11-30"),
                monthly("Rent",       -1800),
                monthly("Groceries",   -600),
                monthly("New Salary", +6500, "2027-03-01", "2027-11-30"),
                annually("Insurance", -1200, "2026-09-01"),
            ],
            one_offs=[
                one_off("Moving Costs",  -3000, "2026-12-01"),
                one_off("Signing Bonus", +5000, "2027-03-01"),
            ],
        )

        assert len(ledger) == 18  # Jun 2026 -> Nov 2027

        expected = pd.DataFrame([
            {"phase": "Current Job",  "months": 6, "start": 50_000.00, "net":  14_432.85, "end": 64_432.85},  # noqa: E501
            {"phase": "Career Break", "months": 3, "start": 64_432.85, "net": -10_096.51, "end": 54_336.34},  # noqa: E501
            {"phase": "New Role",     "months": 9, "start": 54_336.34, "net":  40_840.66, "end": 95_177.00},  # noqa: E501
        ])
        # fmt: on
        actual_summary = (
            agg[["active_phase", "months", "starting_liquidity", "net_flow", "ending_liquidity"]]
            .rename(
                columns={
                    "active_phase": "phase",
                    "starting_liquidity": "start",
                    "net_flow": "net",
                    "ending_liquidity": "end",
                }
            )
            .reset_index(drop=True)
        )
        pd.testing.assert_frame_equal(actual_summary, expected, atol=0.01)


class TestSinglePhaseNoFlows:
    """Edge case: just phases, no cash flows. Balance stays flat."""

    def test_flat_balance(self, tmp_path):
        ledger, agg = run_forecast(
            tmp_path,
            actuals=[LiquidityActual(date=date(2026, 1, 1), amount=10000)],
            phases=[("Waiting", date(2026, 1, 1), date(2026, 6, 30))],
            recurring=[],
            one_offs=[],
        )
        assert len(ledger) == 6
        assert all(ledger["ending_liquidity"] == 10000)
        assert agg.iloc[0]["net_flow"] == 0


class TestNegativeLiquidity:
    """Liquidity goes negative -- engine should still compute, not error."""

    def test_goes_negative(self, tmp_path):
        ledger, _agg = run_forecast(
            tmp_path,
            actuals=[LiquidityActual(date=date(2026, 1, 1), amount=1000)],
            phases=[("Burn", date(2026, 1, 1), date(2026, 3, 31))],
            recurring=[("Rent", "Outflow", 500, "Monthly", None, None)],
            one_offs=[],
        )
        # Jan-Mar 2026 = 31+28+31 = 90 days of rent
        expected = 1000 - 500 * 90 / _MONTHLY_PERIOD_DAYS
        assert ledger.iloc[-1]["ending_liquidity"] == pytest.approx(expected)


class TestAnnualFrequency:
    """Annual cash flow fires once per year in the correct month."""

    def test_fires_in_correct_months(self, tmp_path):
        ledger, _agg = run_forecast(
            tmp_path,
            phases=[("Long", date(2026, 1, 1), date(2028, 12, 31))],
            recurring=[
                ("Annual Fee", "Outflow", 600, "Annually", date(2026, 3, 1), None),
            ],
            one_offs=[],
        )
        # Should fire in Mar 2026, Mar 2027, Mar 2028 = 3 times
        months_with_outflow = ledger[ledger["total_outflow"] > 0]
        assert len(months_with_outflow) == 3
        assert all(d.month == 3 for d in months_with_outflow["month_year"])
        # Anniversary windows: Mar 2026 -> 365 days, Mar 2027 -> 366 (covers leap Feb 2028),
        # Mar 2028 -> 365.
        expected = -600 * (365 + 366 + 365) / _ANNUAL_PERIOD_DAYS
        assert ledger.iloc[-1]["ending_liquidity"] == pytest.approx(expected)


class TestOneOffsOnly:
    """Scenario with only one-off cash flows."""

    def test_one_offs_fire_correctly(self, tmp_path):
        ledger, _agg = run_forecast(
            tmp_path,
            actuals=[LiquidityActual(date=date(2026, 1, 1), amount=20000)],
            phases=[("Setup", date(2026, 1, 1), date(2026, 4, 30))],
            recurring=[],
            one_offs=[
                ("Deposit", "Outflow", 5000, date(2026, 1, 15)),
                ("Refund", "Inflow", 2000, date(2026, 3, 10)),
            ],
        )
        assert ledger.iloc[0]["ending_liquidity"] == 15000  # Jan: -5000
        assert ledger.iloc[1]["ending_liquidity"] == 15000  # Feb: nothing
        assert ledger.iloc[2]["ending_liquidity"] == 17000  # Mar: +2000
        assert ledger.iloc[3]["ending_liquidity"] == 17000  # Apr: nothing


class TestPhaseGap:
    """Months between phases still compute; cash flows still fire."""

    def test_gap_months_included(self, tmp_path):
        ledger, agg = run_forecast(
            tmp_path,
            actuals=[LiquidityActual(date=date(2026, 1, 1), amount=5000)],
            phases=[
                ("Before", date(2026, 1, 1), date(2026, 2, 28)),
                ("After", date(2026, 4, 1), date(2026, 5, 31)),
            ],
            recurring=[("Rent", "Outflow", 1000, "Monthly", None, None)],
            one_offs=[],
        )
        # 5 months Jan-May = 31+28+31+30+31 = 151 days
        assert len(ledger) == 5
        expected_final = 5000 - 1000 * 151 / _MONTHLY_PERIOD_DAYS
        assert ledger.iloc[-1]["ending_liquidity"] == pytest.approx(expected_final)

        # Gap month (March) still has the outflow (31-day month)
        march = ledger[ledger["month_year"] == date(2026, 3, 1)].iloc[0]
        assert march["total_outflow"] == pytest.approx(1000 * 31 / _MONTHLY_PERIOD_DAYS)

        # Aggregation only covers phased months
        assert len(agg) == 2
        assert agg[agg["active_phase"] == "Before"].iloc[0]["months"] == 2
        assert agg[agg["active_phase"] == "After"].iloc[0]["months"] == 2


class TestAggregateCashflowsInPeriod:
    """Unit tests for aggregate_cashflows_in_period."""

    def _setup(self):
        phases = [
            Phase("Working", date(2026, 1, 1), date(2026, 6, 30)),
            Phase("Break", date(2026, 7, 1), date(2026, 12, 31)),
        ]
        cash_flows = [
            RecurringCashFlow(
                "Salary",
                Direction.INFLOW,
                5000.0,
                Frequency.MONTHLY,
                start_date=date(2026, 1, 1),
                end_date=date(2026, 6, 30),
            ),
            RecurringCashFlow("Rent", Direction.OUTFLOW, 1200.0, Frequency.MONTHLY),
            OneOffCashFlow("Bonus", Direction.INFLOW, 3000.0, date=date(2026, 3, 1)),
        ]
        timeline = build_timeline(phases)
        return timeline, phases, cash_flows

    def test_phase_aligned_period(self):
        timeline, phases, cash_flows = self._setup()
        result = aggregate_cashflows_in_period(
            timeline,
            phases,
            cash_flows,
            date(2026, 1, 1),
            date(2026, 6, 30),
        )
        items_by_name = {it["name"]: it for it in result["items"]}
        # Jan-Jun 2026 = 31+28+31+30+31+30 = 181 days
        assert items_by_name["Salary"]["amount"] == pytest.approx(5000 * 181 / _MONTHLY_PERIOD_DAYS)
        assert items_by_name["Rent"]["amount"] == pytest.approx(1200 * 181 / _MONTHLY_PERIOD_DAYS)
        # Bonus is a one-off; not pro-rated
        assert items_by_name["Bonus"]["amount"] == 3000

    def test_single_month(self):
        timeline, phases, cash_flows = self._setup()
        result = aggregate_cashflows_in_period(
            timeline,
            phases,
            cash_flows,
            date(2026, 3, 1),
            date(2026, 3, 31),
        )
        items_by_name = {it["name"]: it for it in result["items"]}
        # March = 31 days
        assert items_by_name["Salary"]["amount"] == pytest.approx(5000 * 31 / _MONTHLY_PERIOD_DAYS)
        assert items_by_name["Rent"]["amount"] == pytest.approx(1200 * 31 / _MONTHLY_PERIOD_DAYS)
        assert items_by_name["Bonus"]["amount"] == 3000

    def test_period_with_no_cashflows_returns_empty_items(self):
        phases = [Phase("Quiet", date(2026, 1, 1), date(2026, 3, 31))]
        timeline = build_timeline(phases)
        result = aggregate_cashflows_in_period(
            timeline,
            phases,
            [],
            date(2026, 1, 1),
            date(2026, 3, 31),
        )
        assert result["items"] == []
        assert result["starting_liquidity"] == 0.0
        assert result["ending_liquidity"] == 0.0

    def test_starting_and_ending_liquidity_match_ledger(self):
        timeline, phases, cash_flows = self._setup()
        ledger = compute_ledger(timeline, phases, cash_flows)
        result = aggregate_cashflows_in_period(
            timeline,
            phases,
            cash_flows,
            date(2026, 3, 1),
            date(2026, 3, 1),
        )
        mar = ledger[ledger["month_year"] == date(2026, 3, 1)].iloc[0]
        assert result["starting_liquidity"] == mar["starting_liquidity"]
        assert result["ending_liquidity"] == mar["ending_liquidity"]

    def test_inflows_ordered_before_outflows(self):
        timeline, phases, cash_flows = self._setup()
        result = aggregate_cashflows_in_period(
            timeline,
            phases,
            cash_flows,
            date(2026, 1, 1),
            date(2026, 6, 30),
        )
        directions = [it["direction"].value for it in result["items"]]
        inflow_indices = [i for i, d in enumerate(directions) if d == "Inflow"]
        outflow_indices = [i for i, d in enumerate(directions) if d == "Outflow"]
        if inflow_indices and outflow_indices:
            assert max(inflow_indices) < min(outflow_indices)

    def test_period_outside_timeline_raises(self):
        timeline, phases, cash_flows = self._setup()
        with pytest.raises(EngineError):
            aggregate_cashflows_in_period(
                timeline,
                phases,
                cash_flows,
                date(2030, 1, 1),
                date(2030, 6, 30),
            )

    def test_end_before_start_raises(self):
        timeline, phases, cash_flows = self._setup()
        with pytest.raises(EngineError):
            aggregate_cashflows_in_period(
                timeline,
                phases,
                cash_flows,
                date(2026, 6, 1),
                date(2026, 1, 1),
            )


class TestActuals:
    """compute_ledger correctly re-anchors from the latest actual reading."""

    def _base_kwargs(self):
        return dict(
            phases=[("Work", date(2026, 1, 1), date(2026, 6, 30))],
            recurring=[("Rent", "Outflow", 1000, "Monthly", None, None)],
            one_offs=[],
        )

    def test_no_actuals_starts_from_zero(self, tmp_path):
        ledger, _ = run_forecast(tmp_path, actuals=[], **self._base_kwargs())
        assert len(ledger) == 6
        assert ledger.iloc[0]["starting_liquidity"] == 0.0

    def test_latest_actual_re_anchors_balance(self, tmp_path):
        actuals = [LiquidityActual(date=date(2026, 3, 15), amount=25000.0)]
        ledger, _ = run_forecast(tmp_path, actuals=actuals, **self._base_kwargs())
        # Timeline trimmed to March onward (4 months: Mar-Jun = 31+30+31+30 = 122 days)
        assert len(ledger) == 4
        assert ledger.iloc[0]["starting_liquidity"] == 25000.0
        expected = 25000 - 1000 * 122 / _MONTHLY_PERIOD_DAYS
        assert ledger.iloc[-1]["ending_liquidity"] == pytest.approx(expected)

    def test_one_off_before_latest_actual_filtered(self, tmp_path):
        kwargs = dict(
            phases=[("Work", date(2026, 1, 1), date(2026, 6, 30))],
            recurring=[],
            one_offs=[
                ("Old Bonus", "Inflow", 5000, date(2026, 2, 1)),
                ("Future Bonus", "Inflow", 3000, date(2026, 5, 1)),
            ],
        )
        actuals = [LiquidityActual(date=date(2026, 3, 1), amount=8000.0)]
        ledger, _ = run_forecast(tmp_path, actuals=actuals, **kwargs)
        # Old Bonus (Feb) is before latest actual (Mar 1) — filtered out
        # Future Bonus (May) is after — kept
        assert len(ledger) == 4  # Mar-Jun
        may = ledger[ledger["month_year"] == date(2026, 5, 1)].iloc[0]
        assert may["total_inflow"] == 3000.0
        total_inflow_all = ledger["total_inflow"].sum()
        assert total_inflow_all == 3000.0  # Only the future bonus

    def test_one_off_on_same_day_as_actual_kept(self, tmp_path):
        kwargs = dict(
            phases=[("Work", date(2026, 1, 1), date(2026, 6, 30))],
            recurring=[],
            one_offs=[
                ("Same Day", "Inflow", 500, date(2026, 3, 15)),
            ],
        )
        # Actual on the 15th; a one-off also on the 15th should NOT be filtered
        # (filter is strictly less-than)
        actuals = [LiquidityActual(date=date(2026, 3, 15), amount=8000.0)]
        ledger, _ = run_forecast(tmp_path, actuals=actuals, **kwargs)
        march = ledger[ledger["month_year"] == date(2026, 3, 1)].iloc[0]
        assert march["total_inflow"] == 500.0

    def test_multiple_actuals_only_latest_anchors(self, tmp_path):
        actuals = [
            LiquidityActual(date=date(2026, 2, 1), amount=11000.0),
            LiquidityActual(date=date(2026, 4, 1), amount=30000.0),
        ]
        ledger, _ = run_forecast(tmp_path, actuals=actuals, **self._base_kwargs())
        # Latest is April -> timeline Apr-Jun (3 months)
        assert len(ledger) == 3
        assert ledger.iloc[0]["starting_liquidity"] == 30000.0
