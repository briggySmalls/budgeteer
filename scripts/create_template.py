"""Generate model_inputs.ods with anchor-date formulas.

The Config sheet holds two anchor cells:
  B2  Preg_Start  — change this one date to shift the entire timeline
  C2  Birth_Date  — derived as =EDATE(Preg_Start, 9)

All phase dates and most cash-flow dates are formula-driven from those
two cells.  Corporate income events (bonuses, RSUs) remain hardcoded
because they follow the fiscal calendar, not the biological one.

The Python engine reads the *cached* values that LibreOffice writes on
save, so it is completely unaware of the formula layer.
"""

from __future__ import annotations

import sys
from datetime import date, timedelta
from pathlib import Path

from dateutil.relativedelta import relativedelta
from odf.opendocument import OpenDocumentSpreadsheet
from odf.table import Table, TableCell, TableRow

from budgeteer.odswriter import _add_cell, _add_formula_date_cell

# ---------------------------------------------------------------------------
# Spreadsheet cell references for the two anchor dates on the Config sheet
# ---------------------------------------------------------------------------
PREG_START = "Config.$B$2"
BIRTH_DATE = "Config.$C$2"


# ---------------------------------------------------------------------------
# Python equivalent of EDATE() for computing cached values
# ---------------------------------------------------------------------------
def _edate(d: date, months: int) -> date:
    return d + relativedelta(months=months)


# ---------------------------------------------------------------------------
# Sheet builders
# ---------------------------------------------------------------------------


def _build_config(doc, preg_start: date) -> None:
    birth = _edate(preg_start, 9)
    t = Table(name="Config")
    hdr = TableRow()
    for h in ["Starting_Savings", "Preg_Start", "Birth_Date"]:
        _add_cell(hdr, h)
    t.addElement(hdr)
    row = TableRow()
    _add_cell(row, 21000, "float")
    _add_cell(row, preg_start, "date")
    _add_formula_date_cell(row, "EDATE($B$2,9)", birth)
    t.addElement(row)
    doc.spreadsheet.addElement(t)


def _build_phases(doc, preg_start: date) -> None:
    birth = _edate(preg_start, 9)
    t = Table(name="Phases")
    hdr = TableRow()
    for h in ["ID", "Name", "Start_Date", "End_Date"]:
        _add_cell(hdr, h)
    t.addElement(hdr)

    phases = [
        ("P1", "Pregnancy", PREG_START, preg_start, f"{BIRTH_DATE}-1", birth - timedelta(days=1)),
        (
            "P2",
            "Maternity (Full Pay)",
            BIRTH_DATE,
            birth,
            f"EDATE({BIRTH_DATE},6)-1",
            _edate(birth, 6) - timedelta(days=1),
        ),
        (
            "P3",
            "Maternity (Half Pay)",
            f"EDATE({BIRTH_DATE},6)",
            _edate(birth, 6),
            f"EDATE({BIRTH_DATE},9)-1",
            _edate(birth, 9) - timedelta(days=1),
        ),
    ]
    for pid, name, sf, sc, ef, ec in phases:
        row = TableRow()
        _add_cell(row, pid)
        _add_cell(row, name)
        _add_formula_date_cell(row, sf, sc)
        _add_formula_date_cell(row, ef, ec)
        t.addElement(row)

    doc.spreadsheet.addElement(t)


