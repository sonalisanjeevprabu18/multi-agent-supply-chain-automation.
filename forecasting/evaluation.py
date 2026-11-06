"""Model evaluation metrics (MAE, RMSE, WAPE)."""

from __future__ import annotations

from typing import Any, Iterable

import numpy as np


def mae(y_true: Iterable[float], y_pred: Iterable[float]) -> float:
    """Mean absolute error."""
    true = np.asarray(list(y_true), dtype=float)
    pred = np.asarray(list(y_pred), dtype=float)
    if true.size == 0:
        return 0.0
    return float(np.mean(np.abs(true - pred)))


def rmse(y_true: Iterable[float], y_pred: Iterable[float]) -> float:
    """Root mean squared error."""
    true = np.asarray(list(y_true), dtype=float)
    pred = np.asarray(list(y_pred), dtype=float)
    if true.size == 0:
        return 0.0
    return float(np.sqrt(np.mean((true - pred) ** 2)))


def wape(y_true: Iterable[float], y_pred: Iterable[float]) -> float:
    """Weighted absolute percentage error.

    WAPE = sum(|y - yhat|) / sum(|y|). Returns 0.0 when the denominator is zero
    (a perfectly flat zero-demand series) to keep metrics comparable.
    """
    true = np.asarray(list(y_true), dtype=float)
    pred = np.asarray(list(y_pred), dtype=float)
    denominator = float(np.sum(np.abs(true)))
    if denominator == 0.0:
        return 0.0
    return float(np.sum(np.abs(true - pred)) / denominator)


def evaluate(y_true: Iterable[float], y_pred: Iterable[float]) -> dict[str, float]:
    """Return all three metrics in one dict."""
    return {
        "mae": round(mae(y_true, y_pred), 4),
        "rmse": round(rmse(y_true, y_pred), 4),
        "wape": round(wape(y_true, y_pred), 4),
        "n_observations": int(len(list(y_true))),
    }


def compare_models(
    evaluation: dict[str, dict[str, float]]
) -> dict[str, Any]:
    """Pick the lower-WAPE model and report the improvement over the baseline."""
    if not evaluation:
        return {"best_model": None, "wape_improvement": None}
    baseline = evaluation.get("moving_average", {})
    model = evaluation.get("xgboost", {})
    if not model or not baseline:
        return {
            "best_model": max(evaluation, key=lambda k: evaluation[k].get("wape", 0)),
            "wape_improvement": None,
        }
    improvement = None
    if baseline.get("wape"):
        improvement = round(
            (baseline["wape"] - model.get("wape", 0.0)) / baseline["wape"] * 100, 2
        )
    best = "xgboost" if model.get("wape", 1e9) <= baseline.get("wape", 1e9) else "moving_average"
    return {
        "best_model": best,
        "wape_improvement": improvement,
        "metrics": evaluation,
    }
