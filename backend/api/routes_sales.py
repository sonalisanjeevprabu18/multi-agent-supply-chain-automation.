"""Sales ingestion endpoints (CSV upload + template + coverage summary)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from backend.config import settings
from backend.database.session import get_db
from backend.schemas.forecasting import SalesUploadResponse
from backend.services import sales_service
from forecasting.preprocessing import SalesDataError

router = APIRouter(prefix="/api/sales", tags=["sales"])

ALLOWED_CONTENT_TYPES = {
    "text/csv",
    "text/plain",
    "application/csv",
    "application/vnd.ms-excel",
    "application/octet-stream",
}


@router.post("/upload", response_model=SalesUploadResponse)
async def upload_sales(
    file: UploadFile = File(...),
    session: Session = Depends(get_db),
) -> SalesUploadResponse:
    """Validate and ingest a historical sales CSV.

    Rejected rows are reported back; if no row is usable the request fails with
    422 and the full validation report.
    """
    if file.content_type and file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{file.content_type}'. Upload a .csv file.",
        )
    if file.filename and not file.filename.lower().endswith((".csv", ".txt")):
        raise HTTPException(status_code=415, detail="Only .csv files are accepted.")

    payload = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if len(payload) > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File exceeds the {settings.max_upload_mb} MB limit.",
        )
    if not payload:
        raise HTTPException(status_code=422, detail="Uploaded file is empty.")

    try:
        summary, report = sales_service.ingest_sales_frame(session, payload)
    except SalesDataError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    if not report.is_valid:
        raise HTTPException(status_code=422, detail=report.to_dict())
    return SalesUploadResponse(**{k: v for k, v in summary.items() if k in SalesUploadResponse.model_fields})


@router.get("/template")
def download_template() -> Response:
    return Response(
        content=sales_service.template_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="sales_template.csv"'},
    )


@router.get("/summary")
def summary(session: Session = Depends(get_db)) -> dict:
    return sales_service.sales_summary(session)
