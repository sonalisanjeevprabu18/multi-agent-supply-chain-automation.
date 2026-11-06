"""Forecast training, inference and persistence service."""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Any, Iterable

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.models.models import DemandForecast, Product
from backend.services.analytics import product_series
from forecasting.predict import forecast_product, load_artifact
from forecasting.train import load_metrics, train_all_products, artifact_path


class ForecastError(ValueError):
    """Raised when a forecast cannot be produced."""


def _products(session: Session, product_ids: Iterable[int] | None) -> list[Product]:
    stmt = select(Product).order_by(Product.sku)
    if product_ids:
        stmt = stmt.where(Product.id.in_(list(product_ids)))
    return list(session.scalars(stmt).all())


def _series_by_sku(products: list[Product], series: dict[int, Any]) -> dict[str, Any]:
    """Artifacts are stored per SKU (``model_P001.joblib``), so training keys must
    match the keys used at inference time."""
    return {p.sku: series[p.id] for p in products if p.id in series}


def train(
    session: Session,
    product_ids: Iterable[int] | None = None,
    test_days: int = 28,
) -> dict[str, Any]:
    """Train an XGBoost model per product on the stored sales history."""
    products = _products(session, product_ids)
    if not products:
        raise ForecastError("No products exist; upload sales data or seed the database first.")
    series = product_series(session, [p.id for p in products])
    if not series:
        raise ForecastError(
            "No sales history is available. Upload a CSV via /api/sales/upload first."
        )
    reports = train_all_products(_series_by_sku(products, series), test_days=test_days)
    by_sku = {p.sku: p for p in products}
    for report in reports["products"]:
        product = by_sku.get(str(report["product_id"]))
        report["sku"] = product.sku if product else str(report["product_id"])
        report["product_id"] = product.id if product else None
        report["product_name"] = product.name if product else ""
        report.pop("artifact", None)
    return reports


def ensure_models(session: Session, product_ids: Iterable[int] | None = None) -> list[str]:
    """Train artifacts that do not exist yet. Used once by the forecasting agent."""
    trained: list[str] = []
    products = _products(session, product_ids)
    missing = [p for p in products if not artifact_path(p.sku).exists()]
    if not missing:
        return trained
    series = product_series(session, [p.id for p in missing])
    if not series:
        return trained
    reports = train_all_products(_series_by_sku(missing, series), write_metrics=True)
    for report in reports["products"]:
        if report.get("trained"):
            trained.append(str(report["product_id"]))
    return trained


def predict(
    session: Session,
    product_ids: Iterable[int] | None = None,
    horizon_days: int = 7,
    persist: bool = True,
    execution_id: str | None = None,
) -> list[dict[str, Any]]:
    """Forecast every requested product and optionally persist the results."""
    products = _products(session, product_ids)
    if not products:
        raise ForecastError("No products exist to forecast.")
    series = product_series(session, [p.id for p in products])
    if not series:
        raise ForecastError("No sales history is available to forecast from.")

    results: list[dict[str, Any]] = []
    for product in products:
        history = series.get(product.id)
        if history is None:
            results.append(
                {
                    "product_id": product.id,
                    "sku": product.sku,
                    "product_name": product.name,
                    "model": "no_history",
                    "horizon_days": horizon_days,
                    "avg_daily_demand": 0.0,
                    "total_predicted_units": 0.0,
                    "fallback": True,
                    "predictions": [],
                    "metrics": {},
                }
            )
            continue
        artifact = load_artifact(product.sku)
        forecast = forecast_product(product.sku, history, horizon=horizon_days, artifact=artifact)
        results.append(
            {
                "product_id": product.id,
                "sku": product.sku,
                "product_name": product.name,
                "model": forecast["model"],
                "horizon_days": horizon_days,
                "avg_daily_demand": forecast["avg_daily_demand"],
                "total_predicted_units": forecast["total_predicted_units"],
                "fallback": forecast["fallback"],
                "predictions": forecast["predictions"],
                "metrics": forecast.get("metrics", {}),
                "last_observed_date": forecast.get("last_observed_date"),
            }
        )

    if persist and results:
        _persist_results(session, results, execution_id)
    return results


