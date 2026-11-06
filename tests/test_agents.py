"""Tests for the specialized agents (real DB reads, real business logic)."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

from agents.disruption_agent import SupplierDisruptionAgent
from agents.forecasting_agent import DemandForecastingAgent
from agents.inventory_agent import InventoryMonitoringAgent
from agents.logistics_agent import LogisticsAgent
from agents.optimization_agent import InventoryOptimizationAgent
from agents.procurement_agent import ProcurementAgent
from agents.state import initial_state
from agents.verification_agent import DecisionVerificationAgent
from backend.models.models import AgentExecution, Product, SupplierDisruption
from backend.services import agent_service


def _execution(session) -> AgentExecution:
    execution = agent_service.create_execution(
        session,
        scenario="standard_workflow",
        horizon_days=7,
        service_level=0.95,
        focus_product_id=None,
        target_warehouse_id=None,
        supplier_weights={"cost": 0.4, "lead_time": 0.3, "reliability": 0.3},
    )
    return execution


def _state(execution: AgentExecution) -> dict:
    return initial_state(
        execution_id=execution.id,
        scenario=execution.scenario,
        horizon_days=execution.horizon_days,
        service_level=execution.service_level,
        review_period_days=7,
        supplier_weights={"cost": 0.4, "lead_time": 0.3, "reliability": 0.3},
        focus_product_id=None,
        target_warehouse_id=None,
        as_of="2026-10-31",
    )


def test_forecasting_agent_persists_forecasts(session, trained_models):
    from agents.base import TimedAgent

    execution = _execution(session)
    # the graph always runs agents through TimedAgent (logging + retry)
    update = TimedAgent(DemandForecastingAgent(session))(_state(execution))

    assert len(update["forecasts"]) >= 8
    with_predictions = [f for f in update["forecasts"] if f["predictions"]]
    assert len(with_predictions) >= 8
    assert all(f["model"] for f in with_predictions)
    # logs are persisted with the execution id
    logs = agent_service.logs_for(session, execution.id)
    assert logs and logs[0]["agent_name"] == "demand_forecasting_agent"
    assert logs[-1]["status"] == "completed"
    assert "_summary" not in update


def test_inventory_agent_reports_alerts(session, trained_models):
    execution = _execution(session)
    update = InventoryMonitoringAgent(session).run(_state(execution))
    status = update["inventory_status"]
    assert len(status) == 24
    assert {"critical", "low", "ok", "overstock"} & {row["alert_level"] for row in status}
    assert any(row["alert_level"] in ("critical", "stockout") for row in status)


def test_optimization_agent_computes_and_persists(session):
    execution = _execution(session)
    update = InventoryOptimizationAgent(session).run(_state(execution))
    recommendations = update["inventory_recommendations"]
    assert recommendations, "demo data must produce at least one replenishment need"
    first = recommendations[0]
    assert first["safety_stock"] > 0
    assert first["reorder_point"] >= first["safety_stock"]
    assert first["recommended_quantity"] > 0
    assert "Target stock" in first["explanation"]


def test_procurement_agent_generates_valid_orders(session):
    execution = _execution(session)
    agent = ProcurementAgent(session)
    state = _state(execution)
    state.update(InventoryOptimizationAgent(session).run(state))
    update = agent.run(state)

    assert update["purchase_orders"], "replenishment needs must produce purchase orders"
    order = update["purchase_orders"][0]
    assert order["quantity"] > 0
    assert order["total_cost"] == pytest.approx(order["unit_price"] * order["quantity"])
    assert order["expected_delivery_date"] >= order["order_date"]
    assert order["supplier_name"]
    assert update["supplier_rankings"][0]["ranked_suppliers"]


def test_procurement_agent_skips_when_no_need(session):
    execution = _execution(session)
    update = ProcurementAgent(session).run(_state(execution))
    assert update["purchase_orders"] == []
    assert "no procurement was needed" in update["_summary"]


def test_logistics_agent_recommends_transfers(session):
    execution = _execution(session)
    update = LogisticsAgent(session).run(_state(execution))
    assert update["transfers"], "warehouse 2/3 hold surplus and should feed warehouse 1"
    transfer = update["transfers"][0]
    assert transfer["quantity"] > 0
    assert transfer["from_warehouse_id"] != transfer["to_warehouse_id"]
    assert "safety stock" in transfer["reason"]


def test_disruption_agent_no_disruption_skips_recovery(session):
    # resolve any disruptions left by other tests
    for record in session.scalars(select(SupplierDisruption)).all():
        record.status = "resolved"
    session.commit()

    execution = _execution(session)
    update = SupplierDisruptionAgent(session).run(_state(execution))
    assert update["disruptions"] == []
    assert update["recovery_required"] is False


def test_disruption_agent_simulates_for_demo_scenario(session):
    for record in session.scalars(select(SupplierDisruption)).all():
        record.status = "resolved"
    session.commit()

    execution = _execution(session)
    state = _state(execution)
    state["scenario"] = "disruption_demo"
    product = session.scalars(select(Product).where(Product.sku == "P001")).one()
    state["focus_product_id"] = product.id

    update = SupplierDisruptionAgent(session).run(state)
    assert update["disruptions"], "the demo scenario must create a disruption"
    assert update["disruption_assessment"][0]["affected_warehouses"]
    assert update["recovery_required"] is True
    assert update["metrics"]["simulated_disruption"] is True

    record = session.scalars(
        select(SupplierDisruption).order_by(SupplierDisruption.id.desc())
    ).first()
    assert record.delay_days == 10
    assert record.status == "active"


def test_verification_agent_approves_and_flags_conflicts(session, trained_models):
    execution = _execution(session)
    state = _state(execution)
    state.update(DemandForecastingAgent(session).run(state))
    state.update(InventoryMonitoringAgent(session).run(state))
    state.update(InventoryOptimizationAgent(session).run(state))
    state.update(ProcurementAgent(session).run(state))
    state.update(LogisticsAgent(session).run(state))

    update = DecisionVerificationAgent(session).run(state)
    verification = update["verification"]
    checks = {check["check"]: check for check in verification["checks"]}
    assert set(checks) == {
        "data_support",
        "replenishment_quantities",
        "supplier_selection",
        "transfer_feasibility",
        "conflicting_recommendations",
    }
    assert checks["data_support"]["passed"] is True
    assert checks["replenishment_quantities"]["passed"] is True
    assert checks["transfer_feasibility"]["passed"] is True
    assert update["decisions"]
    # transfers and purchase orders covering the same need are surfaced as conflicts
    if verification["conflicts"]:
        rejected = [d for d in update["decisions"] if not d["approved"]]
        assert rejected
        assert "internal transfer" in verification["conflicts"][0]["resolution"].lower()


def test_verification_rejects_unsupported_state(session):
    """A state with an order but no forecast must fail verification."""
    execution = _execution(session)
    state = _state(execution)
    state["purchase_orders"] = []
    state["inventory_recommendations"] = []
    state["transfers"] = []
    update = DecisionVerificationAgent(session).run(state)
    checks = {c["check"]: c for c in update["verification"]["checks"]}
    assert checks["data_support"]["passed"] is False
    assert update["verification"]["approved"] is False
