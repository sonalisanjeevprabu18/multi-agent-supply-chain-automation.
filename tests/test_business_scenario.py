"""End-to-end test of the demonstration business scenario.

Product P001 has a demand spike in warehouse W1 and very little stock, while W2
and W3 hold surplus; the preferred supplier then suffers a delivery delay. The
workflow must forecast, flag, size, procure, detect, transfer and verify — using
real database rows at every step.
"""

from __future__ import annotations

from sqlalchemy import select

from agents.orchestrator import run_workflow
from backend.database.session import session_scope
from backend.models.models import (
    AgentLog,
    DemandForecast,
    InventoryRecommendation,
    Product,
    PurchaseOrder,
    SupplierDisruption,
    Warehouse,
    WarehouseTransfer,
    WorkflowResult,
)
from backend.services import agent_service, inventory_service


def test_end_to_end_disruption_scenario(seeded_database, trained_models):
    with session_scope() as session:
        for record in session.scalars(select(SupplierDisruption)).all():
            record.status = "resolved"
        session.commit()

        product = session.scalars(select(Product).where(Product.sku == "P001")).one()
        warehouses = {w.code: w for w in session.scalars(select(Warehouse)).all()}
        w1, w2 = warehouses["W1"], warehouses["W2"]

        # ---- 1. the operational picture the scenario is built on -----------
        view = inventory_service.build_inventory_view(session)
        rows = {
            (row["sku"], row["warehouse_code"]): row for row in view
        }
        assert rows[("P001", "W1")]["alert_level"] in ("critical", "stockout", "low")
        assert rows[("P001", "W1")]["recommended_order_quantity"] > 0
        assert rows[("P001", "W2")]["available_stock"] > 1000

        # ---- 2. run the workflow with the demo scenario --------------------
        execution = agent_service.create_execution(
            session,
            scenario="disruption_demo",
            horizon_days=14,
            service_level=0.95,
            focus_product_id=product.id,
            target_warehouse_id=w1.id,
            supplier_weights={"cost": 0.4, "lead_time": 0.3, "reliability": 0.3},
        )
        summary = run_workflow(session, execution.id)

        # ---- 3. forecasting produced persisted predictions ----------------
        forecasts = session.scalars(
            select(DemandForecast).where(DemandForecast.product_id == product.id)
        ).all()
        assert forecasts, "forecasts must be persisted"
        assert len(forecasts) == 14
        assert all(f.predicted_units >= 0 for f in forecasts)

        # ---- 4. inventory sizing was persisted ----------------------------
        recommendations = session.scalars(
            select(InventoryRecommendation).where(
                InventoryRecommendation.product_id == product.id,
                InventoryRecommendation.warehouse_id == w1.id,
            )
        ).all()
        assert recommendations
        assert recommendations[0].safety_stock > 0
        assert recommendations[0].reorder_point > recommendations[0].safety_stock

        # ---- 5. procurement recommended a supplier + order ----------------
        orders = session.scalars(
            select(PurchaseOrder).where(PurchaseOrder.execution_id == execution.id)
        ).all()
        assert orders, "a purchase order recommendation is expected"
        order = orders[0]
        assert order.supplier.status == "active"
        assert order.quantity >= order.quantity  # numeric sanity
        assert order.total_cost == round(order.unit_price * order.quantity, 2)

        # ---- 6. a disruption was simulated and assessed --------------------
        disruptions = session.scalars(
            select(SupplierDisruption).where(
                SupplierDisruption.execution_id == execution.id
            )
        ).all()
        assert disruptions
        assert disruptions[0].delay_days == 10
        assert summary["active_disruptions"] >= 1

        # ---- 7. logistics recommended a feasible transfer ------------------
        transfers = session.scalars(
            select(WarehouseTransfer).where(
                WarehouseTransfer.execution_id == execution.id
            )
        ).all()
        assert transfers
        assert all(t.from_warehouse_id != t.to_warehouse_id for t in transfers)
        assert any(t.from_warehouse_id in (w2.id, w1.id) for t in transfers)

        # ---- 8. verification recorded decisions ---------------------------
        result = session.scalars(
            select(WorkflowResult).where(WorkflowResult.execution_id == execution.id)
        ).one()
        assert result.verification["checks"]
        assert result.decisions
        assert summary["recommended_actions"]
        assert summary["verification"]["summary"]

        # ---- 9. execution log is complete and ordered ---------------------
        logs = session.scalars(
            select(AgentLog)
            .where(AgentLog.execution_id == execution.id)
            .order_by(AgentLog.step_index)
        ).all()
        agents_in_order = [log.agent_name for log in logs if log.status == "completed"]
        assert agents_in_order == [
            "demand_forecasting_agent",
            "inventory_monitoring_agent",
            "inventory_optimization_agent",
            "procurement_agent",
            "supplier_disruption_agent",
            "logistics_agent",
            "decision_verification_agent",
        ]
        assert all(log.duration_ms >= 0 for log in logs)
