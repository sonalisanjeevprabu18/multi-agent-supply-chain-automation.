"""Reporting and CSV download endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.services import report_service

router = APIRouter(prefix="/api/reports", tags=["reports"])


@router.get("/summary")
def summary(session: Session = Depends(get_db)) -> dict:
    """Executive KPIs aggregated from the database."""
    return report_service.summary(session)


@router.get("/available")
def available() -> dict:
    return {"reports": list(report_service.REPORT_TYPES)}


@router.get("/download")
def download(
    report: str = Query(default="inventory", description="One of /api/reports/available"),
    session: Session = Depends(get_db),
) -> Response:
    try:
        filename, content = report_service.export_csv(session, report)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        content=content,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
