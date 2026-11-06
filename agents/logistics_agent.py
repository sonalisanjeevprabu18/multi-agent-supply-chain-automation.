"""Agent 6 - Logistics Agent."""

from __future__ import annotations

from typing import Any

from agents.base import BaseAgent
from agents.state import WorkflowState
from backend.services.inventory_service import (
    build_inventory_view,
    persist_transfers,
    transfer_plan_for_view,
)


class LogisticsAgent(BaseAgent):
    """Evaluates inter-warehouse transfers and alternative fulfilment options."""

    name = "logistics_agent"
    description = (
        "Finds surplus stock in other warehouses and proposes transfers that keep every "
        "source warehouse at or above its safety stock."
    )

    def run(self, state: WorkflowState) -> dict[str, Any]:
        view = build_inventory_view(
            self.session,
            product_ids=self.focus_product_ids(state),
            service_level=float(state.get("service_level", 0.95)),
            review_period_days=int(state.get("review_period_days", 7)),
        )
        plans = transfer_plan_for_view(self.session, view)
        if not plans:
            return {
                "transfers": [],
                "metrics": {
                    **state.get("metrics", {}),
                    "transfers": 0,
                    "transfer_units": 0.0,
                },
                "_summary": (
                    "No warehouse holds surplus above its safety stock, so no transfer is "
                    "recommended; procurement remains the recovery path."
                ),
            }

        stored = persist_transfers(self.session, plans, state.get("execution_id"))
        total_units = round(sum(t["quantity"] for t in stored), 2)
        feasible = [t for t in stored if t["feasible"]]
        summary = (
            f"Recommended {len(stored)} transfer(s) totalling {total_units} units; "
            f"{len(feasible)} fully cover the destination requirement."
        )
        if stored:
            first = stored[0]
            summary += (
                f" Largest: {first['quantity']:.0f} units of {first['sku']} from "
                f"{first['from_warehouse_name']} to {first['to_warehouse_name']}."
            )
        return {
            "transfers": stored,
            "metrics": {
                **state.get("metrics", {}),
                "transfers": len(stored),
                "transfer_units": total_units,
                "fully_feasible_transfers": len(feasible),
            },
            "_summary": summary,
        }
