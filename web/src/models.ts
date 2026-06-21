import { compareDates, formatISO } from "./dates";

export enum Direction {
  Inflow = "Inflow",
  Outflow = "Outflow",
}

export enum Frequency {
  Monthly = "Monthly",
  Annually = "Annually",
}

/** Base for all domain errors (mirrors the Python `BudgeteerError` hierarchy). */
export class BudgeteerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class IngestionError extends BudgeteerError {}
export class EngineError extends BudgeteerError {}

/**
 * A named span of time. Cash flows are aggregated per phase. Phases must not
 * overlap (enforced in ingest) and must have a positive duration.
 */
export class Phase {
  constructor(
    readonly name: string,
    readonly startDate: Date,
    readonly endDate: Date
  ) {
    if (compareDates(endDate, startDate) <= 0) {
      throw new Error(
        `Phase '${name}': end_date (${formatISO(endDate)}) must be after start_date (${formatISO(startDate)})`
      );
    }
    Object.freeze(this);
  }
}

function assertNonNegative(name: string, amount: number): void {
  if (amount < 0) {
    throw new Error(`Cash flow '${name}': amount must be non-negative, got ${amount}`);
  }
}

/** A recurring inflow/outflow, prorated by day overlap in the engine. */
export class RecurringCashFlow {
  constructor(
    readonly name: string,
    readonly direction: Direction,
    readonly amount: number,
    readonly frequency: Frequency = Frequency.Monthly,
    readonly startDate: Date | null = null,
    readonly endDate: Date | null = null
  ) {
    assertNonNegative(name, amount);
    if (startDate !== null && endDate !== null && compareDates(endDate, startDate) <= 0) {
      throw new Error(
        `Cash flow '${name}': end_date (${formatISO(endDate)}) must be after start_date (${formatISO(startDate)})`
      );
    }
    Object.freeze(this);
  }
}

/** A single dated cash flow; fires in the month matching its date. */
export class OneOffCashFlow {
  constructor(
    readonly name: string,
    readonly direction: Direction,
    readonly amount: number,
    readonly date: Date
  ) {
    assertNonNegative(name, amount);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Cash flow '${name}': date is required for one-off`);
    }
    Object.freeze(this);
  }
}

export type AnyCashFlow = RecurringCashFlow | OneOffCashFlow;

/** A historical liquidity reading. Amount may be negative (overdrawn). */
export class LiquidityActual {
  constructor(
    readonly date: Date,
    readonly amount: number
  ) {
    Object.freeze(this);
  }
}
