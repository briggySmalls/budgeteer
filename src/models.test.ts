import { describe, expect, it } from "vitest";
import { civilDate } from "./dates";
import {
  Direction,
  Frequency,
  LiquidityActual,
  OneOffCashFlow,
  Phase,
  RecurringCashFlow,
} from "./models";

describe("Phase", () => {
  it("accepts a valid phase", () => {
    const p = new Phase("Test Phase", civilDate(2026, 1, 1), civilDate(2026, 6, 30));
    expect(p.name).toBe("Test Phase");
    expect(p.startDate).toEqual(civilDate(2026, 1, 1));
    expect(p.endDate).toEqual(civilDate(2026, 6, 30));
  });

  it("rejects end before start", () => {
    expect(() => new Phase("Bad", civilDate(2026, 6, 30), civilDate(2026, 1, 1))).toThrow(
      /must be after start_date/
    );
  });

  it("rejects equal dates", () => {
    expect(() => new Phase("Bad", civilDate(2026, 1, 1), civilDate(2026, 1, 1))).toThrow(
      /must be after start_date/
    );
  });
});

describe("RecurringCashFlow", () => {
  it("defaults to an unbounded monthly flow", () => {
    const cf = new RecurringCashFlow("Salary", Direction.Inflow, 5000, Frequency.Monthly);
    expect(cf.frequency).toBe(Frequency.Monthly);
    expect(cf.startDate).toBeNull();
    expect(cf.endDate).toBeNull();
  });

  it("accepts an annual flow with dates", () => {
    const cf = new RecurringCashFlow(
      "Insurance",
      Direction.Outflow,
      1200,
      Frequency.Annually,
      civilDate(2026, 3, 1),
      civilDate(2028, 3, 1)
    );
    expect(cf.frequency).toBe(Frequency.Annually);
    expect(cf.startDate).toEqual(civilDate(2026, 3, 1));
  });

  it("allows an unbounded start", () => {
    const cf = new RecurringCashFlow(
      "Rent",
      Direction.Outflow,
      1800,
      Frequency.Monthly,
      null,
      civilDate(2027, 12, 31)
    );
    expect(cf.startDate).toBeNull();
    expect(cf.endDate).toEqual(civilDate(2027, 12, 31));
  });

  it("rejects a negative amount", () => {
    expect(() => new RecurringCashFlow("Bad", Direction.Inflow, -100)).toThrow(
      /must be non-negative/
    );
  });

  it("rejects end before start", () => {
    expect(
      () =>
        new RecurringCashFlow(
          "Bad",
          Direction.Outflow,
          100,
          Frequency.Monthly,
          civilDate(2027, 1, 1),
          civilDate(2026, 1, 1)
        )
    ).toThrow(/must be after start_date/);
  });
});

describe("OneOffCashFlow", () => {
  it("accepts a valid one-off", () => {
    const cf = new OneOffCashFlow("Moving Costs", Direction.Outflow, 3000, civilDate(2026, 12, 1));
    expect(cf.date).toEqual(civilDate(2026, 12, 1));
  });

  it("rejects a missing/invalid date", () => {
    expect(() => new OneOffCashFlow("Bad", Direction.Outflow, 3000, new Date(Number.NaN))).toThrow(
      /date is required/
    );
  });

  it("rejects a negative amount", () => {
    expect(() => new OneOffCashFlow("Bad", Direction.Outflow, -100, civilDate(2026, 1, 1))).toThrow(
      /must be non-negative/
    );
  });
});

describe("LiquidityActual", () => {
  it("accepts a valid reading", () => {
    const a = new LiquidityActual(civilDate(2026, 3, 15), 42000);
    expect(a.date).toEqual(civilDate(2026, 3, 15));
    expect(a.amount).toBe(42000);
  });

  it("allows a negative amount", () => {
    const a = new LiquidityActual(civilDate(2026, 3, 15), -500);
    expect(a.amount).toBe(-500);
  });

  it("is frozen", () => {
    const a = new LiquidityActual(civilDate(2026, 3, 15), 1000);
    expect(() => {
      (a as { amount: number }).amount = 2000;
    }).toThrow();
  });
});
