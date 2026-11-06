"""Agent 4 - Procurement Agent."""

from __future__ import annotations

from typing import Any

from agents.base import AgentError, BaseAgent
from agents.state import WorkflowState
from backend.services import procurement_service


class ProcurementAgent(BaseAgent):
    """Ranks suppliers for each requirement and generates purchase-order recommendations."""

    name = "procurement_agent"
    description = (
        "Scores suppliers on normalised cost, lead time and reliability, then creates "
        "simulated purchase-order recommendations for every replenishment need."
    )

    def run(self, state: WorkflowState) -> dict[str, Any]:
        if not state.get("inventory_recommendations"):
            return {
                "purchase_orders": [],
                "supplier_rankings": [],
                "metrics": {
                    **state.get("metrics", {}),
                    "purchase_orders": 0,
                    "procurement_value": 0.0,
                },
                "_summary": "No replenishment requirement was raised, so no procurement was needed.",
            }

        result = procurement_service.generate_purchase_orders(
            self.session,
            warehouse_id=state.get("target_warehouse_id"),
            product_ids=self.focus_product_ids(state),
            service_level=float(state.get("service_level", 0.95)),
            review_period_days=int(state.get("review_period_days", 7)),
            weights=state.get("supplier_weights"),
            persist=True,
            execution_id=state.get("execution_id"),
        )

        if not result["orders"] and result["skipped"]:
            raise AgentError(
                "No purchase order could be created: "
                + "; ".join(f"{s['sku']}: {s['reason']}" for s in result["skipped"])
            )

        rankings = [
            {
                "product_id": ranking["product_id"],
                "sku": ranking["sku"],
                "quantity": ranking["quantity"],
                "ranked_suppliers": ranking["ranked_suppliers"][:3],
            }
            for ranking in result["rankings"]
        ]
        total_value = result["summary"]["total_cost"]
        top = result["orders"][0] if result["orders"] else None
        summary = (
            f"Generated {len(result['orders'])} purchase-order recommendation(s) worth "
            f"{total_value:.2f}."
        )
        if top:
            summary += (
                f" Top order: {top['quantity']:.0f} x {top['sku']} from "
                f"{top['supplier_name']} delivering {top['expected_delivery_date']}."
            )
        if result["skipped"]:
            summary += f" {len(result['skipped'])} requirement(s) were skipped (see log)."

        return {
            "purchase_orders": result["orders"],
            "supplier_rankings": rankings,
            "skipped_procurement": result["skipped"],
            "metrics": {
                **state.get("metrics", {}),
                "purchase_orders": len(result["orders"]),
                "procurement_value": total_value,
            },
            "_summary": summary,
        }
