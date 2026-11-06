"""Catalog endpoints: products, warehouses, inventory snapshot, suppliers."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.models.models import Product, Supplier, Warehouse
from backend.schemas.catalog import (
    InventoryOut,
    ProductCreate,
    ProductOut,
    SupplierOut,
    WarehouseOut,
)
from backend.services.inventory_service import build_inventory_view
from backend.services.procurement_service import supplier_catalog

router = APIRouter(prefix="/api", tags=["catalog"])


@router.get("/products", response_model=list[ProductOut])
def list_products(
    search: str | None = Query(default=None, description="Filter by SKU or name"),
    limit: int = Query(default=200, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_db),
) -> list[ProductOut]:
    stmt = select(Product).order_by(Product.sku).limit(limit).offset(offset)
    if search:
        like = f"%{search.strip()}%"
        stmt = stmt.where(Product.sku.ilike(like) | Product.name.ilike(like))
    return [ProductOut.model_validate(p) for p in session.scalars(stmt).all()]


@router.post("/products", response_model=ProductOut, status_code=201)
def create_product(payload: ProductCreate, session: Session = Depends(get_db)) -> ProductOut:
    product = Product(**payload.model_dump())
    session.add(product)
    try:
        session.commit()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(
            status_code=409, detail=f"A product with SKU '{payload.sku}' already exists."
        ) from exc
    session.refresh(product)
    return ProductOut.model_validate(product)


@router.get("/warehouses", response_model=list[WarehouseOut])
def list_warehouses(session: Session = Depends(get_db)) -> list[WarehouseOut]:
    rows = session.scalars(select(Warehouse).order_by(Warehouse.code)).all()
    return [WarehouseOut.model_validate(w) for w in rows]


@router.get("/inventory")
def list_inventory(
    warehouse_id: int | None = None,
    product_id: int | None = None,
    session: Session = Depends(get_db),
) -> list[dict]:
    """Inventory with live reorder point, safety stock, alerts and recommendations."""
    view = build_inventory_view(
        session,
        warehouse_id=warehouse_id,
        product_ids=[product_id] if product_id else None,
    )
    return view


@router.get("/inventory/raw", response_model=list[InventoryOut])
def list_inventory_raw(
    warehouse_id: int | None = None,
    session: Session = Depends(get_db),
) -> list[InventoryOut]:
    from backend.models.models import Inventory

    stmt = select(Inventory).order_by(Inventory.product_id)
    if warehouse_id:
        stmt = stmt.where(Inventory.warehouse_id == warehouse_id)
    return [InventoryOut.model_validate(row) for row in session.scalars(stmt).all()]


@router.get("/suppliers")
def list_suppliers(session: Session = Depends(get_db)) -> list[dict]:
    """Supplier master data with every product offer (for comparison pages)."""
    return supplier_catalog(session)


@router.get("/suppliers/summary", response_model=list[SupplierOut])
def supplier_summary(session: Session = Depends(get_db)) -> list[SupplierOut]:
    rows = session.scalars(select(Supplier).order_by(Supplier.name)).all()
    return [SupplierOut.model_validate(s) for s in rows]


@router.get("/suppliers/{supplier_id}/offers")
def supplier_offers_route(supplier_id: int, session: Session = Depends(get_db)) -> dict:
    supplier = session.get(Supplier, supplier_id)
    if supplier is None:
        raise HTTPException(status_code=404, detail=f"Supplier {supplier_id} not found.")
    return {
        "supplier_id": supplier.id,
        "supplier_name": supplier.name,
        "status": supplier.status,
        "offers": [
            {
                "product_id": offer.product_id,
                "sku": offer.product.sku,
                "product_name": offer.product.name,
                "unit_price": offer.unit_price,
                "lead_time_days": offer.lead_time_days,
                "reliability_score": offer.reliability_score,
                "minimum_order_quantity": offer.minimum_order_quantity,
            }
            for offer in supplier.offers
        ],
    }


@router.get("/dashboard/snapshot")
def dashboard_snapshot(session: Session = Depends(get_db)) -> dict:
    """Compact counts used by the executive dashboard header cards."""
    return {
        "products": int(session.scalar(select(func.count()).select_from(Product)) or 0),
        "warehouses": int(session.scalar(select(func.count()).select_from(Warehouse)) or 0),
        "suppliers": int(session.scalar(select(func.count()).select_from(Supplier)) or 0),
    }
