import { describe, expect, it } from "vitest";
import { civilDate } from "./dates";
import {
  ANNUAL_PERIOD_DAYS,
  type LedgerRow,
  MONTHLY_PERIOD_DAYS,
  activeFraction,
  aggregateByPhase,
  aggregateCashflowsInPeriod,
  buildTimeline,
  computeLedger,
} from "./engine";
import {
  type AnyCashFlow,
  Direction,
  EngineError,
  Frequency,
  LiquidityActual,
  OneOffCashFlow,
  Phase,
  RecurringCashFlow,
} from "./models";

const d = civilDate;

/** Assert |actual - expected| <= tol (mirrors pytest.approx / atol). */
function close(actual: number, expected: number, tol = 1e-9): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

function monthly(name: string, amount: number, start: Date | null = null, end: Date | null = null) {
  return new RecurringCashFlow(
    name,
    amount >= 0 ? Direction.Inflow : Direction.Outflow,
    Math.abs(amount),
    Frequency.Monthly,
    start,
    end
  );
}

function annually(
  name: string,
  amount: number,
  start: Date | null = null,
  end: Date | null = null
) {
  return new RecurringCashFlow(
    name,
    amount >= 0 ? Direction.Inflow : Direction.Outflow,
    Math.abs(amount),
    Frequency.Annually,
    start,
    end
  );
}

function oneOff(name: string, amount: number, on: Date) {
  return new OneOffCashFlow(
    name,
    amount >= 0 ? Direction.Inflow : Direction.Outflow,
    Math.abs(amount),
    on
  );
}

const last = (rows: LedgerRow[]) => rows.at(-1) as LedgerRow;
const monthRow = (rows: LedgerRow[], m: Date) =>
  rows.find((r) => r.monthYear.getTime() === m.getTime()) as LedgerRow;

describe("monthly prorating", () => {
  it("mid-month start", () => {
    const cf = monthly("X", -1000, d(2026, 3, 15));
    expect(activeFraction(cf, d(2026, 2, 1))).toBe(0);
    close(activeFraction(cf, d(2026, 3, 1)), 17 / MONTHLY_PERIOD_DAYS);
    close(activeFraction(cf, d(2026, 4, 1)), 30 / MONTHLY_PERIOD_DAYS);
    close(activeFraction(cf, d(2026, 5, 1)), 31 / MONTHLY_PERIOD_DAYS);
  });

  it("mid-month end", () => {
    const cf = monthly("X", -1000, null, d(2026, 3, 15));
    close(activeFraction(cf, d(2026, 2, 1)), 28 / MONTHLY_PERIOD_DAYS);
    close(activeFraction(cf, d(2026, 3, 1)), 15 / MONTHLY_PERIOD_DAYS);
    expect(activeFraction(cf, d(2026, 4, 1))).toBe(0);
  });

  it("mutual exclusion: no double count across adjacent flows", () => {
    const a = monthly("A", -1000, null, d(2026, 3, 15));
    const b = monthly("B", -1000, d(2026, 3, 16));
    const march = d(2026, 3, 1);
    const total = 1000 * activeFraction(a, march) + 1000 * activeFraction(b, march);
    close(total, (1000 * 31) / MONTHLY_PERIOD_DAYS);
  });

  it("same-month start and end", () => {
    const cf = monthly("X", -1000, d(2026, 3, 5), d(2026, 3, 20));
    close(activeFraction(cf, d(2026, 3, 1)), 16 / MONTHLY_PERIOD_DAYS);
    expect(activeFraction(cf, d(2026, 2, 1))).toBe(0);
    expect(activeFraction(cf, d(2026, 4, 1))).toBe(0);
  });

  it("full-year totals conserved", () => {
    const cf = monthly("X", -1200);
    const phases = [new Phase("Y", d(2026, 1, 1), d(2026, 12, 31))];
    const ledger = computeLedger(buildTimeline(phases), phases, [cf]);
    const total = ledger.reduce((s, r) => s + r.totalOutflow, 0);
    close(total, (1200 * 365) / MONTHLY_PERIOD_DAYS, 1e-6);
  });
});

