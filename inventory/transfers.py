"""Warehouse allocation and inter-warehouse transfer planning.

Transfer rule: a source warehouse may only give away stock above its own safety
stock. A destination only receives what it needs to reach its target level.
Every recommendation carries a machine-readable explanation.
"""

from __future__ import annotations

from typing import Any, Iterable

from inventory.calculations import available_stock, target_stock_level


def transferable_surplus(
    *,
    current_stock: float,
    reserved_stock: float,
    safety_stock_units: float,
    incoming_stock: float = 0.0,
) -> float:
    """Units a warehouse can release without breaching its own safety stock."""
    available = available_stock(current_stock, reserved_stock) + max(0.0, incoming_stock)
    return max(0.0, available - max(0.0, safety_stock_units))


def plan_transfer(
    *,
    product_id: str,
    destination_warehouse_id: str,
    destination_need: float,
    sources: Iterable[dict[str, Any]],
) -> dict[str, Any]:
    """Pick the best source warehouse(s) for a destination shortfall.

    ``sources`` items must contain ``warehouse_id``, ``current_stock``,
    ``reserved_stock``, ``safety_stock`` and optionally ``incoming_stock``.
    Surplus sources are consumed in descending order of releasable surplus.
    """
    need = max(0.0, float(destination_need))
    candidates: list[dict[str, Any]] = []
    for source in sources:
        if str(source.get("warehouse_id")) == str(destination_warehouse_id):
            continue
        surplus = transferable_surplus(
            current_stock=float(source.get("current_stock", 0.0)),
            reserved_stock=float(source.get("reserved_stock", 0.0)),
            safety_stock_units=float(source.get("safety_stock", 0.0)),
            incoming_stock=float(source.get("incoming_stock", 0.0)),
        )
        if surplus <= 0:
            continue
        candidates.append(
            {
                "warehouse_id": source["warehouse_id"],
                "warehouse_name": source.get("warehouse_name", source["warehouse_id"]),
                "transferable_quantity": round(surplus, 2),
                "safety_stock_after": round(float(source.get("safety_stock", 0.0)), 2),
            }
        )

    candidates.sort(key=lambda c: c["transferable_quantity"], reverse=True)

    allocations: list[dict[str, Any]] = []
    remaining = need
    for candidate in candidates:
        if remaining <= 0:
            break
        quantity = min(candidate["transferable_quantity"], remaining)
        if quantity <= 0:
            continue
        allocations.append(
            {
                "from_warehouse_id": candidate["warehouse_id"],
                "from_warehouse_name": candidate["warehouse_name"],
                "quantity": round(quantity, 2),
                "source_retains_safety_stock": True,
            }
        )
        remaining -= quantity

    allocated = sum(a["quantity"] for a in allocations)
    return {
        "product_id": product_id,
        "to_warehouse_id": destination_warehouse_id,
        "requested_quantity": round(need, 2),
        "allocated_quantity": round(allocated, 2),
        "unmet_quantity": round(max(0.0, remaining), 2),
        "feasible": allocated > 0 and remaining <= 0,
        "partially_feasible": allocated > 0 and remaining > 0,
        "transfers": allocations,
        "explanation": _explain(allocations, remaining, destination_warehouse_id),
    }


def _explain(allocations: list[dict[str, Any]], remaining: float, destination: str) -> str:
    if not allocations:
        return (
            f"No source warehouse holds surplus above its safety stock, so no transfer "
            f"into {destination} is feasible."
        )
    parts = ", ".join(
        f"{a['quantity']:.0f} units from {a['from_warehouse_name']}" for a in allocations
    )
    text = f"Transfer {parts} into {destination} while every source keeps its safety stock."
    if remaining > 0:
        text += f" A shortfall of {remaining:.0f} units remains and must be procured."
    return text


def allocate_demand(
    *,
    product_id: str,
    requested_quantity: float,
    warehouses: list[dict[str, Any]],
    preserve_safety_stock: bool = False,
) -> dict[str, Any]:
    """Distribute a demand across warehouses, largest-available first.

    Used when a customer order must be fulfilled from multiple locations and by
    the logistics agent when evaluating alternative fulfilment options.
    """
    requested = max(0.0, float(requested_quantity))
    ranked: list[dict[str, Any]] = []
    for warehouse in warehouses:
        available = available_stock(
            float(warehouse.get("current_stock", 0.0)),
            float(warehouse.get("reserved_stock", 0.0)),
        )
        if preserve_safety_stock:
            available = max(0.0, available - float(warehouse.get("safety_stock", 0.0)))
        ranked.append(
            {
                "warehouse_id": warehouse.get("warehouse_id"),
                "warehouse_name": warehouse.get("warehouse_name", warehouse.get("warehouse_id")),
                "allocatable": round(available, 2),
            }
        )
    ranked.sort(key=lambda w: w["allocatable"], reverse=True)

    remaining = requested
    allocation: list[dict[str, Any]] = []
    for warehouse in ranked:
        if remaining <= 0:
            break
        quantity = min(warehouse["allocatable"], remaining)
        if quantity <= 0:
            continue
        allocation.append(
            {
                "warehouse_id": warehouse["warehouse_id"],
                "warehouse_name": warehouse["warehouse_name"],
                "quantity": round(quantity, 2),
            }
        )
        remaining -= quantity

    return {
        "product_id": product_id,
        "requested_quantity": round(requested, 2),
        "allocated_quantity": round(requested - remaining, 2),
        "unmet_quantity": round(max(0.0, remaining), 2),
        "fully_allocated": remaining <= 0,
        "allocation": allocation,
    }


def replenishment_target(
    *,
    avg_daily_demand: float,
    lead_time_days: float,
    review_period_days: float,
    safety_stock_units: float,
) -> float:
    """Thin wrapper kept so agents share one target-stock definition."""
    return target_stock_level(
        avg_daily_demand, lead_time_days, review_period_days, safety_stock_units
    )
