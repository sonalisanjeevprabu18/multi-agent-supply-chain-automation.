"""Sales CSV ingestion: validation, product/warehouse resolution, upsert."""

from __future__ import annotations

from datetime import date
from io import StringIO
from typing import Any

import pandas as pd
from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.models import Product, SalesHistory, Warehouse
from forecasting.preprocessing import (
    ValidationReport,
    build_template_frame,
    read_csv_bytes,
    validate_and_clean,
)


def _resolve_products(session: Session, frame: pd.DataFrame) -> dict[str, Product]:
    skus = sorted(frame["product_id"].unique().tolist())
    existing = {
        product.sku: product
        for product in session.scalars(select(Product).where(Product.sku.in_(skus))).all()
    }
    names = (
        frame.groupby("product_id")["product_name"].first().to_dict()
    )
    prices = frame.groupby("product_id")["selling_price"].mean().to_dict()
    for sku in skus:
        if sku not in existing:
            product = Product(
                sku=str(sku),
                name=str(names.get(sku, sku)),
                category="imported",
                unit_cost=round(float(prices.get(sku, 0.0)) * 0.65, 2),
                selling_price=round(float(prices.get(sku, 0.0)), 2),
            )
            session.add(product)
            existing[sku] = product
    session.flush()
    return existing


def _resolve_warehouses(session: Session, frame: pd.DataFrame) -> dict[str, Warehouse]:
    codes = sorted(frame["warehouse_id"].unique().tolist())
    existing = {
        warehouse.code: warehouse
        for warehouse in session.scalars(
            select(Warehouse).where(Warehouse.code.in_(codes))
        ).all()
    }
    for code in codes:
        if code not in existing:
            warehouse = Warehouse(
                code=str(code),
                name=f"Warehouse {code}",
                location="Imported",
                capacity=10000.0,
            )
            session.add(warehouse)
            existing[code] = warehouse
    session.flush()
    return existing


def ingest_sales_frame(
    session: Session, raw: bytes | pd.DataFrame
) -> tuple[dict[str, Any], ValidationReport]:
    """Validate and upsert a sales file. Raises SalesDataError on unparseable input."""
    frame = read_csv_bytes(raw) if isinstance(raw, (bytes, bytearray)) else raw
    cleaned, report = validate_and_clean(frame)
    if not report.is_valid:
        session.rollback()
        return (
            {
                "accepted_rows": 0,
                "rejected_rows": report.rejected_rows,
                "warnings": report.warnings,
                "errors": report.errors,
                "products_ingested": 0,
                "warehouses_ingested": 0,
                "date_range": None,
            },
            report,
        )

    products = _resolve_products(session, cleaned)
    warehouses = _resolve_warehouses(session, cleaned)

    min_date = cleaned["date"].min().date()
    max_date = cleaned["date"].max().date()
    existing_rows = session.execute(
        select(
            SalesHistory.id,
            SalesHistory.sale_date,
            SalesHistory.product_id,
            SalesHistory.warehouse_id,
        ).where(SalesHistory.sale_date.between(min_date, max_date))
    ).all()
    index = {
        (row.sale_date, int(row.product_id), int(row.warehouse_id)): row.id
        for row in existing_rows
    }

    inserted = 0
    updated = 0
    for record in cleaned.to_dict("records"):
        product = products[record["product_id"]]
        warehouse = warehouses[record["warehouse_id"]]
        sale_date = record["date"].date() if hasattr(record["date"], "date") else record["date"]
        key = (sale_date, int(product.id), int(warehouse.id))
        if key in index:
            history_id = index[key]
            session.execute(
                SalesHistory.__table__.update()
                .where(SalesHistory.__table__.c.id == history_id)
                .values(
                    units_sold=float(record["units_sold"]),
                    selling_price=float(record["selling_price"]),
                )
            )
            updated += 1
        else:
            session.add(
                SalesHistory(
                    sale_date=sale_date,
                    product_id=product.id,
                    warehouse_id=warehouse.id,
                    units_sold=float(record["units_sold"]),
                    selling_price=float(record["selling_price"]),
                )
            )
            inserted += 1

    session.commit()
    return (
        {
            "accepted_rows": inserted + updated,
            "rejected_rows": report.rejected_rows,
            "warnings": report.warnings,
            "errors": report.errors,
            "products_ingested": len(products),
            "warehouses_ingested": len(warehouses),
            "date_range": (min_date.isoformat(), max_date.isoformat()),
            "inserted_rows": inserted,
            "updated_rows": updated,
        },
        report,
    )


def template_csv() -> str:
    buffer = StringIO()
    build_template_frame().to_csv(buffer, index=False)
    return buffer.getvalue()


def sales_summary(session: Session) -> dict[str, Any]:
    """Coverage information for the dashboard's data panel."""
    from sqlalchemy import func

    total_rows = session.scalar(select(func.count()).select_from(SalesHistory)) or 0
    min_date, max_date = session.execute(
        select(func.min(SalesHistory.sale_date), func.max(SalesHistory.sale_date))
    ).first() or (None, None)
    products = session.scalar(select(func.count()).select_from(Product)) or 0
    return {
        "sales_rows": int(total_rows),
        "products": int(products),
        "date_range": (
            (min_date.isoformat(), max_date.isoformat()) if min_date and max_date else None
        ),
    }


def latest_sales_date(session: Session) -> date | None:
    from backend.services.analytics import max_sale_date

    return max_sale_date(session)
