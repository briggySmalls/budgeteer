import { describe, expect, it } from "vitest";
import { civilDate } from "./dates";
import { aggregateByPhase, buildTimeline, computeLedger } from "./engine";
import { type Cell, parseInputs } from "./ingest";
import { Direction, Frequency, IngestionError } from "./models";

const d = civilDate;

type Fixtures = Record<
  "Phases" | "Recurring_Cash_Flows" | "One_Off_Cash_Flows" | "Actuals",
  Cell[][]
>;

function validSheets(): Fixtures {
  return {
    Phases: [
      ["Name", "Start_Date", "End_Date"],
      ["Work", d(2026, 1, 1), d(2026, 6, 30)],
    ],
    Recurring_Cash_Flows: [
      ["Name", "Direction", "Amount", "Frequency", "Start_Date", "End_Date"],
      ["Salary", "Inflow", 5000, "Monthly", null, null],
    ],
    One_Off_Cash_Flows: [
      ["Name", "Direction", "Amount", "Date"],
      ["Bonus", "inflow", 1000, d(2026, 3, 1)],
    ],
    Actuals: [
      ["Date", "Liquidity"],
      [d(2026, 1, 1), 10000],
    ],
  };
}

describe("parseInputs happy path", () => {
  it("parses all four sheets", () => {
    const { phases, cashFlows, actuals } = parseInputs(validSheets());
    expect(phases).toHaveLength(1);
    expect(cashFlows).toHaveLength(2);
    expect(actuals).toHaveLength(1);
    expect(phases[0]?.name).toBe("Work");
  });

  it("title-cases and trims Direction / Frequency", () => {
    const sheets = validSheets();
    sheets.Recurring_Cash_Flows[1] = ["Rent", " outflow ", 1200, " monthly ", null, null];
    const { cashFlows } = parseInputs(sheets);
    const rent = cashFlows.find((c) => c.name === "Rent");
    expect(rent?.direction).toBe(Direction.Outflow);
    expect((rent as { frequency: Frequency }).frequency).toBe(Frequency.Monthly);
    // One-off "inflow" lower-cased input parsed to Inflow
    expect(cashFlows.find((c) => c.name === "Bonus")?.direction).toBe(Direction.Inflow);
  });

  it("accepts ISO string dates", () => {
    const sheets = validSheets();
    sheets.Phases[1] = ["Work", "2026-01-01", "2026-06-30"];
    const { phases } = parseInputs(sheets);
    expect(phases[0]?.startDate).toEqual(d(2026, 1, 1));
    expect(phases[0]?.endDate).toEqual(d(2026, 6, 30));
  });
});

describe("phase validation", () => {
  it("sorts phases by start date", () => {
    const sheets = validSheets();
    sheets.Phases = [
      ["Name", "Start_Date", "End_Date"],
      ["Second", d(2026, 4, 1), d(2026, 6, 30)],
      ["First", d(2026, 1, 1), d(2026, 3, 31)],
    ];
    const { phases } = parseInputs(sheets);
    expect(phases.map((p) => p.name)).toEqual(["First", "Second"]);
  });

  it("rejects overlapping phases", () => {
    const sheets = validSheets();
    sheets.Phases = [
      ["Name", "Start_Date", "End_Date"],
      ["A", d(2026, 1, 1), d(2026, 4, 30)],
      ["B", d(2026, 4, 1), d(2026, 6, 30)],
    ];
    expect(() => parseInputs(sheets)).toThrow(/overlap/);
  });

  it("requires phase dates", () => {
    const sheets = validSheets();
    sheets.Phases[1] = ["Work", null, d(2026, 6, 30)];
    expect(() => parseInputs(sheets)).toThrow(/Start_Date and End_Date are required/);
  });
});

describe("error handling", () => {
  it("flags missing columns", () => {
    const sheets = validSheets();
    sheets.Phases = [
      ["Name", "Start_Date"],
      ["Work", d(2026, 1, 1)],
    ];
    expect(() => parseInputs(sheets)).toThrow(/missing columns/);
  });

  it("flags an unknown Direction", () => {
    const sheets = validSheets();
    sheets.One_Off_Cash_Flows[1] = ["Bonus", "sideways", 1000, d(2026, 3, 1)];
    expect(() => parseInputs(sheets)).toThrow(/Direction must be/);
  });

  it("requires a one-off date", () => {
    const sheets = validSheets();
    sheets.One_Off_Cash_Flows[1] = ["Bonus", "Inflow", 1000, null];
    expect(() => parseInputs(sheets)).toThrow(/Date is required for one-off/);
  });

  it("throws IngestionError when a sheet is missing", () => {
    const { Recurring_Cash_Flows, ...rest } = validSheets();
    void Recurring_Cash_Flows;
    expect(() => parseInputs(rest)).toThrow(IngestionError);
  });
});

describe("actuals", () => {
  it("returns [] for an empty Actuals sheet", () => {
    const sheets = validSheets();
    sheets.Actuals = [["Date", "Liquidity"]];
    expect(parseInputs(sheets).actuals).toEqual([]);
  });

  it("rejects a non-numeric Liquidity", () => {
    const sheets = validSheets();
    sheets.Actuals[1] = [d(2026, 1, 1), "not-a-number"];
    expect(() => parseInputs(sheets)).toThrow(/invalid Liquidity/);
  });

  it("sorts actuals by date", () => {
    const sheets = validSheets();
    sheets.Actuals = [
      ["Date", "Liquidity"],
      [d(2026, 4, 1), 30000],
      [d(2026, 2, 1), 11000],
    ];
    const { actuals } = parseInputs(sheets);
    expect(actuals.map((a) => a.amount)).toEqual([11000, 30000]);
  });
});

describe("parse -> engine integration", () => {
  it("feeds the engine end to end", () => {
    const { phases, cashFlows, actuals } = parseInputs(validSheets());
    const ledger = computeLedger(buildTimeline(phases), phases, cashFlows, actuals);
    expect(ledger).toHaveLength(6);
    expect(ledger[0]?.startingLiquidity).toBe(10000);
    // Single phase covers the whole timeline.
    expect(aggregateByPhase(ledger)).toHaveLength(1);
  });
});
