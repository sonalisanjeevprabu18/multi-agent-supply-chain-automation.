"""Shared demand and inventory analytics used by services and agents.

This module is the single place where "what is demand right now?" is answered:
inventory sizing, procurement sizing and every agent read demand from here, so
the numbers on the dashboard and inside a workflow cannot drift apart.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any, Iterable

import pandas as pd
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.models.models import (
    DemandForecast,
    Inventory,
    Product,
    SalesHistory,
    Supplier,
    SupplierProduct,
    Warehouse,
)
from inventory.calculations import demand_std

LOOKBACK_DAYS = 42
DEFAULT_LEAD_TIME = 7.0
DEFAULT_MOQ = 1.0


def max_sale_date(session: Session) -> date | None:
    return session.scalar(select(func.max(SalesHistory.sale_date)))


def sales_frame(
    session: Session,
    product_ids: Iterable[int] | None = None,
    start: date | None = None,
    end: date | None = None,
) -> pd.DataFrame:
    """Load sales history as a tidy frame: product_id, warehouse_id, ds, y."""
    stmt = select(
        SalesHistory.product_id,
        SalesHistory.warehouse_id,
        SalesHistory.sale_date,
        SalesHistory.units_sold,
    )
    if product_ids:
        stmt = stmt.where(SalesHistory.product_id.in_(list(product_ids)))
    if start:
        stmt = stmt.where(SalesHistory.sale_date >= start)
    if end:
        stmt = stmt.where(SalesHistory.sale_date <= end)
    rows = session.execute(stmt).all()
    if not rows:
        return pd.DataFrame(columns=["product_id", "warehouse_id", "ds", "y"])
    frame = pd.DataFrame(rows, columns=["product_id", "warehouse_id", "ds", "y"])
    frame["ds"] = pd.to_datetime(frame["ds"]).dt.normalize()
    frame["y"] = frame["y"].astype(float)
    return frame.sort_values(["product_id", "warehouse_id", "ds"]).reset_index(drop=True)


def product_series(
    session: Session, product_ids: Iterable[int] | None = None
) -> dict[int, pd.DataFrame]:
    """Daily demand per product, aggregated across warehouses."""
    frame = sales_frame(session, product_ids=product_ids)
    if frame.empty:
        return {}
    grouped = (
        frame.groupby(["product_id", "ds"], as_index=False)["y"].sum()
        .sort_values(["product_id", "ds"])
    )
    return {
        int(pid): group[["ds", "y"]].reset_index(drop=True)
        for pid, group in grouped.groupby("product_id")
    }


def warehouse_shares(frame: pd.DataFrame) -> dict[int, dict[int, float]]:
    """Share of each product's demand that historically lands in each warehouse."""
    if frame.empty:
        return {}
    totals = frame.groupby("product_id")["y"].sum()
    shares: dict[int, dict[int, float]] = {}
    by_pair = frame.groupby(["product_id", "warehouse_id"])["y"].sum()
    for (product_id, warehouse_id), value in by_pair.items():
        total = float(totals.get(product_id, 0.0))
        share = float(value) / total if total > 0 else 0.0
        shares.setdefault(int(product_id), {})[int(warehouse_id)] = round(share, 6)
    return shares


def latest_forecast_avg(session: Session) -> dict[int, float]:
    """Most recent persisted average daily demand per product."""
    rows = session.execute(
        select(
            DemandForecast.product_id,
            DemandForecast.avg_daily_demand,
            DemandForecast.created_at,
        ).order_by(DemandForecast.created_at.desc(), DemandForecast.id.desc())
    ).all()
    seen: dict[int, float] = {}
    for product_id, avg_daily, _created in rows:
        if int(product_id) not in seen:
            seen[int(product_id)] = float(avg_daily or 0.0)
    return seen


def demand_profile(
    session: Session,
    product_ids: Iterable[int] | None = None,
    lookback_days: int = LOOKBACK_DAYS,
) -> dict[tuple[int, int], dict[str, Any]]:
    """Per (product, warehouse) demand statistics.

    ``avg_daily_demand`` prefers the latest persisted forecast, distributed across
    warehouses by their historical share, and falls back to observed history.
    """
    frame = sales_frame(session, product_ids=product_ids)
    if frame.empty:
        return {}
    shares = warehouse_shares(frame)
    forecasts = latest_forecast_avg(session)
    end = pd.Timestamp(frame["ds"].max())
    start = end - timedelta(days=lookback_days - 1)
    calendar = pd.date_range(start, end, freq="D")

    profile: dict[tuple[int, int], dict[str, Any]] = {}
    for (product_id, warehouse_id), group in frame.groupby(["product_id", "warehouse_id"]):
        series = (
            group.set_index("ds")["y"].reindex(calendar, fill_value=0.0).astype(float)
        )
        history = [float(v) for v in series.values]
        observed_avg = sum(history) / len(history) if history else 0.0
        share = shares.get(int(product_id), {}).get(int(warehouse_id), 0.0)
        if int(product_id) in forecasts and forecasts[int(product_id)] > 0:
            avg_daily = forecasts[int(product_id)] * share
            source = "forecast"
        else:
            avg_daily = observed_avg
            source = "history"
        profile[(int(product_id), int(warehouse_id))] = {
            "avg_daily_demand": round(avg_daily, 4),
            "observed_avg_daily_demand": round(observed_avg, 4),
            "demand_std_dev": round(demand_std(history), 4),
            "history": history,
            "lookback_days": len(history),
            "demand_source": source,
            "warehouse_share": share,
        }
    return profile


