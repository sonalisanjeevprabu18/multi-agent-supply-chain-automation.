"""Schemas for agent execution endpoints."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class AgentExecuteRequest(BaseModel):
    scenario: str = Field(
        default="standard_workflow",
        description="standard_workflow | disruption_demo",
    )
    horizon_days: int = Field(default=7, ge=1, le=30)
    service_level: float = Field(default=0.95, ge=0.5, le=0.999)
    focus_product_id: int | None = None
    target_warehouse_id: int | None = None
    supplier_weights: dict[str, float] = Field(
        default_factory=lambda: {"cost": 0.4, "lead_time": 0.3, "reliability": 0.3}
    )
    # When true the request waits for the workflow and returns the full result.
    wait_for_completion: bool = False


class AgentLogOut(BaseModel):
    agent_name: str
    step_index: int
    status: str
    message: str
    duration_ms: int
    payload: dict[str, Any] | None = None
    created_at: datetime | None = None


class AgentExecutionOut(BaseModel):
    execution_id: str
    status: str
    scenario: str
    current_agent: str | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    error: str | None = None
    summary: dict[str, Any] | None = None
    logs: list[AgentLogOut] = Field(default_factory=list)


class WorkflowStatusOut(BaseModel):
    execution_id: str
    status: str
    current_agent: str | None = None
    progress: int
    error: str | None = None
    summary: dict[str, Any] | None = None
