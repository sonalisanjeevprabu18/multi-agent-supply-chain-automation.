"""Typed shared state passed between LangGraph agents."""

from __future__ import annotations

from typing import Any, TypedDict


class WorkflowState(TypedDict, total=False):
    """Shared state for the multi-agent workflow.

    Every agent reads the keys produced by the agents before it and appends its
    own results; nothing is mutated in place, which keeps the graph replayable.
    """

    execution_id: str
    scenario: str
    as_of: str
    horizon_days: int
    service_level: float
    review_period_days: int
    supplier_weights: dict[str, float]
    focus_product_id: int | None
    target_warehouse_id: int | None

    forecasts: list[dict[str, Any]]
    inventory_status: list[dict[str, Any]]
    inventory_recommendations: list[dict[str, Any]]
    supplier_rankings: list[dict[str, Any]]
    purchase_orders: list[dict[str, Any]]
    disruptions: list[dict[str, Any]]
    disruption_assessment: list[dict[str, Any]]
    recovery_required: bool
    transfers: list[dict[str, Any]]

    verification: dict[str, Any]
    decisions: list[dict[str, Any]]
    errors: list[str]
    metrics: dict[str, Any]


AGENT_SEQUENCE: tuple[str, ...] = (
    "demand_forecasting_agent",
    "inventory_monitoring_agent",
    "inventory_optimization_agent",
    "procurement_agent",
    "supplier_disruption_agent",
    "logistics_agent",
    "decision_verification_agent",
)


def initial_state(
    *,
    execution_id: str,
    scenario: str,
    horizon_days: int,
    service_level: float,
    review_period_days: int,
    supplier_weights: dict[str, float],
    focus_product_id: int | None,
    target_warehouse_id: int | None,
    as_of: str,
) -> WorkflowState:
    """Build a fresh state object for one execution."""
    return WorkflowState(
        execution_id=execution_id,
        scenario=scenario,
        as_of=as_of,
        horizon_days=horizon_days,
        service_level=service_level,
        review_period_days=review_period_days,
        supplier_weights=supplier_weights,
        focus_product_id=focus_product_id,
        target_warehouse_id=target_warehouse_id,
        forecasts=[],
        inventory_status=[],
        inventory_recommendations=[],
        supplier_rankings=[],
        purchase_orders=[],
        disruptions=[],
        disruption_assessment=[],
        recovery_required=False,
        transfers=[],
        verification={},
        decisions=[],
        errors=[],
        metrics={},
    )
