import type { Cell, DataSource, SheetSet } from "../ingest";
import { IngestionError } from "../models";
import { SHEET_NAMES, rowsWithDates } from "./sheetSchema";

const SHEETS_API = "https://sheets.googleapis.com/v4/spreadsheets";

/** Minimal fetch shape, so tests can inject a stub without a full Response. */
export type FetchLike = (
  url: string,
  init?: { headers?: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }>;

interface ValueRange {
  range?: string;
  values?: Cell[][];
}

interface BatchGetResponse {
  valueRanges?: ValueRange[];
}

interface GoogleSheetsConfig {
  spreadsheetId: string;
  accessToken: string;
  fetchImpl?: FetchLike;
}

/** Sheet name out of an A1 range like `Phases!A1:Z` or `'My Sheet'!A1`. */
function sheetNameOf(range: string): string {
  const name = range.split("!")[0] ?? "";
  return name.replace(/^'(.*)'$/, "$1").replace(/''/g, "'");
}

function buildParams(): URLSearchParams {
  const params = new URLSearchParams();
  for (const name of SHEET_NAMES) {
    params.append("ranges", name);
  }
  params.set("valueRenderOption", "UNFORMATTED_VALUE");
  params.set("dateTimeRenderOption", "SERIAL_NUMBER");
  return params;
}

function buildSheetMap(body: BatchGetResponse): Map<string, Cell[][]> {
  const byName = new Map<string, Cell[][]>();
  for (const vr of body.valueRanges ?? []) {
    if (vr.range) {
      byName.set(sheetNameOf(vr.range), vr.values ?? []);
    }
  }
  return byName;
}

function buildSheets(byName: Map<string, Cell[][]>): SheetSet {
  const sheets: SheetSet = {};
  for (const name of SHEET_NAMES) {
    sheets[name] = rowsWithDates(name, byName.get(name) ?? []);
  }
  return sheets;
}

/**
 * Reads the four model sheets from a Google Sheet via the Sheets API
 * (values:batchGet). UNFORMATTED_VALUE returns the computed result of formula
 * cells (so the formula layer is preserved) as exact numbers; dates come back as
 * 1900-system serial numbers and are converted to UTC-midnight dates, keeping
 * ingest source-agnostic. Reads as the signed-in user, so the sheet's own sharing
 * is the access control.
 */
export class GoogleSheetsSource implements DataSource {
  constructor(private readonly config: GoogleSheetsConfig) {}

  async load(): Promise<SheetSet> {
    const { spreadsheetId, accessToken } = this.config;
    const doFetch: FetchLike = this.config.fetchImpl ?? fetch;

    const params = buildParams();
    const url = `${SHEETS_API}/${encodeURIComponent(spreadsheetId)}/values:batchGet?${params}`;

    const res = await doFetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new IngestionError(
        `Google Sheets request failed (${res.status}): ${detail.slice(0, 200)}`
      );
    }

    const body = (await res.json()) as BatchGetResponse;
    return buildSheets(buildSheetMap(body));
  }
}
