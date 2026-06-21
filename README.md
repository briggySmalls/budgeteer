# Budgeteer

Personal liquidity forecasting app. Define phases and cash flows in a LibreOffice
spreadsheet; the app computes a monthly ledger and renders interactive Plotly charts.

It is a **100% client-side React + TypeScript app** (in `web/`). Nothing is sent to a
server you run — the forecast engine, spreadsheet parsing and charts all run in the
browser. Two data sources are supported behind a common `DataSource` seam:

- **Google Sheets** (recommended) — sign in with Google and pick a Sheet via the native
  Google Picker, then read the model straight from it, so there is no file to carry between
  devices. The app uses the `drive.file` scope, so it only ever gains access to the sheet
  you explicitly pick.
- **ODS upload** (fallback / offline) — upload a `model_inputs.ods` file.

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

## Google Sheets setup (one-time)

The Sheets integration needs a Google OAuth client and your model in a Sheet.

**1. Create OAuth client + API key**

In the [Google Cloud console](https://console.cloud.google.com/), create a project and
enable the **Google Sheets API**, **Google Drive API** and **Google Picker API**. Then:

- Create an OAuth **client ID** (type *Web application*) — used for sign-in:
  - **Authorized JavaScript origins** (origin only, no path):
    - `http://localhost:5173` (dev)
    - `https://briggysmalls.github.io` (deployed)
- Create an **API key** — the Picker's developer key:
  - **Application restrictions → Websites (HTTP referrers)** — use the bare domain/subdomain;
    the `*` wildcard is only for subdomains, there is no path wildcard, and query/fragments
    are ignored:
    - `http://localhost:5173` (dev)
    - `https://briggysmalls.github.io` (deployed)
  - **API restrictions**: limit to the Google Sheets, Drive and Picker APIs.

Then wire the values in:

- Local dev: copy `web/.env.example` to `web/.env.local` and set `VITE_GOOGLE_CLIENT_ID`
  and `VITE_GOOGLE_API_KEY`.
- GitHub Pages: set repo **secrets** of the same names (the build reads them). Both values
  are public (they ship in the bundle); the secrets are just how they reach the build.

**2. Put your model in a Sheet**

- Upload `model_inputs.ods` to Google Drive and open it with Google Sheets (File → Import,
  or "Open with → Google Sheets"). Keep the same tab names, including `Variables`.
- Check the formulas converted: LibreOffice `$Variables.$B$2` becomes `Variables!$B$2`;
  `EDATE`/relative-cell arithmetic and the RSU cell references should survive — verify a
  few. Set the spreadsheet locale/number format so dates are unambiguous.
- The Sheet is private to you by default; that sharing is the app's access control.

**3. Verify parity**

Open the Sheet in the app and confirm the ledger matches the same model uploaded as
`.ods` — they should agree to the penny (both run the same engine).

## Architecture

Pipeline: **`.ods` upload → `DataSource` → ingest → models → engine → charts → React UI**

- `web/src/dates.ts` — timezone-safe UTC "civil date" helpers
- `web/src/models.ts` — `Phase` / `RecurringCashFlow` / `OneOffCashFlow` /
  `LiquidityActual` with construction-time validation
- `web/src/engine.ts` — pure forecast engine (day-overlap proration, ledger,
  phase/period aggregates)
- `web/src/ingest.ts` — parses raw sheet rows into models; the `DataSource` interface
  decouples parsing from storage
- `web/src/sources/odsUpload.ts` — `OdsUploadSource` reads an uploaded `.ods` (SheetJS)
- `web/src/sources/googleSheets.ts` — `GoogleSheetsSource` reads via the Sheets API
- `web/src/sources/googleAuth.ts` — Google Identity Services token flow
- `web/src/sources/googlePicker.ts` — native Google Picker for choosing a Sheet
- `web/src/sources/sheetSchema.ts` — shared serial-date conversion + date-column schema
- `web/src/charts.ts` — Plotly figure builders
- `web/src/App.tsx` + `web/src/components/` — upload screen and dashboard

## Development

- **Build/test:** Vite + Vitest (`web/`).
- **Quality:** Biome (lint + format), `tsc --noEmit` (strict), knip (dead code),
  enforced by a Husky + lint-staged pre-commit hook and the `web-ci` GitHub Action.
- **Deploy:** `pages.yml` builds `web/` and publishes the static site to GitHub Pages.
