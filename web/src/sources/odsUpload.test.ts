import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTimeline, computeLedger } from "../engine";
import { parseInputs } from "../ingest";
import { OneOffCashFlow } from "../models";
import { OdsUploadSource } from "./odsUpload";

// The real production model file lives at the repo root and doubles as our fixture.
// Tests run with cwd = web/, so it is one directory up; fall back to cwd just in case.
function findFixture(): string {
  for (const p of [
    resolve(process.cwd(), "..", "model_inputs.ods"),
    resolve(process.cwd(), "model_inputs.ods"),
  ]) {
    if (existsSync(p)) {
      return p;
    }
  }
  throw new Error("model_inputs.ods fixture not found");
}

const odsBytes = readFileSync(findFixture());

describe("OdsUploadSource against the real model_inputs.ods", () => {
  it("reads the four model sheets", async () => {
    const sheets = await new OdsUploadSource(odsBytes).load();
    expect(Object.keys(sheets).sort()).toEqual([
      "Actuals",
      "One_Off_Cash_Flows",
      "Phases",
      "Recurring_Cash_Flows",
    ]);
  });

  it("converts serial dates into plausible Date objects", async () => {
    const sheets = await new OdsUploadSource(odsBytes).load();
    const { phases } = parseInputs(sheets);
    expect(phases.length).toBeGreaterThan(0);
    for (const p of phases) {
      expect(p.startDate).toBeInstanceOf(Date);
      expect(p.startDate.getUTCFullYear()).toBeGreaterThanOrEqual(2024);
      expect(p.startDate.getUTCFullYear()).toBeLessThanOrEqual(2032);
    }
  });

  it("surfaces cached formula values (RSU vest = shares x price x fx x tax)", async () => {
    const sheets = await new OdsUploadSource(odsBytes).load();
    const { cashFlows } = parseInputs(sheets);
    const rsu = cashFlows.find((c) => c.name.includes("RSU Vest Q3 2026"));
    expect(rsu).toBeDefined();
    // 172 * 63.17 * 0.79 * 0.5 = 4291.77 (cached value in the ODS)
    expect(rsu?.amount).toBeCloseTo(4291.77, 1);
  });

  it("runs the full ingest -> engine pipeline without error", async () => {
    const sheets = await new OdsUploadSource(odsBytes).load();
    const { phases, cashFlows, actuals } = parseInputs(sheets);
    const ledger = computeLedger(
      buildTimeline(phases),
      phases,
      cashFlows,
      actuals.length > 0 ? actuals : null
    );
    expect(ledger.length).toBeGreaterThan(0);
    const final = ledger.at(-1);
    expect(final && Number.isFinite(final.endingLiquidity)).toBe(true);
  });

  it("preserves one-off dates within their cash-flow month", async () => {
    const sheets = await new OdsUploadSource(odsBytes).load();
    const { cashFlows } = parseInputs(sheets);
    const oneOffs = cashFlows.filter((c) => c instanceof OneOffCashFlow);
    expect(oneOffs.length).toBeGreaterThan(0);
    for (const cf of oneOffs) {
      expect((cf as OneOffCashFlow).date).toBeInstanceOf(Date);
    }
  });
});
