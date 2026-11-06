"""Agent 5 - Supplier Disruption Agent."""

from __future__ import annotations

from typing import Any

from agents.base import AgentError, BaseAgent
from agents.state import WorkflowState
from backend.services import procurement_service


class SupplierDisruptionAgent(BaseAgent):
    """Detects supplier disruptions, quantifies their impact and sets recovery needs."""

    name = "supplier_disruption_agent"
    description = (
        "Reads active disruption events, simulates one for the demonstration scenario, "
        "and assesses affected products, warehouses, stockout risk and alternatives."
    )

    def run(self, state: WorkflowState) -> dict[str, Any]:
        active = procurement_service.active_disruptions(self.session)
        simulated = False

        if state.get("scenario") == "disruption_demo" and not active:
            active = self._simulate_demo_disruption(state)
            simulated = bool(active)

        if not active:
            return {
                "disruptions": [],
                "disruption_assessment": [],
                "recovery_required": False,
                "metrics": {**state.get("metrics", {}), "active_disruptions": 0},
                "_summary": (
                    "No active supplier disruption detected; recovery actions and "
                    "logistics transfers are skipped for this run."
                ),
            }

        assessments: list[dict[str, Any]] = []
        for disruption in active:
            try:
                assessment = procurement_service.assess_disruption(
                    self.session, disruption, weights=state.get("supplier_weights")
                )
            except procurement_service.ProcurementError as exc:
                raise AgentError(str(exc)) from exc
            assessments.append(assessment)

        recovery_required = any(a["recovery"]["recovery_needed"] for a in assessments)
        compact_assessments = [
            {
                "disruption_id": a["disruption"]["id"],
                "supplier_id": a["disruption"]["supplier_id"],
                "supplier_name": a["disruption"]["supplier_name"],
                "sku": a["disruption"].get("sku"),
                "disruption_type": a["disruption"]["disruption_type"],
                "delay_days": a["disruption"]["delay_days"],
                "severity": a["disruption"]["severity"],
                "overall_stockout_risk": a["overall_stockout_risk"],
                "affected_products": a["affected_products"],
                "affected_warehouses": a["affected_warehouses"],
                "alternative_suppliers": [
                    {
                        "supplier_id": alt["supplier_id"],
                        "supplier_name": alt["supplier_name"],
                        "score": alt["score"],
                        "eligible": alt["eligible"],
                        "lead_time_days": alt["lead_time_days"],
                        "unit_price": alt["unit_price"],
                    }
                    for alt in a["alternative_suppliers"][:3]
                ],
                "transfer_suggestion": a["transfer_suggestion"],
                "recovery": a["recovery"],
                "summary": a["summary"],
            }
            for a in assessments
        ]
        risk_rank = {"unknown": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
        worst_risk = max(
            (a["overall_stockout_risk"] for a in assessments),
            key=lambda r: risk_rank.get(r, 0),
        )
        summary = (
            f"Assessed {len(assessments)} active disruption(s); highest stockout risk is "
            f"{worst_risk}. Recovery needed: {'yes' if recovery_required else 'no'}."
        )
        if simulated:
            summary += " A supplier delay was simulated for the demonstration scenario."

        return {
            "disruptions": [a["disruption"] for a in assessments],
            "disruption_assessment": compact_assessments,
            "recovery_required": recovery_required,
            "metrics": {
                **state.get("metrics", {}),
                "active_disruptions": len(assessments),
                "worst_stockout_risk": worst_risk,
                "simulated_disruption": simulated,
            },
            "_summary": summary,
        }

    def _simulate_demo_disruption(self, state: WorkflowState) -> list[dict[str, Any]]:
        """Create one real (simulated) delay record for the demo scenario."""
        from backend.models.models import Product
        from backend.services.analytics import supplier_offers
        from procurement.supplier_selection import score_suppliers

        product_id = state.get("focus_product_id")
        if product_id is None:
            product = self.session.query(Product).order_by(Product.id).first()
            product_id = product.id if product else None
        if product_id is None:
            return []

        quantity = 0.0
        for recommendation in state.get("inventory_recommendations", []):
            if recommendation["product_id"] == product_id:
                quantity = max(quantity, recommendation["recommended_quantity"])

        offers = supplier_offers(self.session, int(product_id))
        if not offers:
            return []
        ranked = score_suppliers(offers, max(quantity, 1.0), state.get("supplier_weights"))
        best = next((o for o in ranked if o.get("eligible")), ranked[0])

        procurement_service.simulate_disruption(
            self.session,
            supplier_id=int(best["supplier_id"]),
            product_id=int(product_id),
            disruption_type="delivery_delay",
            delay_days=10,
            reliability_delta=-0.15,
            notes="Simulated 10-day delivery delay used by the demonstration scenario.",
            execution_id=state.get("execution_id"),
        )
        self.log(
            state,
            "simulated",
            f"Simulated a 10-day delivery delay for {best['supplier_name']} on "
            f"{best.get('sku', product_id)}.",
        )
        return procurement_service.active_disruptions(self.session)
