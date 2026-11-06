"""Multi-agent workflow endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from agents.graph import graph_definition
from agents.orchestrator import SCENARIOS, demo_scenario_defaults
from agents.runtime import dispatch
from backend.database.session import get_db
from backend.schemas.agents import AgentExecuteRequest
from backend.services import agent_service

router = APIRouter(prefix="/api/agents", tags=["agents"])


@router.post("/execute", status_code=202)
def execute(
    payload: AgentExecuteRequest,
    session: Session = Depends(get_db),
) -> dict:
    """Create an execution record and start the LangGraph workflow.

    Set ``wait_for_completion=true`` to block until the workflow finishes (this is
    the mode to use on serverless hosting, which cannot keep background threads).
    """
    if payload.scenario not in SCENARIOS:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown scenario '{payload.scenario}'. Expected one of {', '.join(SCENARIOS)}.",
        )
    execution = agent_service.create_execution(
        session,
        scenario=payload.scenario,
        horizon_days=payload.horizon_days,
        service_level=payload.service_level,
        focus_product_id=payload.focus_product_id,
        target_warehouse_id=payload.target_warehouse_id,
        supplier_weights=payload.supplier_weights,
    )
    try:
        dispatch(execution.id, wait=payload.wait_for_completion)
    except Exception as exc:  # noqa: BLE001 - surface orchestration failures
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    session.expire_all()
    record = agent_service.get_execution(session, execution.id)
    return agent_service.serialize_execution(session, record)


@router.post("/demo", status_code=202)
def execute_demo(
    horizon_days: int = 14,
    wait_for_completion: bool = True,
    session: Session = Depends(get_db),
) -> dict:
    """Run the end-to-end demonstration scenario (demand spike + supplier delay)."""
    defaults = demo_scenario_defaults(session)
    execution = agent_service.create_execution(
        session,
        scenario="disruption_demo",
        horizon_days=horizon_days,
        service_level=0.95,
        focus_product_id=defaults["focus_product_id"],
        target_warehouse_id=defaults["target_warehouse_id"],
        supplier_weights={"cost": 0.4, "lead_time": 0.3, "reliability": 0.3},
    )
    try:
        dispatch(execution.id, wait=wait_for_completion)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    session.expire_all()
    record = agent_service.get_execution(session, execution.id)
    return agent_service.serialize_execution(session, record)


@router.get("/graph")
def graph() -> dict:
    return graph_definition()


@router.get("/executions")
def executions(limit: int = 20, session: Session = Depends(get_db)) -> list[dict]:
    return agent_service.list_executions(session, limit=limit)


@router.get("/status/{execution_id}")
def status(execution_id: str, session: Session = Depends(get_db)) -> dict:
    execution = agent_service.get_execution(session, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id} not found.")
    return agent_service.serialize_execution(session, execution)


@router.get("/logs/{execution_id}")
def logs(execution_id: str, session: Session = Depends(get_db)) -> list[dict]:
    execution = agent_service.get_execution(session, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail=f"Execution {execution_id} not found.")
    return agent_service.logs_for(session, execution_id)


@router.get("/result/{execution_id}")
def result(execution_id: str, session: Session = Depends(get_db)) -> dict:
    record = agent_service.result_for(session, execution_id)
    if record is None:
        execution = agent_service.get_execution(session, execution_id)
        if execution is None:
            raise HTTPException(status_code=404, detail=f"Execution {execution_id} not found.")
        raise HTTPException(
            status_code=409,
            detail=f"Execution {execution_id} is {execution.status}; no result yet.",
        )
    return record
