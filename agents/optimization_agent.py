"""Agent 3 - Inventory Optimization Agent."""

from __future__ import annotations

from typing import Any

from agents.base import BaseAgent
from agents.state import WorkflowState
from backend.services.inventory_service import build_inventory_view, persist_recommendations


class InventoryOptimizationAgent(BaseAgent):
    """Calculates safety stock, reorder points and replenishment quantities."""

    name = "inventory_optimization_agent"
    description = (
        "Applies ROP/safety-stock/recommended-order formulas to every stock row and "
        "persists the sizing recommendations."
    )

    def run(self, state: WorkflowState) -> dict[str, Any]:
        view = build_inventory_view(
            self.session,
            warehouse_id=state.get("target_warehouse_id"),
            product_ids=self.focus_product_ids(state),
            service_level=float(state.get("service_level", 0.95)),
            review_period_days=int(state.get("review_period_days", 7)),
        )
        persist_recommendations(self.session, view, state.get("execution_id"))

        recommendations = [
            {
                "product_id": row["product_id"],
                "sku": row["sku"],
                "product_name": row["product_name"],
                "warehouse_id": row["warehouse_id"],
                "warehouse_code": row["warehouse_code"],
                "warehouse_name": row["warehouse_name"],
                "available_stock": row["available_stock"],
                "incoming_stock": row["incoming_stock"],
                "avg_daily_demand": row["avg_daily_demand"],
                "safety_stock": row["safety_stock"],
                "reorder_point": row["reorder_point"],
                "target_stock": row["target_stock"],
                "recommended_quantity": row["recommended_order_quantity"],
                "lead_time_days": row["lead_time_days"],
                "minimum_order_quantity": row["minimum_order_quantity"],
                "max_capacity": row["max_capacity"],
                "alert_level": row["alert_level"],
                "explanation": (
                    row["explanation"]
                    + f" Target stock {row['target_stock']:.0f} covers "
                    f"{row['lead_time_days']:.0f}-day lead time plus review period; "
                    f"recommended order {row['recommended_order_quantity']:.0f} units."
                ),
            }
            for row in view
            if row["recommended_order_quantity"] > 0
        ]
        total_units = round(sum(r["recommended_quantity"] for r in recommendations), 2)
        summary = (
            f"Computed sizing for {len(view)} rows; {len(recommendations)} need "
            f"replenishment totalling {total_units} units at a "
            f"{float(state.get('service_level', 0.95)):.0%} service level."
        )
        return {
            "inventory_recommendations": recommendations,
            "metrics": {
                **state.get("metrics", {}),
                "replenishment_items": len(recommendations),
                "replenishment_units": total_units,
            },
            "_summary": summary,
        }
