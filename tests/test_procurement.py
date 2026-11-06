"""Unit tests for supplier scoring, purchase orders and disruption handling."""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from procurement.disruptions import (
    DisruptionError,
    assess_stockout_risk,
    detect_disruptions,
    disruption_severity,
    effective_lead_time,
    recovery_plan,
    validate_disruption,
)
from procurement.purchase_orders import (
    PurchaseOrderError,
    build_purchase_order,
    consolidate_orders,
    expected_delivery_date,
    validate_order_against_requirement,
)
from procurement.supplier_selection import (
    SupplierSelectionError,
    normalise_weights,
    rank_for_quantity,
    score_suppliers,
    select_best_supplier,
)


def _offers() -> list[dict]:
    return [
        {
            "supplier_id": 1,
            "supplier_name": "Cheap but Slow",
            "unit_price": 8.0,
            "lead_time_days": 20,
            "reliability_score": 0.75,
            "minimum_order_quantity": 10,
            "supplier_status": "active",
        },
        {
            "supplier_id": 2,
            "supplier_name": "Balanced",
            "unit_price": 10.0,
            "lead_time_days": 7,
            "reliability_score": 0.95,
            "minimum_order_quantity": 10,
            "supplier_status": "active",
        },
        {
            "supplier_id": 3,
            "supplier_name": "Premium Fast",
            "unit_price": 12.0,
            "lead_time_days": 3,
            "reliability_score": 0.9,
            "minimum_order_quantity": 10,
            "supplier_status": "active",
        },
        {
            "supplier_id": 4,
            "supplier_name": "Suspended Co",
            "unit_price": 5.0,
            "lead_time_days": 2,
            "reliability_score": 0.99,
            "minimum_order_quantity": 1,
            "supplier_status": "suspended",
        },
    ]


def test_weights_are_normalised():
    weights = normalise_weights({"cost": 2, "lead_time": 1, "reliability": 1})
    assert weights == {"cost": 0.5, "lead_time": 0.25, "reliability": 0.25}
    assert sum(normalise_weights(None).values()) == pytest.approx(1.0)


def test_score_suppliers_excludes_inactive_and_ranks_all():
    ranked = score_suppliers(_offers(), 100, {"cost": 0.4, "lead_time": 0.3, "reliability": 0.3})
    assert len(ranked) == 4
    assert ranked[0]["eligible"] is True
    suspended = next(o for o in ranked if o["supplier_id"] == 4)
    assert suspended["eligible"] is False
    assert suspended["score"] == 0.0
    assert "not accepting orders" in suspended["disqualification_reason"]
    for offer in ranked:
        assert 0 <= offer["score"] <= 100


def test_cost_weight_drives_cheapest_selection():
    ranked = score_suppliers(_offers(), 100, {"cost": 1.0, "lead_time": 0.0, "reliability": 0.0})
    assert ranked[0]["supplier_id"] == 1
    assert ranked[0]["component_scores"]["cost"] == 1.0


def test_lead_time_weight_drives_fastest_selection():
    ranked = score_suppliers(_offers(), 100, {"cost": 0.0, "lead_time": 1.0, "reliability": 0.0})
    assert ranked[0]["supplier_id"] == 3


def test_reliability_weight_drives_most_reliable_selection():
    ranked = score_suppliers(
        _offers(), 100, {"cost": 0.0, "lead_time": 0.0, "reliability": 1.0}
    )
    assert ranked[0]["supplier_id"] == 2


def test_moq_violation_disqualifies_supplier():
    ranked = score_suppliers(_offers(), quantity=5, weights=None)
    eligible = [o for o in ranked if o["eligible"]]
    assert eligible == []
    active = [o for o in ranked if o["supplier_status"] == "active"]
    assert active and all(
        "minimum order quantity" in o["disqualification_reason"] for o in active
    )


def test_best_supplier_raises_when_nothing_eligible():
    with pytest.raises(SupplierSelectionError):
        select_best_supplier(_offers(), quantity=5)


def test_rank_for_quantity_payload():
    payload = rank_for_quantity(_offers(), 100)
    assert payload["recommended_supplier_id"] in (1, 2, 3)
    assert payload["weights"]["cost"] == pytest.approx(0.4)
    assert payload["recommendation"]


def test_purchase_order_totals_and_delivery_date():
    supplier = {
        "supplier_id": 2,
        "supplier_name": "Balanced",
        "unit_price": 10.0,
        "lead_time_days": 7,
        "minimum_order_quantity": 10,
        "score": 88.5,
    }
    order = build_purchase_order(
        product_id=1,
        product_name="Widget",
        warehouse_id=1,
        warehouse_name="Central",
        quantity=120,
        supplier=supplier,
        order_date=date(2026, 11, 1),
        maximum_capacity=1000,
        incoming_stock=0,
        available_stock=100,
    )
    assert order["total_cost"] == 1200.0
    assert order["expected_delivery_date"] == "2026-11-08"
    assert order["status"] == "recommended"
    assert expected_delivery_date(date(2026, 11, 1), 7) == date(2026, 11, 8)


