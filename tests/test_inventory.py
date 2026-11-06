"""Unit tests for inventory sizing, alerts, allocation and transfers."""

from __future__ import annotations

import pytest

from inventory.calculations import (
    available_stock,
    classify_stock,
    days_of_cover,
    demand_std,
    inventory_metrics,
    recommended_order_quantity,
    reorder_point,
    safety_stock,
    target_stock_level,
    z_value,
)
from inventory.transfers import (
    allocate_demand,
    plan_transfer,
    transferable_surplus,
)


def test_z_value_matches_normal_table():
    assert z_value(0.95) == pytest.approx(1.6449, rel=1e-3)
    assert z_value(0.90) == pytest.approx(1.2816, rel=1e-3)
    assert z_value(0.99) == pytest.approx(2.3263, rel=1e-3)


def test_safety_stock_formula():
    # Z(0.95)=1.6449, sigma=10, lead time=9 -> 1.6449*10*3 = 49.35
    assert safety_stock(0.95, 10.0, 9.0) == pytest.approx(49.35, rel=1e-3)
    assert safety_stock(0.95, 10.0, 0.0) == 0.0


def test_reorder_point_formula():
    # ROP = avg daily demand * lead time + safety stock
    assert reorder_point(20.0, 7.0, 30.0) == pytest.approx(170.0)


def test_target_stock_covers_lead_time_plus_review_period():
    assert target_stock_level(10.0, 7.0, 7.0, 15.0) == pytest.approx(155.0)


def test_available_stock_never_negative():
    assert available_stock(50.0, 20.0) == 30.0
    assert available_stock(10.0, 40.0) == 0.0


def test_recommended_order_quantity_basic():
    assert recommended_order_quantity(500, 100, 50) == 350.0
    assert recommended_order_quantity(100, 100, 0) == 0.0


def test_recommended_order_quantity_respects_moq_and_capacity():
    assert recommended_order_quantity(30, 0, 0, minimum_order_quantity=50) == 50.0
    # capacity headroom of 40 units caps the order
    assert recommended_order_quantity(500, 0, 0, maximum_capacity=40) == 40.0
    assert recommended_order_quantity(500, 0, 0, maximum_capacity=0) == 0.0


def test_demand_std_is_population_std():
    assert demand_std([10, 10, 10, 10]) == pytest.approx(0.0)
    assert demand_std([2, 4, 4, 4, 5, 5, 7, 9]) == pytest.approx(2.0)


def test_days_of_cover():
    assert days_of_cover(100, 20) == 5.0
    assert days_of_cover(100, 0) is None


@pytest.mark.parametrize(
    "available,rop,safety,expected",
    [
        (0, 100, 20, "stockout"),
        (15, 100, 20, "critical"),
        (60, 100, 20, "low"),
        (200, 100, 20, "ok"),
        (400, 100, 20, "overstock"),
    ],
)
def test_stock_classification(available, rop, safety, expected):
    result = classify_stock(
        available=available,
        reorder_point_units=rop,
        safety_stock_units=safety,
        avg_daily_demand=10.0,
        lead_time_days=7.0,
    )
    assert result["alert_level"] == expected
    assert result["explanation"]


def test_stockout_risk_when_cover_shorter_than_lead_time():
    result = classify_stock(
        available=40,
        reorder_point_units=100,
        safety_stock_units=20,
        avg_daily_demand=10.0,
        lead_time_days=7.0,
    )
    assert result["stockout_risk"] is True
    assert result["days_of_cover"] == 4.0


def test_inventory_metrics_consistent_units():
    metrics = inventory_metrics(
        current_stock=300,
        reserved_stock=50,
        incoming_stock=0,
        avg_daily_demand=20,
        daily_demand_history=[18, 22, 20, 19, 21, 20, 20],
        lead_time_days=7,
        service_level=0.95,
        review_period_days=7,
        minimum_order_quantity=25,
        capacity=1000,
    )
    assert metrics["available_stock"] == 250.0
    assert metrics["safety_stock"] > 0
    assert metrics["reorder_point"] == pytest.approx(20 * 7 + metrics["safety_stock"], rel=1e-2)
    assert metrics["recommended_order_quantity"] > 0
    assert metrics["target_stock"] > metrics["reorder_point"]


def test_transferable_surplus_respects_safety_stock():
    assert transferable_surplus(
        current_stock=500, reserved_stock=20, safety_stock_units=100
    ) == pytest.approx(380.0)
    assert transferable_surplus(
        current_stock=80, reserved_stock=0, safety_stock_units=100
    ) == 0.0


def test_plan_transfer_uses_surplus_and_reports_shortfall():
    sources = [
        {
            "warehouse_id": "W1",
            "warehouse_name": "Central",
            "current_stock": 50,
            "reserved_stock": 0,
            "safety_stock": 100,
        },
        {
            "warehouse_id": "W2",
            "warehouse_name": "North",
            "current_stock": 900,
            "reserved_stock": 0,
            "safety_stock": 100,
        },
        {
            "warehouse_id": "W3",
            "warehouse_name": "South",
            "current_stock": 400,
            "reserved_stock": 0,
            "safety_stock": 50,
        },
    ]
    plan = plan_transfer(
        product_id="P1",
        destination_warehouse_id="W1",
        destination_need=1000,
        sources=sources,
    )
    # total releasable surplus is 1150 but only 1000 is needed
    assert plan["allocated_quantity"] == pytest.approx(1000.0)
    assert plan["unmet_quantity"] == 0.0
    assert plan["feasible"] is True
    # destination never sources from itself
    assert all(t["from_warehouse_id"] != "W1" for t in plan["transfers"])
    # the largest surplus is used first
    assert plan["transfers"][0]["from_warehouse_id"] == "W2"


def test_plan_transfer_infeasible_when_no_surplus():
    plan = plan_transfer(
        product_id="P1",
        destination_warehouse_id="W1",
        destination_need=100,
        sources=[
            {
                "warehouse_id": "W2",
                "current_stock": 50,
                "reserved_stock": 0,
                "safety_stock": 50,
            }
        ],
    )
    assert plan["feasible"] is False
    assert plan["transfers"] == []
    assert "No source warehouse" in plan["explanation"]


def test_allocate_demand_waterfall():
    allocation = allocate_demand(
        product_id="P1",
        requested_quantity=100,
        warehouses=[
            {"warehouse_id": "W1", "current_stock": 40, "reserved_stock": 0},
            {"warehouse_id": "W2", "current_stock": 80, "reserved_stock": 10},
        ],
    )
    assert allocation["allocated_quantity"] == 100
    assert allocation["fully_allocated"] is True
    assert allocation["allocation"][0]["warehouse_id"] == "W2"


def test_allocate_demand_reports_unmet_quantity():
    allocation = allocate_demand(
        product_id="P1",
        requested_quantity=100,
        warehouses=[{"warehouse_id": "W1", "current_stock": 30, "reserved_stock": 0}],
    )
    assert allocation["unmet_quantity"] == 70
    assert allocation["fully_allocated"] is False