def _build_recurring(doc, preg_start: date) -> None:
    birth = _edate(preg_start, 9)
    t = Table(name="Recurring_Cash_Flows")
    hdr = TableRow()
    for h in ["ID", "Name", "Direction", "Amount", "Frequency", "Start_Date", "End_Date"]:
        _add_cell(hdr, h)
    t.addElement(hdr)

    # (id, name, direction, amount, freq, start_formula, start_cached, end_formula, end_cached)
    # end_formula=None means blank cell (unbounded)
    rows = [
        (
            "CF1",
            "Net Household Income (Full Pay)",
            "Inflow",
            17700,
            "Monthly",
            PREG_START,
            preg_start,
            f"EDATE({BIRTH_DATE},6)-1",
            _edate(birth, 6) - timedelta(days=1),
        ),
        (
            "CF2",
            "Net Household Income (Half Pay)",
            "Inflow",
            10700,
            "Monthly",
            f"EDATE({BIRTH_DATE},6)",
            _edate(birth, 6),
            f"EDATE({BIRTH_DATE},9)-1",
            _edate(birth, 9) - timedelta(days=1),
        ),
        (
            "CF3",
            "Baseline Living Expenses",
            "Outflow",
            10000,
            "Monthly",
            PREG_START,
            preg_start,
            None,
            None,
        ),
        (
            "CF4",
            "Pregnancy Holidays",
            "Outflow",
            3000,
            "Monthly",
            PREG_START,
            preg_start,
            f"{BIRTH_DATE}-1",
            birth - timedelta(days=1),
        ),
        (
            "CF5",
            "Night Nurse (6 weeks smoothed)",
            "Outflow",
            4500,
            "Monthly",
            BIRTH_DATE,
            birth,
            f"{BIRTH_DATE}+42",
            birth + timedelta(days=42),
        ),
        (
            "CF6",
            "Nanny (7.5 months)",
            "Outflow",
            3000,
            "Monthly",
            f"{BIRTH_DATE}+43",
            birth + timedelta(days=43),
            f"EDATE({BIRTH_DATE},9)-1",
            _edate(birth, 9) - timedelta(days=1),
        ),
        (
            "CF7",
            "Mexico Villa Rent",
            "Outflow",
            5000,
            "Monthly",
            f"EDATE({BIRTH_DATE},3)",
            _edate(birth, 3),
            f"EDATE({BIRTH_DATE},9)-1",
            _edate(birth, 9) - timedelta(days=1),
        ),
    ]
    for fid, name, direction, amount, freq, sf, sc, ef, ec in rows:
        row = TableRow()
        _add_cell(row, fid)
        _add_cell(row, name)
        _add_cell(row, direction)
        _add_cell(row, amount, "float")
        _add_cell(row, freq)
        _add_formula_date_cell(row, sf, sc)
        if ef is not None:
            _add_formula_date_cell(row, ef, ec)
        else:
            row.addElement(TableCell())
        t.addElement(row)

    doc.spreadsheet.addElement(t)


def _build_one_offs(doc, preg_start: date) -> None:
    birth = _edate(preg_start, 9)
    t = Table(name="One_Off_Cash_Flows")
    hdr = TableRow()
    for h in ["ID", "Name", "Direction", "Amount", "Date"]:
        _add_cell(hdr, h)
    t.addElement(hdr)

    # formula=None = hardcoded date (corporate calendar, not biological)
    rows = [
        ("CF10", "April Bonus & RSUs", "Inflow", 40000, None, date(2026, 4, 30)),
        ("CF11", "October RSUs", "Inflow", 12000, None, date(2026, 10, 31)),
        (
            "CF12",
            "Kensington Wing Deposit",
            "Outflow",
            8500,
            f"EDATE({PREG_START},2)+14",
            _edate(preg_start, 2) + timedelta(days=14),
        ),
        (
            "CF13",
            "Private Obstetrician Instalment",
            "Outflow",
            8000,
            f"EDATE({PREG_START},5)",
            _edate(preg_start, 5),
        ),
        ("CF14", "Private Midwife", "Outflow", 2500, f"EDATE({BIRTH_DATE},-1)", _edate(birth, -1)),
        (
            "CF15",
            "Hospital Final Balance (Epidural etc)",
            "Outflow",
            2250,
            f"{BIRTH_DATE}+14",
            birth + timedelta(days=14),
        ),
        (
            "CF16",
            "Mexico Travel & Logistics (Flights)",
            "Outflow",
            10000,
            f"EDATE({BIRTH_DATE},2)",
            _edate(birth, 2),
        ),
    ]
    for fid, name, direction, amount, formula, cached in rows:
        row = TableRow()
        _add_cell(row, fid)
        _add_cell(row, name)
        _add_cell(row, direction)
        _add_cell(row, amount, "float")
        if formula is not None:
            _add_formula_date_cell(row, formula, cached)
        else:
            _add_cell(row, cached, "date")
        t.addElement(row)

    doc.spreadsheet.addElement(t)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def create_template(output_path: Path, preg_start: date = date(2026, 4, 1)) -> None:
    doc = OpenDocumentSpreadsheet()
    _build_config(doc, preg_start)
    _build_phases(doc, preg_start)
    _build_recurring(doc, preg_start)
    _build_one_offs(doc, preg_start)
    doc.save(str(output_path))
    print(f"Created {output_path}  (Preg_Start={preg_start})")


if __name__ == "__main__":
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("model_inputs.ods")
    create_template(output)
