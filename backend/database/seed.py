"""Idempotent seeding of the database with synthetic demonstration data.

Usage::

    python -m backend.database.seed            # seed if empty
    python -m backend.database.seed --reset    # drop + recreate + seed
    python -m backend.database.seed --days 240
"""

from __future__ import annotations

import argparse
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database.sample_data import (
    PRODUCTS,
    SUPPLIERS,
    SUPPLIER_OFFERS,
    WAREHOUSES,
    generate_sales_frame,
    inventory_frame,
)
from backend.database.session import init_db, session_scope
from backend.models.models import (
    Inventory,
    Product,
    SalesHistory,
    Supplier,
    SupplierProduct,
    Warehouse,
)


def is_seeded(session: Session) -> bool:
    return bool(session.scalar(select(func.count()).select_from(Product)))


def seed_database(
    session: Session,
    *,
    days: int = 180,
    end_date: date | None = None,
    force: bool = False,
) -> dict:
    """Insert warehouses, products, suppliers, offers, stock and sales history."""
    if is_seeded(session) and not force:
        return {"seeded": False, "reason": "database already contains data"}

    warehouses: dict[str, Warehouse] = {}
    for payload in WAREHOUSES:
        warehouses[payload["code"]] = Warehouse(**payload)
    products: dict[str, Product] = {}
    for payload in PRODUCTS:
        products[payload["sku"]] = Product(**payload)
    suppliers: dict[str, Supplier] = {}
    for payload in SUPPLIERS:
        suppliers[payload["code"]] = Supplier(**payload)

    session.add_all([*warehouses.values(), *products.values(), *suppliers.values()])
    session.flush()

    for sku, code, multiplier, lead, reliability, moq in SUPPLIER_OFFERS:
        product = products[sku]
        session.add(
            SupplierProduct(
                supplier_id=suppliers[code].id,
                product_id=product.id,
                unit_price=round(product.unit_cost * multiplier, 2),
                lead_time_days=float(lead),
                reliability_score=float(reliability),
                minimum_order_quantity=float(moq),
                is_preferred=multiplier <= 1.0,
            )
        )

    stock = inventory_frame()
    for row in stock.to_dict("records"):
        product = products[row["product_id"]]
        warehouse = warehouses[row["warehouse_id"]]
        session.add(
            Inventory(
                product_id=product.id,
                warehouse_id=warehouse.id,
                current_stock=row["current_stock"],
                reserved_stock=row["reserved_stock"],
                incoming_stock=row["incoming_stock"],
                max_capacity=row["max_capacity"],
            )
        )

    sales = generate_sales_frame(days=days, end_date=end_date)
    sales_rows = [
        SalesHistory(
            sale_date=date.fromisoformat(row["date"]),
            product_id=products[row["product_id"]].id,
            warehouse_id=warehouses[row["warehouse_id"]].id,
            units_sold=float(row["units_sold"]),
            selling_price=float(row["selling_price"]),
        )
        for row in sales.to_dict("records")
    ]
    session.add_all(sales_rows)
    session.flush()

    return {
        "seeded": True,
        "warehouses": len(warehouses),
        "products": len(products),
        "suppliers": len(suppliers),
        "supplier_offers": len(SUPPLIER_OFFERS),
        "inventory_rows": len(stock),
        "sales_rows": len(sales_rows),
        "days": days,
        "data_source": "synthetic",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the supply-chain database.")
    parser.add_argument("--reset", action="store_true", help="drop all tables first")
    parser.add_argument("--days", type=int, default=180, help="days of sales history")
    parser.add_argument(
        "--force", action="store_true", help="insert demo rows even if data exists"
    )
    args = parser.parse_args()

    print(f"[seed] database: {'sqlite (local dev)' if settings.is_sqlite else 'postgresql'}")
    init_db(drop=args.reset)
    with session_scope() as session:
        summary = seed_database(
            session, days=args.days, force=args.force or args.reset
        )
    print(f"[seed] {summary}")


if __name__ == "__main__":
    main()
