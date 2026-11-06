"""Unit tests for CSV validation, preprocessing, features, training and evaluation."""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from forecasting.evaluation import compare_models, evaluate, mae, rmse, wape
from forecasting.feature_engineering import (
    FEATURE_COLUMNS,
    chronological_split,
    feature_row,
    make_supervised,
    to_daily_series,
)
from forecasting.predict import forecast_product
from forecasting.preprocessing import (
    REQUIRED_COLUMNS,
    SalesDataError,
    read_csv_bytes,
    validate_and_clean,
)
from forecasting.train import train_product


def _frame(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows)


def _daily_rows(days: int, base: float = 20.0, sku: str = "P001") -> list[dict]:
    start = pd.Timestamp("2026-01-01")
    return [
        {
            "date": (start + pd.Timedelta(days=i)).date().isoformat(),
            "product_id": sku,
            "product_name": "Widget",
            "warehouse_id": "W1",
            "units_sold": base + (i % 7),
            "selling_price": 9.5,
        }
        for i in range(days)
    ]


# ---------------------------------------------------------------- validation
def test_validation_accepts_clean_data():
    cleaned, report = validate_and_clean(_frame(_daily_rows(10)))
    assert report.is_valid is True
    assert report.rows_clean == 10
    assert report.rejected_rows == 0
    assert list(cleaned.columns) == list(REQUIRED_COLUMNS)
    assert str(cleaned["date"].dtype).startswith("datetime64")


def test_validation_rejects_missing_columns():
    frame = _frame([{"date": "2026-01-01", "units_sold": 3}])
    cleaned, report = validate_and_clean(frame)
    assert report.is_valid is False
    assert cleaned.empty
    assert any("Missing mandatory column" in error for error in report.errors)


def test_validation_rejects_empty_frame():
    _, report = validate_and_clean(pd.DataFrame())
    assert report.is_valid is False
    assert "no data rows" in report.errors[0].lower()


def test_validation_rejects_negative_quantities_bad_dates_and_types():
    rows = _daily_rows(3)
    rows.append({**rows[0], "date": "2026-02-01", "units_sold": -5})
    rows.append({**rows[0], "date": "2026-02-02", "units_sold": "abc"})
    rows.append({**rows[0], "date": "not-a-date", "units_sold": 4})
    rows.append({**rows[0], "date": "2026-02-03", "selling_price": 0})
    _, report = validate_and_clean(_frame(rows))
    assert report.is_valid is True  # valid rows survive
    assert report.rows_clean == 3
    assert report.rejected_rows == 4
    joined = " ".join(report.errors)
    assert "negative units_sold" in joined
    assert "non-numeric units_sold" in joined
    assert "invalid date" in joined


def test_validation_deduplicates_rows():
    rows = _daily_rows(3)
    rows.append({**rows[0], "units_sold": 99})
    cleaned, report = validate_and_clean(_frame(rows))
    assert len(cleaned) == 3
    assert any("duplicate" in w.lower() for w in report.warnings)


def test_read_csv_bytes_rejects_garbage():
    with pytest.raises(SalesDataError):
        read_csv_bytes(b"")


def test_read_csv_bytes_parses_template():
    frame = read_csv_bytes(
        b"date,product_id,product_name,warehouse_id,units_sold,selling_price\n"
        b"2026-01-01,P1,Widget,W1,5,2.5\n"
    )
    cleaned, report = validate_and_clean(frame)
    assert report.is_valid
    assert cleaned.iloc[0]["units_sold"] == 5


# ---------------------------------------------------------------- features
def test_daily_series_fills_missing_days():
    series = pd.DataFrame(
        {
            "ds": pd.to_datetime(["2026-01-01", "2026-01-04"]),
            "y": [10.0, 20.0],
        }
    )
    dense = to_daily_series(series)
    assert len(dense) == 4
    assert dense["y"].tolist() == [10.0, 0.0, 0.0, 20.0]


def test_feature_engineering_has_no_future_leakage():
    series = pd.DataFrame(
        {
            "ds": pd.date_range("2026-01-01", periods=60, freq="D"),
            "y": np.arange(1, 61, dtype=float),
        }
    )
    supervised = make_supervised(series)
    assert set(FEATURE_COLUMNS).issubset(supervised.columns)
    row = supervised.iloc[10]
    # lag_1 must be the value of the previous day, not the current one
    assert row["lag_1"] == row["y"] - 1
    # rolling_mean_7 is the mean of the 7 days *before* the target day
    assert row["rolling_mean_7"] == pytest.approx(row["y"] - 4.0)


