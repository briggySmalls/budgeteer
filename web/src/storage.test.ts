import { afterEach, describe, expect, it } from "vitest";
import { clearStoredSheetId, getStoredSheetId, setStoredSheetId } from "./storage";

afterEach(() => clearStoredSheetId());

describe("stored sheet id", () => {
  it("round-trips a value", () => {
    expect(getStoredSheetId()).toBeNull();
    setStoredSheetId("sheet-abc");
    expect(getStoredSheetId()).toBe("sheet-abc");
  });

  it("clears", () => {
    setStoredSheetId("sheet-abc");
    clearStoredSheetId();
    expect(getStoredSheetId()).toBeNull();
  });
});
