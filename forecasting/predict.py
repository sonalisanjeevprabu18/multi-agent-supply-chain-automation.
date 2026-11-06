"""Inference: recursive multi-step demand forecasting from persisted artifacts.

The model is never retrained here. If no artifact exists, or the product has too
little history, prediction degrades gracefully to a moving-average baseline and
the response says so via the ``model`` field - it never invents a number.
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

import joblib
import numpy as np
import pandas as pd

from forecasting.config import MAX_HORIZON
from forecasting.feature_engineering import FEATURE_COLUMNS, feature_row, to_daily_series
from forecasting.train import artifact_path


def load_artifact(product_id: str) -> dict[str, Any] | None:
    path = artifact_path(product_id)
    if not path.exists():
        return None
    try:
        return joblib.load(path)
    except Exception:  # corrupt/foreign artifact -> treat as missing
        return None


def _baseline_forecast(history: list[float], horizon: int) -> list[float]:
    """Moving average of the last 7 observations (or the overall mean)."""
    if not history:
        return [0.0] * horizon
    window = history[-7:] if len(history) >= 7 else history
    level = float(np.mean(window))
    return [max(0.0, level)] * horizon


def forecast_product(
    product_id: str,
    series: pd.DataFrame,
    horizon: int = 7,
    artifact: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Forecast ``horizon`` days ahead for one product.

    Parameters
    ----------
    series:
        Observed daily history with ``ds``/``y`` columns.
    artifact:
        Optional pre-loaded artifact (avoids repeated disk reads).
    """
    horizon = int(max(1, min(horizon, MAX_HORIZON)))
    dense = to_daily_series(series)
    if dense.empty:
        return {
            "product_id": product_id,
            "model": "no_history",
            "horizon_days": horizon,
            "predictions": [],
            "fallback": True,
            "reason": "no historical observations for this product",
        }

    history = [float(v) for v in dense["y"].values]
    last_date = pd.Timestamp(dense["ds"].max())
    artifact = artifact if artifact is not None else load_artifact(product_id)

    predictions: list[dict[str, Any]] = []
    fallback = True
    model_name = "moving_average_fallback"

    if artifact and len(history) >= 14:
        model = artifact.get("model")
        try:
            buffer = list(history[-120:])
            for step in range(1, horizon + 1):
                target_date = last_date + timedelta(days=step)
                row = feature_row(target_date, buffer)
                features = pd.DataFrame([row])[list(FEATURE_COLUMNS)]
                value = float(model.predict(features)[0])
                value = float(max(0.0, value))
                predictions.append(
                    {
                        "date": target_date.date().isoformat(),
                        "predicted_units": round(value, 2),
                    }
                )
                buffer.append(value)
            fallback = False
            model_name = "xgboost"
        except Exception as exc:  # pragma: no cover - defensive
            predictions = []
            fallback = True
            model_name = f"moving_average_fallback: {exc}"

    if fallback:
        values = _baseline_forecast(history, horizon)
        predictions = [
            {
                "date": (last_date + timedelta(days=step)).date().isoformat(),
                "predicted_units": round(values[step - 1], 2),
            }
            for step in range(1, horizon + 1)
        ]

    total = round(sum(p["predicted_units"] for p in predictions), 2)
    avg_daily = round(total / horizon, 4) if horizon else 0.0
    return {
        "product_id": product_id,
        "model": model_name,
        "horizon_days": horizon,
        "last_observed_date": last_date.date().isoformat(),
        "predictions": predictions,
        "total_predicted_units": total,
        "avg_daily_demand": avg_daily,
        "fallback": fallback,
        "metrics": (artifact or {}).get("metrics", {}),
        "artifact_trained_at": (artifact or {}).get("trained_at"),
    }


def forecast_many(
    product_series: dict[str, pd.DataFrame],
    horizon: int = 7,
) -> list[dict[str, Any]]:
    """Forecast a batch of products, loading each artifact once."""
    results: list[dict[str, Any]] = []
    for product_id, series in sorted(product_series.items()):
        artifact = load_artifact(product_id)
        results.append(
            forecast_product(product_id, series, horizon=horizon, artifact=artifact)
        )
    return results
