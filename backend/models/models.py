"""SQLAlchemy models for the supply-chain automation database.

Designed for Supabase PostgreSQL (production) and works unchanged on SQLite for
local development and tests. Every relationship used by the agents is modelled
with explicit foreign keys and indexes on the hot lookup paths.
"""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sku: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    category: Mapped[str] = mapped_column(String(80), default="general")
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    selling_price: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    inventory: Mapped[list["Inventory"]] = relationship(back_populates="product")
    offers: Mapped[list["SupplierProduct"]] = relationship(back_populates="product")


class Warehouse(Base):
    __tablename__ = "warehouses"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    location: Mapped[str] = mapped_column(String(160), default="")
    capacity: Mapped[float] = mapped_column(Float, default=10000.0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    inventory: Mapped[list["Inventory"]] = relationship(back_populates="warehouse")


class Inventory(Base):
    __tablename__ = "inventory"
    __table_args__ = (
        UniqueConstraint("product_id", "warehouse_id", name="uq_inventory_product_warehouse"),
        Index("ix_inventory_warehouse", "warehouse_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    current_stock: Mapped[float] = mapped_column(Float, default=0.0)
    reserved_stock: Mapped[float] = mapped_column(Float, default=0.0)
    incoming_stock: Mapped[float] = mapped_column(Float, default=0.0)
    max_capacity: Mapped[float | None] = mapped_column(Float, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    product: Mapped[Product] = relationship(back_populates="inventory")
    warehouse: Mapped[Warehouse] = relationship(back_populates="inventory")


class SalesHistory(Base):
    __tablename__ = "sales_history"
    __table_args__ = (
        UniqueConstraint(
            "sale_date", "product_id", "warehouse_id", name="uq_sales_date_product_warehouse"
        ),
        Index("ix_sales_product_date", "product_id", "sale_date"),
        Index("ix_sales_warehouse_date", "warehouse_id", "sale_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    sale_date: Mapped[date] = mapped_column(Date, nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    units_sold: Mapped[float] = mapped_column(Float, nullable=False)
    selling_price: Mapped[float] = mapped_column(Float, default=0.0)
    ingested_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped[Product] = relationship()
    warehouse: Mapped[Warehouse] = relationship()


class Supplier(Base):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(16), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    contact_email: Mapped[str] = mapped_column(String(160), default="")
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    offers: Mapped[list["SupplierProduct"]] = relationship(
        back_populates="supplier", cascade="all, delete-orphan"
    )


class SupplierProduct(Base):
    __tablename__ = "supplier_products"
    __table_args__ = (
        UniqueConstraint("supplier_id", "product_id", name="uq_supplier_product"),
        Index("ix_supplier_products_product", "product_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"))
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    unit_price: Mapped[float] = mapped_column(Float, nullable=False)
    lead_time_days: Mapped[float] = mapped_column(Float, default=7.0)
    reliability_score: Mapped[float] = mapped_column(Float, default=0.9)
    minimum_order_quantity: Mapped[float] = mapped_column(Float, default=1.0)
    is_preferred: Mapped[bool] = mapped_column(Boolean, default=False)

    supplier: Mapped[Supplier] = relationship(back_populates="offers")
    product: Mapped[Product] = relationship(back_populates="offers")


class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"
    __table_args__ = (Index("ix_purchase_orders_product", "product_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"))
    quantity: Mapped[float] = mapped_column(Float, nullable=False)
    unit_price: Mapped[float] = mapped_column(Float, default=0.0)
    total_cost: Mapped[float] = mapped_column(Float, default=0.0)
    order_date: Mapped[date] = mapped_column(Date, default=date.today)
    expected_delivery_date: Mapped[date] = mapped_column(Date, default=date.today)
    status: Mapped[str] = mapped_column(String(32), default="recommended", index=True)
    explanation: Mapped[str] = mapped_column(Text, default="")
    execution_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped[Product] = relationship()
    warehouse: Mapped[Warehouse] = relationship()
    supplier: Mapped[Supplier] = relationship()


class DemandForecast(Base):
    __tablename__ = "demand_forecasts"
    __table_args__ = (
        Index("ix_forecast_product_date", "product_id", "forecast_date"),
        Index("ix_forecast_execution", "execution_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    warehouse_id: Mapped[int | None] = mapped_column(
        ForeignKey("warehouses.id", ondelete="CASCADE"), nullable=True
    )
    forecast_date: Mapped[date] = mapped_column(Date, nullable=False)
    horizon_days: Mapped[int] = mapped_column(Integer, default=7)
    predicted_units: Mapped[float] = mapped_column(Float, default=0.0)
    avg_daily_demand: Mapped[float] = mapped_column(Float, default=0.0)
    model_name: Mapped[str] = mapped_column(String(64), default="xgboost")
    execution_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped[Product] = relationship()
    warehouse: Mapped[Warehouse] = relationship()


class InventoryRecommendation(Base):
    __tablename__ = "inventory_recommendations"
    __table_args__ = (Index("ix_recommendations_product", "product_id", "warehouse_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    avg_daily_demand: Mapped[float] = mapped_column(Float, default=0.0)
    safety_stock: Mapped[float] = mapped_column(Float, default=0.0)
    reorder_point: Mapped[float] = mapped_column(Float, default=0.0)
    target_stock: Mapped[float] = mapped_column(Float, default=0.0)
    available_stock: Mapped[float] = mapped_column(Float, default=0.0)
    incoming_stock: Mapped[float] = mapped_column(Float, default=0.0)
    recommended_quantity: Mapped[float] = mapped_column(Float, default=0.0)
    lead_time_days: Mapped[float] = mapped_column(Float, default=7.0)
    alert_level: Mapped[str] = mapped_column(String(24), default="ok")
    stockout_risk: Mapped[bool] = mapped_column(Boolean, default=False)
    explanation: Mapped[str] = mapped_column(Text, default="")
    execution_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped[Product] = relationship()
    warehouse: Mapped[Warehouse] = relationship()


class WarehouseTransfer(Base):
    __tablename__ = "warehouse_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id", ondelete="CASCADE"))
    from_warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    to_warehouse_id: Mapped[int] = mapped_column(ForeignKey("warehouses.id", ondelete="CASCADE"))
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    reason: Mapped[str] = mapped_column(Text, default="")
    feasible: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(24), default="recommended")
    execution_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    product: Mapped[Product] = relationship()
    from_warehouse: Mapped[Warehouse] = relationship(foreign_keys=[from_warehouse_id])
    to_warehouse: Mapped[Warehouse] = relationship(foreign_keys=[to_warehouse_id])


class SupplierDisruption(Base):
    __tablename__ = "supplier_disruptions"
    __table_args__ = (Index("ix_disruption_supplier", "supplier_id", "status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id", ondelete="CASCADE"))
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="CASCADE"), nullable=True
    )
    disruption_type: Mapped[str] = mapped_column(String(40), default="delivery_delay")
    delay_days: Mapped[int] = mapped_column(Integer, default=0)
    reliability_delta: Mapped[float] = mapped_column(Float, default=0.0)
    started_at: Mapped[date] = mapped_column(Date, default=date.today)
    expected_resolution_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(24), default="active", index=True)
    severity: Mapped[str] = mapped_column(String(24), default="medium")
    notes: Mapped[str] = mapped_column(Text, default="")
    execution_id: Mapped[str | None] = mapped_column(String(36), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    supplier: Mapped[Supplier] = relationship()
    product: Mapped[Product] = relationship()


class AgentExecution(Base):
    __tablename__ = "agent_executions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    status: Mapped[str] = mapped_column(String(24), default="queued", index=True)
    scenario: Mapped[str] = mapped_column(String(64), default="standard_workflow")
    current_agent: Mapped[str | None] = mapped_column(String(64), nullable=True)
    horizon_days: Mapped[int] = mapped_column(Integer, default=7)
    service_level: Mapped[float] = mapped_column(Float, default=0.95)
    focus_product_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    logs: Mapped[list["AgentLog"]] = relationship(
        back_populates="execution", cascade="all, delete-orphan"
    )


class AgentLog(Base):
    __tablename__ = "agent_logs"
    __table_args__ = (Index("ix_agent_logs_execution_step", "execution_id", "step_index"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    execution_id: Mapped[str] = mapped_column(
        ForeignKey("agent_executions.id", ondelete="CASCADE")
    )
    agent_name: Mapped[str] = mapped_column(String(64), nullable=False)
    step_index: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(24), default="completed")
    message: Mapped[str] = mapped_column(Text, default="")
    payload: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    execution: Mapped[AgentExecution] = relationship(back_populates="logs")


class WorkflowResult(Base):
    __tablename__ = "workflow_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    execution_id: Mapped[str] = mapped_column(String(36), index=True, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="completed")
    verification: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    decisions: Mapped[list | None] = mapped_column(JSON, nullable=True)
    summary: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
