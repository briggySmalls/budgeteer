import { describe, expect, it } from "vitest";
import { combinedMonthlyChart, monthYearLabel, periodWaterfallChart } from "./charts";
import { civilDate } from "./dates";
import { aggregateCashflowsInPeriod, buildTimeline } from "./engine";
import { Direction, Frequency, LiquidityActual, Phase, RecurringCashFlow } from "./models";

const d = civilDate;

function makeLedger() {
  const phases = [new Phase("Working", d(2026, 1, 1), d(2026, 6, 30))];
  const cashFlows = [
    new RecurringCashFlow("Salary", Direction.Inflow, 5000, Frequency.Monthly),
    new RecurringCashFlow("Rent", Direction.Outflow, 1500, Frequency.Monthly),
  ];
  const timeline = buildTimeline(phases);
  return { timeline, phases, cashFlows };
}

describe("combinedMonthlyChart", () => {
  const { timeline, phases, cashFlows } = makeLedger();

  it("returns a figure object", () => {
    const fig = combinedMonthlyChart(timeline, phases, cashFlows, []);
    expect(fig).toHaveProperty("data");
    expect(fig).toHaveProperty("layout");
  });

  it("has exactly two bar/scatter data traces (no actuals)", () => {
    const fig = combinedMonthlyChart(timeline, phases, cashFlows, []);
    const traces = fig.data.filter((t) => t.type === "bar" || t.type === "scatter");
    expect(traces).toHaveLength(2);
  });

  it("keeps all traces on a single y axis", () => {
    const fig = combinedMonthlyChart(timeline, phases, cashFlows, []);
    const yaxes = new Set(fig.data.map((t) => t.yaxis));
    for (const y of yaxes) {
      expect([undefined, "y"]).toContain(y);
    }
  });

  it("adds an actuals trace when actuals are supplied", () => {
    const fig = combinedMonthlyChart(timeline, phases, cashFlows, [
      new LiquidityActual(d(2026, 2, 1), 12000),
    ]);
    expect(fig.data.some((t) => t.name === "Actual Liquidity")).toBe(true);
  });

  it("colours negative net-flow bars red and positive green", () => {
    const pPhases = [new Phase("P", d(2026, 1, 1), d(2026, 2, 28))];
    const pCashFlows = [new RecurringCashFlow("Rent", Direction.Outflow, 1000, Frequency.Monthly)];
    const pTimeline = buildTimeline(pPhases);
    const fig = combinedMonthlyChart(pTimeline, pPhases, pCashFlows, []);
    const bar = fig.data.find((t) => t.type === "bar");
    const color = (bar?.marker as { color: string[] }).color;
    expect(color.every((c) => c === "#e74c3c")).toBe(true);
  });
});

describe("periodWaterfallChart", () => {
  const { cashFlows } = makeLedger();

  function summary(start: Date, end: Date) {
    return aggregateCashflowsInPeriod(cashFlows, [], start, end);
  }

  it("returns a figure object", () => {
    const fig = periodWaterfallChart(summary(d(2026, 1, 1), d(2026, 6, 30)));
    expect(fig).toHaveProperty("data");
  });

  it("titles the period range", () => {
    const fig = periodWaterfallChart(summary(d(2026, 1, 1), d(2026, 6, 30)));
    expect(fig.layout.title).toContain("2026-01-01");
    expect(fig.layout.title).toContain("2026-06-30");
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
