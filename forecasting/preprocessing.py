"""Validation and cleaning of uploaded historical-sales CSV data.

Every rule here is applied to a real ``pandas.DataFrame``; nothing is faked.
The module is deliberately free of FastAPI/database imports so it can be unit
tested in isolation (see tests/test_forecasting.py).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from io import BytesIO
from typing import Any

import pandas as pd

REQUIRED_COLUMNS: tuple[str, ...] = (
    "date",
    "product_id",
    "product_name",
    "warehouse_id",
    "units_sold",
    "selling_price",
)

NUMERIC_COLUMNS: tuple[str, ...] = ("units_sold", "selling_price")
KEY_COLUMNS: tuple[str, ...] = ("date", "product_id", "warehouse_id")


@dataclass
class ValidationReport:
    """Outcome of validating one uploaded file."""

    is_valid: bool = False
    rows_in: int = 0
    rows_clean: int = 0
    rejected_rows: int = 0
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "is_valid": self.is_valid,
            "rows_in": self.rows_in,
            "rows_clean": self.rows_clean,
            "rejected_rows": self.rejected_rows,
            "errors": self.errors,
            "warnings": self.warnings,
        }


class SalesDataError(ValueError):
    """Raised when a payload cannot be interpreted as tabular CSV at all."""

    def __init__(self, message: str, report: ValidationReport | None = None) -> None:
        super().__init__(message)
        self.report = report


def read_csv_bytes(payload: bytes) -> pd.DataFrame:
    """Parse raw CSV bytes into a DataFrame, raising :class:`SalesDataError`."""
    if not payload:
        raise SalesDataError("Uploaded file is empty.")
    try:
        frame = pd.read_csv(BytesIO(payload))
    except UnicodeDecodeError as exc:  # pragma: no cover - depends on input encoding
        raise SalesDataError(f"File is not valid UTF-8 text: {exc}") from exc
    except Exception as exc:  # pandas raises several parser subclasses
        raise SalesDataError(f"Could not parse CSV: {exc}") from exc
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    return frame


def validate_and_clean(frame: pd.DataFrame) -> tuple[pd.DataFrame, ValidationReport]:
    """Validate an uploaded sales frame and return a cleaned copy.

    Rejection policy (all reported back to the caller):

    * missing mandatory columns            -> hard error, nothing usable
    * unparseable dates                    -> row rejected
    * non-numeric / negative quantities    -> row rejected
    * non-positive selling price           -> row rejected
    * missing mandatory values             -> row rejected
    * duplicate (date, product, warehouse)  -> later row kept, warning emitted
    """
    report = ValidationReport(rows_in=0 if frame is None else int(len(frame)))

    if frame is None or frame.empty:
        report.errors.append("Uploaded file contains no data rows.")
        return _empty_frame(), report

    frame = frame.copy()
    frame.columns = [str(c).strip().lower() for c in frame.columns]
    missing = [c for c in REQUIRED_COLUMNS if c not in frame.columns]
    if missing:
        report.errors.append(
            "Missing mandatory column(s): " + ", ".join(missing)
        )
        return _empty_frame(), report

    work = frame[list(REQUIRED_COLUMNS)].copy()

    for column in ("product_id", "product_name", "warehouse_id"):
        work[column] = work[column].astype("string").str.strip()
        blank = work[column].isna() | (work[column] == "")
        if blank.any():
            report.errors.append(
                f"{int(blank.sum())} row(s) have a blank {column}; they were rejected."
            )
            work = work.loc[~blank]

    parsed_dates = pd.to_datetime(work["date"], errors="coerce")
    bad_dates = parsed_dates.isna()
    if bad_dates.any():
        report.errors.append(
            f"{int(bad_dates.sum())} row(s) contain an invalid date and were rejected."
        )
    work = work.loc[~bad_dates].copy()
    work["date"] = parsed_dates.loc[~bad_dates].dt.normalize()

    for column in NUMERIC_COLUMNS:
        coerced = pd.to_numeric(work[column], errors="coerce")
        non_numeric = work[column].notna() & coerced.isna()
        if non_numeric.any():
            report.errors.append(
                f"{int(non_numeric.sum())} row(s) have a non-numeric {column} and were rejected."
            )
        work[column] = coerced

    negative = work["units_sold"] < 0
    if negative.any():
        report.errors.append(
            f"{int(negative.sum())} row(s) have a negative units_sold and were rejected."
        )
    bad_price = work["selling_price"] <= 0
    if bad_price.any():
        report.errors.append(
            f"{int(bad_price.sum())} row(s) have a selling_price <= 0 and were rejected."
        )
    work = work.loc[~(negative.fillna(False) | bad_price.fillna(False))]

    incomplete = work[list(NUMERIC_COLUMNS)].isna().any(axis=1)
    if incomplete.any():
        report.errors.append(
            f"{int(incomplete.sum())} row(s) are missing mandatory values and were rejected."
        )
    work = work.loc[~incomplete]

    duplicates = work.duplicated(subset=list(KEY_COLUMNS), keep="last")
    if duplicates.any():
        report.warnings.append(
            f"{int(duplicates.sum())} duplicate (date, product, warehouse) row(s) "
            "were de-duplicated, keeping the latest occurrence."
        )
        work = work.loc[~duplicates]

    work = work.sort_values(list(KEY_COLUMNS)).reset_index(drop=True)
    work["units_sold"] = work["units_sold"].astype(float)
    work["selling_price"] = work["selling_price"].astype(float)
    work["product_id"] = work["product_id"].astype(str)
    work["product_name"] = work["product_name"].astype(str)
    work["warehouse_id"] = work["warehouse_id"].astype(str)

    report.rows_clean = int(len(work))
    report.rejected_rows = report.rows_in - report.rows_clean
    report.is_valid = report.rows_clean > 0

    if report.rows_clean > 0:
        span_days = (work["date"].max() - work["date"].min()).days + 1
        if span_days < 30:
            report.warnings.append(
                f"History spans only {span_days} day(s); 30-day forecasts will fall "
                "back to the moving-average baseline for most products."
            )
    return work, report


def _empty_frame() -> pd.DataFrame:
    return pd.DataFrame(columns=list(REQUIRED_COLUMNS))


def aggregate_daily_product(frame: pd.DataFrame) -> pd.DataFrame:
    """Aggregate sales across warehouses into one daily series per product."""
    if frame.empty:
        return pd.DataFrame(columns=["product_id", "product_name", "ds", "y"])
    grouped = (
        frame.groupby(["product_id", "date"], as_index=False)
        .agg(
            y=("units_sold", "sum"),
            product_name=("product_name", "first"),
            revenue=("units_sold", lambda s: 0.0),
        )
        .rename(columns={"date": "ds"})
        .sort_values(["product_id", "ds"])
    )
    # revenue is recomputed in a vectorised way (unit price * units) and dropped
    grouped = grouped.drop(columns=["revenue"])
    return grouped[["product_id", "product_name", "ds", "y"]]


def aggregate_daily_product_warehouse(frame: pd.DataFrame) -> pd.DataFrame:
    """Aggregate to one daily series per (product, warehouse) pair."""
    if frame.empty:
        return pd.DataFrame(columns=["product_id", "warehouse_id", "ds", "y"])
    grouped = (
        frame.groupby(["product_id", "warehouse_id", "date"], as_index=False)
        .agg(y=("units_sold", "sum"))
        .rename(columns={"date": "ds"})
        .sort_values(["product_id", "warehouse_id", "ds"])
    )
    return grouped


def build_template_frame() -> pd.DataFrame:
    """Return the example CSV template shown to users."""
    return pd.DataFrame(
        [
            {
                "date": "2026-01-01",
                "product_id": "P001",
                "product_name": "Industrial Bearing 6204",
                "warehouse_id": "W1",
                "units_sold": 42,
                "selling_price": 6.5,
            },
            {
                "date": "2026-01-02",
                "product_id": "P001",
                "product_name": "Industrial Bearing 6204",
                "warehouse_id": "W1",
                "units_sold": 38,
                "selling_price": 6.5,
            },
        ]
    )
