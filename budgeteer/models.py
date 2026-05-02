from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from enum import Enum


class Direction(Enum):
    INFLOW = "Inflow"
    OUTFLOW = "Outflow"


class Frequency(Enum):
    MONTHLY = "Monthly"
    ANNUALLY = "Annually"


class BudgeteerError(Exception):
    pass


class IngestionError(BudgeteerError):
    pass


class EngineError(BudgeteerError):
    pass


@dataclass(frozen=True)
class Phase:
    id: str
    name: str
    start_date: date
    end_date: date

    def __post_init__(self) -> None:
        if self.end_date <= self.start_date:
            raise ValueError(
                f"Phase '{self.name}': end_date ({self.end_date}) "
                f"must be after start_date ({self.start_date})"
            )


@dataclass(frozen=True)
class CashFlow:
    id: str
    name: str
    direction: Direction
    amount: float

    def __post_init__(self) -> None:
        if self.amount < 0:
            raise ValueError(
                f"Cash flow '{self.name}': amount must be non-negative, got {self.amount}"
            )


@dataclass(frozen=True)
class RecurringCashFlow(CashFlow):
    frequency: Frequency = Frequency.MONTHLY
    start_date: date | None = None
    end_date: date | None = None

    def __post_init__(self) -> None:
        super().__post_init__()
        if (
            self.start_date is not None
            and self.end_date is not None
            and self.end_date <= self.start_date
        ):
            raise ValueError(
                f"Cash flow '{self.name}': end_date ({self.end_date}) "
                f"must be after start_date ({self.start_date})"
            )


@dataclass(frozen=True)
class OneOffCashFlow(CashFlow):
    date: date = date.min  # overridden at construction; default for dataclass ordering

    def __post_init__(self) -> None:
        super().__post_init__()
        if self.date == date.min:
            raise ValueError(f"Cash flow '{self.name}': date is required for one-off")


AnyCashFlow = RecurringCashFlow | OneOffCashFlow
