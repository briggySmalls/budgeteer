import * as XLSX from "xlsx";
import type { Cell, DataSource, SheetSet } from "../ingest";
import { SHEET_NAMES, rowsWithDates } from "./sheetSchema";

/**
 * Reads the four model sheets from an uploaded `.ods` file in the browser.
 *
 * SheetJS returns the cached computed value of formula cells, so the
 * LibreOffice-authored formula layer (relative dates, RSU/FX calcs) is preserved
 * without re-implementing any formulas. Date columns come back as serial numbers
 * and are converted to UTC-midnight dates, so ingest always receives Date objects.
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
        const raw = XLSX.utils.sheet_to_json<Cell[]>(ws, {
          header: 1,
          raw: true,
          defval: null,
        });
        sheets[name] = rowsWithDates(name, raw);
      }
    }
    return Promise.resolve(sheets);
  }
}
