"""Procurement service: supplier ranking, purchase orders, disruptions."""

from __future__ import annotations

from datetime import date
from typing import Any, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from backend.models.models import (
    Product,
    PurchaseOrder,
    Supplier,
    SupplierDisruption,
    Warehouse,
)
from backend.services.analytics import (
    demand_profile,
    inventory_rows,
    lead_time_for_product,
    supplier_offers,
)
from backend.services.inventory_service import build_inventory_view
from inventory.calculations import available_stock
from inventory.transfers import plan_transfer
from procurement.disruptions import (
    assess_stockout_risk,
    detect_disruptions,
    disruption_severity,
    effective_lead_time,
    find_alternative_suppliers,
    recovery_plan,
    simulated_disruption_record,
    validate_disruption,
)
from procurement.purchase_orders import (
    PurchaseOrderError,
    build_purchase_order,
    consolidate_orders,
)
from procurement.supplier_selection import (
    SupplierSelectionError,
    rank_for_quantity,
    score_suppliers,
)


class ProcurementError(ValueError):
    """Raised for invalid procurement / disruption requests."""


def supplier_catalog(session: Session) -> list[dict[str, Any]]:
    """Suppliers with their commercial terms, for the comparison page."""
    rows = session.execute(
        select(Supplier).order_by(Supplier.name)
    ).scalars().all()
    catalog: list[dict[str, Any]] = []
    for supplier in rows:
        offers = [
            {
                "product_id": offer.product_id,
                "sku": offer.product.sku,
                "product_name": offer.product.name,
                "unit_price": float(offer.unit_price),
                "lead_time_days": float(offer.lead_time_days),
                "reliability_score": float(offer.reliability_score),
                "minimum_order_quantity": float(offer.minimum_order_quantity),
            }
            for offer in supplier.offers
        ]
        catalog.append(
            {
                "id": supplier.id,
                "code": supplier.code,
                "name": supplier.name,
                "contact_email": supplier.contact_email,
                "status": supplier.status,
                "offers": offers,
            }
        )
    return catalog


