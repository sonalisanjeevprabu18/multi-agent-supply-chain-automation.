"""Workflow orchestration: execution records, state hand-off, persistence."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from agents.graph import build_workflow
from agents.state import WorkflowState, initial_state
from backend.models.models import AgentExecution, WorkflowResult
from backend.services.analytics import max_sale_date

SCENARIOS = ("standard_workflow", "disruption_demo")


class OrchestrationError(RuntimeError):
    """Raised when the workflow cannot be started or completed."""


def summary_from_state(state: WorkflowState) -> dict[str, Any]:
    """Compact, JSON-safe summary persisted with the execution."""
    metrics = state.get("metrics", {})
    verification = state.get("verification", {})
    decisions = state.get("decisions", [])
    return {
        "scenario": state.get("scenario"),
        "horizon_days": state.get("horizon_days"),
        "as_of": state.get("as_of"),
        "products_forecasted": len(state.get("forecasts", [])),
        "inventory_alerts": metrics.get("inventory_alerts", {}),
        "replenishment_items": metrics.get("replenishment_items", 0),
        "replenishment_units": metrics.get("replenishment_units", 0.0),
        "purchase_orders": len(state.get("purchase_orders", [])),
        "procurement_value": metrics.get("procurement_value", 0.0),
        "active_disruptions": metrics.get("active_disruptions", 0),
        "worst_stockout_risk": metrics.get("worst_stockout_risk"),
        "transfers": len(state.get("transfers", [])),
        "transfer_units": metrics.get("transfer_units", 0.0),
        "verification": {
            "approved": verification.get("approved"),
            "failed_checks": verification.get("failed_checks", []),
            "summary": verification.get("summary"),
            "checks": verification.get("checks", []),
            "conflicts": verification.get("conflicts", []),
        },
        "decisions": decisions,
        "recommended_actions": [
            f"{d['action']} {d['quantity']:.0f} x {d['sku']}"
            for d in decisions
            if d.get("approved")
        ],
    }


def run_workflow(session: Session, execution_id: str) -> dict[str, Any]:
    """Execute the full agent graph for a persisted execution record."""
    execution = session.get(AgentExecution, execution_id)
    if execution is None:
        raise OrchestrationError(f"Execution {execution_id} does not exist.")
    if execution.status in ("completed", "failed", "running"):
        raise OrchestrationError(f"Execution {execution_id} is already {execution.status}.")

    latest_sale = max_sale_date(session)
    if latest_sale is None:
        execution.status = "failed"
        execution.error = "No sales history is available; upload data before running agents."
        execution.finished_at = datetime.now(timezone.utc)
        session.commit()
        raise OrchestrationError(execution.error)

    request_settings = execution.summary if isinstance(execution.summary, dict) else {}
    execution.status = "running"
    execution.started_at = datetime.now(timezone.utc)
    execution.error = None
    session.commit()

    state = initial_state(
        execution_id=execution_id,
        scenario=execution.scenario,
        horizon_days=int(execution.horizon_days),
        service_level=float(execution.service_level),
        review_period_days=int(request_settings.get("review_period_days", 7)),
        supplier_weights=request_settings.get(
            "supplier_weights", {"cost": 0.4, "lead_time": 0.3, "reliability": 0.3}
        ),
        focus_product_id=execution.focus_product_id,
        target_warehouse_id=request_settings.get("target_warehouse_id"),
        as_of=latest_sale.isoformat(),
    )

    invoke = build_workflow(session)
    try:
        final_state = invoke(state)
    except Exception as exc:  # noqa: BLE001 - failure is recorded for the API
        session.rollback()
        execution = session.get(AgentExecution, execution_id)
        execution.status = "failed"
        execution.error = str(exc)[:2000]
        execution.finished_at = datetime.now(timezone.utc)
        session.commit()
        raise OrchestrationError(str(exc)) from exc

    summary = summary_from_state(final_state)
    execution = session.get(AgentExecution, execution_id)
    execution.status = "completed"
    execution.current_agent = "decision_verification_agent"
    execution.finished_at = datetime.now(timezone.utc)
    execution.summary = summary

    existing = session.query(WorkflowResult).filter_by(execution_id=execution_id).first()
    if existing is None:
        session.add(
            WorkflowResult(
                execution_id=execution_id,
                status="completed",
                verification=summary.get("verification"),
                decisions=summary.get("decisions"),
                summary=summary,
            )
        )
    else:
        existing.status = "completed"
        existing.verification = summary.get("verification")
        existing.decisions = summary.get("decisions")
        existing.summary = summary
    session.commit()
    return summary


def demo_scenario_defaults(session: Session) -> dict[str, Any]:
    """Pick the demonstration focus: highest-risk product/warehouse pair."""
    from backend.models.models import Product
    from backend.services.inventory_service import build_inventory_view

    view = build_inventory_view(session)
    severity = {"stockout": 0, "critical": 1, "low": 2, "ok": 3, "overstock": 4}
    ranked = sorted(view, key=lambda row: severity.get(row["alert_level"], 5))
    if not ranked:
        product = session.query(Product).order_by(Product.id).first()
        return {
            "focus_product_id": product.id if product else None,
            "target_warehouse_id": None,
        }
    worst = ranked[0]
    if worst["alert_level"] in ("ok", "overstock"):
        product = session.query(Product).order_by(Product.id).first()
        return {
            "focus_product_id": product.id if product else None,
            "target_warehouse_id": None,
        }
    return {
        "focus_product_id": worst["product_id"],
        "target_warehouse_id": worst["warehouse_id"],
    }