def _persist_results(
    session: Session, results: list[dict[str, Any]], execution_id: str | None
) -> None:
    """Replace the previous forecast batch for the affected products."""
    product_ids = [r["product_id"] for r in results if r["predictions"]]
    if not product_ids:
        return
    session.execute(
        delete(DemandForecast).where(DemandForecast.product_id.in_(product_ids))
    )
    now = datetime.now(timezone.utc)
    for result in results:
        for point in result["predictions"]:
            session.add(
                DemandForecast(
                    product_id=result["product_id"],
                    warehouse_id=None,
                    forecast_date=date.fromisoformat(point["date"]),
                    horizon_days=result["horizon_days"],
                    predicted_units=float(point["predicted_units"]),
                    avg_daily_demand=float(result["avg_daily_demand"]),
                    model_name=result["model"],
                    execution_id=execution_id,
                    created_at=now,
                )
            )
    session.commit()


def results(
    session: Session,
    product_id: int | None = None,
    limit_products: int = 100,
) -> list[dict[str, Any]]:
    """Latest persisted forecast batch, grouped per product."""
    stmt = select(DemandForecast, Product).join(
        Product, Product.id == DemandForecast.product_id
    )
    if product_id:
        stmt = stmt.where(DemandForecast.product_id == product_id)
    stmt = stmt.order_by(
        DemandForecast.created_at.desc(), DemandForecast.id.desc()
    ).limit(5000)
    rows = session.execute(stmt).all()
    if not rows:
        return []

    latest_created: dict[int, datetime] = {}
    grouped: dict[int, dict[str, Any]] = {}
    for forecast, product in rows:
        created = forecast.created_at
        current_latest = latest_created.get(product.id)
        if current_latest is None:
            latest_created[product.id] = created
        elif created < current_latest:
            continue
        entry = grouped.setdefault(
            product.id,
            {
                "product_id": product.id,
                "sku": product.sku,
                "product_name": product.name,
                "model": forecast.model_name,
                "horizon_days": forecast.horizon_days,
                "avg_daily_demand": float(forecast.avg_daily_demand),
                "predictions": [],
                "execution_id": forecast.execution_id,
                "created_at": created.isoformat() if created else None,
            },
        )
        entry["predictions"].append(
            {
                "date": forecast.forecast_date.isoformat(),
                "predicted_units": round(float(forecast.predicted_units), 2),
            }
        )
    output = []
    for entry in sorted(grouped.values(), key=lambda e: e["sku"])[:limit_products]:
        entry["predictions"].sort(key=lambda p: p["date"])
        entry["total_predicted_units"] = round(
            sum(p["predicted_units"] for p in entry["predictions"]), 2
        )
        entry["fallback"] = "fallback" in str(entry["model"])
        output.append(entry)
    return output


def backtest(
    session: Session, product_id: int, days: int = 28
) -> dict[str, Any]:
    """One-step-ahead backtest of the persisted model against real history.

    Each day in the window is predicted using only the observations before it, so
    the chart shows genuine out-of-sample behaviour rather than a memorised fit.
    """
    import pandas as pd

    from forecasting.evaluation import evaluate
    from forecasting.feature_engineering import FEATURE_COLUMNS, feature_row, to_daily_series
    from forecasting.predict import load_artifact

    product = session.get(Product, product_id)
    if product is None:
        raise ForecastError(f"Product {product_id} does not exist.")
    series = product_series(session, [product_id]).get(product_id)
    if series is None or len(series) < 20:
        raise ForecastError(
            f"Product {product.sku} has too little sales history for a backtest."
        )

    dense = to_daily_series(series)
    window = int(max(5, min(days, len(dense) - 14)))
    artifact = load_artifact(product.sku)
    values = [float(v) for v in dense["y"].values]
    dates = list(dense["ds"])
    start = len(dense) - window

    actual: list[float] = []
    predicted: list[float] = []
    for index in range(start, len(dense)):
        history = values[:index]
        if len(history) < 7:
            continue
        row = feature_row(pd.Timestamp(dates[index]), history)
        if artifact is not None:
            point = float(
                artifact["model"].predict(pd.DataFrame([row])[list(FEATURE_COLUMNS)])[0]
            )
        else:
            point = float(sum(history[-7:]) / 7)
        predicted.append(round(max(0.0, point), 2))
        actual.append(round(values[index], 2))

    if not actual:
        raise ForecastError(f"Not enough history to backtest {product.sku}.")
    metrics = evaluate(actual, predicted)
    return {
        "product_id": product.id,
        "sku": product.sku,
        "product_name": product.name,
        "model": "xgboost" if artifact is not None else "moving_average_fallback",
        "days": len(actual),
        "dates": [d.strftime("%Y-%m-%d") for d in dates[start:]][: len(actual)],
        "actual": actual,
        "predicted": predicted,
        "metrics": metrics,
    }


def metrics_registry() -> dict[str, Any]:
    """Persisted offline training metrics (MAE/RMSE/WAPE per product)."""
    return load_metrics()
