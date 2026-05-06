# Budgeteer

Personal liquidity forecasting app. Define phases and cash flows in a LibreOffice spreadsheet; the app computes a monthly ledger and serves interactive Plotly charts via Streamlit with hot-reload on save.

## Quick start

```bash
make setup   # uv sync + pre-commit hooks
make run     # launch Streamlit at http://localhost:8501
make test    # pytest --cov
make lint    # ruff check + format check
```

## How it works

Edit `model_inputs.ods` in LibreOffice. The app watches the file and reloads automatically on save.

**Sheets the app reads:**

| Sheet | Columns | Notes |
|---|---|---|
| `Phases` | `Name, Start_Date, End_Date` | Must not overlap |
| `Recurring_Cash_Flows` | `Name, Direction, Amount, Frequency, Start_Date, End_Date` | Direction: `Inflow`/`Outflow`; Frequency: `Monthly`/`Annually` |
| `One_Off_Cash_Flows` | `Name, Direction, Amount, Date` | |
| `Actuals` | `Date, Liquidity` | Optional; sheet must exist |

Any other sheets (e.g. `Variables` for shared constants) are ignored by the parser and can be used freely for LibreOffice formulas.

## Modifying model_inputs.ods from Python

When you need to add rows, rename columns, or restructure the file, use the migration framework rather than editing the ODS directly or regenerating from scratch. Regenerating destroys LibreOffice-authored formulas (date anchors, cross-sheet references).

### Writing a migration script

Create a file in `scripts/` and use `budgeteer/ods_etl.py`:

```python
from pathlib import Path
from budgeteer.ods_etl import (
    run_migration, get_sheet, add_sheet,
    append_row, remove_rows,
    str_cell, float_cell, date_cell, formula_cell,
)

def transform(doc):
    sheet = get_sheet(doc, "One_Off_Cash_Flows")

    # Remove rows whose Name contains "Old Label"
    remove_rows(sheet, lambda cells: "Old Label" in cells[0])

    # Append a plain row
    append_row(sheet,
        str_cell("School fees"),
        str_cell("Outflow"),
        float_cell(3500.00),
        date_cell(date(2027, 9, 1)),
    )

    # Append a row whose Amount is a LibreOffice formula
    append_row(sheet,
        str_cell("RSU Vest"),
        str_cell("Inflow"),
        formula_cell("=172*$Variables.$B$2*$Variables.$B$3", cached_value=4291.77),
        date_cell(date(2026, 7, 1)),
    )

if __name__ == "__main__":
    run_migration(Path("model_inputs.ods"), transform)
```

Run it with:

```bash
uv run python scripts/your_migration.py
```

`run_migration` automatically:
- backs up the file to `model_inputs.bkp.ods` before touching it
- strips the ~1 million blank trailing rows LibreOffice writes, which otherwise cause a row-count warning on next open

### Formula cells

`formula_cell(expr, cached_value)` writes a cell with a LibreOffice formula.

- Write `expr` exactly as you would in the LibreOffice formula bar, with a leading `=`:
  ```python
  formula_cell("=172*$Variables.$B$2*$Variables.$B$3*$Variables.$B$4", 4291.77)
  ```
- Cross-sheet references: use `$SheetName.$Col$Row` (e.g. `$Variables.$B$2`). **Do not** use `[.Sheet.$Col$Row]` — that triggers `Err:508` in LibreOffice.
- `cached_value` is stored so pandas reads a valid number before LibreOffice recalculates. It must be a reasonable approximation of the formula result.

See `scripts/migrate_add_rsus.py` for a complete example.
