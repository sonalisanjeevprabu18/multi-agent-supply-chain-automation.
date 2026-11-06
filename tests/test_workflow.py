"""Integration tests for the LangGraph orchestrator and persistence."""

from __future__ import annotations

import pytest
from sqlalchemy import select

from agents.graph import graph_definition, route_after_disruption
from agents.orchestrator import run_workflow
from backend.models.models import (
    AgentExecution,
    AgentLog,
    PurchaseOrder,
    SupplierDisruption,
    WarehouseTransfer,
    WorkflowResult,
)
from backend.services import agent_service


def _create(session, scenario: str, focus=None, warehouse=None) -> AgentExecution:
    return agent_service.create_execution(
        session,
        scenario=scenario,
        horizon_days=14,
        service_level=0.95,
        focus_product_id=focus,
        target_warehouse_id=warehouse,
        supplier_weights={"cost": 0.4, "lead_time": 0.3, "reliability": 0.3},
    )


def test_graph_definition_matches_spec():
    definition = graph_definition()
    node_ids = [node["id"] for node in definition["nodes"]]
    assert node_ids == [
        "demand_forecasting",
        "inventory_monitoring",
        "inventory_optimization",
        "procurement",
        "supplier_disruption",
        "logistics",
        "decision_verification",
    ]
    assert definition["entry"] == "demand_forecasting"


def test_conditional_routing():
    assert route_after_disruption({"recovery_required": True}) == "logistics"
    assert route_after_disruption({"recovery_required": False}) == "decision_verification"


def test_standard_workflow_persists_everything(session, trained_models):
    # ensure a clean disruption state so logistics is skipped
    for record in session.scalars(select(SupplierDisruption)).all():
        record.status = "resolved"
    session.commit()

    execution = _create(session, "standard_workflow")
    summary = run_workflow(session, execution.id)

    execution = session.get(AgentExecution, execution.id)
    assert execution.status == "completed"
    assert execution.finished_at is not None
    assert summary["products_forecasted"] >= 8
    assert summary["verification"]["approved"] is True

    logs = session.scalars(
        select(AgentLog).where(AgentLog.execution_id == execution.id)
    ).all()
    completed = [log.agent_name for log in logs if log.status == "completed"]
    assert completed == [
        "demand_forecasting_agent",
        "inventory_monitoring_agent",
        "inventory_optimization_agent",
        "procurement_agent",
        "supplier_disruption_agent",
        "decision_verification_agent",
    ]
    # the conditional edge skipped logistics
    assert "logistics_agent" not in completed

    result = session.scalars(
        select(WorkflowResult).where(WorkflowResult.execution_id == execution.id)
    ).first()
    assert result is not None
    assert result.summary["scenario"] == "standard_workflow"
    assert result.decisions is not None


def test_disruption_demo_runs_logistics_and_records_decision(session, trained_models):
    for record in session.scalars(select(SupplierDisruption)).all():
        record.status = "resolved"
    session.commit()

    execution = _create(session, "disruption_demo")
    summary = run_workflow(session, execution.id)

    logs = session.scalars(
        select(AgentLog).where(AgentLog.execution_id == execution.id)
    ).all()
    completed = [log.agent_name for log in logs if log.status == "completed"]
    assert "logistics_agent" in completed
    assert completed[-1] == "decision_verification_agent"
    assert summary["active_disruptions"] >= 1
    assert summary["transfers"] >= 1
    assert summary["recommended_actions"]

    # real rows were written by the workflow
    transfers = session.scalars(
        select(WarehouseTransfer).where(WarehouseTransfer.execution_id == execution.id)
    ).all()
    orders = session.scalars(
        select(PurchaseOrder).where(PurchaseOrder.execution_id == execution.id)
    ).all()
    assert transfers and orders
    assert all(t.quantity > 0 for t in transfers)


def test_workflow_retry_logs_failure(session, monkeypatch):
    """A crashing agent must be retried once and recorded as failed."""
    from agents.forecasting_agent import DemandForecastingAgent

    calls = {"n": 0}

    def boom(self, state):
        calls["n"] += 1
        raise RuntimeError("synthetic agent failure")

    monkeypatch.setattr(DemandForecastingAgent, "run", boom)
    execution = _create(session, "standard_workflow")

    from agents.orchestrator import OrchestrationError

    with pytest.raises(OrchestrationError):
        run_workflow(session, execution.id)

    session.expire_all()
    execution = session.get(AgentExecution, execution.id)
    assert execution.status == "failed"
    assert "synthetic agent failure" in execution.error
    assert calls["n"] == 2  # one retry

    logs = session.scalars(
        select(AgentLog).where(AgentLog.execution_id == execution.id)
    ).all()
    statuses = [log.status for log in logs]
    assert "failed" in statuses
    assert "retrying" in statuses


def test_cannot_run_same_execution_twice(session, trained_models):
    execution = _create(session, "standard_workflow")
    run_workflow(session, execution.id)
    with pytest.raises(Exception) as excinfo:
        run_workflow(session, execution.id)
    assert "already completed" in str(excinfo.value)


def test_workflow_requires_sales_history(monkeypatch):
    """Without history the execution fails cleanly instead of inventing data."""
    from agents import orchestrator

    monkeypatch.setattr(orchestrator, "max_sale_date", lambda session: None)
    with pytest.raises(Exception):
        # uses the real session but no latest sale date
        from backend.database.session import session_scope

        with session_scope() as scoped:
            execution = _create(scoped, "standard_workflow")
            orchestrator.run_workflow(scoped, execution.id)
