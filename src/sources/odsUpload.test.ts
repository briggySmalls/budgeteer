import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { civilDate } from "../dates";
import { buildTimeline, computeLedger } from "../engine";
import { type Cell, parseInputs } from "../ingest";
import { OdsUploadSource } from "./odsUpload";

// Spreadsheet serial number for a date (what a real ODS stores in date cells).
const serial = (y: number, m: number, d: number) =>
  Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86_400_000);

/**
 * Build a synthetic `.ods` in memory with fake data, so the test carries no real
 * financial information. Includes a formula cell with a cached value to exercise
 * the "read computed value, not the formula" path.
 */
function makeOds(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const sheet = (aoa: Cell[][]) => XLSX.utils.aoa_to_sheet(aoa);

  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      ["Name", "Start_Date", "End_Date"],
      ["Job", serial(2026, 1, 1), serial(2026, 6, 30)],
    ]),
    "Phases"
  );

  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      ["Name", "Direction", "Amount", "Frequency", "Start_Date", "End_Date"],
      ["Salary", "Inflow", 5000, "Monthly", null, null],
    ]),
    "Recurring_Cash_Flows"
  );

  const oneOff = sheet([
    ["Name", "Direction", "Amount", "Date"],
    ["Bonus", "Inflow", 1000, serial(2026, 3, 1)],
    ["Computed", "Inflow", 0, serial(2026, 4, 1)],
  ]);
  // A formula cell carrying a cached computed value (200 = 100 * 2).
  oneOff.C3 = { t: "n", f: "100*2", v: 200 };
  XLSX.utils.book_append_sheet(wb, oneOff, "One_Off_Cash_Flows");

  XLSX.utils.book_append_sheet(
    wb,
    sheet([
      ["Date", "Liquidity"],
      [serial(2026, 1, 1), 10000],
    ]),
    "Actuals"
  );

  return XLSX.write(wb, { bookType: "ods", type: "array" }) as Uint8Array;
}

describe("OdsUploadSource", () => {
  const bytes = makeOds();

  it("reads the four model sheets", async () => {
    const sheets = await new OdsUploadSource(bytes).load();
    expect(Object.keys(sheets).sort()).toEqual([
      "Actuals",
      "One_Off_Cash_Flows",
      "Phases",
      "Recurring_Cash_Flows",
    ]);
  });

  it("converts serial dates to UTC-midnight dates", async () => {
    const { phases } = parseInputs(await new OdsUploadSource(bytes).load());
    expect(phases[0]?.startDate).toEqual(civilDate(2026, 1, 1));
    expect(phases[0]?.endDate).toEqual(civilDate(2026, 6, 30));
  });

  it("surfaces a formula cell's cached value", async () => {
    const { cashFlows } = parseInputs(await new OdsUploadSource(bytes).load());
    expect(cashFlows.find((c) => c.name === "Computed")?.amount).toBe(200);
  });

  it("runs the full ingest -> engine pipeline", async () => {
    const { phases, cashFlows, actuals } = parseInputs(await new OdsUploadSource(bytes).load());
    const ledger = computeLedger(buildTimeline(phases), phases, cashFlows, actuals);
    expect(ledger).toHaveLength(6);
    expect(ledger[0]?.startingLiquidity).toBe(10000);
  });
});
