"""Schemas for procurement, suppliers and disruptions."""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field


class SupplierWeights(BaseModel):
    cost: float = Field(default=0.4, ge=0, le=1)
    lead_time: float = Field(default=0.3, ge=0, le=1)
    reliability: float = Field(default=0.3, ge=0, le=1)


class SupplierRecommendRequest(BaseModel):
    product_id: int
    quantity: float = Field(gt=0)
    weights: SupplierWeights = Field(default_factory=SupplierWeights)
    warehouse_id: int | None = None


class ProcurementGenerateRequest(BaseModel):
    warehouse_id: int | None = None
    product_ids: list[int] | None = None
    service_level: float = Field(default=0.95, ge=0.5, le=0.999)
    review_period_days: int = Field(default=7, ge=1, le=60)
    weights: SupplierWeights = Field(default_factory=SupplierWeights)
    persist: bool = True


class PurchaseOrderOut(BaseModel):
    id: int | None = None
    product_id: int
    sku: str
    product_name: str
    warehouse_code: str
    supplier_name: str
    quantity: float
    unit_price: float
    total_cost: float
    expected_delivery_date: date | None = None
    status: str
    explanation: str


class DisruptionCreate(BaseModel):
    supplier_id: int
    product_id: int | None = None
    disruption_type: str = Field(
        default="delivery_delay",
        description="delivery_delay | supplier_unavailable | lead_time_increase | reliability_reduction",
    )
    delay_days: int = Field(default=7, ge=0, le=90)
    reliability_delta: float = Field(default=-0.2, ge=-1.0, le=0.0)
    notes: str | None = None


class DisruptionOut(BaseModel):
    id: int
    supplier_id: int
    supplier_name: str
    product_id: int | None = None
    sku: str | None = None
    disruption_type: str
    delay_days: int
    severity: str
    status: str
    started_at: date
    expected_resolution_date: date | None = None
    notes: str


class DisruptionAssessmentOut(BaseModel):
    disruption: DisruptionOut
    affected_products: list[dict]
    affected_warehouses: list[dict]
    stockout_risk: dict
    alternative_suppliers: list[dict]
    transfer_suggestion: dict | None = None
    recovery: dict
