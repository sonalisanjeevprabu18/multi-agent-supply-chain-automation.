"""Feature engineering for the XGBoost demand model.

All lag/rolling features are shifted so that no future information leaks into a
training row: the value for day *t* only uses observations up to *t-1*.
"""

from __future__ import annotations

import pandas as pd

FEATURE_COLUMNS: tuple[str, ...] = (
    "day",
    "month",
    "week",
    "dayofweek",
    "quarter",
    "is_weekend",
    "lag_1",
    "lag_7",
    "lag_14",
    "rolling_mean_7",
    "rolling_mean_14",
    "rolling_mean_30",
)

LAG_COLUMNS: tuple[str, ...] = ("lag_1", "lag_7", "lag_14")
ROLLING_WINDOWS: tuple[int, ...] = (7, 14, 30)


def to_daily_series(
    frame: pd.DataFrame,
    date_column: str = "ds",
    value_column: str = "y",
) -> pd.DataFrame:
    """Densify a series onto a continuous daily calendar.

    Days without any recorded sale are genuine zero-demand days for a
    distributor, so they are filled with 0 rather than dropped - dropping them
    would bias lag features upward.
    """
    if frame.empty:
        return pd.DataFrame(columns=["ds", "y"])
    series = frame[[date_column, value_column]].copy()
    series.columns = ["ds", "y"]
    series["ds"] = pd.to_datetime(series["ds"]).dt.normalize()
    series = (
        series.groupby("ds", as_index=False)["y"].sum().sort_values("ds")
    )
    full_range = pd.date_range(series["ds"].min(), series["ds"].max(), freq="D")
    series = (
        series.set_index("ds")
        .reindex(full_range, fill_value=0.0)
        .rename_axis("ds")
        .reset_index()
    )
    series["y"] = series["y"].astype(float)
    return series


def add_calendar_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Attach deterministic calendar features derived from the date itself."""
    out = frame.copy()
    ds = pd.to_datetime(out["ds"])
    out["day"] = ds.dt.day
    out["month"] = ds.dt.month
    out["week"] = ds.dt.isocalendar().week.astype(int)
    out["dayofweek"] = ds.dt.dayofweek
    out["quarter"] = ds.dt.quarter
    out["is_weekend"] = (ds.dt.dayofweek >= 5).astype(int)
    return out


def add_lag_features(frame: pd.DataFrame) -> pd.DataFrame:
    """Attach lag and rolling features computed strictly from the past."""
    out = frame.copy()
    for lag in (1, 7, 14):
        out[f"lag_{lag}"] = out["y"].shift(lag)
    for window in ROLLING_WINDOWS:
        out[f"rolling_mean_{window}"] = (
            out["y"].shift(1).rolling(window=window, min_periods=window).mean()
        )
    return out


def build_features(series: pd.DataFrame) -> pd.DataFrame:
    """Return the series with calendar + lag features attached."""
    if series.empty:
        return pd.DataFrame(columns=["ds", "y", *FEATURE_COLUMNS])
    dense = to_daily_series(series)
    return add_lag_features(add_calendar_features(dense))


def make_supervised(series: pd.DataFrame) -> pd.DataFrame:
    """Drop warm-up rows that do not have a full feature vector."""
    features = build_features(series)
    usable = features.dropna(subset=list(FEATURE_COLUMNS))
    return usable.reset_index(drop=True)


def chronological_split(
    supervised: pd.DataFrame, test_days: int
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split by time, never randomly: train on the past, test on the future."""
    if supervised.empty:
        return supervised, supervised
    cutoff = supervised["ds"].max() - pd.Timedelta(days=test_days - 1)
    train = supervised.loc[supervised["ds"] < cutoff].reset_index(drop=True)
    test = supervised.loc[supervised["ds"] >= cutoff].reset_index(drop=True)
    if train.empty or test.empty:  # degenerate series: fall back to 80/20
        split_at = max(1, int(len(supervised) * 0.8))
        train = supervised.iloc[:split_at].reset_index(drop=True)
        test = supervised.iloc[split_at:].reset_index(drop=True)
    return train, test


def feature_row(
    ds: pd.Timestamp,
    history: list[float],
) -> dict[str, float]:
    """Build one feature row for a future date from the observed history.

    Used by the recursive multi-step forecaster: ``history`` holds every
    observation up to and including the previous day.
    """
    if not history:
        raise ValueError("history must contain at least one observation")
    ds = pd.Timestamp(ds)

    def lag(n: int) -> float:
        return float(history[-n]) if len(history) >= n else float(sum(history) / len(history))

    def rolling(window: int) -> float:
        if len(history) >= window:
            window_values = history[-window:]
        else:
            window_values = history
        return float(sum(window_values) / len(window_values))

    row = {
        "day": ds.day,
        "month": ds.month,
        "week": int(ds.isocalendar().week),
        "dayofweek": ds.dayofweek,
        "quarter": ds.quarter,
        "is_weekend": int(ds.dayofweek >= 5),
        "lag_1": lag(1),
        "lag_7": lag(7),
        "lag_14": lag(14),
    }
    for window in ROLLING_WINDOWS:
        row[f"rolling_mean_{window}"] = rolling(window)
    return row
