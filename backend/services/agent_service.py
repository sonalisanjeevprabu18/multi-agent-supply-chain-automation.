"""Agent execution service: create, read and serialise workflow executions."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.models import AgentExecution, AgentLog, WorkflowResult

AGENT_STEPS = 7


def create_execution(
    session: Session,
    *,
    scenario: str,
    horizon_days: int,
    service_level: float,
    focus_product_id: int | None,
    target_warehouse_id: int | None,
    supplier_weights: dict[str, float],
    review_period_days: int = 7,
) -> AgentExecution:
    execution = AgentExecution(
        id=str(uuid4()),
        status="queued",
        scenario=scenario,
        horizon_days=horizon_days,
        service_level=service_level,
        focus_product_id=focus_product_id,
        summary={
            "supplier_weights": supplier_weights,
            "target_warehouse_id": target_warehouse_id,
            "review_period_days": review_period_days,
        },
        started_at=datetime.now(timezone.utc),
    )
    session.add(execution)
    session.commit()
    return execution


def get_execution(session: Session, execution_id: str) -> AgentExecution | None:
    return session.get(AgentExecution, execution_id)


def logs_for(session: Session, execution_id: str) -> list[dict[str, Any]]:
    entries = session.scalars(
        select(AgentLog)
        .where(AgentLog.execution_id == execution_id)
        .order_by(AgentLog.step_index, AgentLog.id)
    ).all()
    return [
        {
            "id": entry.id,
            "agent_name": entry.agent_name,
            "step_index": entry.step_index,
            "status": entry.status,
            "message": entry.message,
            "duration_ms": entry.duration_ms,
            "payload": entry.payload,
            "created_at": entry.created_at.isoformat() if entry.created_at else None,
        }
        for entry in entries
    ]


def serialize_execution(
    session: Session, execution: AgentExecution, include_logs: bool = True
) -> dict[str, Any]:
    logs = logs_for(session, execution.id) if include_logs else []
    completed_agents = {log["agent_name"] for log in logs if log["status"] == "completed"}
    progress = int(min(100, round(len(completed_agents) / AGENT_STEPS * 100)))
    if execution.status == "completed":
        progress = 100
    return {
        "execution_id": execution.id,
        "status": execution.status,
        "scenario": execution.scenario,
        "current_agent": execution.current_agent,
        "horizon_days": execution.horizon_days,
        "service_level": execution.service_level,
        "focus_product_id": execution.focus_product_id,
        "started_at": execution.started_at.isoformat() if execution.started_at else None,
        "finished_at": execution.finished_at.isoformat() if execution.finished_at else None,
        "error": execution.error,
        "summary": execution.summary,
        "progress": progress,
        "completed_agents": sorted(completed_agents),
        "logs": logs,
    }


def list_executions(session: Session, limit: int = 20) -> list[dict[str, Any]]:
    executions = session.scalars(
        select(AgentExecution)
        .order_by(AgentExecution.started_at.desc(), AgentExecution.id.desc())
        .limit(limit)
    ).all()
    return [
        {
            "execution_id": execution.id,
            "status": execution.status,
            "scenario": execution.scenario,
            "started_at": execution.started_at.isoformat() if execution.started_at else None,
            "finished_at": execution.finished_at.isoformat() if execution.finished_at else None,
            "current_agent": execution.current_agent,
            "error": execution.error,
            "summary": execution.summary,
        }
        for execution in executions
    ]


def result_for(session: Session, execution_id: str) -> dict[str, Any] | None:
    record = session.scalars(
        select(WorkflowResult).where(WorkflowResult.execution_id == execution_id)
    ).first()
    if record is None:
        return None
    return {
        "execution_id": record.execution_id,
        "status": record.status,
        "verification": record.verification,
        "decisions": record.decisions,
        "summary": record.summary,
        "created_at": record.created_at.isoformat() if record.created_at else None,
    }
