import { describe, expect, it } from "vitest";
import { combinedMonthlyChart, monthYearLabel, periodWaterfallChart } from "./charts";
import { civilDate } from "./dates";
import { aggregateCashflowsInPeriod, buildTimeline, computeLedger } from "./engine";
import { Direction, Frequency, LiquidityActual, Phase, RecurringCashFlow } from "./models";

const d = civilDate;

function makeLedger() {
  const phases = [new Phase("Working", d(2026, 1, 1), d(2026, 6, 30))];
  const cashFlows = [
    new RecurringCashFlow("Salary", Direction.Inflow, 5000, Frequency.Monthly),
    new RecurringCashFlow("Rent", Direction.Outflow, 1500, Frequency.Monthly),
  ];
  const timeline = buildTimeline(phases);
  return { timeline, phases, cashFlows, ledger: computeLedger(timeline, phases, cashFlows) };
}

describe("combinedMonthlyChart", () => {
  it("returns a figure object", () => {
    const fig = combinedMonthlyChart(makeLedger().ledger);
    expect(fig).toHaveProperty("data");
    expect(fig).toHaveProperty("layout");
  });

  it("has exactly two bar/scatter data traces (no actuals)", () => {
    const fig = combinedMonthlyChart(makeLedger().ledger);
    const traces = fig.data.filter((t) => t.type === "bar" || t.type === "scatter");
    expect(traces).toHaveLength(2);
  });

  it("keeps all traces on a single y axis", () => {
    const fig = combinedMonthlyChart(makeLedger().ledger);
    const yaxes = new Set(fig.data.map((t) => t.yaxis));
    for (const y of yaxes) {
      expect([undefined, "y"]).toContain(y);
    }
  });

  it("adds an actuals trace when actuals are supplied", () => {
    const { ledger } = makeLedger();
    const fig = combinedMonthlyChart(ledger, [new LiquidityActual(d(2026, 2, 1), 12000)]);
    expect(fig.data.some((t) => t.name === "Actual Liquidity")).toBe(true);
  });

  it("colours negative net-flow bars red and positive green", () => {
    const phases = [new Phase("P", d(2026, 1, 1), d(2026, 2, 28))];
    const cashFlows = [new RecurringCashFlow("Rent", Direction.Outflow, 1000, Frequency.Monthly)];
    const ledger = computeLedger(buildTimeline(phases), phases, cashFlows);
    const fig = combinedMonthlyChart(ledger);
    const bar = fig.data.find((t) => t.type === "bar");
    const color = (bar?.marker as { color: string[] }).color;
    expect(color.every((c) => c === "#e74c3c")).toBe(true);
  });
});

describe("periodWaterfallChart", () => {
  function summary(start: Date, end: Date) {
    const { cashFlows } = makeLedger();
    return aggregateCashflowsInPeriod(cashFlows, [], start, end);
  }

  it("returns a figure object", () => {
    const fig = periodWaterfallChart(summary(d(2026, 1, 1), d(2026, 6, 30)));
    expect(fig).toHaveProperty("data");
  });

  it("titles the period range", () => {
    const fig = periodWaterfallChart(summary(d(2026, 1, 1), d(2026, 6, 30)));
    expect(fig.layout.title).toContain("Jan 2026");
    expect(fig.layout.title).toContain("Jun 2026");
  });

  it("starts absolute and ends total", () => {
    const fig = periodWaterfallChart(summary(d(2026, 3, 1), d(2026, 3, 1)));
    const wf = fig.data[0];
    expect(wf?.measure?.[0]).toBe("absolute");
    expect(wf?.measure?.at(-1)).toBe("total");
  });
});

describe("monthYearLabel", () => {
  it("formats as abbreviated month and year", () => {
    expect(monthYearLabel(d(2026, 1, 15))).toBe("Jan 2026");
    expect(monthYearLabel(d(2027, 11, 1))).toBe("Nov 2027");
  });
});
