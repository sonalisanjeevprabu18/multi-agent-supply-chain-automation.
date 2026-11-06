"""Shared API helpers: error mapping and pagination."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy.orm import Session

from backend.services.procurement_service import ProcurementError


def handle_value_error(exc: ValueError) -> HTTPException:
    """Map domain errors onto proper HTTP status codes."""
    if isinstance(exc, ProcurementError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


def ensure_rows(rows: list, message: str) -> None:
    if not rows:
        raise HTTPException(status_code=404, detail=message)


def session_or_500(session: Session | None) -> Session:
    if session is None:  # pragma: no cover - dependency always provides one
        raise HTTPException(status_code=500, detail="Database session unavailable")
    return session
