# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Budgeteer is a **100% client-side React + TypeScript** liquidity-forecasting app.
Parsing, the forecast engine, and Plotly charts all run client-side. There is no
backend and no Python — an earlier Streamlit/Python implementation was ported to
TypeScript and removed (see git history if you need the original).

The model is read through a `DataSource` seam with a **Google Sheets** implementation
(read via the Sheets API as the signed-in user) and a legacy `OdsUploadSource` kept for
tests. Both yield the same row shape to ingest.

## Commands

All commands run from the repo root:

- `make setup` / `npm install` — install deps (also wires the git hooks)
- `make run` / `npm run dev` — Vite dev server
- `make test` / `npm run coverage` — Vitest with coverage thresholds
- `make lint` — `biome ci .` + `tsc --noEmit` + `knip`
- `make format` / `npm run check` — Biome auto-fix + format

Run a single test: `npx vitest run src/engine.test.ts`

CI (`.github/workflows/ci.yml`) runs Biome, tsc, Vitest+coverage, knip and the Vite
build. `pages.yml` deploys the static build to GitHub Pages. A Husky + lint-staged
pre-commit hook runs Biome on staged files.

## Architecture

Pipeline: **Sheets API → `DataSource` → ingest → models → engine → charts → React UI**

- `src/dates.ts` — timezone-safe "civil date" helpers. Every date is a UTC-midnight
  `Date`; all arithmetic is in UTC so month/day boundaries never drift. `monthStartsBetween`
  reproduces `pandas.date_range(freq="MS")`.
- `src/models.ts` — `Direction`/`Frequency` enums; `Phase`, `RecurringCashFlow`,
  `OneOffCashFlow`, `LiquidityActual` classes with construction-time validation; the
  `BudgeteerError`/`IngestionError`/`EngineError` hierarchy. Instances are frozen.
- `src/engine.ts` — pure forecast functions, no I/O: `buildTimeline`,
  `activeFraction` (day-overlap proration; monthly = days/`MONTHLY_PERIOD_DAYS`,
  annual fires only in the anchor month), `computeLedger` (seeds from the latest actual,
  filtering one-offs strictly before it), `aggregateByPhase`, `aggregateCashflowsInPeriod`.
  Cash-flow kind is discriminated with `instanceof`.
- `src/ingest.ts` — `parseInputs(sheets)` turns raw rows into validated models;
  the `DataSource` interface (`load(): Promise<SheetSet>`) decouples parsing from storage.
- `src/sources/odsUpload.ts` — `OdsUploadSource`: reads an uploaded `.ods` with
  SheetJS, which returns the **cached computed value** of formula cells, so the
  LibreOffice formula layer is preserved.
- `src/sources/googleSheets.ts` — `GoogleSheetsSource`: reads via the Sheets API
  `values:batchGet` (`UNFORMATTED_VALUE` + `SERIAL_NUMBER`), given a spreadsheet id and a
  bearer token. `googleAuth.ts` runs the Google Identity Services token flow (client id
  from `VITE_GOOGLE_CLIENT_ID`); `googlePicker.ts` opens the native Google Picker (API key
  from `VITE_GOOGLE_API_KEY`) for the user to choose the spreadsheet.
- `src/sources/sheetSchema.ts` — shared by both sources: the date-column schema and
  the 1900-system serial→UTC-midnight-date conversion, so ingest stays source-agnostic.
- `src/charts.ts` — pure Plotly figure builders (data + layout objects), so they are
  unit-testable without a DOM. `src/components/PlotlyChart.tsx` renders them,
  dynamically importing plotly.js so it is code-split out of the main bundle.
- `src/App.tsx` + `src/components/` — upload screen and the three-tab dashboard
  (Monthly View with click-to-drill-down, Period Waterfall, Ledger Data).

### The ODS file

`model_inputs.ods` is hand-maintained in LibreOffice and committed at the repo root. It
may use cross-sheet formulas (e.g. dates anchored on a `Variables` cell). It is both the
app's input (uploaded at runtime) and the fixture for `src/sources/odsUpload.test.ts`.
Do not regenerate it from scratch — that destroys the LibreOffice-authored formulas.

### Google Sheets integration

`VITE_GOOGLE_CLIENT_ID` (OAuth Web client id) and `VITE_GOOGLE_API_KEY` (Picker developer
key) enable the Sheets data source; when either is unset, the UI shows only a hint to
configure them. For the GitHub Pages deploy the values come from repo secrets of the same
names, read at build time in `pages.yml`. OAuth scopes are `spreadsheets.readonly` +
`drive.file` (least privilege: the app only accesses the sheet the user picks). See the
README for the one-time Google Cloud setup. Auth tokens are held in memory only; the
chosen spreadsheet id is persisted in `localStorage` (`storage.ts`).

## Tests

Vitest tests live beside their modules (`*.test.ts`). They were ported from the original
pytest suite and pin the same penny-exact expected values (e.g. the template scenario's
phase aggregates). `odsUpload.test.ts` exercises the real `model_inputs.ods` end to end.

## Conventions

- **Currency:** GBP (£) everywhere — `formatGBP` and chart formatters hardcode `£`.
- **Tooling:** Biome (`biome.json`, lint + format), `tsc` strict (`noUncheckedIndexedAccess`,
  etc.), knip for dead code. Two-space indent, double quotes, 100-col width.
- **Dates:** never use raw `new Date(...)` for calendar logic — use the `dates.ts` helpers.