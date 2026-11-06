"""Dashboard reporting: aggregated KPIs and CSV exports."""

from __future__ import annotations

from datetime import datetime, timezone
from io import StringIO
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from backend.models.models import (
    AgentExecution,
    AgentLog,
    DemandForecast,
    Inventory,
    InventoryRecommendation,
    Product,
    PurchaseOrder,
    SalesHistory,
    Supplier,
    SupplierDisruption,
    Warehouse,
    WarehouseTransfer,
)
from backend.services.analytics import finished_forecast_inventory_value
from backend.services.inventory_service import build_inventory_view
from forecasting.train import load_metrics

REPORT_TYPES = (
    "inventory",
    "forecasts",
    "purchase_orders",
    "transfers",
    "disruptions",
    "agent_executions",
    "sales",
)


def _count(session: Session, model: Any) -> int:
    return int(session.scalar(select(func.count()).select_from(model)) or 0)


def summary(session: Session) -> dict[str, Any]:
    """Executive KPIs computed from live rows (never hardcoded)."""
    view = build_inventory_view(session)
    alerts = {
        "critical": sum(1 for r in view if r["alert_level"] in ("critical", "stockout")),
        "low": sum(1 for r in view if r["alert_level"] == "low"),
        "overstock": sum(1 for r in view if r["alert_level"] == "overstock"),
        "ok": sum(1 for r in view if r["alert_level"] == "ok"),
    }
    pending_count, pending_value = session.execute(
        select(func.count(), func.coalesce(func.sum(PurchaseOrder.total_cost), 0.0)).where(
            PurchaseOrder.status.in_(("recommended", "pending"))
        )
    ).first()
    active_disruptions = session.scalars(
        select(SupplierDisruption).where(SupplierDisruption.status == "active")
    ).all()
    executions = session.scalars(
        select(AgentExecution)
        .order_by(AgentExecution.started_at.desc(), AgentExecution.id.desc())
        .limit(5)
    ).all()

    metrics = load_metrics()
    trained = [p for p in metrics.get("products", []) if p.get("trained")]
    xgb_wape = [p["metrics"]["xgboost"]["wape"] for p in trained if p.get("metrics")]
    base_wape = [
        p["metrics"]["moving_average"]["wape"] for p in trained if p.get("metrics")
    ]
    sales_min, sales_max = session.execute(
        select(func.min(SalesHistory.sale_date), func.max(SalesHistory.sale_date))
    ).first() or (None, None)

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_source": "synthetic_demo_plus_uploads",
        "totals": {
            "products": _count(session, Product),
            "warehouses": _count(session, Warehouse),
            "suppliers": _count(session, Supplier),
            "active_suppliers": int(
                session.scalar(
                    select(func.count()).select_from(Supplier).where(Supplier.status == "active")
                )
                or 0
            ),
            "inventory_value": round(finished_forecast_inventory_value(session), 2),
            "sales_rows": _count(session, SalesHistory),
            "inventory_rows": _count(session, Inventory),
        },
        "inventory": {
            "alerts": alerts,
            "low_stock_products": sorted({r["sku"] for r in view if r["alert_level"] == "low"}),
            "critical_products": sorted(
                {r["sku"] for r in view if r["alert_level"] in ("critical", "stockout")}
            ),
            "overstocked_products": sorted(
                {r["sku"] for r in view if r["alert_level"] == "overstock"}
            ),
            "stockout_risk_items": sum(1 for r in view if r["stockout_risk"]),
            "replenishment_required": sum(
                1 for r in view if r["recommended_order_quantity"] > 0
            ),
            "recommended_order_units": round(
                sum(r["recommended_order_quantity"] for r in view), 2
            ),
        },
        "forecasting": {
            "models_trained": metrics.get("n_trained", 0),
            "models_with_fallback": metrics.get("n_fallback", 0),
            "avg_xgboost_wape": round(sum(xgb_wape) / len(xgb_wape), 4) if xgb_wape else None,
            "avg_baseline_wape": round(sum(base_wape) / len(base_wape), 4) if base_wape else None,
            "persisted_forecast_rows": _count(session, DemandForecast),
            "last_trained_at": metrics.get("trained_at"),
        },
        "procurement": {
            "pending_recommendations": int(pending_count or 0),
            "pending_value": round(float(pending_value or 0.0), 2),
            "purchase_orders": _count(session, PurchaseOrder),
        },
        "disruptions": {
            "active": len(active_disruptions),
            "critical": sum(1 for d in active_disruptions if d.severity == "critical"),
            "by_severity": {
                severity: sum(1 for d in active_disruptions if d.severity == severity)
                for severity in ("critical", "high", "medium", "low")
            },
        },
        "transfers": {
            "records": _count(session, WarehouseTransfer),
            "units": round(
                float(
                    session.scalar(
                        select(func.coalesce(func.sum(WarehouseTransfer.quantity), 0.0))
                    )
                    or 0.0
                ),
                2,
            ),
        },
        "recommendations": {"records": _count(session, InventoryRecommendation)},
        "sales_history": {
            "date_range": (
                (sales_min.isoformat(), sales_max.isoformat())
                if sales_min and sales_max
                else None
            )
        },
        "recent_executions": [
            {
                "execution_id": execution.id,
                "status": execution.status,
                "scenario": execution.scenario,
                "started_at": execution.started_at.isoformat() if execution.started_at else None,
                "finished_at": execution.finished_at.isoformat() if execution.finished_at else None,
                "summary": execution.summary,
            }
            for execution in executions
        ],
        "agent_statistics": agent_statistics(session),
    }


