import { describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  civilDate,
  daysInMonth,
  diffDays,
  formatISO,
  monthStartsBetween,
} from "./dates";

describe("daysInMonth", () => {
  it("knows month lengths", () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it("is leap-year aware", () => {
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
  });
});

describe("addDays / diffDays", () => {
  it("crosses month and year boundaries", () => {
    expect(formatISO(addDays(civilDate(2026, 1, 31), 1))).toBe("2026-02-01");
    expect(formatISO(addDays(civilDate(2026, 12, 31), 1))).toBe("2027-01-01");
    expect(diffDays(civilDate(2026, 3, 16), civilDate(2026, 3, 1))).toBe(15);
    expect(diffDays(civilDate(2027, 1, 1), civilDate(2026, 1, 1))).toBe(365);
  });
});

describe("addMonths", () => {
  it("rolls over the year", () => {
    expect(formatISO(addMonths(civilDate(2026, 11, 1), 1))).toBe("2026-12-01");
    expect(formatISO(addMonths(civilDate(2026, 12, 1), 1))).toBe("2027-01-01");
  });
});

describe("monthStartsBetween", () => {
  it("is inclusive of both ends when start is a month-start", () => {
    const months = monthStartsBetween(civilDate(2026, 6, 1), civilDate(2027, 11, 30));
    expect(months).toHaveLength(18);
    expect(formatISO(months[0] as Date)).toBe("2026-06-01");
    expect(formatISO(months.at(-1) as Date)).toBe("2027-11-01");
  });

  it("skips the partial first month when start is mid-month (pandas MS semantics)", () => {
    const months = monthStartsBetween(civilDate(2026, 4, 11), civilDate(2026, 7, 31));
    expect(months.map(formatISO)).toEqual(["2026-05-01", "2026-06-01", "2026-07-01"]);
  });
});
