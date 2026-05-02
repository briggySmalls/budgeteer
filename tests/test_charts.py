from __future__ import annotations

from datetime import date

import plotly.graph_objects as go

from budgeteer.charts import combined_monthly_chart, period_waterfall_chart
from budgeteer.engine import aggregate_cashflows_in_period, build_timeline, compute_ledger
from budgeteer.models import Direction, Frequency, Phase, RecurringCashFlow


def _make_ledger():
    phases = [Phase("P1", "Working", date(2026, 1, 1), date(2026, 6, 30))]
    cash_flows = [
        RecurringCashFlow("CF1", "Salary", Direction.INFLOW, 5000.0, Frequency.MONTHLY),
        RecurringCashFlow("CF2", "Rent", Direction.OUTFLOW, 1500.0, Frequency.MONTHLY),
    ]
    timeline = build_timeline(phases)
    return timeline, phases, cash_flows, compute_ledger(timeline, phases, cash_flows)


class TestCombinedMonthlyChart:
    def test_returns_figure(self):
        _, _, _, ledger = _make_ledger()
        fig = combined_monthly_chart(ledger)
        assert isinstance(fig, go.Figure)

    def test_has_two_traces(self):
        _, _, _, ledger = _make_ledger()
        fig = combined_monthly_chart(ledger)
        data_traces = [t for t in fig.data if isinstance(t, go.Bar | go.Scatter)]
        assert len(data_traces) == 2

    def test_has_secondary_yaxis(self):
        _, _, _, ledger = _make_ledger()
        fig = combined_monthly_chart(ledger)
        liquidity_trace = next(t for t in fig.data if isinstance(t, go.Scatter))
        assert liquidity_trace.yaxis == "y2"


class TestPeriodWaterfallChart:
    def test_returns_figure(self):
        timeline, phases, cash_flows, _ = _make_ledger()
        summary = aggregate_cashflows_in_period(
            timeline,
            phases,
            cash_flows,
            date(2026, 1, 1),
            date(2026, 6, 30),
        )
        fig = period_waterfall_chart(summary)
        assert isinstance(fig, go.Figure)

    def test_title_contains_period(self):
        timeline, phases, cash_flows, _ = _make_ledger()
        summary = aggregate_cashflows_in_period(
            timeline,
            phases,
            cash_flows,
            date(2026, 1, 1),
            date(2026, 6, 30),
        )
        fig = period_waterfall_chart(summary)
        assert "Jan 2026" in fig.layout.title.text
        assert "Jun 2026" in fig.layout.title.text

    def test_waterfall_first_bar_is_absolute(self):
        timeline, phases, cash_flows, _ = _make_ledger()
        summary = aggregate_cashflows_in_period(
            timeline,
            phases,
            cash_flows,
            date(2026, 3, 1),
            date(2026, 3, 1),
        )
        fig = period_waterfall_chart(summary)
        wf = fig.data[0]
        assert wf.measure[0] == "absolute"
        assert wf.measure[-1] == "total"
