import { describe, expect, it } from "vitest";
import { formatGBP } from "./format";

describe("formatGBP", () => {
  it("formats with a pound sign, thousands separators and two decimals", () => {
    expect(formatGBP(64432.85)).toBe("£64,432.85");
    expect(formatGBP(0)).toBe("£0.00");
    expect(formatGBP(-520.1)).toBe("£-520.10");
  });
});
