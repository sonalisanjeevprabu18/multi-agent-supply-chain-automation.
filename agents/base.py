"""Shared plumbing for the specialized agents: logging, serialisation, errors."""

from __future__ import annotations

import time
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from agents.state import WorkflowState
from backend.models.models import AgentExecution, AgentLog


class AgentError(RuntimeError):
    """Raised when an agent cannot complete its task."""


def jsonable(value: Any) -> Any:
    """Recursively convert values to JSON-serialisable primitives."""
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [jsonable(v) for v in value]
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if hasattr(value, "item"):  # numpy scalar
        try:
            return value.item()
        except Exception:  # pragma: no cover - defensive
            return str(value)
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def compact(payload: dict[str, Any], max_items: int = 3) -> dict[str, Any]:
    """Trim a state update so agent logs stay small enough for JSON columns."""
    result: dict[str, Any] = {}
    for key, value in payload.items():
        if key.startswith("_"):
            continue
        if isinstance(value, list):
            result[key] = {
                "count": len(value),
                "sample": jsonable(value[:max_items]),
            }
        elif isinstance(value, dict) and len(str(value)) > 4000:
            result[key] = {"truncated": True, "keys": list(value)[:20]}
        else:
            result[key] = jsonable(value)
    return result


class BaseAgent:
    """Base class providing DB logging and shared helpers."""

    name: str = "base_agent"
    description: str = ""

    def __init__(self, session: Session) -> None:
        self.session = session

    # ---- logging -------------------------------------------------------
    def log(
        self,
        state: WorkflowState,
        status: str,
        message: str,
        *,
        payload: dict[str, Any] | None = None,
        duration_ms: int = 0,
    ) -> AgentLog:
        execution_id = state.get("execution_id")
        if not execution_id:
            raise AgentError("state is missing execution_id")
        step = int(
            self.session.scalar(
                select(func.count())
                .select_from(AgentLog)
                .where(AgentLog.execution_id == execution_id)
            )
            or 0
        )
        entry = AgentLog(
            execution_id=execution_id,
            agent_name=self.name,
            step_index=step,
            status=status,
            message=message[:4000],
            payload=jsonable(payload) if payload else None,
            duration_ms=duration_ms,
        )
        self.session.add(entry)
        execution = self.session.get(AgentExecution, execution_id)
        if execution is not None:
            execution.current_agent = self.name
        self.session.commit()
        return entry

    # ---- contract ------------------------------------------------------
    def run(self, state: WorkflowState) -> dict[str, Any]:
        raise NotImplementedError

    # ---- helpers -------------------------------------------------------
    def focus_product_ids(self, state: WorkflowState) -> list[int] | None:
        focus = state.get("focus_product_id")
        return [int(focus)] if focus else None


class TimedAgent:
    """Wrap an agent with retry + timing + status logging."""

    def __init__(self, agent: BaseAgent, retries: int = 1) -> None:
        self.agent = agent
        self.retries = max(0, retries)

    def __call__(self, state: WorkflowState) -> dict[str, Any]:
        started = time.perf_counter()
        self.agent.log(state, "started", f"{self.agent.name} started")
        last_error: Exception | None = None
        for attempt in range(self.retries + 1):
            try:
                update = self.agent.run(state)
                duration = int((time.perf_counter() - started) * 1000)
                summary = update.pop("_summary", f"{self.agent.name} completed")
                self.agent.log(
                    state,
                    "completed",
                    str(summary),
                    payload=compact(update),
                    duration_ms=duration,
                )
                return update
            except Exception as exc:  # noqa: BLE001 - surfaced in the execution log
                last_error = exc
                self.session_rollback()
                if attempt < self.retries:
                    self.agent.log(
                        state,
                        "retrying",
                        f"{self.agent.name} failed ({exc}); retrying once.",
                    )
                    continue
                duration = int((time.perf_counter() - started) * 1000)
                self.agent.log(
                    state,
                    "failed",
                    f"{self.agent.name} failed: {exc}",
                    duration_ms=duration,
                )
        raise AgentError(f"{self.agent.name} failed: {last_error}") from last_error

    def session_rollback(self) -> None:
        try:
            self.agent.session.rollback()
        except Exception:  # pragma: no cover - session may be unusable
            pass
