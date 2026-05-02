"""Integration tests: ODS file -> ingest -> engine -> assert on numbers.

Each test defines a financial scenario, writes a temp ODS file,
runs the full pipeline, and checks phase-level totals and balances.
"""

from datetime import date

from budgeteer.engine import aggregate_by_phase, build_timeline, compute_ledger
from budgeteer.ingest import load_inputs
from budgeteer.odswriter import write_ods


def run_forecast(tmp_path, **kwargs):
    """Write an ODS file from kwargs and run the full pipeline."""
    path = tmp_path / "model.ods"
    write_ods(path, **kwargs)
    savings, phases, flows = load_inputs(path)
    timeline = build_timeline(phases)
    ledger = compute_ledger(timeline, phases, flows, savings)
    agg = aggregate_by_phase(ledger)
    return ledger, agg


class TestTemplateScenario:
    """The default template: 3 phases, salary->break->new role."""

    def test_full_pipeline(self, tmp_path):
        d = date
        ledger, agg = run_forecast(
            tmp_path,
            starting_savings=50000,
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
            starting_savings=10000,
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
            starting_savings=1000,
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
            starting_savings=0,
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
            starting_savings=20000,
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
            starting_savings=5000,
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
