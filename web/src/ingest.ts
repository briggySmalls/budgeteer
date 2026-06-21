/**
 * Parse raw spreadsheet rows into domain models. Ported from budgeteer/ingest.py.
 *
 * This layer is agnostic to where rows come from: a DataSource yields each sheet
 * as an array of rows (header row first), whether read from an uploaded ODS
 * (SheetJS) or, later, the Google Sheets API. Date cells must already be JS Date
 * objects — the DataSource owns any serial-number conversion.
 */
import { civilDate, compareDates, formatISO } from "./dates";
import {
  type AnyCashFlow,
  Direction,
  Frequency,
  IngestionError,
  LiquidityActual,
  OneOffCashFlow,
  Phase,
  RecurringCashFlow,
} from "./models";

export type Cell = string | number | Date | null | undefined;
/** A sheet as rows, with the header as the first row (SheetJS `header:1` shape). */
export type SheetRows = Cell[][];
export type SheetSet = Record<string, SheetRows>;

/** Supplies raw sheet rows. Implemented by OdsUploadSource / GoogleSheetsSource. */
export interface DataSource {
  load(): Promise<SheetSet>;
}

export interface ParsedInputs {
  phases: Phase[];
  cashFlows: AnyCashFlow[];
  actuals: LiquidityActual[];
}

export async function loadInputs(source: DataSource): Promise<ParsedInputs> {
  return parseInputs(await source.load());
}

export function parseInputs(sheets: SheetSet): ParsedInputs {
  const phases = readPhases(sheets);
  const recurring = readRecurring(sheets);
  const oneOffs = readOneOffs(sheets);
  const actuals = readActuals(sheets);
  return { phases, cashFlows: [...recurring, ...oneOffs], actuals };
}

function isEmpty(cell: Cell): boolean {
  return cell === null || cell === undefined || cell === "";
}

/**
 * Turn a sheet into column-keyed records, dropping all-empty rows and validating
 * required columns. Returns null records list when the sheet has no data rows.
 */
function readTable(sheets: SheetSet, name: string, required: string[]): Record<string, Cell>[] {
  const rows = sheets[name];
  if (rows === undefined) {
    throw new IngestionError(`Sheet '${name}' not found`);
  }
  const header = (rows[0] ?? []).map((c) => String(c ?? "").trim());
  const dataRows = rows.slice(1).filter((row) => !row.every(isEmpty));

  const missing = required.filter((col) => !header.includes(col)).sort();
  if (missing.length > 0) {
    throw new IngestionError(`Sheet '${name}': missing columns ${JSON.stringify(missing)}`);
  }

  return dataRows.map((row) => {
    const record: Record<string, Cell> = {};
    header.forEach((col, i) => {
      record[col] = row[i] ?? null;
    });
    return record;
  });
}

function toDate(val: Cell): Date | null {
  if (isEmpty(val)) {
    return null;
  }
  if (val instanceof Date) {
    if (Number.isNaN(val.getTime())) {
      return null;
    }
    return civilDate(val.getUTCFullYear(), val.getUTCMonth() + 1, val.getUTCDate());
  }
  const iso = String(val).slice(0, 10);
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d || Number.isNaN(y) || Number.isNaN(m) || Number.isNaN(d)) {
    return null;
  }
  return civilDate(y, m, d);
}

function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());
}

function parseDirection(val: Cell, itemName: string): Direction {
  const candidate = titleCase(String(val ?? "").trim());
  if (candidate === Direction.Inflow || candidate === Direction.Outflow) {
    return candidate as Direction;
  }
  throw new IngestionError(
    `Cash flow '${itemName}': Direction must be 'Inflow' or 'Outflow', got '${val}'`
  );
}

function parseFrequency(val: Cell, itemName: string): Frequency {
  const candidate = titleCase(String(val ?? "").trim());
  if (candidate === Frequency.Monthly || candidate === Frequency.Annually) {
    return candidate as Frequency;
  }
  throw new IngestionError(
    `Cash flow '${itemName}': Frequency must be 'Monthly' or 'Annually', got '${val}'`
  );
}

function asIngestionError<T>(fn: () => T): T {
  try {
    return fn();
  } catch (e) {
    if (e instanceof IngestionError) {
      throw e;
    }
    throw new IngestionError(e instanceof Error ? e.message : String(e));
  }
}

function readPhases(sheets: SheetSet): Phase[] {
  const records = readTable(sheets, "Phases", ["Name", "Start_Date", "End_Date"]);
  const phases = records.map((row) => {
    const name = String(row.Name);
    const start = toDate(row.Start_Date);
    const end = toDate(row.End_Date);
    if (start === null || end === null) {
      throw new IngestionError(`Phase '${name}': Start_Date and End_Date are required`);
    }
    return asIngestionError(() => new Phase(name, start, end));
  });

  phases.sort((a, b) => compareDates(a.startDate, b.startDate));
  validateNoOverlaps(phases);
  return phases;
}

function validateNoOverlaps(phases: Phase[]): void {
  for (let i = 0; i < phases.length - 1; i++) {
    const a = phases[i] as Phase;
    const b = phases[i + 1] as Phase;
    if (a.endDate.getTime() >= b.startDate.getTime()) {
      throw new IngestionError(
        `Phases '${a.name}' and '${b.name}' overlap: ${a.name} ends ${formatISO(a.endDate)}, ${b.name} starts ${formatISO(b.startDate)}`
      );
    }
  }
}

function readRecurring(sheets: SheetSet): RecurringCashFlow[] {
  const records = readTable(sheets, "Recurring_Cash_Flows", [
    "Name",
    "Direction",
    "Amount",
    "Frequency",
    "Start_Date",
    "End_Date",
  ]);
  return records.map((row) => {
    const name = String(row.Name);
    const direction = parseDirection(row.Direction, name);
    const frequency = parseFrequency(row.Frequency, name);
    const amount = Number(row.Amount);
    const start = toDate(row.Start_Date);
    const end = toDate(row.End_Date);
    return asIngestionError(
      () => new RecurringCashFlow(name, direction, amount, frequency, start, end)
    );
  });
}

function readOneOffs(sheets: SheetSet): OneOffCashFlow[] {
  const records = readTable(sheets, "One_Off_Cash_Flows", ["Name", "Direction", "Amount", "Date"]);
  return records.map((row) => {
    const name = String(row.Name);
    const direction = parseDirection(row.Direction, name);
    const amount = Number(row.Amount);
    const d = toDate(row.Date);
    if (d === null) {
      throw new IngestionError(`Cash flow '${name}': Date is required for one-off`);
    }
    return asIngestionError(() => new OneOffCashFlow(name, direction, amount, d));
  });
}

function readActuals(sheets: SheetSet): LiquidityActual[] {
  if (sheets.Actuals === undefined) {
    throw new IngestionError("Sheet 'Actuals' not found");
  }
  const dataRows = sheets.Actuals.slice(1).filter((row) => !row.every(isEmpty));
  if (dataRows.length === 0) {
    return [];
  }

  const records = readTable(sheets, "Actuals", ["Date", "Liquidity"]);
  const actuals = records.map((row) => {
    const d = toDate(row.Date);
    if (d === null) {
      throw new IngestionError("Actuals: Date is required for each row");
    }
    const amount = Number(row.Liquidity);
    if (Number.isNaN(amount)) {
      throw new IngestionError(
        `Actuals: invalid Liquidity value on ${formatISO(d)}: ${row.Liquidity}`
      );
    }
    return new LiquidityActual(d, amount);
  });

  actuals.sort((a, b) => compareDates(a.date, b.date));
  return actuals;
}
