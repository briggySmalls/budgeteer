"""
ETL framework for one-off migrations to model_inputs.ods.

Usage
-----
Write a migration script that defines a ``transform`` function and calls
``run_migration``.  Everything else (backup, load, blank-row cleanup,
namespace-safe save) is handled for you::

    from pathlib import Path
    from budgeteer.ods_etl import (
        run_migration, get_sheet, add_sheet, append_row, remove_rows,
        str_cell, float_cell, date_cell, formula_cell,
    )

    def transform(doc):
        sheet = get_sheet(doc, "One_Off_Cash_Flows")
        remove_rows(sheet, lambda cells: "RSU" in cells[0])
        append_row(
            sheet,
            str_cell("RSU Vest Q3 2026 (172 shares)"),
            str_cell("Inflow"),
            formula_cell("=172*$Variables.$B$2*$Variables.$B$3*$Variables.$B$4", 4291.77),
            date_cell(date(2026, 7, 1)),
        )

    if __name__ == "__main__":
        run_migration(Path("model_inputs.ods"), transform)

Formula cell notes
------------------
* Write expressions exactly as you would in LibreOffice, with a leading ``=``,
  e.g. ``"=172*$Variables.$B$2*$Variables.$B$3"``.  The ODF ``of:`` namespace
  prefix is added internally — you never need to type it.
* Cross-sheet references use ``$SheetName.$Col$Row`` syntax, e.g.
  ``$Variables.$B$2``.  Do NOT use ``[.Sheet.$Col$Row]`` — that triggers
  LibreOffice Err:508.
* ``cached_value`` is stored as ``office:value`` so pandas reads a valid
  number before LibreOffice recalculates.
"""

from __future__ import annotations

import re
import shutil
import zipfile
from collections.abc import Callable
from datetime import date
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET

from odf.opendocument import load
from odf.table import Table, TableCell, TableRow
from odf.text import P

__all__ = [
    "add_sheet",
    "append_row",
    "date_cell",
    "float_cell",
    "formula_cell",
    "get_sheet",
    "remove_rows",
    "row_text",
    "run_migration",
    "str_cell",
]

# ---------------------------------------------------------------------------
# Migration runner
# ---------------------------------------------------------------------------


def run_migration(
    ods_path: Path,
    transform: Callable,
    *,
    backup: bool = True,
) -> None:
    """Load *ods_path*, run *transform(doc)*, save cleanly.

    A timestamped backup is written to ``<stem>.bkp.ods`` before saving
    unless *backup* is False.  Blank rows left by LibreOffice are stripped
    automatically so the file opens without a row-count warning.
    """
    if backup:
        bkp = ods_path.with_suffix(".bkp.ods")
        shutil.copy(ods_path, bkp)
        print(f"Backup → {bkp}")

    doc = load(str(ods_path))
    transform(doc)
    _save_clean(doc, ods_path)
    print(f"Saved  → {ods_path}")


# ---------------------------------------------------------------------------
# Sheet helpers
# ---------------------------------------------------------------------------


def get_sheet(doc, name: str) -> Table:
    """Return the named sheet, raising KeyError if absent."""
    for sheet in doc.spreadsheet.getElementsByType(Table):
        if sheet.getAttribute("name") == name:
            return sheet
    raise KeyError(f"Sheet {name!r} not found")


def add_sheet(doc, name: str, *, before: str | None = None) -> Table:
    """Add a new sheet named *name*.

    Pass *before* to insert it before an existing sheet by name; otherwise
    it is appended at the end.
    """
    sheet = Table(name=name)
    if before is not None:
        ref = get_sheet(doc, before)
        doc.spreadsheet.insertBefore(sheet, ref)
    else:
        doc.spreadsheet.addElement(sheet)
    return sheet


def row_text(row: TableRow) -> list[str]:
    """Return the text content of each cell in *row* as a list of strings."""
    result = []
    for cell in row.getElementsByType(TableCell):
        parts = cell.getElementsByType(P)
        result.append(parts[0].firstChild.data if parts and parts[0].firstChild else "")
    return result


