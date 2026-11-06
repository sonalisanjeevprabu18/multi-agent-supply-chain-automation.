"""LangGraph wiring for the multi-agent workflow.

START -> demand forecasting -> inventory monitoring -> inventory optimization
      -> procurement -> supplier disruption -+-> logistics -> verification -> END
                                             +-> verification -> END
"""

from __future__ import annotations

from typing import Any, Callable

from langgraph.graph import END, START, StateGraph
from sqlalchemy.orm import Session

from agents.base import TimedAgent
from agents.disruption_agent import SupplierDisruptionAgent
from agents.forecasting_agent import DemandForecastingAgent
from agents.inventory_agent import InventoryMonitoringAgent
from agents.logistics_agent import LogisticsAgent
from agents.optimization_agent import InventoryOptimizationAgent
from agents.procurement_agent import ProcurementAgent
from agents.state import WorkflowState
from agents.verification_agent import DecisionVerificationAgent

NODE_FORECAST = "demand_forecasting"
NODE_MONITOR = "inventory_monitoring"
NODE_OPTIMIZE = "inventory_optimization"
NODE_PROCUREMENT = "procurement"
NODE_DISRUPTION = "supplier_disruption"
NODE_LOGISTICS = "logistics"
NODE_VERIFICATION = "decision_verification"


def route_after_disruption(state: WorkflowState) -> str:
    """Skip logistics when no recovery action is required."""
    return NODE_LOGISTICS if state.get("recovery_required") else NODE_VERIFICATION


def build_workflow(session: Session) -> Callable[[WorkflowState], WorkflowState]:
    """Compile the LangGraph workflow bound to one database session."""
    builder = StateGraph(WorkflowState)

    builder.add_node(NODE_FORECAST, TimedAgent(DemandForecastingAgent(session)))
    builder.add_node(NODE_MONITOR, TimedAgent(InventoryMonitoringAgent(session)))
    builder.add_node(NODE_OPTIMIZE, TimedAgent(InventoryOptimizationAgent(session)))
    builder.add_node(NODE_PROCUREMENT, TimedAgent(ProcurementAgent(session)))
    builder.add_node(NODE_DISRUPTION, TimedAgent(SupplierDisruptionAgent(session)))
    builder.add_node(NODE_LOGISTICS, TimedAgent(LogisticsAgent(session)))
    builder.add_node(NODE_VERIFICATION, TimedAgent(DecisionVerificationAgent(session)))

    builder.add_edge(START, NODE_FORECAST)
    builder.add_edge(NODE_FORECAST, NODE_MONITOR)
    builder.add_edge(NODE_MONITOR, NODE_OPTIMIZE)
    builder.add_edge(NODE_OPTIMIZE, NODE_PROCUREMENT)
    builder.add_edge(NODE_PROCUREMENT, NODE_DISRUPTION)
    builder.add_conditional_edges(
        NODE_DISRUPTION,
        route_after_disruption,
        {NODE_LOGISTICS: NODE_LOGISTICS, NODE_VERIFICATION: NODE_VERIFICATION},
    )
    builder.add_edge(NODE_LOGISTICS, NODE_VERIFICATION)
    builder.add_edge(NODE_VERIFICATION, END)

    graph = builder.compile()
    return graph.invoke


def graph_definition() -> dict[str, Any]:
    """Machine-readable description of the graph (used by /api/agents/graph)."""
    return {
        "entry": NODE_FORECAST,
        "nodes": [
            {"id": NODE_FORECAST, "agent": "demand_forecasting_agent", "label": "Demand Forecasting"},
            {"id": NODE_MONITOR, "agent": "inventory_monitoring_agent", "label": "Inventory Monitoring"},
            {"id": NODE_OPTIMIZE, "agent": "inventory_optimization_agent", "label": "Inventory Optimization"},
            {"id": NODE_PROCUREMENT, "agent": "procurement_agent", "label": "Procurement"},
            {"id": NODE_DISRUPTION, "agent": "supplier_disruption_agent", "label": "Supplier Disruption"},
            {"id": NODE_LOGISTICS, "agent": "logistics_agent", "label": "Logistics"},
            {"id": NODE_VERIFICATION, "agent": "decision_verification_agent", "label": "Decision Verification"},
        ],
        "edges": [
            [NODE_FORECAST, NODE_MONITOR],
            [NODE_MONITOR, NODE_OPTIMIZE],
            [NODE_OPTIMIZE, NODE_PROCUREMENT],
            [NODE_PROCUREMENT, NODE_DISRUPTION],
            [NODE_DISRUPTION, NODE_LOGISTICS, "recovery_required == true"],
            [NODE_DISRUPTION, NODE_VERIFICATION, "recovery_required == false"],
            [NODE_LOGISTICS, NODE_VERIFICATION],
            [NODE_VERIFICATION, "END"],
        ],
    }