def agent_statistics(session: Session) -> dict[str, Any]:
    total = _count(session, AgentExecution)
    completed = int(
        session.scalar(
            select(func.count())
            .select_from(AgentExecution)
            .where(AgentExecution.status == "completed")
        )
        or 0
    )
    failed = int(
        session.scalar(
            select(func.count())
            .select_from(AgentExecution)
            .where(AgentExecution.status == "failed")
        )
        or 0
    )
    timed = session.execute(
        select(AgentExecution.started_at, AgentExecution.finished_at).where(
            AgentExecution.finished_at.is_not(None),
            AgentExecution.started_at.is_not(None),
        )
    ).all()
    durations = [
        (finished - started).total_seconds()
        for started, finished in timed
        if started is not None and finished is not None and finished >= started
    ]
    per_agent = session.execute(
        select(AgentLog.agent_name, func.count(), func.avg(AgentLog.duration_ms))
        .where(AgentLog.status == "completed")
        .group_by(AgentLog.agent_name)
        .order_by(func.count().desc())
    ).all()
    return {
        "executions": total,
        "completed": completed,
        "failed": failed,
        "success_rate": round(completed / total, 4) if total else None,
        "avg_execution_seconds": (
            round(sum(durations) / len(durations), 2) if durations else None
        ),
        "agent_logs": _count(session, AgentLog),
        "per_agent": [
            {
                "agent_name": name,
                "runs": int(count),
                "avg_duration_ms": round(float(duration or 0), 1),
            }
            for name, count, duration in per_agent
        ],
    }


