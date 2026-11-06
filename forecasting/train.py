"""Offline training of the XGBoost demand model.

Training is intentionally *separate* from API inference: ``POST /api/forecast/train``
calls :func:`train_all_products`, while prediction only loads a persisted
artifact. Artifacts are joblib files holding the fitted model, the feature list,
the residual scale and the evaluation metrics.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from forecasting.config import (
    MIN_OBSERVATIONS,
    MIN_TRAIN_ROWS,
    TEST_DAYS,
    XGB_PARAMS,
    artifact_dir,
)
from forecasting.evaluation import compare_models, evaluate
from forecasting.feature_engineering import (
    FEATURE_COLUMNS,
    chronological_split,
    make_supervised,
    to_daily_series,
)

METRICS_FILENAME = "metrics.json"


def artifact_path(product_id: str) -> Path:
    safe = "".join(ch for ch in str(product_id) if ch.isalnum() or ch in "-_")
    return artifact_dir() / f"model_{safe}.joblib"


def _baseline_prediction(train: pd.DataFrame, test: pd.DataFrame) -> np.ndarray:
    """Seasonal-naive baseline: the mean of the previous 7 observed days."""
    history = list(train["y"].astype(float).values)
    predictions: list[float] = []
    for _ in range(len(test)):
        window = history[-7:] if len(history) >= 7 else history
        predictions.append(float(np.mean(window)) if window else 0.0)
        # walk forward through the *actual* test values (one-step-ahead baseline)
        predictions_index = len(predictions) - 1
        if predictions_index < len(test):
            history.append(float(test["y"].iloc[predictions_index]))
    return np.asarray(predictions, dtype=float)


def train_product(
    series: pd.DataFrame,
    product_id: str,
    test_days: int = TEST_DAYS,
) -> dict[str, Any]:
    """Train and persist one product model.

    ``series`` must contain ``ds``/``y`` columns (daily). Returns a report dict;
    ``trained`` is False when history is too short, in which case prediction
    falls back to the moving-average baseline.
    """
    started = time.perf_counter()
    dense = to_daily_series(series)
    observations = int(len(dense))
    result: dict[str, Any] = {
        "product_id": str(product_id),
        "trained": False,
        "observations": observations,
        "artifact": None,
        "metrics": {},
        "reason": None,
    }

    if observations < MIN_OBSERVATIONS:
        result["reason"] = (
            f"insufficient_history: {observations} daily observations, "
            f"{MIN_OBSERVATIONS} required"
        )
        return result

    supervised = make_supervised(dense)
    if len(supervised) < MIN_TRAIN_ROWS:
        result["reason"] = (
            f"insufficient_supervised_rows: {len(supervised)} rows, {MIN_TRAIN_ROWS} required"
        )
        return result

    train, test = chronological_split(supervised, test_days)
    if train.empty or test.empty:
        result["reason"] = "chronological_split_failed"
        return result

    model = XGBRegressor(**XGB_PARAMS)
    model.fit(train[list(FEATURE_COLUMNS)], train["y"])

    raw_predictions = model.predict(test[list(FEATURE_COLUMNS)])
    xgb_predictions = np.clip(raw_predictions, 0, None)
    baseline_predictions = np.clip(_baseline_prediction(train, test), 0, None)

    y_true = test["y"].astype(float).values
    metrics = {
        "xgboost": evaluate(y_true, xgb_predictions),
        "moving_average": evaluate(y_true, baseline_predictions),
    }
    comparison = compare_models(metrics)

    residuals = y_true - xgb_predictions
    residual_std = float(np.std(residuals)) if residuals.size else 0.0

    artifact = {
        "product_id": str(product_id),
        "model": model,
        "feature_columns": list(FEATURE_COLUMNS),
        "last_observed_date": dense["ds"].max().isoformat(),
        "history": [float(v) for v in dense["y"].tail(120).values],
        "residual_std": residual_std,
        "metrics": metrics,
        "comparison": comparison,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "observations": observations,
        "train_rows": int(len(train)),
        "test_rows": int(len(test)),
    }
    path = artifact_path(product_id)
    joblib.dump(artifact, path)

    result.update(
        {
            "trained": True,
            "artifact": str(path.name),
            "metrics": metrics,
            "comparison": comparison,
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "duration_ms": int((time.perf_counter() - started) * 1000),
        }
    )
    return result


def train_all_products(
    product_series: dict[str, pd.DataFrame],
    test_days: int = TEST_DAYS,
    write_metrics: bool = True,
) -> dict[str, Any]:
    """Train a model per product and persist a combined metrics registry."""
    started = time.perf_counter()
    reports: list[dict[str, Any]] = []
    for product_id, series in sorted(product_series.items()):
        reports.append(train_product(series, product_id, test_days=test_days))

    aggregate: dict[str, Any] = {
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "n_products": len(reports),
        "n_trained": sum(1 for r in reports if r["trained"]),
        "n_fallback": sum(1 for r in reports if not r["trained"]),
        "duration_ms": int((time.perf_counter() - started) * 1000),
        "products": reports,
    }
    if write_metrics:
        (artifact_dir() / METRICS_FILENAME).write_text(
            json.dumps(aggregate, indent=2), encoding="utf-8"
        )
    return aggregate


def load_metrics() -> dict[str, Any]:
    """Read the persisted metrics registry (empty dict when absent)."""
    path = artifact_dir() / METRICS_FILENAME
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
