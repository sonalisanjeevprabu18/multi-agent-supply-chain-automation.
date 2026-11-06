"""Forecasting endpoints: offline training, prediction, results and metrics."""

from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.forecasting import (
    ForecastPredictRequest,
    ForecastResultOut,
    ForecastTrainRequest,
)
from backend.services import forecast_service

router = APIRouter(prefix="/api/forecast", tags=["forecasting"])

_training_lock = Lock()
_training_state: dict = {
    "status": "idle",
    "started_at": None,
    "finished_at": None,
    "error": None,
    "result": None,
}


def _train_job(product_ids: list[int] | None, test_days: int, url: str | None = None) -> None:
    """Run training in its own session so it is safe off the request thread."""
    from backend.database.session import session_scope

    with _training_lock:
        _training_state.update(
            {
                "status": "running",
                "started_at": datetime.now(timezone.utc).isoformat(),
                "finished_at": None,
                "error": None,
                "result": None,
            }
        )
    try:
        with session_scope() as session:
            result = forecast_service.train(session, product_ids, test_days=test_days)
        with _training_lock:
            _training_state.update(
                {
                    "status": "completed",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "result": result,
                }
            )
    except Exception as exc:  # noqa: BLE001 - reported through the status endpoint
        with _training_lock:
            _training_state.update(
                {
                    "status": "failed",
                    "finished_at": datetime.now(timezone.utc).isoformat(),
                    "error": str(exc),
                }
            )


@router.post("/train")
async def train(
    payload: ForecastTrainRequest,
    background: bool = Query(default=True, description="Run in the background"),
    session: Session = Depends(get_db),
) -> dict:
    """Train XGBoost + baseline models offline and persist the artifacts.

    Training never runs during a dashboard read. By default it is dispatched to
    the background and progress is visible at ``/api/forecast/train/status``.
    """
    if background:
        import threading

        with _training_lock:
            if _training_state["status"] == "running":
                return JSONResponse(
                    status_code=202,
                    content={"status": "already_running", **_training_state},
                )
        thread = threading.Thread(
            target=_train_job,
            args=(payload.product_ids, payload.test_days),
            daemon=True,
        )
        thread.start()
        return JSONResponse(
            status_code=202,
            content={
                "status": "training_started",
                "poll": "/api/forecast/train/status",
            },
        )

    try:
        result = await run_in_threadpool(
            forecast_service.train, session, payload.product_ids, payload.test_days
        )
    except forecast_service.ForecastError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"status": "completed", "result": result}


@router.get("/train/status")
def train_status() -> dict:
    with _training_lock:
        return dict(_training_state)


@router.post("/predict", response_model=list[ForecastResultOut])
def predict(
    payload: ForecastPredictRequest,
    session: Session = Depends(get_db),
) -> list[ForecastResultOut]:
    """Generate forecasts from the persisted model artifacts (no retraining)."""
    try:
        results = forecast_service.predict(
            session,
            payload.product_ids,
            horizon_days=payload.horizon_days,
            persist=payload.persist,
        )
    except forecast_service.ForecastError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return [ForecastResultOut(**r) for r in results]


@router.get("/results")
def results(
    product_id: int | None = None,
    session: Session = Depends(get_db),
) -> list[dict]:
    return forecast_service.results(session, product_id=product_id)


@router.get("/backtest/{product_id}")
def backtest(product_id: int, days: int = Query(default=28, ge=5, le=90), session: Session = Depends(get_db)) -> dict:
    """Actual versus one-step-ahead predicted demand (real hold-out behaviour)."""
    try:
        return forecast_service.backtest(session, product_id, days=days)
    except forecast_service.ForecastError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/metrics")
def metrics() -> dict:
    registry = forecast_service.metrics_registry()
    if not registry:
        return {
            "trained_at": None,
            "n_products": 0,
            "n_trained": 0,
            "products": [],
            "note": "No models have been trained yet. POST /api/forecast/train first.",
        }
    return registry
