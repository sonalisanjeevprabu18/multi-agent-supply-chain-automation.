"""Procurement, supplier recommendation and disruption endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.database.session import get_db
from backend.schemas.procurement import (
    DisruptionCreate,
    ProcurementGenerateRequest,
    SupplierRecommendRequest,
)
from backend.services import procurement_service

router = APIRouter(prefix="/api", tags=["procurement"])


@router.post("/suppliers/recommend")
def recommend_suppliers(
    payload: SupplierRecommendRequest,
    session: Session = Depends(get_db),
) -> dict:
    """Rank suppliers for a product/quantity using weighted normalised criteria."""
    try:
        return procurement_service.recommend_suppliers(
            session,
            product_id=payload.product_id,
            quantity=payload.quantity,
            weights=payload.weights.model_dump(),
        )
    except procurement_service.ProcurementError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/procurement/generate")
def generate_purchase_orders(
    payload: ProcurementGenerateRequest,
    session: Session = Depends(get_db),
) -> dict:
    """Generate simulated purchase-order recommendations from inventory needs."""
    try:
        return procurement_service.generate_purchase_orders(
            session,
            warehouse_id=payload.warehouse_id,
            product_ids=payload.product_ids,
            service_level=payload.service_level,
            review_period_days=payload.review_period_days,
            weights=payload.weights.model_dump(),
            persist=payload.persist,
        )
    except procurement_service.ProcurementError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/procurement/orders")
def list_purchase_orders(
    limit: int = 200,
    session: Session = Depends(get_db),
) -> list[dict]:
    return procurement_service.stored_purchase_orders(session, limit=limit)


@router.post("/disruptions/simulate")
def simulate_disruption(
    payload: DisruptionCreate,
    session: Session = Depends(get_db),
) -> dict:
    """Record a simulated supplier disruption (never affects a real supplier)."""
    try:
        record = procurement_service.simulate_disruption(
            session,
            supplier_id=payload.supplier_id,
            product_id=payload.product_id,
            disruption_type=payload.disruption_type,
            delay_days=payload.delay_days,
            reliability_delta=payload.reliability_delta,
            notes=payload.notes,
        )
        return procurement_service.assess_disruption(session, record)
    except procurement_service.ProcurementError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/disruptions/active")
def active_disruptions(session: Session = Depends(get_db)) -> list[dict]:
    return procurement_service.active_disruptions(session)


@router.get("/disruptions/{disruption_id}/assessment")
def disruption_assessment(disruption_id: int, session: Session = Depends(get_db)) -> dict:
    active = {d["id"]: d for d in procurement_service.active_disruptions(session)}
    disruption = active.get(disruption_id)
    if disruption is None:
        raise HTTPException(
            status_code=404,
            detail=f"Active disruption {disruption_id} not found (it may be resolved).",
        )
    return procurement_service.assess_disruption(session, disruption)


@router.post("/disruptions/{disruption_id}/resolve")
def resolve_disruption(disruption_id: int, session: Session = Depends(get_db)) -> dict:
    try:
        return procurement_service.resolve_disruption(session, disruption_id)
    except procurement_service.ProcurementError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