def test_purchase_order_rejects_moq_and_capacity_violations():
    supplier = {
        "supplier_id": 2,
        "supplier_name": "Balanced",
        "unit_price": 10.0,
        "lead_time_days": 7,
        "minimum_order_quantity": 50,
    }
    with pytest.raises(PurchaseOrderError):
        build_purchase_order(
            product_id=1,
            product_name="Widget",
            warehouse_id=1,
            warehouse_name="Central",
            quantity=20,
            supplier=supplier,
        )
    with pytest.raises(PurchaseOrderError):
        build_purchase_order(
            product_id=1,
            product_name="Widget",
            warehouse_id=1,
            warehouse_name="Central",
            quantity=200,
            supplier={**supplier, "minimum_order_quantity": 10},
            maximum_capacity=150,
            available_stock=100,
        )


def test_consolidate_and_validate_orders():
    orders = [
        {"supplier_id": 1, "total_cost": 100.0, "quantity": 10},
        {"supplier_id": 2, "total_cost": 50.0, "quantity": 5},
    ]
    summary = consolidate_orders(orders)
    assert summary["order_count"] == 2
    assert summary["total_cost"] == 150.0
    check = validate_order_against_requirement(orders[0], required_quantity=12)
    assert check["covered"] is False
    assert check["shortfall"] == 2


# ----------------------------------------------------------- disruptions
def test_validate_disruption_rules():
    assert validate_disruption("delivery_delay", 5, -0.2)["delay_days"] == 5
    with pytest.raises(DisruptionError):
        validate_disruption("meteor_strike", 5, -0.2)
    with pytest.raises(DisruptionError):
        validate_disruption("delivery_delay", 0, -0.2)
    with pytest.raises(DisruptionError):
        validate_disruption("delivery_delay", 5, 0.5)
    with pytest.raises(DisruptionError):
        validate_disruption("delivery_delay", 200, -0.2)


def test_detect_disruptions_filters_status_and_dates():
    today = date(2026, 11, 5)
    events = [
        {"id": 1, "status": "active", "started_at": "2026-11-01", "expected_resolution_date": "2026-11-20"},
        {"id": 2, "status": "resolved", "started_at": "2026-11-01"},
        {"id": 3, "status": "active", "started_at": "2026-11-10"},
        {"id": 4, "status": "active", "started_at": "2026-10-01", "expected_resolution_date": "2026-10-15"},
    ]
    active = detect_disruptions(disruptions=events, as_of=today)
    assert [e["id"] for e in active] == [1]


def test_effective_lead_time_extends_for_delay():
    supplier = {"lead_time_days": 7}
    assert effective_lead_time(supplier, None) == 7
    assert effective_lead_time(
        supplier, {"disruption_type": "delivery_delay", "delay_days": 5}
    ) == 12
    # an unavailable supplier is assumed to cost at least 7 extra days
    assert effective_lead_time(
        supplier, {"disruption_type": "supplier_unavailable", "delay_days": 3}
    ) == 14


def test_assess_stockout_risk_levels():
    safe = assess_stockout_risk(
        available_stock=500, avg_daily_demand=20, days_until_delivery=7
    )
    assert safe["risk"] == "low"
    critical = assess_stockout_risk(
        available_stock=20, avg_daily_demand=20, days_until_delivery=10
    )
    assert critical["risk"] == "critical"
    assert critical["projected_shortfall"] == pytest.approx(180.0)
    unknown = assess_stockout_risk(
        available_stock=20, avg_daily_demand=0, days_until_delivery=10
    )
    assert unknown["risk"] == "unknown"


def test_disruption_severity_mapping():
    assert disruption_severity(10, "critical") == "critical"
    assert disruption_severity(10, "high") == "high"
    assert disruption_severity(3, "high") == "medium"
    assert disruption_severity(1, "low") == "low"


def test_recovery_plan_prefers_transfer_when_feasible():
    plan = recovery_plan(
        stockout_risk="critical",
        alternative_supplier={"supplier_name": "Alt", "lead_time_days": 5, "score": 80},
        transfer_feasible=True,
        transfer_quantity=120,
    )
    assert "transfer_stock" in plan["actions"]
    assert "switch_supplier" in plan["actions"]
    assert plan["recovery_needed"] is True


def test_recovery_plan_monitor_when_risk_low():
    plan = recovery_plan(
        stockout_risk="low",
        alternative_supplier=None,
        transfer_feasible=False,
        transfer_quantity=0,
    )
    assert plan["actions"] == ["monitor"]
    assert plan["recovery_needed"] is False


def test_recovery_plan_expedites_when_nothing_else_works():
    plan = recovery_plan(
        stockout_risk="high",
        alternative_supplier=None,
        transfer_feasible=False,
        transfer_quantity=0,
    )
    assert plan["actions"] == ["expedite"]
    assert "escalate" in plan["rationale"]
