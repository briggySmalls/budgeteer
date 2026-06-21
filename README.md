# Budgeteer

Personal liquidity forecasting app. Define phases and cash flows in a LibreOffice
spreadsheet; the app computes a monthly ledger and renders interactive Plotly charts.

It is a **100% client-side React + TypeScript app** (in `web/`). You upload your
`model_inputs.ods` in the browser; nothing is sent to a server. The forecast engine,
spreadsheet parsing and charts all run in the browser.

> **Phase 2 (planned):** read the model directly from Google Sheets instead of an
> uploaded file, behind the existing `DataSource` seam — removing the need to carry the
> `.ods` between devices.

## Quick start

```bash
make setup   # cd web && npm install (also wires git hooks)
make run     # vite dev server; then upload model_inputs.ods
make test    # vitest with coverage
make lint    # biome + tsc + knip
```

(Or run the `npm` scripts directly inside `web/`.)

## How it works

Edit `model_inputs.ods` in LibreOffice, then upload it in the app. Cross-sheet
formulas (date anchors, RSU/FX calculations) are authored natively in LibreOffice;
the app reads their **cached computed values** via SheetJS, so no formula logic is
re-implemented.

**Sheets the app reads:**

| Sheet | Columns | Notes |
|---|---|---|
| `Phases` | `Name, Start_Date, End_Date` | Must not overlap |
| `Recurring_Cash_Flows` | `Name, Direction, Amount, Frequency, Start_Date, End_Date` | Direction: `Inflow`/`Outflow`; Frequency: `Monthly`/`Annually` |
| `One_Off_Cash_Flows` | `Name, Direction, Amount, Date` | |
| `Actuals` | `Date, Liquidity` | Optional; sheet must exist |

Any other sheets (e.g. `Variables` for shared constants) are ignored by the parser and
can be used freely for LibreOffice formulas.

## Architecture

Pipeline: **`.ods` upload → `DataSource` → ingest → models → engine → charts → React UI**

- `web/src/dates.ts` — timezone-safe UTC "civil date" helpers
- `web/src/models.ts` — `Phase` / `RecurringCashFlow` / `OneOffCashFlow` /
  `LiquidityActual` with construction-time validation
- `web/src/engine.ts` — pure forecast engine (day-overlap proration, ledger,
  phase/period aggregates)
- `web/src/ingest.ts` — parses raw sheet rows into models; the `DataSource` interface
  decouples parsing from storage
- `web/src/sources/odsUpload.ts` — `OdsUploadSource` reads an uploaded `.ods` (SheetJS),
  converting serial dates to UTC-midnight dates
- `web/src/charts.ts` — Plotly figure builders
- `web/src/App.tsx` + `web/src/components/` — upload screen and dashboard

## Development

- **Build/test:** Vite + Vitest (`web/`).
- **Quality:** Biome (lint + format), `tsc --noEmit` (strict), knip (dead code),
  enforced by a Husky + lint-staged pre-commit hook and the `web-ci` GitHub Action.
- **Deploy:** `pages.yml` builds `web/` and publishes the static site to GitHub Pages.
