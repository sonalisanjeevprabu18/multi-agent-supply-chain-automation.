"""Background execution runtime for the agent workflow.

Local development: a bounded thread pool runs the graph after the HTTP response
returns. Serverless deployments cannot rely on in-process threads, so
``execution_mode`` is reported by ``/api/agents/status`` and the documented
Vercel limitation (docs/DEPLOYMENT.md) requires either ``wait_for_completion``
or an external worker invoking ``run_workflow`` for the queued execution.
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from backend.database.session import session_scope

logger = logging.getLogger(__name__)

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="agent-workflow")
_inflight: set[str] = set()


def _run(execution_id: str) -> None:
    from agents.orchestrator import run_workflow

    try:
        with session_scope() as session:
            run_workflow(session, execution_id)
    except Exception as exc:  # noqa: BLE001 - failure is already persisted
        logger.warning("workflow %s failed: %s", execution_id, exc)
    finally:
        _inflight.discard(execution_id)


def dispatch(execution_id: str, wait: bool = False) -> dict[str, Any]:
    """Start a workflow, either inline (blocking) or in the background."""
    from agents.orchestrator import OrchestrationError, run_workflow

    if wait:
        with session_scope() as session:
            run_workflow(session, execution_id)
        return {"execution_id": execution_id, "mode": "synchronous"}

    if execution_id in _inflight:
        return {"execution_id": execution_id, "mode": "already_running"}

    _inflight.add(execution_id)
    try:
        _executor.submit(_run, execution_id)
    except Exception as exc:  # pragma: no cover - executor shutdown
        _inflight.discard(execution_id)
        raise OrchestrationError(f"Could not schedule workflow: {exc}") from exc
    return {"execution_id": execution_id, "mode": "background"}


def is_inflight(execution_id: str) -> bool:
    return execution_id in _inflight
