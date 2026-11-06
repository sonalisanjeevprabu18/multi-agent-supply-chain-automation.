"""Agent 2 - Inventory Monitoring Agent."""

from __future__ import annotations

from typing import Any

from agents.base import AgentError, BaseAgent, jsonable
from agents.state import WorkflowState
from backend.services.inventory_service import build_inventory_view


class InventoryMonitoringAgent(BaseAgent):
    """Identifies shortages, surplus and stockout risk from live stock + forecasts."""

    name = "inventory_monitoring_agent"
    description = (
        "Compares current stock with forecast demand and flags critical stock, "
        "low stock, overstock and stockout risk per warehouse."
    )

    def run(self, state: WorkflowState) -> dict[str, Any]:
        view = build_inventory_view(
            self.session,
            warehouse_id=state.get("target_warehouse_id"),
            product_ids=self.focus_product_ids(state),
            service_level=float(state.get("service_level", 0.95)),
            review_period_days=int(state.get("review_period_days", 7)),
        )
        if not view:
            raise AgentError("No inventory records exist for the requested scope.")

        status = [
            {
                "product_id": row["product_id"],
                "sku": row["sku"],
                "product_name": row["product_name"],
                "warehouse_id": row["warehouse_id"],
                "warehouse_code": row["warehouse_code"],
                "warehouse_name": row["warehouse_name"],
                "current_stock": row["current_stock"],
                "available_stock": row["available_stock"],
                "incoming_stock": row["incoming_stock"],
                "avg_daily_demand": row["avg_daily_demand"],
                "demand_source": row["demand_source"],
                "days_of_cover": row["days_of_cover"],
                "alert_level": row["alert_level"],
                "stockout_risk": row["stockout_risk"],
                "explanation": row["explanation"],
            }
            for row in view
        ]
        counts = {
            level: sum(1 for row in status if row["alert_level"] == level)
            for level in ("stockout", "critical", "low", "overstock", "ok")
        }
        summary = (
            f"Monitored {len(status)} product/warehouse pairs: "
            f"{counts['stockout']} stockout, {counts['critical']} critical, "
            f"{counts['low']} low, {counts['overstock']} overstock, {counts['ok']} healthy."
        )
        return {
            "inventory_status": status,
            "metrics": {
                **state.get("metrics", {}),
                "inventory_alerts": counts,
                "stockout_risk_items": sum(1 for row in status if row["stockout_risk"]),
                "inventory_rows": jsonable(len(status)),
            },
            "_summary": summary,
        }
