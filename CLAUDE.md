# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

All dev commands go through `uv` and are wrapped in the `Makefile`:

- `make setup` — `uv sync` + install pre-commit hooks
- `make run` — launch the Streamlit app (`uv run streamlit run budgeteer/app.py`)
- `make test` — `uv run pytest --cov`
- `make lint` — `ruff check .` + `ruff format --check .`
- `make format` — `ruff format .` + `ruff check --fix .`

Run a single test: `uv run pytest tests/test_engine.py::test_name -v`

CI (`.github/workflows/ci.yml`) runs `ruff check`, `ruff format --check`, and `pytest --cov` against `uv sync --frozen`. Pre-commit runs `ruff-format` then `ruff --fix`.

## Architecture

Pipeline: **`.ods` file → ingest → models → engine → charts → Streamlit**

The user edits `model_inputs.ods` in LibreOffice; the app watches the file's mtime and hot-reloads on save.

### Data flow

1. **`budgeteer/ingest.py`** reads four sheets from the ODS via `pd.read_excel(engine="odf")`:
   - `Phases` — `ID, Name, Start_Date, End_Date` (must not overlap; sorted by start_date)
   - `Recurring_Cash_Flows` — `ID, Name, Direction, Amount, Frequency, Start_Date, End_Date`
   - `One_Off_Cash_Flows` — `ID, Name, Direction, Amount, Date`
   - `Actuals` — `Date, Liquidity` (may be empty; sheet must exist)

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

### ODS file lifecycle

`model_inputs.ods` is a hand-maintained file edited in LibreOffice. It may use cross-sheet formulas (e.g. dates anchored on a `Config.Preg_Start` cell so cash-flow dates auto-update when the anchor shifts) — those formulas are authored natively in LibreOffice, not emitted from Python. `pandas.read_excel(engine="odf")` reads **cached formula values**, so the engine is unaware of the formula layer.

When the data model changes (new sheet, renamed column, etc.), migrate the file with a one-off Python script using `odfpy` rather than regenerating from scratch — preserves user-authored formulas and data.

`budgeteer/odswriter.py` exposes `write_ods(...)` used **only by tests** to write static-value ODS files into a `tmp_path`. It does not emit formulas.

### Tests

Integration tests in `tests/test_forecast.py` call `write_ods` to produce a temp ODS, then run the full ingest → engine pipeline. Engine/model tests build dataclasses directly.

## Conventions

- **Currency:** GBP (£) everywhere — chart formatters and Streamlit metrics hardcode `£`.
- **Ruff config** (`pyproject.toml`): `target-version = "py311"`, `line-length = 100`, lint rules `E,F,I,N,UP,B,SIM,RUF`.
- **Python 3.11+** (`from __future__ import annotations` is used throughout).