def recommend_suppliers(
    session: Session,
    product_id: int,
    quantity: float,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    product = session.get(Product, product_id)
    if product is None:
        raise ProcurementError(f"Product {product_id} does not exist.")
    if quantity <= 0:
        raise ProcurementError("quantity must be greater than zero.")
    offers = supplier_offers(session, product_id)
    if not offers:
        raise ProcurementError(f"No supplier offers exist for product {product.sku}.")
    try:
        ranking = rank_for_quantity(offers, quantity, weights)
    except SupplierSelectionError as exc:
        raise ProcurementError(str(exc)) from exc
    return {
        "product_id": product.id,
        "sku": product.sku,
        "product_name": product.name,
        **ranking,
    }


def generate_purchase_orders(
    session: Session,
    *,
    warehouse_id: int | None = None,
    product_ids: Iterable[int] | None = None,
    service_level: float = 0.95,
    review_period_days: int = 7,
    weights: dict[str, float] | None = None,
    persist: bool = True,
    execution_id: str | None = None,
) -> dict[str, Any]:
    """Turn replenishment requirements into simulated purchase-order recommendations."""
    view = build_inventory_view(
        session,
        warehouse_id=warehouse_id,
        product_ids=product_ids,
        service_level=service_level,
        review_period_days=review_period_days,
    )
    orders: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    rankings: list[dict[str, Any]] = []

    for row in view:
        quantity = float(row["recommended_order_quantity"])
        if quantity <= 0:
            continue
        offers = supplier_offers(session, row["product_id"])
        if not offers:
            skipped.append(
                {
                    "product_id": row["product_id"],
                    "sku": row["sku"],
                    "warehouse_id": row["warehouse_id"],
                    "reason": "no supplier offers on file",
                }
            )
            continue
        try:
            ranked = score_suppliers(offers, quantity, weights)
        except SupplierSelectionError as exc:
            skipped.append(
                {
                    "product_id": row["product_id"],
                    "sku": row["sku"],
                    "warehouse_id": row["warehouse_id"],
                    "reason": str(exc),
                }
            )
            continue

        rankings.append(
            {
                "product_id": row["product_id"],
                "sku": row["sku"],
                "warehouse_id": row["warehouse_id"],
                "quantity": quantity,
                "ranked_suppliers": [
                    {
                        "supplier_id": offer["supplier_id"],
                        "supplier_name": offer["supplier_name"],
                        "score": offer["score"],
                        "eligible": offer["eligible"],
                        "unit_price": offer["unit_price"],
                        "lead_time_days": offer["lead_time_days"],
                        "reliability_score": offer["reliability_score"],
                        "meets_moq": offer["meets_moq"],
                        "explanation": offer["explanation"],
                    }
                    for offer in ranked
                ],
            }
        )

        best = next((offer for offer in ranked if offer.get("eligible")), None)
        if best is None:
            skipped.append(
                {
                    "product_id": row["product_id"],
                    "sku": row["sku"],
                    "warehouse_id": row["warehouse_id"],
                    "reason": "no eligible supplier satisfies status/MOQ constraints",
                }
            )
            continue
        try:
            order = build_purchase_order(
                product_id=row["product_id"],
                product_name=row["product_name"],
                warehouse_id=row["warehouse_id"],
                warehouse_name=row["warehouse_name"],
                quantity=quantity,
                supplier=best,
                order_date=date.today(),
                maximum_capacity=row.get("max_capacity"),
                incoming_stock=row["incoming_stock"],
                available_stock=row["available_stock"],
            )
        except PurchaseOrderError as exc:
            skipped.append(
                {
                    "product_id": row["product_id"],
                    "sku": row["sku"],
                    "warehouse_id": row["warehouse_id"],
                    "reason": str(exc),
                }
            )
            continue

        order.update(
            {
                "sku": row["sku"],
                "warehouse_code": row["warehouse_code"],
                "requirement": quantity,
                "alert_level": row["alert_level"],
            }
        )
        if persist:
            record = PurchaseOrder(
                product_id=row["product_id"],
                warehouse_id=row["warehouse_id"],
                supplier_id=best["supplier_id"],
                quantity=order["quantity"],
                unit_price=order["unit_price"],
                total_cost=order["total_cost"],
                order_date=date.fromisoformat(order["order_date"]),
                expected_delivery_date=date.fromisoformat(order["expected_delivery_date"]),
                status="recommended",
                explanation=order["explanation"],
                execution_id=execution_id,
            )
            session.add(record)
            session.flush()
            order["id"] = record.id
        orders.append(order)

    if persist:
        session.commit()
    return {
        "orders": orders,
        "rankings": rankings,
        "skipped": skipped,
        "summary": consolidate_orders(orders),
    }


def stored_purchase_orders(session: Session, limit: int = 200) -> list[dict[str, Any]]:
    stmt = (
        select(PurchaseOrder, Product, Warehouse, Supplier)
        .join(Product, Product.id == PurchaseOrder.product_id)
        .join(Warehouse, Warehouse.id == PurchaseOrder.warehouse_id)
        .join(Supplier, Supplier.id == PurchaseOrder.supplier_id)
        .order_by(PurchaseOrder.created_at.desc(), PurchaseOrder.id.desc())
        .limit(limit)
    )
    output = []
    for order, product, warehouse, supplier in session.execute(stmt).all():
        output.append(
            {
                "id": order.id,
                "product_id": product.id,
                "sku": product.sku,
                "product_name": product.name,
                "warehouse_id": warehouse.id,
                "warehouse_code": warehouse.code,
                "supplier_id": supplier.id,
                "supplier_name": supplier.name,
                "quantity": float(order.quantity),
                "unit_price": float(order.unit_price),
                "total_cost": float(order.total_cost),
                "order_date": order.order_date.isoformat(),
                "expected_delivery_date": order.expected_delivery_date.isoformat(),
                "status": order.status,
                "explanation": order.explanation,
                "execution_id": order.execution_id,
            }
        )
    return output


def simulate_disruption(
    session: Session,
    *,
    supplier_id: int,
    product_id: int | None,
    disruption_type: str,
    delay_days: int,
    reliability_delta: float,
    notes: str | None = None,
    execution_id: str | None = None,
) -> dict[str, Any]:
    """Persist a simulated disruption event (never affects a real supplier)."""
    validated = validate_disruption(disruption_type, delay_days, reliability_delta)
    supplier = session.get(Supplier, supplier_id)
    if supplier is None:
        raise ProcurementError(f"Supplier {supplier_id} does not exist.")
    if supplier.status != "active":
        raise ProcurementError(
            f"Supplier {supplier.name} is {supplier.status}; simulate disruptions on an active supplier."
        )
    if product_id is not None and session.get(Product, product_id) is None:
        raise ProcurementError(f"Product {product_id} does not exist.")

    payload = simulated_disruption_record(
        supplier={"supplier_id": supplier.id, "supplier_name": supplier.name},
        product_id=product_id,
        disruption_type=validated["disruption_type"],
        delay_days=validated["delay_days"],
        reliability_delta=validated["reliability_delta"],
        notes=notes,
    )
    record = SupplierDisruption(
        supplier_id=supplier.id,
        product_id=product_id,
        disruption_type=validated["disruption_type"],
        delay_days=validated["delay_days"],
        reliability_delta=validated["reliability_delta"],
        started_at=date.fromisoformat(payload["started_at"]),
        expected_resolution_date=(
            date.fromisoformat(payload["expected_resolution_date"])
            if payload.get("expected_resolution_date")
            else None
        ),
        status="active",
        severity="medium",
        notes=payload["notes"],
        execution_id=execution_id,
    )
    session.add(record)
    session.commit()
    return serialize_disruption(record, session)


def serialize_disruption(record: SupplierDisruption, session: Session) -> dict[str, Any]:
    supplier = session.get(Supplier, record.supplier_id)
    product = session.get(Product, record.product_id) if record.product_id else None
    return {
        "id": record.id,
        "supplier_id": record.supplier_id,
        "supplier_name": supplier.name if supplier else "",
        "product_id": record.product_id,
        "sku": product.sku if product else None,
        "disruption_type": record.disruption_type,
        "delay_days": record.delay_days,
        "reliability_delta": float(record.reliability_delta),
        "severity": record.severity,
        "status": record.status,
        "started_at": record.started_at.isoformat(),
        "expected_resolution_date": (
            record.expected_resolution_date.isoformat()
            if record.expected_resolution_date
            else None
        ),
        "notes": record.notes,
    }


def active_disruptions(session: Session, as_of: date | None = None) -> list[dict[str, Any]]:
    records = session.scalars(
        select(SupplierDisruption).order_by(SupplierDisruption.created_at.desc())
    ).all()
    payloads: list[dict[str, Any]] = []
    for record in records:
        supplier = session.get(Supplier, record.supplier_id)
        product = session.get(Product, record.product_id) if record.product_id else None
        payloads.append(
            {
                "id": record.id,
                "supplier_id": record.supplier_id,
                "supplier_name": supplier.name if supplier else "",
                "supplier_status": supplier.status if supplier else "unknown",
                "product_id": record.product_id,
                "sku": product.sku if product else None,
                "product_name": product.name if product else None,
                "disruption_type": record.disruption_type,
                "delay_days": record.delay_days,
                "reliability_delta": float(record.reliability_delta),
                "status": record.status,
                "severity": record.severity,
                "started_at": record.started_at,
                "expected_resolution_date": record.expected_resolution_date,
                "notes": record.notes,
                "created_at": record.created_at,
            }
        )
    active = detect_disruptions(disruptions=payloads, as_of=as_of)
    for payload in active:  # make the payload JSON-serialisable
        payload["started_at"] = payload["started_at"].isoformat() if payload["started_at"] else None
        payload["expected_resolution_date"] = (
            payload["expected_resolution_date"].isoformat()
            if payload.get("expected_resolution_date")
            else None
        )
        payload["created_at"] = payload["created_at"].isoformat() if payload.get("created_at") else None
    return active


def assess_disruption(
    session: Session,
    disruption: dict[str, Any],
    *,
    quantity: float | None = None,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Quantify impact, rank alternatives and propose a recovery action."""
    supplier = session.get(Supplier, int(disruption["supplier_id"]))
    if supplier is None:
        raise ProcurementError("Disruption references a supplier that no longer exists.")

    affected_product_ids: list[int] = []
    if disruption.get("product_id"):
        affected_product_ids = [int(disruption["product_id"])]
    else:
        affected_product_ids = [
            offer.product_id for offer in supplier.offers
        ]
    products = {
        p.id: p
        for p in session.scalars(select(Product).where(Product.id.in_(affected_product_ids))).all()
    }

    profile = demand_profile(session, product_ids=affected_product_ids)
    stock_rows = inventory_rows(session, product_ids=affected_product_ids)

    affected_products: list[dict[str, Any]] = []
    affected_warehouses: list[dict[str, Any]] = []
    alternatives: list[dict[str, Any]] = []
    worst: dict[str, Any] | None = None
    overall_risk = "low"
    risk_order = {"unknown": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}

    for product_id, product in products.items():
        terms = lead_time_for_product(session, product_id)
        wait = effective_lead_time(terms, disruption)
        offers = supplier_offers(session, product_id)
        alternatives = find_alternative_suppliers(
            product_id=product_id,
            offers=offers,
            excluded_supplier_ids=[supplier.id],
            quantity=quantity or 0.0,
            weights=weights,
        )
        best_alternative = next((a for a in alternatives if a.get("eligible")), None)

        for row in stock_rows:
            if row["product_id"] != product_id:
                continue
            stats = profile.get((product_id, row["warehouse_id"]), {})
            avg_daily = float(stats.get("avg_daily_demand", 0.0))
            available = available_stock(row["current_stock"], row["reserved_stock"])
            risk = assess_stockout_risk(
                available_stock=available,
                avg_daily_demand=avg_daily,
                days_until_delivery=wait,
            )
            affected_warehouses.append(
                {
                    "warehouse_id": row["warehouse_id"],
                    "warehouse_code": row["warehouse_code"],
                    "warehouse_name": row["warehouse_name"],
                    "available_stock": round(available, 2),
                    "avg_daily_demand": round(avg_daily, 4),
                    "days_until_delivery": round(wait, 2),
                    **risk,
                }
            )
            if risk_order.get(risk["risk"], 0) >= risk_order.get(overall_risk, 1):
                overall_risk = risk["risk"]
                worst = {
                    **row,
                    "available": available,
                    "avg_daily": avg_daily,
                    "wait": wait,
                    "risk": risk,
                    "best_alternative": best_alternative,
                    "alternatives": alternatives,
                }
        affected_products.append(
            {
                "product_id": product_id,
                "sku": product.sku,
                "product_name": product.name,
                "base_lead_time_days": terms["lead_time_days"],
                "effective_lead_time_days": round(wait, 2),
                "alternative_supplier_count": len(alternatives),
            }
        )

    transfer_suggestion = None
    transfer_feasible = False
    transfer_quantity = 0.0
    if worst is not None and worst["avg_daily"] > 0:
        need = max(
            0.0,
            worst["avg_daily"] * worst["wait"] - worst["available"],
        )
        same_product_rows = [r for r in stock_rows if r["product_id"] == worst["product_id"]]
        sources = [
            {
                "warehouse_id": r["warehouse_id"],
                "warehouse_name": r["warehouse_name"],
                "current_stock": r["current_stock"],
                "reserved_stock": r["reserved_stock"],
                "incoming_stock": r["incoming_stock"],
                "safety_stock": 0.0,
            }
            for r in same_product_rows
        ]
        # protect each source's own safety stock by using its reorder-point headroom
        view = build_inventory_view(
            session, product_ids=[worst["product_id"]]
        )
        safety_by_warehouse = {
            row["warehouse_id"]: row["safety_stock"] for row in view
        }
        for source in sources:
            source["safety_stock"] = safety_by_warehouse.get(source["warehouse_id"], 0.0)
        transfer_suggestion = plan_transfer(
            product_id=worst["product_id"],
            destination_warehouse_id=worst["warehouse_id"],
            destination_need=need,
            sources=sources,
        )
        transfer_feasible = transfer_suggestion["feasible"]
        transfer_quantity = transfer_suggestion["allocated_quantity"]

    recovery = recovery_plan(
        stockout_risk=overall_risk,
        alternative_supplier=worst["best_alternative"] if worst else None,
        transfer_feasible=transfer_feasible,
        transfer_quantity=transfer_quantity,
    )

    severity = disruption_severity(disruption.get("delay_days", 0), overall_risk)
    record = session.get(SupplierDisruption, int(disruption["id"]))
    if record is not None and record.severity != severity:
        record.severity = severity
        session.commit()

    return {
        "disruption": {**disruption, "severity": severity},
        "overall_stockout_risk": overall_risk,
        "affected_products": affected_products,
        "affected_warehouses": affected_warehouses,
        "alternative_suppliers": alternatives,
        "transfer_suggestion": transfer_suggestion,
        "recovery": recovery,
        "summary": _assessment_summary(
            supplier.name, overall_risk, affected_products, recovery, transfer_suggestion
        ),
    }


def _assessment_summary(
    supplier_name: str,
    risk: str,
    products: list[dict[str, Any]],
    recovery: dict[str, Any],
    transfer: dict[str, Any] | None,
) -> str:
    skus = ", ".join(p["sku"] for p in products) or "no products"
    text = (
        f"Disruption at {supplier_name} affects {skus} with an overall stockout risk of {risk}. "
        f"Recommended recovery: {', '.join(recovery.get('actions', []))}."
    )
    if transfer:
        text += f" Internal transfer of {transfer['allocated_quantity']:.0f} units is available."
    return text


def resolve_disruption(session: Session, disruption_id: int) -> dict[str, Any]:
    record = session.get(SupplierDisruption, disruption_id)
    if record is None:
        raise ProcurementError(f"Disruption {disruption_id} does not exist.")
    record.status = "resolved"
    session.commit()
    return serialize_disruption(record, session)
