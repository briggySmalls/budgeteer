"""Helpers for writing .ods files from Python data."""

from __future__ import annotations

from datetime import date
from pathlib import Path

from odf.opendocument import OpenDocumentSpreadsheet
from odf.table import Table, TableCell, TableRow
from odf.text import P


def _add_formula_date_cell(row: TableRow, formula: str, cached: date):
    """Add a date cell whose value is a spreadsheet formula with a cached result.

    The cached value is what the Python engine reads; LibreOffice recalculates
    it from the formula whenever the anchor dates change and the file is saved.
    """
    cell = TableCell(formula=f"of:={formula}", valuetype="date", datevalue=str(cached))
    cell.addElement(P(text=str(cached)))
    row.addElement(cell)


def _add_cell(row: TableRow, value: str | float | date, value_type: str = "string"):
    if value_type == "date":
        cell = TableCell(valuetype="date", datevalue=str(value))
        cell.addElement(P(text=str(value)))
    elif value_type == "float":
        cell = TableCell(valuetype="float", value=str(value))
        cell.addElement(P(text=str(value)))
    else:
        cell = TableCell(valuetype="string")
        cell.addElement(P(text=str(value)))
    row.addElement(cell)


def write_ods(
    path: Path,
    *,
    phases: list[tuple[str, str, date, date]],
    recurring: list[tuple],
    one_offs: list[tuple],
    actuals: list[tuple[date, float]] | None = None,
):
    """Write a complete model_inputs.ods file.

    Args:
        phases: list of (id, name, start_date, end_date)
        recurring: list of (id, name, direction, amount, frequency, start, end)
                   where start/end can be None
        one_offs: list of (id, name, direction, amount, date)
    """
    doc = OpenDocumentSpreadsheet()

    # Phases
    phases_t = Table(name="Phases")
    hdr = TableRow()
    for h in ["ID", "Name", "Start_Date", "End_Date"]:
        _add_cell(hdr, h)
    phases_t.addElement(hdr)
    for pid, name, start, end in phases:
        row = TableRow()
        _add_cell(row, pid)
        _add_cell(row, name)
        _add_cell(row, start, "date")
        _add_cell(row, end, "date")
        phases_t.addElement(row)
    doc.spreadsheet.addElement(phases_t)

    # Recurring_Cash_Flows
    rec_t = Table(name="Recurring_Cash_Flows")
    hdr = TableRow()
    for h in ["ID", "Name", "Direction", "Amount", "Frequency", "Start_Date", "End_Date"]:
        _add_cell(hdr, h)
    rec_t.addElement(hdr)
    for fid, name, direction, amount, freq, start, end in recurring:
        row = TableRow()
        _add_cell(row, fid)
        _add_cell(row, name)
        _add_cell(row, direction)
        _add_cell(row, amount, "float")
        _add_cell(row, freq)
        if start:
            _add_cell(row, start, "date")
        else:
            row.addElement(TableCell())
        if end:
            _add_cell(row, end, "date")
        else:
            row.addElement(TableCell())
        rec_t.addElement(row)
    doc.spreadsheet.addElement(rec_t)

    # One_Off_Cash_Flows
    oo_t = Table(name="One_Off_Cash_Flows")
    hdr = TableRow()
    for h in ["ID", "Name", "Direction", "Amount", "Date"]:
        _add_cell(hdr, h)
    oo_t.addElement(hdr)
    for fid, name, direction, amount, d in one_offs:
        row = TableRow()
        _add_cell(row, fid)
        _add_cell(row, name)
        _add_cell(row, direction)
        _add_cell(row, amount, "float")
        _add_cell(row, d, "date")
        oo_t.addElement(row)
    doc.spreadsheet.addElement(oo_t)

    # Actuals
    actuals_t = Table(name="Actuals")
    hdr = TableRow()
    for h in ["Date", "Liquidity"]:
        _add_cell(hdr, h)
    actuals_t.addElement(hdr)
    for d, amount in actuals or []:
        row = TableRow()
        _add_cell(row, d, "date")
        _add_cell(row, amount, "float")
        actuals_t.addElement(row)
    doc.spreadsheet.addElement(actuals_t)

    doc.save(str(path))