def append_row(sheet: Table, *cells: TableCell) -> None:
    """Append a new row containing *cells* to *sheet*."""
    row = TableRow()
    for cell in cells:
        row.addElement(cell)
    sheet.addElement(row)


def remove_rows(sheet: Table, predicate: Callable[[list[str]], bool]) -> int:
    """Remove rows from *sheet* where ``predicate(row_text(row))`` is True.

    Returns the number of rows removed.
    """
    to_remove = [row for row in sheet.getElementsByType(TableRow) if predicate(row_text(row))]
    for row in to_remove:
        sheet.removeChild(row)
    return len(to_remove)


# ---------------------------------------------------------------------------
# Cell constructors
# ---------------------------------------------------------------------------


def str_cell(text: str) -> TableCell:
    cell = TableCell(valuetype="string")
    cell.addElement(P(text=str(text)))
    return cell


def float_cell(value: float) -> TableCell:
    cell = TableCell(valuetype="float", value=str(value))
    cell.addElement(P(text=str(value)))
    return cell


def date_cell(d: date) -> TableCell:
    cell = TableCell(valuetype="date", datevalue=str(d))
    cell.addElement(P(text=str(d)))
    return cell


def formula_cell(expr: str, cached_value: float) -> TableCell:
    """Create a formula cell.

    Write *expr* exactly as you would type it in LibreOffice, leading ``=``
    included::

        formula_cell("=172*$Variables.$B$2*$Variables.$B$3*$Variables.$B$4", 4291.77)

    Cross-sheet references: ``$SheetName.$Col$Row`` (NOT ``[.Sheet.$Col$Row]``).
    *cached_value* is stored so pandas can read the number before LibreOffice
    recalculates.
    """
    body = expr.lstrip("=")
    cell = TableCell(
        valuetype="float",
        value=f"{cached_value:.6g}",
        formula=f"of:={body}",
    )
    cell.addElement(P(text=f"{cached_value:.6g}"))
    return cell


# ---------------------------------------------------------------------------
# Internal: clean save
# ---------------------------------------------------------------------------

_TABLE_NS = "urn:oasis:names:tc:opendocument:xmlns:table:1.0"
_TEXT_NS = "urn:oasis:names:tc:opendocument:xmlns:text:1.0"
_ROW_TAG = f"{{{_TABLE_NS}}}table-row"
_CELL_TAG = f"{{{_TABLE_NS}}}table-cell"
_P_TAG = f"{{{_TEXT_NS}}}p"


def _row_is_blank(row: ET.Element) -> bool:
    for cell in row.iter(_CELL_TAG):
        for p in cell.iter(_P_TAG):
            if p.text and p.text.strip():
                return False
    return True


def _strip_blank_rows(xml_bytes: bytes) -> bytes:
    """Remove blank rows from all sheets in content.xml bytes."""
    xml_str = xml_bytes.decode("utf-8")

    # Register original prefixes so ET.tostring preserves them (e.g. table:, office:)
    for prefix, uri in re.findall(r'xmlns:(\w+)="([^"]+)"', xml_str[:8000]):
        ET.register_namespace(prefix, uri)

    root = ET.fromstring(xml_bytes)

    for table in root.iter(f"{{{_TABLE_NS}}}table"):
        blank = [r for r in table if r.tag == _ROW_TAG and _row_is_blank(r)]
        for r in blank:
            table.remove(r)

    serialised = ET.tostring(root, encoding="unicode")

    # Preserve the original XML declaration if present
    if xml_str.startswith("<?xml"):
        decl_end = xml_str.index("?>") + 2
        serialised = xml_str[:decl_end] + "\n" + serialised

    return serialised.encode("utf-8")


def _save_clean(doc, path: Path) -> None:
    """Save *doc* via odfpy then strip blank rows from content.xml."""
    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)

    out = BytesIO()
    with zipfile.ZipFile(buf, "r") as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "content.xml":
                data = _strip_blank_rows(data)
            zout.writestr(item, data)

    path.write_bytes(out.getvalue())
