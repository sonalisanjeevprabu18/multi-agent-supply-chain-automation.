"""Write the sample CSV datasets shipped with the project.

All rows are SYNTHETIC demonstration data (see data/sample/README.md); they must
never be presented as real business records.

Usage::

    python data/generate_samples.py            # 180 days ending today
    python data/generate_samples.py --days 240 --end 2026-10-31
"""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.database.sample_data import (  # noqa: E402
    generate_sales_frame,
    inventory_frame,
    supplier_frame,
)

SAMPLE_DIR = ROOT / "data" / "sample"


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic sample CSVs.")
    parser.add_argument("--days", type=int, default=180)
    parser.add_argument(
        "--end", type=str, default=None, help="ISO end date (default: today)"
    )
    args = parser.parse_args()

    end_date = date.fromisoformat(args.end) if args.end else date.today()
    SAMPLE_DIR.mkdir(parents=True, exist_ok=True)

    sales = generate_sales_frame(days=args.days, end_date=end_date)
    sales_path = SAMPLE_DIR / "sales_history.csv"
    sales.to_csv(sales_path, index=False)

    inventory_path = SAMPLE_DIR / "inventory_snapshot.csv"
    inventory_frame().to_csv(inventory_path, index=False)

    suppliers_path = SAMPLE_DIR / "supplier_offers.csv"
    supplier_frame().to_csv(suppliers_path, index=False)

    print(f"sales rows     : {len(sales)} -> {sales_path.relative_to(ROOT)}")
    print(f"inventory rows : {len(inventory_frame())} -> {inventory_path.relative_to(ROOT)}")
    print(f"supplier rows  : {len(supplier_frame())} -> {suppliers_path.relative_to(ROOT)}")
    print(f"date range     : {sales['date'].min()} .. {sales['date'].max()}")


if __name__ == "__main__":
    main()