describe("annual prorating", () => {
  it("full year, anchored to March", () => {
    const cf = annually("X", -12000, d(2026, 3, 15));
    expect(activeFraction(cf, d(2026, 4, 1))).toBe(0);
    expect(activeFraction(cf, d(2026, 1, 1))).toBe(0);
    close(activeFraction(cf, d(2026, 3, 1)), 365 / ANNUAL_PERIOD_DAYS);
    close(activeFraction(cf, d(2027, 3, 1)), 366 / ANNUAL_PERIOD_DAYS);
  });

  it("partial year truncated by end date", () => {
    const cf = annually("X", -12000, d(2026, 3, 15), d(2026, 9, 15));
    close(activeFraction(cf, d(2026, 3, 1)), 185 / ANNUAL_PERIOD_DAYS);
    expect(activeFraction(cf, d(2027, 3, 1))).toBe(0);
  });

  it("partial year, anchor not January", () => {
    const cf = annually("X", -12000, d(2026, 8, 1), d(2027, 2, 1));
    close(activeFraction(cf, d(2026, 8, 1)), 185 / ANNUAL_PERIOD_DAYS);
    expect(activeFraction(cf, d(2027, 8, 1))).toBe(0);
  });

  it("no start date defaults to January", () => {
    const cf = annually("X", -12000, null, d(2026, 6, 30));
    close(activeFraction(cf, d(2026, 1, 1)), 181 / ANNUAL_PERIOD_DAYS);
    expect(activeFraction(cf, d(2026, 6, 1))).toBe(0);
  });

  it("leap-day anchor clamps without crashing", () => {
    const cf = annually("X", -12000, d(2024, 2, 29));
    expect(activeFraction(cf, d(2024, 2, 1))).toBeGreaterThan(0.9);
    expect(activeFraction(cf, d(2025, 2, 1))).toBeGreaterThan(0.9);
  });
});

describe("one-off activation", () => {
  it("matches only its own month", () => {
    const cf = new OneOffCashFlow("X", Direction.Outflow, 500, d(2026, 3, 15));
    expect(activeFraction(cf, d(2026, 3, 1))).toBe(1);
    expect(activeFraction(cf, d(2026, 2, 1))).toBe(0);
    expect(activeFraction(cf, d(2026, 4, 1))).toBe(0);
  });
});

describe("template scenario (penny-exact parity)", () => {
  it("computes phase aggregates", () => {
    const phases = [
      new Phase("Current Job", d(2026, 6, 1), d(2026, 11, 30)),
      new Phase("Career Break", d(2026, 12, 1), d(2027, 2, 28)),
      new Phase("New Role", d(2027, 3, 1), d(2027, 11, 30)),
    ];
    const flows: AnyCashFlow[] = [
      monthly("Salary", 5000, d(2026, 6, 1), d(2026, 11, 30)),
      monthly("Rent", -1800),
      monthly("Groceries", -600),
      monthly("New Salary", 6500, d(2027, 3, 1), d(2027, 11, 30)),
      annually("Insurance", -1200, d(2026, 9, 1)),
      oneOff("Moving Costs", -3000, d(2026, 12, 1)),
      oneOff("Signing Bonus", 5000, d(2027, 3, 1)),
    ];
    const actuals = [new LiquidityActual(d(2026, 6, 1), 50_000)];
    const timeline = buildTimeline(phases);
    const ledger = computeLedger(timeline, phases, flows, actuals);
    expect(ledger).toHaveLength(18);

    const agg = aggregateByPhase(ledger);
    const expected = [
      { phase: "Current Job", months: 6, start: 50_000.0, net: 14_432.85, end: 64_432.85 },
      { phase: "Career Break", months: 3, start: 64_432.85, net: -10_096.51, end: 54_336.34 },
      { phase: "New Role", months: 9, start: 54_336.34, net: 40_840.66, end: 95_177.0 },
    ];
    expect(agg).toHaveLength(3);
    expected.forEach((e, i) => {
      const a = agg[i];
      if (!a) throw new Error("missing phase summary");
      expect(a.activePhase).toBe(e.phase);
      expect(a.months).toBe(e.months);
      close(a.startingLiquidity, e.start, 0.01);
      close(a.netFlow, e.net, 0.01);
      close(a.endingLiquidity, e.end, 0.01);
    });
  });
});

describe("single phase, no flows", () => {
  it("keeps a flat balance", () => {
    const phases = [new Phase("Waiting", d(2026, 1, 1), d(2026, 6, 30))];
    const ledger = computeLedger(
      buildTimeline(phases),
      phases,
      [],
      [new LiquidityActual(d(2026, 1, 1), 10000)]
    );
    expect(ledger).toHaveLength(6);
    expect(ledger.every((r) => r.endingLiquidity === 10000)).toBe(true);
    expect((aggregateByPhase(ledger)[0] as { netFlow: number }).netFlow).toBe(0);
  });
});

describe("negative liquidity", () => {
  it("computes without erroring", () => {
    const phases = [new Phase("Burn", d(2026, 1, 1), d(2026, 3, 31))];
    const ledger = computeLedger(
      buildTimeline(phases),
      phases,
      [monthly("Rent", -500)],
      [new LiquidityActual(d(2026, 1, 1), 1000)]
    );
    close(last(ledger).endingLiquidity, 1000 - (500 * 90) / MONTHLY_PERIOD_DAYS);
  });
});

