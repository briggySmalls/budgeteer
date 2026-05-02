"""Integration tests: ODS file -> ingest -> engine -> assert on numbers.

Each test defines a financial scenario, writes a temp ODS file,
runs the full pipeline, and checks phase-level totals and balances.
"""

from datetime import date

import pytest

from budgeteer.engine import (
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


class TestTemplateScenario:
    """The default template: 3 phases, salary->break->new role."""

    def test_full_pipeline(self, tmp_path):
        d = date
        ledger, agg = run_forecast(
            tmp_path,
            actuals=[LiquidityActual(date=date(2026, 6, 1), amount=50000)],
            phases=[
                ("P1", "Current Job", d(2026, 6, 1), d(2026, 11, 30)),
                ("P2", "Career Break", d(2026, 12, 1), d(2027, 2, 28)),
                ("P3", "New Role", d(2027, 3, 1), d(2027, 11, 30)),
            ],
            recurring=[
                ("CF1", "Salary", "Inflow", 5000, "Monthly", d(2026, 6, 1), d(2026, 11, 30)),
                ("CF2", "Rent", "Outflow", 1800, "Monthly", None, None),
                ("CF3", "Groceries", "Outflow", 600, "Monthly", None, None),
                ("CF4", "New Salary", "Inflow", 6500, "Monthly", d(2027, 3, 1), d(2027, 11, 30)),
                ("CF5", "Insurance", "Outflow", 1200, "Annually", d(2026, 9, 1), None),
            ],
            one_offs=[
                ("CF10", "Moving Costs", "Outflow", 3000, d(2026, 12, 1)),
                ("CF11", "Signing Bonus", "Inflow", 5000, d(2027, 3, 1)),
            ],
        )

        # 18 months total: Jun 2026 -> Nov 2027
        assert len(ledger) == 18

        # -- Phase 1: Current Job (Jun-Nov 2026, 6 months) --
        p1 = agg[agg["active_phase"] == "Current Job"].iloc[0]
        assert p1["months"] == 6
        assert p1["starting_liquidity"] == 50000
        # Monthly: +5000 salary, -1800 rent, -600 groceries = +2600/mo
        # Sep also has -1200 insurance (annual)
        # 6 months * 2600 = 15600, minus 1200 insurance = 14400
        assert p1["net_flow"] == 14400
        assert p1["ending_liquidity"] == 64400

        # -- Phase 2: Career Break (Dec 2026 - Feb 2027, 3 months) --
        p2 = agg[agg["active_phase"] == "Career Break"].iloc[0]
        assert p2["months"] == 3
        assert p2["starting_liquidity"] == 64400
        # No salary, -1800 rent, -600 groceries = -2400/mo
        # Dec also has -3000 moving costs (one-off)
        # 3 * -2400 + -3000 = -10200
        assert p2["net_flow"] == -10200
        assert p2["ending_liquidity"] == 54200

        # -- Phase 3: New Role (Mar-Nov 2027, 9 months) --
        p3 = agg[agg["active_phase"] == "New Role"].iloc[0]
        assert p3["months"] == 9
        assert p3["starting_liquidity"] == 54200
        # +6500 salary, -1800 rent, -600 groceries = +4100/mo
        # Mar has +5000 signing bonus (one-off)
        # Sep has -1200 insurance (annual)
        # 9 * 4100 + 5000 - 1200 = 40700
        assert p3["net_flow"] == 40700
        assert p3["ending_liquidity"] == 94900

        # Final balance
        assert ledger.iloc[-1]["ending_liquidity"] == 94900


class TestSinglePhaseNoFlows:
    """Edge case: just phases, no cash flows. Balance stays flat."""

    def test_flat_balance(self, tmp_path):
        ledger, agg = run_forecast(
            tmp_path,
            actuals=[LiquidityActual(date=date(2026, 1, 1), amount=10000)],
            phases=[("P1", "Waiting", date(2026, 1, 1), date(2026, 6, 30))],
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
            phases=[("P1", "Burn", date(2026, 1, 1), date(2026, 3, 31))],
            recurring=[("CF1", "Rent", "Outflow", 500, "Monthly", None, None)],
            one_offs=[],
        )
        # 1000 - 500*3 = -500
        assert ledger.iloc[-1]["ending_liquidity"] == -500


class TestAnnualFrequency:
    """Annual cash flow fires once per year in the correct month."""

    def test_fires_in_correct_months(self, tmp_path):
        ledger, _agg = run_forecast(
            tmp_path,
            phases=[("P1", "Long", date(2026, 1, 1), date(2028, 12, 31))],
            recurring=[
                ("CF1", "Annual Fee", "Outflow", 600, "Annually", date(2026, 3, 1), None),
            ],
            one_offs=[],
        )
        # Should fire in Mar 2026, Mar 2027, Mar 2028 = 3 times
        months_with_outflow = ledger[ledger["total_outflow"] > 0]
        assert len(months_with_outflow) == 3
        assert all(d.month == 3 for d in months_with_outflow["month_year"])
        assert ledger.iloc[-1]["ending_liquidity"] == -1800


class TestOneOffsOnly:
    """Scenario with only one-off cash flows."""

    def test_one_offs_fire_correctly(self, tmp_path):
        ledger, _agg = run_forecast(
            tmp_path,
            actuals=[LiquidityActual(date=date(2026, 1, 1), amount=20000)],
            phases=[("P1", "Setup", date(2026, 1, 1), date(2026, 4, 30))],
            recurring=[],
            one_offs=[
                ("CF1", "Deposit", "Outflow", 5000, date(2026, 1, 15)),
                ("CF2", "Refund", "Inflow", 2000, date(2026, 3, 10)),
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
                ("P1", "Before", date(2026, 1, 1), date(2026, 2, 28)),
                ("P2", "After", date(2026, 4, 1), date(2026, 5, 31)),
            ],
            recurring=[("CF1", "Rent", "Outflow", 1000, "Monthly", None, None)],
            one_offs=[],
        )
        # 5 months total (Jan-May), -1000 each
        assert len(ledger) == 5
        assert ledger.iloc[-1]["ending_liquidity"] == 0

        # Gap month (March) still has the outflow
        march = ledger[ledger["month_year"] == date(2026, 3, 1)].iloc[0]
        assert march["total_outflow"] == 1000

        # Aggregation only covers phased months
        assert len(agg) == 2
        assert agg[agg["active_phase"] == "Before"].iloc[0]["months"] == 2
        assert agg[agg["active_phase"] == "After"].iloc[0]["months"] == 2


class TestAggregateCashflowsInPeriod:
    """Unit tests for aggregate_cashflows_in_period."""

    def _setup(self):
        phases = [
            Phase("P1", "Working", date(2026, 1, 1), date(2026, 6, 30)),
            Phase("P2", "Break", date(2026, 7, 1), date(2026, 12, 31)),
        ]
        cash_flows = [
            RecurringCashFlow(
                "CF1",
                "Salary",
                Direction.INFLOW,
                5000.0,
                Frequency.MONTHLY,
                start_date=date(2026, 1, 1),
                end_date=date(2026, 6, 30),
            ),
            RecurringCashFlow("CF2", "Rent", Direction.OUTFLOW, 1200.0, Frequency.MONTHLY),
            OneOffCashFlow("CF3", "Bonus", Direction.INFLOW, 3000.0, date=date(2026, 3, 1)),
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
        # Salary: 5000 * 6 months = 30000
        assert items_by_name["Salary"]["amount"] == 30000
        # Rent: 1200 * 6 months = 7200 (active all year, but only 6 months in period)
        assert items_by_name["Rent"]["amount"] == 7200
        # Bonus fires once in Mar
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
        assert items_by_name["Salary"]["amount"] == 5000
        assert items_by_name["Rent"]["amount"] == 1200
        assert items_by_name["Bonus"]["amount"] == 3000

    def test_period_with_no_cashflows_returns_empty_items(self):
        phases = [Phase("P1", "Quiet", date(2026, 1, 1), date(2026, 3, 31))]
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
            phases=[("P1", "Work", date(2026, 1, 1), date(2026, 6, 30))],
            recurring=[("CF1", "Rent", "Outflow", 1000, "Monthly", None, None)],
            one_offs=[],
        )

    def test_no_actuals_starts_from_zero(self, tmp_path):
        ledger, _ = run_forecast(tmp_path, actuals=[], **self._base_kwargs())
        assert len(ledger) == 6
        assert ledger.iloc[0]["starting_liquidity"] == 0.0

    def test_latest_actual_re_anchors_balance(self, tmp_path):
        actuals = [LiquidityActual(date=date(2026, 3, 15), amount=25000.0)]
        ledger, _ = run_forecast(tmp_path, actuals=actuals, **self._base_kwargs())
        # Timeline trimmed to March onward (4 months: Mar-Jun)
        assert len(ledger) == 4
        assert ledger.iloc[0]["starting_liquidity"] == 25000.0
        # Each month: -1000 rent; 25000 - 4*1000 = 21000
        assert ledger.iloc[-1]["ending_liquidity"] == 21000.0

    def test_one_off_before_latest_actual_filtered(self, tmp_path):
        kwargs = dict(
            phases=[("P1", "Work", date(2026, 1, 1), date(2026, 6, 30))],
            recurring=[],
            one_offs=[
                ("CF1", "Old Bonus", "Inflow", 5000, date(2026, 2, 1)),
                ("CF2", "Future Bonus", "Inflow", 3000, date(2026, 5, 1)),
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
            phases=[("P1", "Work", date(2026, 1, 1), date(2026, 6, 30))],
            recurring=[],
            one_offs=[
                ("CF1", "Same Day", "Inflow", 500, date(2026, 3, 15)),
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
