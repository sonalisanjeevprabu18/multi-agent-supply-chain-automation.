"""Schemas for inventory optimization endpoints."""

from __future__ import annotations

from pydantic import BaseModel, Field


class InventoryOptimizeRequest(BaseModel):
    warehouse_id: int | None = None
    product_ids: list[int] | None = None
    service_level: float = Field(default=0.95, ge=0.5, le=0.999)
    review_period_days: int = Field(default=7, ge=1, le=60)


class InventoryRecommendationOut(BaseModel):
    product_id: int
    sku: str
    product_name: str
    warehouse_id: int
    warehouse_code: str
    warehouse_name: str
    available_stock: float
    incoming_stock: float
    avg_daily_demand: float
    safety_stock: float
    reorder_point: float
    target_stock: float
    recommended_quantity: float
    alert_level: str
    stockout_risk: bool
    days_of_cover: float | None = None
    explanation: str


class TransferOut(BaseModel):
    product_id: int
    sku: str
    product_name: str
    from_warehouse_id: int
    from_warehouse_code: str
    to_warehouse_id: int
    to_warehouse_code: str
    quantity: float
    reason: str
    feasible: bool
    status: str