def export_csv(session: Session, report: str) -> tuple[str, str]:
    """Return (filename, csv_text) for a downloadable report."""
    key = report.strip().lower()
    buffer = StringIO()

    if key == "inventory":
        rows = build_inventory_view(session)
        columns = [
            "sku",
            "product_name",
            "warehouse_code",
            "current_stock",
            "reserved_stock",
            "available_stock",
            "incoming_stock",
            "avg_daily_demand",
            "safety_stock",
            "reorder_point",
            "target_stock",
            "recommended_order_quantity",
            "alert_level",
            "stockout_risk",
            "days_of_cover",
        ]
        _write_rows(buffer, columns, rows)
        return "inventory_report.csv", buffer.getvalue()

    if key == "forecasts":
        rows = session.execute(
            select(DemandForecast, Product)
            .join(Product, Product.id == DemandForecast.product_id)
            .order_by(DemandForecast.forecast_date)
        ).all()
        columns = [
            "sku",
            "product_name",
            "forecast_date",
            "predicted_units",
            "model_name",
            "horizon_days",
        ]
        _write_rows(
            buffer,
            columns,
            [
                {
                    "sku": product.sku,
                    "product_name": product.name,
                    "forecast_date": forecast.forecast_date.isoformat(),
                    "predicted_units": forecast.predicted_units,
                    "model_name": forecast.model_name,
                    "horizon_days": forecast.horizon_days,
                }
                for forecast, product in rows
            ],
        )
        return "forecast_report.csv", buffer.getvalue()

    if key == "purchase_orders":
        rows = session.execute(
            select(PurchaseOrder, Product, Supplier, Warehouse)
            .join(Product, Product.id == PurchaseOrder.product_id)
            .join(Supplier, Supplier.id == PurchaseOrder.supplier_id)
            .join(Warehouse, Warehouse.id == PurchaseOrder.warehouse_id)
            .order_by(PurchaseOrder.created_at.desc())
        ).all()
        columns = [
            "id",
            "sku",
            "warehouse_code",
            "supplier_name",
            "quantity",
            "unit_price",
            "total_cost",
            "expected_delivery_date",
            "status",
        ]
        _write_rows(
            buffer,
            columns,
            [
                {
                    "id": order.id,
                    "sku": product.sku,
                    "warehouse_code": warehouse.code,
                    "supplier_name": supplier.name,
                    "quantity": order.quantity,
                    "unit_price": order.unit_price,
                    "total_cost": order.total_cost,
                    "expected_delivery_date": order.expected_delivery_date.isoformat(),
                    "status": order.status,
                }
                for order, product, supplier, warehouse in rows
            ],
        )
        return "purchase_orders.csv", buffer.getvalue()

    if key == "transfers":
        rows = session.execute(
            select(WarehouseTransfer, Product).join(
                Product, Product.id == WarehouseTransfer.product_id
            )
        ).all()
        columns = [
            "id",
            "sku",
            "from_warehouse_id",
            "to_warehouse_id",
            "quantity",
            "feasible",
            "status",
            "reason",
        ]
        _write_rows(
            buffer,
            columns,
            [
                {
                    "id": transfer.id,
                    "sku": product.sku,
                    "from_warehouse_id": transfer.from_warehouse_id,
                    "to_warehouse_id": transfer.to_warehouse_id,
                    "quantity": transfer.quantity,
                    "feasible": transfer.feasible,
                    "status": transfer.status,
                    "reason": transfer.reason,
                }
                for transfer, product in rows
            ],
        )
        return "warehouse_transfers.csv", buffer.getvalue()

    if key == "disruptions":
        rows = session.execute(
            select(SupplierDisruption, Supplier)
            .join(Supplier, Supplier.id == SupplierDisruption.supplier_id)
            .order_by(SupplierDisruption.created_at.desc())
        ).all()
        columns = [
            "id",
            "supplier_name",
            "disruption_type",
            "delay_days",
            "severity",
            "status",
            "started_at",
            "expected_resolution_date",
        ]
        _write_rows(
            buffer,
            columns,
            [
                {
                    "id": disruption.id,
                    "supplier_name": supplier.name,
                    "disruption_type": disruption.disruption_type,
                    "delay_days": disruption.delay_days,
                    "severity": disruption.severity,
                    "status": disruption.status,
                    "started_at": disruption.started_at.isoformat(),
                    "expected_resolution_date": (
                        disruption.expected_resolution_date.isoformat()
                        if disruption.expected_resolution_date
                        else ""
                    ),
                }
                for disruption, supplier in rows
            ],
        )
        return "supplier_disruptions.csv", buffer.getvalue()

    if key == "agent_executions":
        rows = session.scalars(
            select(AgentExecution).order_by(AgentExecution.started_at.desc())
        ).all()
        columns = [
            "execution_id",
            "scenario",
            "status",
            "started_at",
            "finished_at",
            "error",
        ]
        _write_rows(
            buffer,
            columns,
            [
                {
                    "execution_id": execution.id,
                    "scenario": execution.scenario,
                    "status": execution.status,
                    "started_at": (
                        execution.started_at.isoformat() if execution.started_at else ""
                    ),
                    "finished_at": (
                        execution.finished_at.isoformat() if execution.finished_at else ""
                    ),
                    "error": execution.error or "",
                }
                for execution in rows
            ],
        )
        return "agent_executions.csv", buffer.getvalue()

    if key == "sales":
        rows = session.execute(
            select(SalesHistory, Product, Warehouse)
            .join(Product, Product.id == SalesHistory.product_id)
            .join(Warehouse, Warehouse.id == SalesHistory.warehouse_id)
            .order_by(SalesHistory.sale_date.desc())
            .limit(20000)
        ).all()
        columns = ["sale_date", "sku", "warehouse_code", "units_sold", "selling_price"]
        _write_rows(
            buffer,
            columns,
            [
                {
                    "sale_date": sale.sale_date.isoformat(),
                    "sku": product.sku,
                    "warehouse_code": warehouse.code,
                    "units_sold": sale.units_sold,
                    "selling_price": sale.selling_price,
                }
                for sale, product, warehouse in rows
            ],
        )
        return "sales_history.csv", buffer.getvalue()

    raise ValueError(f"Unknown report '{report}'. Available: {', '.join(REPORT_TYPES)}")


def _write_rows(buffer: StringIO, columns: list[str], rows: list[dict[str, Any]]) -> None:
    import csv

    writer = csv.DictWriter(buffer, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({column: row.get(column, "") for column in columns})
