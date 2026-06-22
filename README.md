# Budgeteer

Personal liquidity forecasting app. Define phases and cash flows in a Google Sheet;
the app computes a monthly ledger and renders interactive Plotly charts.

It is a **100% client-side React + TypeScript app** (in `web/`). Nothing is sent to a
server you run — the forecast engine, spreadsheet parsing and charts all run in the
browser. The model is read from **Google Sheets** behind the `DataSource` seam:

- **Google Sheets** — sign in with Google and pick a Sheet via the native Google Picker,
  then read the model straight from it, so there is no file to carry between devices.
  The app uses the `drive.file` scope, so it only ever gains access to the sheet
  you explicitly pick.

## Quick start

```bash
make setup   # cd web && npm install (also wires git hooks)
make run     # vite dev server
make test    # vitest with coverage
make lint    # biome + tsc + knip
```

(Or run the `npm` scripts directly inside `web/`.)

## How it works

Create your model as a Google Sheet with the four required tabs below. Cross-sheet
formulas (date anchors, RSU/FX calculations) work natively in Sheets — the app reads
formula results, not the formulas themselves.

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

**2. Create your model Sheet**

Create a Google Sheet with the four tabs listed above. You can start from
`model_inputs.ods` by uploading it to Google Drive and opening with Google Sheets
(File → Import, or "Open with → Google Sheets"). Check that formulas converted
correctly — LibreOffice `$Variables.$B$2` becomes `Variables!$B$2`; `EDATE` and
relative-cell arithmetic should survive.

**3. Use it**

Open the app, sign in, pick your Sheet, and the forecast renders immediately.

## Architecture

Pipeline: **Sheets API → `DataSource` → ingest → models → engine → charts → React UI**

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