def test_feature_row_matches_supervised_row():
    series = pd.DataFrame(
        {
            "ds": pd.date_range("2026-01-01", periods=40, freq="D"),
            "y": np.arange(1, 41, dtype=float),
        }
    )
    row = feature_row(pd.Timestamp("2026-02-10"), list(series["y"].values))
    assert row["lag_1"] == 40.0
    assert len(row) == len(FEATURE_COLUMNS)


def test_chronological_split_keeps_order():
    supervised = make_supervised(
        pd.DataFrame(
            {
                "ds": pd.date_range("2026-01-01", periods=90, freq="D"),
                "y": np.random.default_rng(0).normal(50, 5, 90),
            }
        )
    )
    train, test = chronological_split(supervised, test_days=20)
    assert train["ds"].max() < test["ds"].min()
    assert len(test) == 20


# ---------------------------------------------------------------- metrics
def test_metrics_are_mathematically_correct():
    y_true = [10, 20, 30]
    y_pred = [12, 18, 33]
    assert mae(y_true, y_pred) == pytest.approx(2.3333, rel=1e-3)
    # sqrt((2^2 + 2^2 + 3^2) / 3) = sqrt(17/3)
    assert rmse(y_true, y_pred) == pytest.approx(2.3805, rel=1e-3)
    assert wape(y_true, y_pred) == pytest.approx(7 / 60, rel=1e-3)
    result = evaluate(y_true, y_pred)
    assert set(result) == {"mae", "rmse", "wape", "n_observations"}


def test_wape_handles_zero_demand():
    assert wape([0, 0], [0, 0]) == 0.0


def test_compare_models_picks_lower_wape():
    comparison = compare_models(
        {
            "xgboost": {"wape": 0.10, "mae": 1, "rmse": 1},
            "moving_average": {"wape": 0.20, "mae": 2, "rmse": 2},
        }
    )
    assert comparison["best_model"] == "xgboost"
    assert comparison["wape_improvement"] == pytest.approx(50.0)


# ---------------------------------------------------------------- training
def test_train_produces_artifact_and_metrics(artifact_dir):
    series = pd.DataFrame(
        {
            "ds": pd.date_range("2026-01-01", periods=120, freq="D"),
            "y": 50 + 10 * np.sin(np.arange(120) / 7) + np.random.default_rng(1).normal(0, 2, 120),
        }
    )
    report = train_product(series, "TEST-TRAIN", test_days=21)
    assert report["trained"] is True
    assert report["metrics"]["xgboost"]["wape"] >= 0
    assert report["metrics"]["moving_average"]["mae"] >= 0
    assert (artifact_dir / "model_TEST-TRAIN.joblib").exists()


def test_train_refuses_short_history():
    series = pd.DataFrame(
        {"ds": pd.date_range("2026-01-01", periods=20, freq="D"), "y": 5.0}
    )
    report = train_product(series, "TEST-SHORT")
    assert report["trained"] is False
    assert "insufficient_history" in report["reason"]


def test_forecast_uses_xgboost_artifact(artifact_dir):
    series = pd.DataFrame(
        {
            "ds": pd.date_range("2026-01-01", periods=120, freq="D"),
            "y": 40 + np.random.default_rng(3).normal(0, 2, 120),
        }
    )
    train_product(series, "TEST-FC", test_days=21)
    result = forecast_product("TEST-FC", series, horizon=7)
    assert result["model"] == "xgboost"
    assert result["fallback"] is False
    assert len(result["predictions"]) == 7
    assert all(p["predicted_units"] >= 0 for p in result["predictions"])


def test_forecast_falls_back_without_artifact():
    series = pd.DataFrame(
        {
            "ds": pd.date_range("2026-01-01", periods=20, freq="D"),
            "y": 12.0,
        }
    )
    result = forecast_product("NO-ARTIFACT", series, horizon=5)
    assert result["fallback"] is True
    assert "fallback" in result["model"]
    assert len(result["predictions"]) == 5
    assert result["predictions"][0]["predicted_units"] == 12.0
