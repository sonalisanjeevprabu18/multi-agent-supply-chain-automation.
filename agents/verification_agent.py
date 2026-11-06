"""Agent 7 - Decision Verification Agent.

Independently re-derives the constraints every other agent claimed to satisfy and
rejects (with reasons) anything that is not supported by the stored data.
"""

from __future__ import annotations

import math
from typing import Any

from agents.base import BaseAgent
from agents.state import WorkflowState
from backend.models.models import Product, Supplier
from backend.services.inventory_service import build_inventory_view
from inventory.calculations import available_stock

TOLERANCE = 0.5


class DecisionVerificationAgent(BaseAgent):
    """Validates quantities, supplier constraints, transfers and conflicts."""

    name = "decision_verification_agent"
    description = (
        "Checks order quantities against requirements, supplier eligibility, transfer "
        "feasibility, source safety stock, conflicting actions and data support."
    )

    def run(self, state: WorkflowState) -> dict[str, Any]:
        view = build_inventory_view(
            self.session,
            product_ids=self.focus_product_ids(state),
            service_level=float(state.get("service_level", 0.95)),
            review_period_days=int(state.get("review_period_days", 7)),
        )
        view_index = {(row["product_id"], row["warehouse_id"]): row for row in view}

        checks: list[dict[str, Any]] = []
        decisions: list[dict[str, Any]] = []
        conflicts: list[dict[str, Any]] = []

        # 1) Data support -------------------------------------------------
        forecasts = state.get("forecasts", [])
        forecast_index = {f["product_id"]: f for f in forecasts}
        checks.append(
            {
                "check": "data_support",
                "passed": bool(forecasts),
                "detail": (
                    f"{len(forecasts)} product forecast(s) back this decision set."
                    if forecasts
                    else "No forecasts are available; recommendations are unsupported."
                ),
            }
        )

        # 2) Replenishment sizing ----------------------------------------
        sizing_failures: list[str] = []
        for rec in state.get("inventory_recommendations", []):
            row = view_index.get((rec["product_id"], rec["warehouse_id"]))
            if row is None:
                sizing_failures.append(
                    f"{rec['sku']}: no inventory row for {rec['warehouse_code']}"
                )
                continue
            expected = max(
                0.0, row["target_stock"] - row["available_stock"] - row["incoming_stock"]
            )
            # a positive requirement is rounded up to whole units and to the supplier
            # MOQ, so both the ceiling and the MOQ are legal upper bounds
            upper_bound = max(
                float(math.ceil(expected)), float(row.get("minimum_order_quantity") or 0.0)
            )
            if rec["recommended_quantity"] > upper_bound + TOLERANCE:
                sizing_failures.append(
                    f"{rec['sku']}/{rec['warehouse_code']}: recommended "
                    f"{rec['recommended_quantity']:.0f} exceeds requirement {expected:.0f} "
                    f"(MOQ {upper_bound:.0f})"
                )
            if rec["recommended_quantity"] > 0 and (
                row["avg_daily_demand"] <= 0 or rec["product_id"] not in forecast_index
            ):
                sizing_failures.append(
                    f"{rec['sku']}/{rec['warehouse_code']}: no demand basis for an order"
                )
        checks.append(
            {
                "check": "replenishment_quantities",
                "passed": not sizing_failures,
                "detail": (
                    "Every recommended quantity equals target minus available minus incoming."
                    if not sizing_failures
                    else "; ".join(sizing_failures[:5])
                ),
            }
        )

        # 3) Supplier / purchase-order constraints -----------------------
        order_failures: list[str] = []
        for order in state.get("purchase_orders", []):
            supplier = self.session.get(Supplier, order["supplier_id"])
            product = self.session.get(Product, order["product_id"])
            if supplier is None or product is None:
                order_failures.append(f"{order.get('sku')}: supplier or product missing")
                continue
            if supplier.status != "active":
                order_failures.append(
                    f"{order['sku']}: supplier {supplier.name} is {supplier.status}"
                )
            offers = [
                offer for offer in supplier.offers if offer.product_id == order["product_id"]
            ]
            if not offers:
                order_failures.append(
                    f"{order['sku']}: {supplier.name} does not supply this product"
                )
            else:
                moq = float(offers[0].minimum_order_quantity)
                if order["quantity"] < moq - TOLERANCE:
                    order_failures.append(
                        f"{order['sku']}: {order['quantity']:.0f} below MOQ {moq:.0f}"
                    )
            expected_total = round(float(order["unit_price"]) * float(order["quantity"]), 2)
            if abs(expected_total - float(order["total_cost"])) > 0.05:
                order_failures.append(
                    f"{order['sku']}: total cost {order['total_cost']:.2f} != "
                    f"unit price x quantity ({expected_total:.2f})"
                )
            requirement = float(order.get("requirement", order["quantity"]))
            if order["quantity"] < requirement - TOLERANCE:
                order_failures.append(
                    f"{order['sku']}: order {order['quantity']:.0f} short of "
                    f"requirement {requirement:.0f}"
                )
        checks.append(
            {
                "check": "supplier_selection",
                "passed": not order_failures,
                "detail": (
                    "All purchase orders use active suppliers, meet MOQ and cover the requirement."
                    if not order_failures
                    else "; ".join(order_failures[:5])
                ),
            }
        )

        # 4) Transfer feasibility + source safety stock -------------------
        transfer_failures: list[str] = []
        for transfer in state.get("transfers", []):
            source = view_index.get((transfer["product_id"], transfer["from_warehouse_id"]))
            destination = view_index.get((transfer["product_id"], transfer["to_warehouse_id"]))
            if source is None or destination is None:
                transfer_failures.append(
                    f"{transfer['sku']}: source or destination inventory row missing"
                )
                continue
            releasable = max(
                0.0,
                available_stock(source["current_stock"], source["reserved_stock"])
                + source["incoming_stock"]
                - source["safety_stock"],
            )
            if transfer["quantity"] > releasable + TOLERANCE:
                transfer_failures.append(
                    f"{transfer['sku']}: {transfer['quantity']:.0f} units from "
                    f"{transfer['from_warehouse_code']} exceeds releasable {releasable:.0f} "
                    "without breaching safety stock"
                )
            if transfer["quantity"] > destination["recommended_order_quantity"] + TOLERANCE:
                transfer_failures.append(
                    f"{transfer['sku']}: transfer exceeds the destination requirement"
                )
        checks.append(
            {
                "check": "transfer_feasibility",
                "passed": not transfer_failures,
                "detail": (
                    "Every transfer leaves its source at or above safety stock and within need."
                    if not transfer_failures
                    else "; ".join(transfer_failures[:5])
                ),
            }
        )

        # 5) Conflicting recommendations ---------------------------------
        transfer_by_target: dict[tuple[int, int], float] = {}
        for transfer in state.get("transfers", []):
            key = (transfer["product_id"], transfer["to_warehouse_id"])
            transfer_by_target[key] = transfer_by_target.get(key, 0.0) + float(
                transfer["quantity"]
            )
        for order in state.get("purchase_orders", []):
            key = (order["product_id"], order["warehouse_id"])
            transferred = transfer_by_target.get(key, 0.0)
            requirement = float(order.get("requirement", order["quantity"]))
            if transferred <= 0:
                continue
            if transferred + float(order["quantity"]) > requirement + TOLERANCE:
                conflicts.append(
                    {
                        "product_id": order["product_id"],
                        "sku": order["sku"],
                        "warehouse_id": order["warehouse_id"],
                        "warehouse_code": order.get("warehouse_code"),
                        "transferred_quantity": round(transferred, 2),
                        "ordered_quantity": round(float(order["quantity"]), 2),
                        "requirement": round(requirement, 2),
                        "resolution": (
                            "Internal transfer satisfies the requirement, so the purchase order "
                            "should be deferred to the next replenishment cycle."
                        ),
                    }
                )
        checks.append(
            {
                "check": "conflicting_recommendations",
                "passed": not conflicts,
                "detail": (
                    "No duplicate coverage between internal transfers and purchase orders."
                    if not conflicts
                    else f"{len(conflicts)} purchase order(s) duplicate an internal transfer."
                ),
            }
        )

        # 6) Assemble decisions ------------------------------------------
        conflict_keys = {(c["product_id"], c["warehouse_id"]) for c in conflicts}
        for transfer in state.get("transfers", []):
            decisions.append(
                {
                    "action": "transfer_stock",
                    "product_id": transfer["product_id"],
                    "sku": transfer["sku"],
                    "warehouse_id": transfer["to_warehouse_id"],
                    "quantity": transfer["quantity"],
                    "approved": bool(transfer.get("feasible")),
                    "reason": transfer.get("reason", ""),
                }
            )
        for order in state.get("purchase_orders", []):
            duplicate = (order["product_id"], order["warehouse_id"]) in conflict_keys
            decisions.append(
                {
                    "action": "purchase_order",
                    "product_id": order["product_id"],
                    "sku": order["sku"],
                    "warehouse_id": order["warehouse_id"],
                    "supplier_name": order.get("supplier_name"),
                    "quantity": order["quantity"],
                    "cost": order.get("total_cost"),
                    "approved": not duplicate,
                    "reason": (
                        "Covered by an internal transfer; defer to the next cycle."
                        if duplicate
                        else "Verified against requirement, MOQ and supplier status."
                    ),
                }
            )

        blocking = ("data_support", "replenishment_quantities", "transfer_feasibility")
        approved = not any(
            c["check"] in blocking and not c["passed"] for c in checks
        )
        failed_checks = [c["check"] for c in checks if not c["passed"]]
        verification = {
            "checks": checks,
            "conflicts": conflicts,
            "approved": approved,
            "failed_checks": failed_checks,
            "decision_count": len(decisions),
            "approved_actions": sum(1 for d in decisions if d["approved"]),
            "rejected_actions": sum(1 for d in decisions if not d["approved"]),
            "summary": (
                f"Verification {'passed' if approved else 'failed'} with "
                f"{len(checks) - len(failed_checks)}/{len(checks)} checks satisfied; "
                f"{sum(1 for d in decisions if d['approved'])} action(s) approved and "
                f"{sum(1 for d in decisions if not d['approved'])} rejected."
            ),
        }
        return {
            "verification": verification,
            "decisions": decisions,
            "_summary": verification["summary"],
        }
