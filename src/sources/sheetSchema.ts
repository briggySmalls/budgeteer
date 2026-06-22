import { civilDate } from "../dates";
import type { Cell, SheetRows } from "../ingest";

/** The sheets the app reads, and which of their columns hold dates. */
const DATE_COLUMNS: Record<string, ReadonlySet<string>> = {
  Phases: new Set(["Start_Date", "End_Date"]),
  Recurring_Cash_Flows: new Set(["Start_Date", "End_Date"]),
  One_Off_Cash_Flows: new Set(["Date"]),
  Actuals: new Set(["Date"]),
};

export const SHEET_NAMES = Object.keys(DATE_COLUMNS);

/**
 * Convert a spreadsheet serial number to a UTC-midnight date.
 *
 * Excel/ODF and the Google Sheets API (SERIAL_NUMBER mode) both use the "1900
 * date system": serial 0 = 1899-12-30. Anchoring on that epoch and stepping in
 * whole UTC days is correct for all modern dates (the 1900-leap-year quirk only
 * affects Jan/Feb 1900) and avoids any timezone drift.
 */
function serialToDate(serial: number): Date {
  const epoch = Date.UTC(1899, 11, 30);
  const dt = new Date(epoch + Math.floor(serial) * 86_400_000);
  return civilDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

/**
 * Normalise a header + raw rows into the SheetRows shape ingest expects,
 * converting serial numbers in the sheet's date columns to Date objects.
 * Shared by the ODS (SheetJS) and Google Sheets sources.
 */
export function rowsWithDates(sheetName: string, raw: Cell[][]): SheetRows {
  if (raw.length === 0) {
    return raw;
  }
  const header = (raw[0] ?? []).map((c) => String(c ?? "").trim());
  const dateCols = DATE_COLUMNS[sheetName] ?? new Set<string>();
  const dateIndices = new Set(
    header.map((name, i) => (dateCols.has(name) ? i : -1)).filter((i) => i >= 0)
  );

  return raw.map((row, rowIndex) => {
    if (rowIndex === 0) {
      return row;
    }
    return row.map((cell, i) =>
      dateIndices.has(i) && typeof cell === "number" ? serialToDate(cell) : cell
    );
  });
}
