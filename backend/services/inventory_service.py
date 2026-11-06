"""Inventory optimization service: sizing, alerts, persistence, transfers."""

from __future__ import annotations

from typing import Any, Iterable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.models.models import InventoryRecommendation, Product, Warehouse, WarehouseTransfer
from backend.services.analytics import (
    demand_profile,
    inventory_rows,
    lead_time_for_product,
)
from inventory.calculations import inventory_metrics
from inventory.transfers import plan_transfer


def build_inventory_view(
    session: Session,
    *,
    warehouse_id: int | None = None,
    product_ids: Iterable[int] | None = None,
    service_level: float = 0.95,
    review_period_days: int = 7,
) -> list[dict[str, Any]]:
    """Compute ROP / safety stock / recommended quantity for every stock row."""
    rows = inventory_rows(session, warehouse_id=warehouse_id, product_ids=product_ids)
    profile = demand_profile(session, product_ids=product_ids)
    view: list[dict[str, Any]] = []

    for row in rows:
        stats = profile.get((row["product_id"], row["warehouse_id"]), {})
        terms = lead_time_for_product(session, row["product_id"])
        metrics = inventory_metrics(
            current_stock=row["current_stock"],
            reserved_stock=row["reserved_stock"],
            incoming_stock=row["incoming_stock"],
            avg_daily_demand=float(stats.get("avg_daily_demand", 0.0)),
            daily_demand_history=stats.get("history", []),
            lead_time_days=terms["lead_time_days"],
            service_level=service_level,
            review_period_days=review_period_days,
            minimum_order_quantity=terms["minimum_order_quantity"],
            capacity=row["max_capacity"],
        )
        view.append(
            {
                **row,
                **metrics,
                "supplier_id": terms["supplier_id"],
                "supplier_name": terms["supplier_name"],
                "minimum_order_quantity": terms["minimum_order_quantity"],
                "unit_price": terms["unit_price"],
                "demand_source": stats.get("demand_source", "history"),
                "lookback_days": stats.get("lookback_days", 0),
            }
        )
    return view


def persist_recommendations(
    session: Session,
    view: list[dict[str, Any]],
    execution_id: str | None = None,
) -> int:
    """Store the latest sizing recommendation per product/warehouse."""
    pairs = [(row["product_id"], row["warehouse_id"]) for row in view]
    if pairs:
        for product_id, warehouse_id in pairs:
            session.execute(
                delete(InventoryRecommendation).where(
                    InventoryRecommendation.product_id == product_id,
                    InventoryRecommendation.warehouse_id == warehouse_id,
                )
            )
    count = 0
    for row in view:
        session.add(
            InventoryRecommendation(
                product_id=row["product_id"],
                warehouse_id=row["warehouse_id"],
                avg_daily_demand=row["avg_daily_demand"],
                safety_stock=row["safety_stock"],
                reorder_point=row["reorder_point"],
                target_stock=row["target_stock"],
                available_stock=row["available_stock"],
                incoming_stock=row["incoming_stock"],
                recommended_quantity=row["recommended_order_quantity"],
                lead_time_days=row["lead_time_days"],
                alert_level=row["alert_level"],
                stockout_risk=row["stockout_risk"],
                explanation=row["explanation"],
                execution_id=execution_id,
            )
        )
        count += 1
    session.commit()
    return count


def optimize(
    session: Session,
    *,
    warehouse_id: int | None = None,
    product_ids: Iterable[int] | None = None,
    service_level: float = 0.95,
    review_period_days: int = 7,
    persist: bool = True,
    execution_id: str | None = None,
) -> dict[str, Any]:
    """Run the full inventory optimization pass."""
    view = build_inventory_view(
        session,
        warehouse_id=warehouse_id,
        product_ids=product_ids,
        service_level=service_level,
        review_period_days=review_period_days,
    )
    persisted = persist_recommendations(session, view, execution_id) if persist else 0
    alerts = [row for row in view if row["alert_level"] != "ok"]
    return {
        "items": view,
        "summary": {
            "items_evaluated": len(view),
            "alerts": len(alerts),
            "critical": sum(1 for r in view if r["alert_level"] in ("critical", "stockout")),
            "low": sum(1 for r in view if r["alert_level"] == "low"),
            "overstock": sum(1 for r in view if r["alert_level"] == "overstock"),
            "replenishment_required": sum(
                1 for r in view if r["recommended_order_quantity"] > 0
            ),
            "total_recommended_units": round(
                sum(r["recommended_order_quantity"] for r in view), 2
            ),
            "persisted": persisted,
            "service_level": service_level,
            "review_period_days": review_period_days,
        },
    }


