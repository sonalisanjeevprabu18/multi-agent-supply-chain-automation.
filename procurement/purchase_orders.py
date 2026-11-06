"""Purchase-order recommendation generation.

Orders produced here are **simulated planning records only** - no real purchase
is ever transmitted to a supplier.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Any


class PurchaseOrderError(ValueError):
    """Raised when a purchase order cannot be validated."""


def expected_delivery_date(order_date: date, lead_time_days: float) -> date:
    return order_date + timedelta(days=int(round(max(0.0, lead_time_days))))


def build_purchase_order(
    *,
    product_id: str,
    product_name: str,
    warehouse_id: str,
    warehouse_name: str,
    quantity: float,
    supplier: dict[str, Any],
    order_date: date | None = None,
    maximum_capacity: float | None = None,
    incoming_stock: float = 0.0,
    available_stock: float = 0.0,
) -> dict[str, Any]:
    """Build and validate one simulated purchase-order recommendation."""
    order_date = order_date or date.today()
    quantity = float(quantity)
    if quantity <= 0:
        raise PurchaseOrderError("quantity must be greater than zero")

    moq = float(supplier.get("minimum_order_quantity") or 0.0)
    if moq and quantity < moq:
        raise PurchaseOrderError(
            f"quantity {quantity:.0f} is below the supplier minimum order quantity {moq:.0f}"
        )
    if maximum_capacity is not None:
        projected = float(available_stock) + float(incoming_stock) + quantity
        if projected > float(maximum_capacity):
            raise PurchaseOrderError(
                f"quantity {quantity:.0f} would push stock to {projected:.0f}, above "
                f"warehouse capacity {float(maximum_capacity):.0f}"
            )

    unit_price = float(supplier.get("unit_price") or 0.0)
    lead_time = float(supplier.get("lead_time_days") or 0.0)
    return {
        "product_id": product_id,
        "product_name": product_name,
        "warehouse_id": warehouse_id,
        "warehouse_name": warehouse_name,
        "supplier_id": supplier.get("supplier_id"),
        "supplier_name": supplier.get("supplier_name"),
        "quantity": round(quantity, 2),
        "unit_price": round(unit_price, 4),
        "total_cost": round(unit_price * quantity, 2),
        "lead_time_days": lead_time,
        "order_date": order_date.isoformat(),
        "expected_delivery_date": expected_delivery_date(order_date, lead_time).isoformat(),
        "status": "recommended",
        "supplier_score": supplier.get("score"),
        "explanation": (
            f"Order {quantity:.0f} units of {product_name} for {warehouse_name} from "
            f"{supplier.get('supplier_name')} at {unit_price:.2f}/unit "
            f"(estimated total {unit_price * quantity:.2f}), delivery in "
            f"{lead_time:.0f} day(s)."
        ),
    }


def consolidate_orders(orders: list[dict[str, Any]]) -> dict[str, Any]:
    """Aggregate a set of recommendations for reporting."""
    if not orders:
        return {
            "order_count": 0,
            "total_cost": 0.0,
            "supplier_count": 0,
            "orders": [],
        }
    suppliers = {o.get("supplier_id") for o in orders}
    return {
        "order_count": len(orders),
        "total_cost": round(sum(float(o.get("total_cost", 0.0)) for o in orders), 2),
        "supplier_count": len(suppliers),
        "orders": orders,
    }


def validate_order_against_requirement(
    order: dict[str, Any], required_quantity: float, tolerance: float = 0.05
) -> dict[str, Any]:
    """Verification helper: does the order actually cover the requirement?"""
    quantity = float(order.get("quantity", 0.0))
    required = float(required_quantity)
    shortfall = max(0.0, required - quantity)
    covered = shortfall <= max(tolerance * required, 1e-9)
    return {
        "covered": covered,
        "required_quantity": round(required, 2),
        "ordered_quantity": round(quantity, 2),
        "shortfall": round(shortfall, 2),
        "reason": (
            "Order quantity covers the replenishment requirement."
            if covered
            else f"Order is short by {shortfall:.0f} units against the requirement."
        ),
    }
