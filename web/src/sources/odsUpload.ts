import * as XLSX from "xlsx";
import { civilDate } from "../dates";
import type { Cell, DataSource, SheetRows, SheetSet } from "../ingest";

/** Sheets we read, and which of their columns hold dates (serial numbers). */
const DATE_COLUMNS: Record<string, ReadonlySet<string>> = {
  Phases: new Set(["Start_Date", "End_Date"]),
  Recurring_Cash_Flows: new Set(["Start_Date", "End_Date"]),
  One_Off_Cash_Flows: new Set(["Date"]),
  Actuals: new Set(["Date"]),
};

const SHEET_NAMES = Object.keys(DATE_COLUMNS);

/**
 * Convert a spreadsheet serial number to a UTC-midnight date.
 *
 * Excel/ODF use the "1900 date system": serial 0 = 1899-12-30. Anchoring on that
 * epoch and stepping in whole UTC days is correct for all modern dates (the
 * 1900-leap-year quirk only affects Jan/Feb 1900) and avoids any timezone drift.
 */
function serialToDate(serial: number): Date {
  const epoch = Date.UTC(1899, 11, 30);
  const dt = new Date(epoch + Math.floor(serial) * 86_400_000);
  return civilDate(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

function sheetToRows(ws: XLSX.WorkSheet, sheetName: string): SheetRows {
  const raw = XLSX.utils.sheet_to_json<Cell[]>(ws, {
    header: 1,
    raw: true,
    defval: null,
  });
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

/**
 * Reads the four model sheets from an uploaded `.ods` file in the browser.
 *
 * SheetJS returns the cached computed value of formula cells, so the
 * LibreOffice-authored formula layer (relative dates, RSU/FX calcs) is preserved
 * without re-implementing any formulas. Date columns come back as serial numbers
 * and are converted here, so ingest always receives Date objects.
 */
export class OdsUploadSource implements DataSource {
  private readonly bytes: Uint8Array;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  }

  static async fromFile(file: File): Promise<OdsUploadSource> {
    return new OdsUploadSource(await file.arrayBuffer());
  }

  load(): Promise<SheetSet> {
    const wb = XLSX.read(this.bytes, { type: "array", cellDates: false });
    const sheets: SheetSet = {};
    for (const name of SHEET_NAMES) {
      const ws = wb.Sheets[name];
      if (ws) {
        sheets[name] = sheetToRows(ws, name);
      }
    }
    return Promise.resolve(sheets);
  }
}