def stored_recommendations(
    session: Session,
    warehouse_id: int | None = None,
    limit: int = 500,
) -> list[dict[str, Any]]:
    """Read persisted recommendations joined with product/warehouse labels."""
    stmt = (
        select(InventoryRecommendation, Product, Warehouse)
        .join(Product, Product.id == InventoryRecommendation.product_id)
        .join(Warehouse, Warehouse.id == InventoryRecommendation.warehouse_id)
        .order_by(Product.sku, Warehouse.code)
        .limit(limit)
    )
    if warehouse_id:
        stmt = stmt.where(InventoryRecommendation.warehouse_id == warehouse_id)
    items = []
    for rec, product, warehouse in session.execute(stmt).all():
        items.append(
            {
                "id": rec.id,
                "product_id": product.id,
                "sku": product.sku,
                "product_name": product.name,
                "warehouse_id": warehouse.id,
                "warehouse_code": warehouse.code,
                "warehouse_name": warehouse.name,
                "available_stock": float(rec.available_stock),
                "incoming_stock": float(rec.incoming_stock),
                "avg_daily_demand": float(rec.avg_daily_demand),
                "safety_stock": float(rec.safety_stock),
                "reorder_point": float(rec.reorder_point),
                "target_stock": float(rec.target_stock),
                "recommended_quantity": float(rec.recommended_quantity),
                "alert_level": rec.alert_level,
                "stockout_risk": bool(rec.stockout_risk),
                "lead_time_days": float(rec.lead_time_days),
                "explanation": rec.explanation,
                "created_at": rec.created_at.isoformat() if rec.created_at else None,
            }
        )
    return items


def transfer_plan_for_view(
    session: Session,
    view: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Plan transfers for every row that still needs replenishment."""
    by_product: dict[int, list[dict[str, Any]]] = {}
    for row in view:
        by_product.setdefault(row["product_id"], []).append(row)

    plans: list[dict[str, Any]] = []
    for product_id, rows in by_product.items():
        for destination in rows:
            need = float(destination["recommended_order_quantity"])
            if need <= 0:
                continue
            sources = [
                {
                    "warehouse_id": other["warehouse_id"],
                    "warehouse_name": other["warehouse_name"],
                    "current_stock": other["current_stock"],
                    "reserved_stock": other["reserved_stock"],
                    "incoming_stock": other["incoming_stock"],
                    "safety_stock": other["safety_stock"],
                }
                for other in rows
            ]
            plan = plan_transfer(
                product_id=product_id,
                destination_warehouse_id=destination["warehouse_id"],
                destination_need=need,
                sources=sources,
            )
            if not plan["transfers"]:
                continue
            plans.append({**plan, "destination_row": destination})
    return plans


def persist_transfers(
    session: Session,
    plans: list[dict[str, Any]],
    execution_id: str | None = None,
) -> list[dict[str, Any]]:
    """Store feasible transfer recommendations and return them with ids."""
    stored: list[dict[str, Any]] = []
    for plan in plans:
        destination = plan["destination_row"]
        for allocation in plan["transfers"]:
            transfer = WarehouseTransfer(
                product_id=plan["product_id"],
                from_warehouse_id=allocation["from_warehouse_id"],
                to_warehouse_id=plan["to_warehouse_id"] if "to_warehouse_id" in allocation else plan["to_warehouse_id"],
                quantity=allocation["quantity"],
                reason=plan["explanation"],
                feasible=plan["feasible"],
                status="recommended",
                execution_id=execution_id,
            )
            session.add(transfer)
            session.flush()
            stored.append(
                {
                    "id": transfer.id,
                    "product_id": plan["product_id"],
                    "sku": destination["sku"],
                    "product_name": destination["product_name"],
                    "from_warehouse_id": allocation["from_warehouse_id"],
                    "from_warehouse_name": allocation["from_warehouse_name"],
                    "to_warehouse_id": transfer.to_warehouse_id,
                    "to_warehouse_name": destination["warehouse_name"],
                    "quantity": allocation["quantity"],
                    "feasible": plan["feasible"],
                    "partially_feasible": plan["partially_feasible"],
                    "reason": plan["explanation"],
                    "status": transfer.status,
                }
            )
    session.commit()
    return stored


def stored_transfers(session: Session, limit: int = 200) -> list[dict[str, Any]]:
    stmt = (
        select(WarehouseTransfer, Product, Warehouse)
        .join(Product, Product.id == WarehouseTransfer.product_id)
        .join(Warehouse, Warehouse.id == WarehouseTransfer.from_warehouse_id)
        .order_by(WarehouseTransfer.created_at.desc(), WarehouseTransfer.id.desc())
        .limit(limit)
    )
    to_names = {
        w.id: w for w in session.scalars(select(Warehouse)).all()
    }
    output = []
    for transfer, product, source in session.execute(stmt).all():
        destination = to_names.get(transfer.to_warehouse_id)
        output.append(
            {
                "id": transfer.id,
                "product_id": product.id,
                "sku": product.sku,
                "product_name": product.name,
                "from_warehouse_id": source.id,
                "from_warehouse_code": source.code,
                "from_warehouse_name": source.name,
                "to_warehouse_id": transfer.to_warehouse_id,
                "to_warehouse_code": destination.code if destination else "",
                "to_warehouse_name": destination.name if destination else "",
                "quantity": float(transfer.quantity),
                "reason": transfer.reason,
                "feasible": bool(transfer.feasible),
                "status": transfer.status,
                "created_at": transfer.created_at.isoformat() if transfer.created_at else None,
            }
        )
    return output
