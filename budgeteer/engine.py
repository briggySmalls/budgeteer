from __future__ import annotations

from datetime import date

import pandas as pd

from budgeteer.models import (
    AnyCashFlow,
    Direction,
    EngineError,
    Frequency,
    OneOffCashFlow,
    Phase,
    RecurringCashFlow,
)


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


def _is_active(cf: AnyCashFlow, month: date) -> bool:
    if isinstance(cf, OneOffCashFlow):
        return month.year == cf.date.year and month.month == cf.date.month

    if isinstance(cf, RecurringCashFlow):
        if cf.start_date is not None and month < cf.start_date.replace(day=1):
            return False
        if cf.end_date is not None and month > cf.end_date.replace(day=1):
            return False

        if cf.frequency == Frequency.ANNUALLY:
            if cf.start_date is None:
                return month.month == 1
            return month.month == cf.start_date.month

        return True

    return False  # pragma: no cover


def compute_ledger(
    timeline: list[date],
    phases: list[Phase],
    cash_flows: list[AnyCashFlow],
    starting_savings: float,
) -> pd.DataFrame:
    rows = []
    balance = starting_savings

    for month in timeline:
        active_phase = _find_active_phase(month, phases)
        active_cfs = [cf for cf in cash_flows if _is_active(cf, month)]

        total_inflow = sum(cf.amount for cf in active_cfs if cf.direction == Direction.INFLOW)
        total_outflow = sum(cf.amount for cf in active_cfs if cf.direction == Direction.OUTFLOW)
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
