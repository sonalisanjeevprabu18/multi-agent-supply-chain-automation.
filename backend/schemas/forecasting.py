"""Schemas for forecasting endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class SalesUploadResponse(BaseModel):
    accepted_rows: int
    rejected_rows: int
    warnings: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    products_ingested: int
    warehouses_ingested: int
    date_range: tuple[str, str] | None = None


class ForecastTrainRequest(BaseModel):
    product_ids: list[int] | None = None
    test_days: int = Field(default=28, ge=7, le=90)


class ForecastMetricsOut(BaseModel):
    product_id: int
    sku: str
    trained: bool
    reason: str | None = None
    observations: int = 0
    metrics: dict[str, Any] = Field(default_factory=dict)
    comparison: dict[str, Any] = Field(default_factory=dict)


class ForecastPredictRequest(BaseModel):
    product_ids: list[int] | None = None
    horizon_days: int = Field(default=7, ge=1, le=30)
    persist: bool = True


class ForecastResultOut(BaseModel):
    product_id: int
    sku: str
    product_name: str
    model: str
    horizon_days: int
    avg_daily_demand: float
    total_predicted_units: float
    fallback: bool
    predictions: list[dict[str, Any]]
    metrics: dict[str, Any] = Field(default_factory=dict)
