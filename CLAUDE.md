# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All dev commands go through `uv` and are wrapped in the `Makefile`:

- `make setup` — `uv sync` + install pre-commit hooks
- `make run` — launch the Streamlit app (`uv run streamlit run budgeteer/app.py`)
- `make test` — `uv run pytest --cov`
- `make lint` — `ruff check .` + `ruff format --check .`
- `make format` — `ruff format .` + `ruff check --fix .`
- `make template` — regenerate `model_inputs.ods` from `scripts/create_template.py`

Run a single test: `uv run pytest tests/test_engine.py::test_name -v`

CI (`.github/workflows/ci.yml`) runs `ruff check`, `ruff format --check`, and `pytest --cov` against `uv sync --frozen`. Pre-commit runs `ruff-format` then `ruff --fix`.

## Architecture

Pipeline: **`.ods` file → ingest → models → engine → charts → Streamlit**

The user edits `model_inputs.ods` in LibreOffice; the app watches the file's mtime and hot-reloads on save.

### Data flow

1. **`budgeteer/ingest.py`** reads four sheets from the ODS via `pd.read_excel(engine="odf")`:
   - `Config` — single `Starting_Savings` cell (plus optional anchor-date cells like `Preg_Start` / `Birth_Date`)
   - `Phases` — `ID, Name, Start_Date, End_Date` (must not overlap; sorted by start_date)
   - `Recurring_Cash_Flows` — `ID, Name, Direction, Amount, Frequency, Start_Date, End_Date`
   - `One_Off_Cash_Flows` — `ID, Name, Direction, Amount, Date`

   All ingest errors raise `IngestionError` (subclass of `BudgeteerError`) with sheet+row context.

2. **`budgeteer/models.py`** — frozen dataclasses with `__post_init__` validation:
   - `Phase` (end > start)
   - `CashFlow` base (amount ≥ 0) → `RecurringCashFlow` (with `Frequency` enum: `Monthly`/`Annually`) and `OneOffCashFlow`
   - `Direction` enum: `Inflow`/`Outflow`
   - All exceptions descend from `BudgeteerError`.

3. **`budgeteer/engine.py`** — pure functions, no I/O:
   - `build_timeline(phases)` → list of month-start dates spanning min(phase.start) to max(phase.end)
   - `_is_active(cf, month)` decides cash-flow activation: one-offs match year+month exactly; recurring respects start/end and `Annually` fires only in the start month (or January if no start_date)
   - `compute_ledger(...)` returns a per-month `DataFrame` with `starting_liquidity`, `total_inflow`, `total_outflow`, `net_flow`, `ending_liquidity`, `active_phase`
   - `aggregate_by_phase(ledger)` collapses to one row per phase

4. **`budgeteer/charts.py`** — three Plotly figures (liquidity line with phase-band overlays, net-flow bars, phase waterfall). All use £ formatting and the shared `_add_phase_bands` helper.

5. **`budgeteer/app.py`** — Streamlit entry point. Hot-reload uses an `@st.fragment(run_every=2)` watcher that compares `ODS_PATH.stat().st_mtime` against session state and clears the `@st.cache_data` loader on change. `mtime` is also passed as a cache key so edits invalidate the cache. There's a `PermissionError` retry path because LibreOffice briefly locks the file on save.

### ODS template generation

`scripts/create_template.py` builds `model_inputs.ods` with **anchor-date formulas**: `Config.B2` (`Preg_Start`) drives the entire timeline via formulas like `EDATE($B$2,9)`, and `Config.C2` (`Birth_Date`) is `=EDATE(Preg_Start, 9)`. Phase and recurring/one-off dates are formula cells with cached values written by `_add_formula_date_cell` (in `budgeteer/odswriter.py`). Corporate-calendar events (RSUs, bonuses) stay hardcoded.

**Important:** `pandas.read_excel(engine="odf")` reads **cached formula values, not formula strings**. This works as long as the user saves the file from LibreOffice Calc (which recalculates and writes the cache). The Python engine is unaware of the formula layer — to shift the entire timeline, the user changes `Preg_Start` in LibreOffice and saves.

### Tests

`tests/conftest.py` exposes a `valid_inputs.ods` fixture under `tests/fixtures/`. Engine tests build models directly; ingest tests round-trip through the fixture file.

## Conventions

- **Currency:** GBP (£) everywhere — chart formatters and Streamlit metrics hardcode `£`.
- **Ruff config** (`pyproject.toml`): `target-version = "py311"`, `line-length = 100`, lint rules `E,F,I,N,UP,B,SIM,RUF`.
- **Python 3.11+** (`from __future__ import annotations` is used throughout).
