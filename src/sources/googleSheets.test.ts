import { describe, expect, it } from "vitest";
import { civilDate } from "../dates";
import { buildTimeline, computeLedger } from "../engine";
import { parseInputs } from "../ingest";
import { Direction, IngestionError } from "../models";
import { type FetchLike, GoogleSheetsSource } from "./googleSheets";

/** Date -> 1900-system serial number (inverse of serialToDate). */
const serial = (d: Date) => Math.round((d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000);
const d = civilDate;

function batchResponse() {
  return {
    valueRanges: [
      {
        range: "Phases!A1:Z1000",
        values: [
          ["Name", "Start_Date", "End_Date"],
          ["Work", serial(d(2026, 1, 1)), serial(d(2026, 6, 30))],
        ],
      },
      {
        range: "Recurring_Cash_Flows!A1:Z1000",
        values: [
          ["Name", "Direction", "Amount", "Frequency", "Start_Date", "End_Date"],
          ["Salary", "Inflow", 5000, "Monthly", "", ""],
        ],
      },
      {
        range: "One_Off_Cash_Flows!A1:Z1000",
        values: [
          ["Name", "Direction", "Amount", "Date"],
          ["Bonus", "Inflow", 1000, serial(d(2026, 3, 1))],
        ],
      },
      {
        range: "Actuals!A1:Z1000",
        values: [
          ["Date", "Liquidity"],
          [serial(d(2026, 1, 1)), 10000],
        ],
      },
    ],
  };
}

function okFetch(body: unknown, capture?: { url?: string; auth?: string }): FetchLike {
  return (url, init) => {
    if (capture) {
      capture.url = url;
      capture.auth = init?.headers?.Authorization;
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(""),
    });
  };
}

describe("GoogleSheetsSource", () => {
  it("requests batchGet with auth, unformatted values and serial dates", async () => {
    const capture: { url?: string; auth?: string } = {};
    const source = new GoogleSheetsSource({
      spreadsheetId: "sheet-123",
      accessToken: "tok-abc",
      fetchImpl: okFetch(batchResponse(), capture),
    });
    await source.load();
    expect(capture.url).toContain("/sheet-123/values:batchGet");
    expect(capture.url).toContain("valueRenderOption=UNFORMATTED_VALUE");
    expect(capture.url).toContain("dateTimeRenderOption=SERIAL_NUMBER");
    expect(capture.url).toContain("ranges=Phases");
    expect(capture.auth).toBe("Bearer tok-abc");
  });

  it("converts serial dates and parses into models", async () => {
    const source = new GoogleSheetsSource({
      spreadsheetId: "s",
      accessToken: "t",
      fetchImpl: okFetch(batchResponse()),
    });
    const { phases, cashFlows, actuals } = parseInputs(await source.load());
    expect(phases[0]?.startDate).toEqual(d(2026, 1, 1));
    expect(phases[0]?.endDate).toEqual(d(2026, 6, 30));
    expect(cashFlows).toHaveLength(2);
    expect(cashFlows.find((c) => c.name === "Bonus")?.direction).toBe(Direction.Inflow);
    expect(actuals[0]?.amount).toBe(10000);
  });

  it("is order-independent (maps value ranges by sheet name)", async () => {
    const shuffled = { valueRanges: batchResponse().valueRanges.reverse() };
    const source = new GoogleSheetsSource({
      spreadsheetId: "s",
      accessToken: "t",
      fetchImpl: okFetch(shuffled),
    });
    const { phases } = parseInputs(await source.load());
    expect(phases[0]?.name).toBe("Work");
  });

  it("feeds the engine end to end", async () => {
    const source = new GoogleSheetsSource({
      spreadsheetId: "s",
      accessToken: "t",
      fetchImpl: okFetch(batchResponse()),
    });
    const { phases, cashFlows, actuals } = parseInputs(await source.load());
    const ledger = computeLedger(buildTimeline(phases), phases, cashFlows, actuals);
    expect(ledger).toHaveLength(6);
    expect(ledger[0]?.startingLiquidity).toBe(10000);
  });

  it("raises IngestionError on an HTTP error", async () => {
    const source = new GoogleSheetsSource({
      spreadsheetId: "s",
      accessToken: "bad",
      fetchImpl: () =>
        Promise.resolve({
          ok: false,
          status: 403,
          json: () => Promise.resolve({}),
          text: () => Promise.resolve("forbidden"),
        }),
    });
    await expect(source.load()).rejects.toBeInstanceOf(IngestionError);
  });
});