describe("annual frequency firing", () => {
  it("fires once per year in the anchor month", () => {
    const phases = [new Phase("Long", d(2026, 1, 1), d(2028, 12, 31))];
    const ledger = computeLedger(buildTimeline(phases), phases, [
      annually("Annual Fee", -600, d(2026, 3, 1)),
    ]);
    const firing = ledger.filter((r) => r.totalOutflow > 0);
    expect(firing).toHaveLength(3);
    expect(firing.every((r) => r.monthYear.getUTCMonth() + 1 === 3)).toBe(true);
    close(last(ledger).endingLiquidity, (-600 * (365 + 366 + 365)) / ANNUAL_PERIOD_DAYS);
  });
});

describe("one-offs only", () => {
  it("fires in matching months", () => {
    const phases = [new Phase("Setup", d(2026, 1, 1), d(2026, 4, 30))];
    const ledger = computeLedger(
      buildTimeline(phases),
      phases,
      [oneOff("Deposit", -5000, d(2026, 1, 15)), oneOff("Refund", 2000, d(2026, 3, 10))],
      [new LiquidityActual(d(2026, 1, 1), 20000)]
    );
    expect((ledger[0] as LedgerRow).endingLiquidity).toBe(15000);
    expect((ledger[1] as LedgerRow).endingLiquidity).toBe(15000);
    expect((ledger[2] as LedgerRow).endingLiquidity).toBe(17000);
    expect((ledger[3] as LedgerRow).endingLiquidity).toBe(17000);
  });
});

describe("phase gap", () => {
  it("includes gap months but aggregates only phased ones", () => {
    const phases = [
      new Phase("Before", d(2026, 1, 1), d(2026, 2, 28)),
      new Phase("After", d(2026, 4, 1), d(2026, 5, 31)),
    ];
    const ledger = computeLedger(
      buildTimeline(phases),
      phases,
      [monthly("Rent", -1000)],
      [new LiquidityActual(d(2026, 1, 1), 5000)]
    );
    expect(ledger).toHaveLength(5);
    close(last(ledger).endingLiquidity, 5000 - (1000 * 151) / MONTHLY_PERIOD_DAYS);
    close(monthRow(ledger, d(2026, 3, 1)).totalOutflow, (1000 * 31) / MONTHLY_PERIOD_DAYS);

    const agg = aggregateByPhase(ledger);
    expect(agg).toHaveLength(2);
    expect((agg.find((a) => a.activePhase === "Before") as { months: number }).months).toBe(2);
    expect((agg.find((a) => a.activePhase === "After") as { months: number }).months).toBe(2);
  });
});

describe("aggregateCashflowsInPeriod", () => {
  function setup() {
    const phases = [
      new Phase("Working", d(2026, 1, 1), d(2026, 6, 30)),
      new Phase("Break", d(2026, 7, 1), d(2026, 12, 31)),
    ];
    const cashFlows: AnyCashFlow[] = [
      new RecurringCashFlow(
        "Salary",
        Direction.Inflow,
        5000,
        Frequency.Monthly,
        d(2026, 1, 1),
        d(2026, 6, 30)
      ),
      new RecurringCashFlow("Rent", Direction.Outflow, 1200, Frequency.Monthly),
      new OneOffCashFlow("Bonus", Direction.Inflow, 3000, d(2026, 3, 1)),
    ];
    return { timeline: buildTimeline(phases), phases, cashFlows };
  }

  it("phase-aligned period", () => {
    const { timeline, phases, cashFlows } = setup();
    const result = aggregateCashflowsInPeriod(
      timeline,
      phases,
      cashFlows,
      d(2026, 1, 1),
      d(2026, 6, 30)
    );
    const byName = Object.fromEntries(result.items.map((it) => [it.name, it]));
    close((byName.Salary as { amount: number }).amount, (5000 * 181) / MONTHLY_PERIOD_DAYS);
    close((byName.Rent as { amount: number }).amount, (1200 * 181) / MONTHLY_PERIOD_DAYS);
    expect((byName.Bonus as { amount: number }).amount).toBe(3000);
  });

  it("single month", () => {
    const { timeline, phases, cashFlows } = setup();
    const result = aggregateCashflowsInPeriod(
      timeline,
      phases,
      cashFlows,
      d(2026, 3, 1),
      d(2026, 3, 31)
    );
    const byName = Object.fromEntries(result.items.map((it) => [it.name, it]));
    close((byName.Salary as { amount: number }).amount, (5000 * 31) / MONTHLY_PERIOD_DAYS);
    close((byName.Rent as { amount: number }).amount, (1200 * 31) / MONTHLY_PERIOD_DAYS);
    expect((byName.Bonus as { amount: number }).amount).toBe(3000);
  });

  it("period with no cash flows returns empty items", () => {
    const phases = [new Phase("Quiet", d(2026, 1, 1), d(2026, 3, 31))];
    const result = aggregateCashflowsInPeriod(
      buildTimeline(phases),
      phases,
      [],
      d(2026, 1, 1),
      d(2026, 3, 31)
    );
    expect(result.items).toEqual([]);
    expect(result.startingLiquidity).toBe(0);
    expect(result.endingLiquidity).toBe(0);
  });

  it("starting/ending liquidity match the ledger", () => {
    const { timeline, phases, cashFlows } = setup();
    const ledger = computeLedger(timeline, phases, cashFlows);
    const result = aggregateCashflowsInPeriod(
      timeline,
      phases,
      cashFlows,
      d(2026, 3, 1),
      d(2026, 3, 1)
    );
    const mar = monthRow(ledger, d(2026, 3, 1));
    expect(result.startingLiquidity).toBe(mar.startingLiquidity);
    expect(result.endingLiquidity).toBe(mar.endingLiquidity);
  });

  it("orders inflows before outflows", () => {
    const { timeline, phases, cashFlows } = setup();
    const result = aggregateCashflowsInPeriod(
      timeline,
      phases,
      cashFlows,
      d(2026, 1, 1),
      d(2026, 6, 30)
    );
    const directions = result.items.map((it) => it.direction);
    const lastInflow = directions.lastIndexOf(Direction.Inflow);
    const firstOutflow = directions.indexOf(Direction.Outflow);
    if (lastInflow !== -1 && firstOutflow !== -1) {
      expect(lastInflow).toBeLessThan(firstOutflow);
    }
  });

  it("raises when the period is outside the timeline", () => {
    const { timeline, phases, cashFlows } = setup();
    expect(() =>
      aggregateCashflowsInPeriod(timeline, phases, cashFlows, d(2030, 1, 1), d(2030, 6, 30))
    ).toThrow(EngineError);
  });

  it("raises when end is before start", () => {
    const { timeline, phases, cashFlows } = setup();
    expect(() =>
      aggregateCashflowsInPeriod(timeline, phases, cashFlows, d(2026, 6, 1), d(2026, 1, 1))
    ).toThrow(EngineError);
  });
});

