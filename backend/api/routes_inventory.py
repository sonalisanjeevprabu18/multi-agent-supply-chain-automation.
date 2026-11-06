"""Inventory optimization endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.inventory import InventoryOptimizeRequest
from backend.services import inventory_service

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


@router.post("/optimize")
def optimize(
    payload: InventoryOptimizeRequest,
    session: Session = Depends(get_db),
) -> dict:
    """Recalculate safety stock, reorder points and replenishment quantities."""
    result = inventory_service.optimize(
        session,
        warehouse_id=payload.warehouse_id,
        product_ids=payload.product_ids,
        service_level=payload.service_level,
        review_period_days=payload.review_period_days,
        persist=True,
    )
    return result


@router.get("/recommendations")
def recommendations(
    warehouse_id: int | None = None,
    limit: int = 500,
    session: Session = Depends(get_db),
) -> list[dict]:
    return inventory_service.stored_recommendations(
        session, warehouse_id=warehouse_id, limit=limit
    )


@router.get("/transfers")
def transfers(limit: int = 200, session: Session = Depends(get_db)) -> list[dict]:
    return inventory_service.stored_transfers(session, limit=limit)


@router.get("/transfers/plan")
def transfer_plan(
    product_id: int | None = None,
    session: Session = Depends(get_db),
) -> list[dict]:
    """Non-persisting preview of feasible inter-warehouse transfers."""
    view = inventory_service.build_inventory_view(
        session, product_ids=[product_id] if product_id else None
    )
    plans = inventory_service.transfer_plan_for_view(session, view)
    if not plans:
        return []
    return [
        {
            "product_id": plan["product_id"],
            "sku": plan["destination_row"]["sku"],
            "destination_warehouse": plan["destination_row"]["warehouse_name"],
            "requested_quantity": plan["requested_quantity"],
            "allocated_quantity": plan["allocated_quantity"],
            "unmet_quantity": plan["unmet_quantity"],
            "feasible": plan["feasible"],
            "transfers": plan["transfers"],
            "explanation": plan["explanation"],
        }
        for plan in plans
    ]


@router.get("/alerts")
def alerts(session: Session = Depends(get_db)) -> dict:
    view = inventory_service.build_inventory_view(session)
    grouped: dict[str, list[dict]] = {}
    for row in view:
        if row["alert_level"] == "ok":
            continue
        grouped.setdefault(row["alert_level"], []).append(
            {
                "sku": row["sku"],
                "product_name": row["product_name"],
                "warehouse_code": row["warehouse_code"],
                "available_stock": row["available_stock"],
                "reorder_point": row["reorder_point"],
                "explanation": row["explanation"],
            }
        )
    if not grouped:
        raise HTTPException(status_code=404, detail="No inventory alerts are active.")
    return grouped
