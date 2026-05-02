"""Generate the model_inputs.ods template with example data."""

from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

from budgeteer.odswriter import write_ods


def main(output_path: Path):
    d = date
    write_ods(
        output_path,
        starting_savings=50000,
        phases=[
            ("P1", "Current Job", d(2026, 6, 1), d(2026, 11, 30)),
            ("P2", "Career Break", d(2026, 12, 1), d(2027, 2, 28)),
            ("P3", "New Role", d(2027, 3, 1), d(2027, 11, 30)),
        ],
        recurring=[
            ("CF1", "Salary", "Inflow", 5000, "Monthly", d(2026, 6, 1), d(2026, 11, 30)),
            ("CF2", "Rent", "Outflow", 1800, "Monthly", None, None),
            ("CF3", "Groceries", "Outflow", 600, "Monthly", None, None),
            (
                "CF4",
                "New Salary",
                "Inflow",
                6500,
                "Monthly",
                d(2027, 3, 1),
                d(2027, 11, 30),
            ),
            ("CF5", "Insurance", "Outflow", 1200, "Annually", d(2026, 9, 1), None),
        ],
        one_offs=[
            ("CF10", "Moving Costs", "Outflow", 3000, d(2026, 12, 1)),
            ("CF11", "Signing Bonus", "Inflow", 5000, d(2027, 3, 1)),
        ],
    )
    print(f"Created {output_path}")


if __name__ == "__main__":
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("model_inputs.ods")
    main(output)