def lead_time_for_product(session: Session, product_id: int) -> dict[str, Any]:
    """Commercial terms taken from the fastest active supplier offering."""
    stmt = (
        select(SupplierProduct, Supplier)
        .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
        .where(
            SupplierProduct.product_id == product_id,
            Supplier.status == "active",
        )
        .order_by(SupplierProduct.lead_time_days.asc())
    )
    row = session.execute(stmt).first()
    if row is None:
        return {
            "lead_time_days": DEFAULT_LEAD_TIME,
            "minimum_order_quantity": DEFAULT_MOQ,
            "unit_price": 0.0,
            "supplier_id": None,
            "supplier_name": None,
        }
    offer, supplier = row
    return {
        "lead_time_days": float(offer.lead_time_days),
        "minimum_order_quantity": float(offer.minimum_order_quantity),
        "unit_price": float(offer.unit_price),
        "supplier_id": supplier.id,
        "supplier_name": supplier.name,
    }


def inventory_rows(
    session: Session,
    warehouse_id: int | None = None,
    product_ids: Iterable[int] | None = None,
) -> list[dict[str, Any]]:
    """Joined inventory snapshot for every product/warehouse pair."""
    stmt = (
        select(Inventory, Product, Warehouse)
        .join(Product, Product.id == Inventory.product_id)
        .join(Warehouse, Warehouse.id == Inventory.warehouse_id)
        .order_by(Product.sku, Warehouse.code)
    )
    if warehouse_id:
        stmt = stmt.where(Inventory.warehouse_id == warehouse_id)
    if product_ids:
        stmt = stmt.where(Inventory.product_id.in_(list(product_ids)))
    rows: list[dict[str, Any]] = []
    for stock, product, warehouse in session.execute(stmt).all():
        rows.append(
            {
                "product_id": product.id,
                "sku": product.sku,
                "product_name": product.name,
                "unit_cost": float(product.unit_cost or 0.0),
                "selling_price": float(product.selling_price or 0.0),
                "warehouse_id": warehouse.id,
                "warehouse_code": warehouse.code,
                "warehouse_name": warehouse.name,
                "warehouse_location": warehouse.location,
                "current_stock": float(stock.current_stock or 0.0),
                "reserved_stock": float(stock.reserved_stock or 0.0),
                "incoming_stock": float(stock.incoming_stock or 0.0),
                "max_capacity": (
                    min(
                        float(stock.max_capacity)
                        if stock.max_capacity is not None
                        else float("inf"),
                        float(warehouse.capacity or float("inf")),
                    )
                    if stock.max_capacity is not None or warehouse.capacity
                    else None
                ),
            }
        )
    return rows


def supplier_offers(session: Session, product_id: int) -> list[dict[str, Any]]:
    """Every supplier offer for one product, including supplier status."""
    stmt = (
        select(SupplierProduct, Supplier, Product)
        .join(Supplier, Supplier.id == SupplierProduct.supplier_id)
        .join(Product, Product.id == SupplierProduct.product_id)
        .where(SupplierProduct.product_id == product_id)
    )
    offers: list[dict[str, Any]] = []
    for offer, supplier, product in session.execute(stmt).all():
        offers.append(
            {
                "supplier_id": supplier.id,
                "supplier_name": supplier.name,
                "supplier_code": supplier.code,
                "supplier_status": supplier.status,
                "product_id": product.id,
                "sku": product.sku,
                "product_name": product.name,
                "unit_price": float(offer.unit_price),
                "lead_time_days": float(offer.lead_time_days),
                "reliability_score": float(offer.reliability_score),
                "minimum_order_quantity": float(offer.minimum_order_quantity),
            }
        )
    return offers


def finished_forecast_inventory_value(session: Session) -> float:
    """Current on-hand inventory valued at product unit cost."""
    stmt = select(func.coalesce(func.sum(Inventory.current_stock * Product.unit_cost), 0.0)).join(
        Product, Product.id == Inventory.product_id
    )
    return float(session.scalar(stmt) or 0.0)
