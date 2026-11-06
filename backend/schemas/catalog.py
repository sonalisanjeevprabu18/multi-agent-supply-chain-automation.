"""Schemas for catalog entities (products, warehouses, inventory, suppliers)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ProductCreate(BaseModel):
    sku: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=160)
    category: str = "general"
    unit_cost: float = Field(default=0.0, ge=0)
    selling_price: float = Field(default=0.0, ge=0)


class ProductOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    sku: str
    name: str
    category: str
    unit_cost: float
    selling_price: float


class WarehouseOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    location: str
    capacity: float


class InventoryOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    product_id: int
    warehouse_id: int
    current_stock: float
    reserved_stock: float
    incoming_stock: float
    max_capacity: float | None = None
    updated_at: datetime | None = None


class SupplierOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    name: str
    contact_email: str
    status: str