describe("actuals re-anchoring", () => {
  const base = () => ({
    phases: [new Phase("Work", d(2026, 1, 1), d(2026, 6, 30))],
    flows: [monthly("Rent", -1000)],
  });

  it("starts from zero with no actuals", () => {
    const { phases, flows } = base();
    const ledger = computeLedger(buildTimeline(phases), phases, flows, []);
    expect(ledger).toHaveLength(6);
    expect((ledger[0] as LedgerRow).startingLiquidity).toBe(0);
  });

  it("re-anchors the balance to the latest actual", () => {
    const { phases, flows } = base();
    const ledger = computeLedger(buildTimeline(phases), phases, flows, [
      new LiquidityActual(d(2026, 3, 15), 25000),
    ]);
    expect(ledger).toHaveLength(4);
    expect((ledger[0] as LedgerRow).startingLiquidity).toBe(25000);
    close(last(ledger).endingLiquidity, 25000 - (1000 * 122) / MONTHLY_PERIOD_DAYS);
  });

  it("filters one-offs strictly before the latest actual", () => {
    const phases = [new Phase("Work", d(2026, 1, 1), d(2026, 6, 30))];
    const flows = [
      oneOff("Old Bonus", 5000, d(2026, 2, 1)),
      oneOff("Future Bonus", 3000, d(2026, 5, 1)),
    ];
    const ledger = computeLedger(buildTimeline(phases), phases, flows, [
      new LiquidityActual(d(2026, 3, 1), 8000),
    ]);
    expect(ledger).toHaveLength(4);
    expect(monthRow(ledger, d(2026, 5, 1)).totalInflow).toBe(3000);
    expect(ledger.reduce((s, r) => s + r.totalInflow, 0)).toBe(3000);
  });

  it("keeps a one-off on the same day as the actual", () => {
    const phases = [new Phase("Work", d(2026, 1, 1), d(2026, 6, 30))];
    const flows = [oneOff("Same Day", 500, d(2026, 3, 15))];
    const ledger = computeLedger(buildTimeline(phases), phases, flows, [
      new LiquidityActual(d(2026, 3, 15), 8000),
    ]);
    expect(monthRow(ledger, d(2026, 3, 1)).totalInflow).toBe(500);
  });

  it("uses only the latest of multiple actuals", () => {
    const { phases, flows } = base();
    const ledger = computeLedger(buildTimeline(phases), phases, flows, [
      new LiquidityActual(d(2026, 2, 1), 11000),
      new LiquidityActual(d(2026, 4, 1), 30000),
    ]);
    expect(ledger).toHaveLength(3);
    expect((ledger[0] as LedgerRow).startingLiquidity).toBe(30000);
  });
});
