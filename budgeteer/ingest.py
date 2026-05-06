from __future__ import annotations

from pathlib import Path

import pandas as pd

from budgeteer.models import (
    AnyCashFlow,
    Direction,
    Frequency,
    IngestionError,
    LiquidityActual,
    OneOffCashFlow,
    Phase,
    RecurringCashFlow,
)


def load_inputs(
    path: Path,
) -> tuple[list[Phase], list[AnyCashFlow], list[LiquidityActual]]:
    if not path.exists():
        raise IngestionError(f"File not found: {path}")

    phases = _read_phases(path)
    recurring = _read_recurring(path)
    one_offs = _read_one_offs(path)
    actuals = _read_actuals(path)

    return phases, [*recurring, *one_offs], actuals


def _read_sheet(path: Path, sheet_name: str) -> pd.DataFrame:
    try:
        df = pd.read_excel(path, sheet_name=sheet_name, engine="odf")
    except ValueError as e:
        raise IngestionError(f"Sheet '{sheet_name}' not found in {path}") from e
    return df.dropna(how="all")


def _require_columns(df: pd.DataFrame, columns: list[str], sheet_name: str) -> None:
    missing = set(columns) - set(df.columns)
    if missing:
        raise IngestionError(f"Sheet '{sheet_name}': missing columns {sorted(missing)}")


def _to_date(val) -> object:
    if pd.isna(val):
        return None
    return pd.Timestamp(val).date()


def _parse_direction(val: str, item_name: str) -> Direction:
    try:
        return Direction(val.strip().title())
    except (ValueError, AttributeError) as e:
        raise IngestionError(
            f"Cash flow '{item_name}': Direction must be 'Inflow' or 'Outflow', got '{val}'"
        ) from e


def _parse_frequency(val: str, item_name: str) -> Frequency:
    try:
        return Frequency(val.strip().title())
    except (ValueError, AttributeError) as e:
        raise IngestionError(
            f"Cash flow '{item_name}': Frequency must be 'Monthly' or 'Annually', got '{val}'"
        ) from e


def _read_phases(path: Path) -> list[Phase]:
    df = _read_sheet(path, "Phases")
    _require_columns(df, ["Name", "Start_Date", "End_Date"], "Phases")

    phases = []
    for _, row in df.iterrows():
        start = _to_date(row["Start_Date"])
        end = _to_date(row["End_Date"])
        if start is None or end is None:
            raise IngestionError(f"Phase '{row['Name']}': Start_Date and End_Date are required")
        try:
            phases.append(Phase(str(row["Name"]), start, end))
        except ValueError as e:
            raise IngestionError(str(e)) from e

    phases.sort(key=lambda p: p.start_date)
    _validate_no_overlaps(phases)
    return phases


def _validate_no_overlaps(phases: list[Phase]) -> None:
    for i in range(len(phases) - 1):
        a, b = phases[i], phases[i + 1]
        if a.end_date >= b.start_date:
            raise IngestionError(
                f"Phases '{a.name}' and '{b.name}' overlap: "
                f"{a.name} ends {a.end_date}, {b.name} starts {b.start_date}"
            )


def _read_recurring(path: Path) -> list[RecurringCashFlow]:
    df = _read_sheet(path, "Recurring_Cash_Flows")
    _require_columns(
        df,
        ["Name", "Direction", "Amount", "Frequency", "Start_Date", "End_Date"],
        "Recurring_Cash_Flows",
    )

    flows = []
    for _, row in df.iterrows():
        name = str(row["Name"])
        direction = _parse_direction(str(row["Direction"]), name)
        frequency = _parse_frequency(str(row["Frequency"]), name)
        amount = float(row["Amount"])
        start = _to_date(row["Start_Date"])
        end = _to_date(row["End_Date"])

        try:
            flows.append(
                RecurringCashFlow(
                    name=name,
                    direction=direction,
                    amount=amount,
                    frequency=frequency,
                    start_date=start,
                    end_date=end,
                )
            )
        except ValueError as e:
            raise IngestionError(str(e)) from e

    return flows


def _read_actuals(path: Path) -> list[LiquidityActual]:
    df = _read_sheet(path, "Actuals")
    if df.empty:
        return []
    _require_columns(df, ["Date", "Liquidity"], "Actuals")
    actuals = []
    for _, row in df.iterrows():
        d = _to_date(row["Date"])
        if d is None:
            raise IngestionError("Actuals: Date is required for each row")
        try:
            amount = float(row["Liquidity"])
        except (ValueError, TypeError) as e:
            raise IngestionError(f"Actuals: invalid Liquidity value on {d}: {e}") from e
        actuals.append(LiquidityActual(date=d, amount=amount))
    actuals.sort(key=lambda a: a.date)
    return actuals


def _read_one_offs(path: Path) -> list[OneOffCashFlow]:
    df = _read_sheet(path, "One_Off_Cash_Flows")
    _require_columns(
        df,
        ["Name", "Direction", "Amount", "Date"],
        "One_Off_Cash_Flows",
    )

    flows = []
    for _, row in df.iterrows():
        name = str(row["Name"])
        direction = _parse_direction(str(row["Direction"]), name)
        amount = float(row["Amount"])
        d = _to_date(row["Date"])

        if d is None:
            raise IngestionError(f"Cash flow '{name}': Date is required for one-off")

        try:
            flows.append(
                OneOffCashFlow(
                    name=name,
                    direction=direction,
                    amount=amount,
                    date=d,
                )
            )
        except ValueError as e:
            raise IngestionError(str(e)) from e

    return flows
