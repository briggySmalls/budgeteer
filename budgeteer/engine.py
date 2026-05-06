from __future__ import annotations

from calendar import monthrange
from datetime import date, timedelta

import pandas as pd

from budgeteer.models import (
    AnyCashFlow,
    Direction,
    EngineError,
    Frequency,
    LiquidityActual,
    OneOffCashFlow,
    Phase,
)

_MONTHLY_PERIOD_DAYS = 365.25 / 12
_ANNUAL_PERIOD_DAYS = 365.25


def build_timeline(phases: list[Phase]) -> list[date]:
    if not phases:
        raise EngineError("At least one Phase is required")

    start = min(p.start_date for p in phases)
    end = max(p.end_date for p in phases)

    months = pd.date_range(start=start, end=end, freq="MS")
    return [m.date() for m in months]


def _find_active_phase(month: date, phases: list[Phase]) -> str | None:
    for p in phases:
        if p.start_date <= month <= p.end_date:
            return p.name
    return None


def _interval_overlap_days(
    flow_start: date | None,
    flow_end: date | None,
    window_start: date,
    window_end: date,
) -> int:
    a = flow_start if flow_start is not None else window_start
    b = flow_end if flow_end is not None else window_end
    overlap_start = max(a, window_start)
    overlap_end = min(b, window_end)
    return max(0, (overlap_end - overlap_start).days + 1)


def _anchor_date(year: int, month: int, day: int) -> date:
    last = monthrange(year, month)[1]
    return date(year, month, min(day, last))


def _active_fraction(cf: AnyCashFlow, month: date) -> float:
    if isinstance(cf, OneOffCashFlow):
        return 1.0 if (month.year, month.month) == (cf.date.year, cf.date.month) else 0.0

    if cf.frequency == Frequency.MONTHLY:
        month_start = month
        month_end = month.replace(day=monthrange(month.year, month.month)[1])
        days = _interval_overlap_days(cf.start_date, cf.end_date, month_start, month_end)
        return days / _MONTHLY_PERIOD_DAYS

    anchor_m = cf.start_date.month if cf.start_date else 1
    anchor_d = cf.start_date.day if cf.start_date else 1
    if month.month != anchor_m:
        return 0.0
    window_start = _anchor_date(month.year, anchor_m, anchor_d)
    window_end = _anchor_date(month.year + 1, anchor_m, anchor_d) - timedelta(days=1)
    days = _interval_overlap_days(cf.start_date, cf.end_date, window_start, window_end)
    return days / _ANNUAL_PERIOD_DAYS


def compute_ledger(
    timeline: list[date],
    phases: list[Phase],
    cash_flows: list[AnyCashFlow],
    actuals: list[LiquidityActual] | None = None,
) -> pd.DataFrame:
    rows = []

    if actuals:
        latest = max(actuals, key=lambda a: a.date)
        latest_month = latest.date.replace(day=1)
        timeline = [m for m in timeline if m >= latest_month]
        balance = latest.amount
        cash_flows = [
            cf
            for cf in cash_flows
            if not (isinstance(cf, OneOffCashFlow) and cf.date < latest.date)
        ]
    else:
        balance = 0.0

    for month in timeline:
        active_phase = _find_active_phase(month, phases)
        weighted = [(cf, _active_fraction(cf, month)) for cf in cash_flows]

        total_inflow = sum(
            cf.amount * f for cf, f in weighted if f > 0 and cf.direction == Direction.INFLOW
        )
        total_outflow = sum(
            cf.amount * f for cf, f in weighted if f > 0 and cf.direction == Direction.OUTFLOW
        )
        net_flow = total_inflow - total_outflow
        ending = balance + net_flow

        rows.append(
            {
                "month_year": month,
                "active_phase": active_phase,
                "starting_liquidity": balance,
                "total_inflow": total_inflow,
                "total_outflow": total_outflow,
                "net_flow": net_flow,
                "ending_liquidity": ending,
            }
        )
        balance = ending

    return pd.DataFrame(rows)


def aggregate_cashflows_in_period(
    timeline: list[date],
    phases: list[Phase],
    cash_flows: list[AnyCashFlow],
    period_start: date,
    period_end: date,
    actuals: list[LiquidityActual] | None = None,
) -> dict:
    if period_end < period_start:
        raise EngineError(
            f"period_end ({period_end}) must be on or after period_start ({period_start})"
        )

    ledger = compute_ledger(timeline, phases, cash_flows, actuals)

    start_month = period_start.replace(day=1)
    end_month = period_end.replace(day=1)

    in_period = ledger[(ledger["month_year"] >= start_month) & (ledger["month_year"] <= end_month)]
    if in_period.empty:
        raise EngineError(
            f"Period [{period_start}, {period_end}] does not overlap the forecast timeline"
        )

    starting_liquidity = float(in_period.iloc[0]["starting_liquidity"])
    ending_liquidity = float(in_period.iloc[-1]["ending_liquidity"])

    months = [m for m in timeline if start_month <= m <= end_month]
    totals: dict[str, dict] = {}
    for cf in cash_flows:
        amount = sum(cf.amount * _active_fraction(cf, m) for m in months)
        if amount == 0:
            continue
        key = cf.name
        if key in totals:
            totals[key]["amount"] += amount
        else:
            totals[key] = {"name": cf.name, "direction": cf.direction, "amount": amount}

    items = sorted(
        totals.values(),
        key=lambda it: (it["direction"] != Direction.INFLOW, -it["amount"]),
    )

    return {
        "starting_liquidity": starting_liquidity,
        "ending_liquidity": ending_liquidity,
        "items": items,
        "period_start": start_month,
        "period_end": end_month,
    }


def aggregate_by_phase(ledger: pd.DataFrame) -> pd.DataFrame:
    phase_rows = ledger[ledger["active_phase"].notna()]
    if phase_rows.empty:
        return pd.DataFrame()

    groups = phase_rows.groupby("active_phase", sort=False)
    agg = groups.agg(
        starting_liquidity=("starting_liquidity", "first"),
        ending_liquidity=("ending_liquidity", "last"),
        total_inflow=("total_inflow", "sum"),
        total_outflow=("total_outflow", "sum"),
        net_flow=("net_flow", "sum"),
        months=("month_year", "count"),
    )
    return agg.reset_index()
