"""Inventory sizing formulas: safety stock, reorder point, order quantity, alerts.

Assumptions (documented in docs/ARCHITECTURE.md):

* Demand is independent across days; the safety-stock formula uses the standard
  normal approximation.
* ``lead_time_days`` is the supplier's replenishment lead time in calendar days.
* ``review_period_days`` is how often the planner reviews stock; the target level
  covers lead time **plus** the review period.
* All quantities are in the product's base unit of measure (units).
* ``available = current_stock - reserved_stock`` (never negative).
"""

from __future__ import annotations

import math
from statistics import NormalDist
from typing import Any, Iterable

DEFAULT_SERVICE_LEVEL = 0.95
DEFAULT_REVIEW_PERIOD_DAYS = 7
DEFAULT_LEAD_TIME_DAYS = 7
DEFAULT_LEAD_TIME_STD = 0.0


def z_value(service_level: float) -> float:
    """Inverse standard-normal CDF for a service level (e.g. 0.95 -> 1.645)."""
    level = min(max(float(service_level), 0.5), 0.9999)
    return NormalDist().inv_cdf(level)


def demand_std(daily_demand: Iterable[float]) -> float:
    """Population standard deviation of observed daily demand."""
    values = [float(v) for v in daily_demand]
    if len(values) < 2:
        return 0.0
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    return math.sqrt(variance)


def safety_stock(
    service_level: float,
    demand_std_dev: float,
    lead_time_days: float,
) -> float:
    """Safety Stock = Z x sigma_demand x sqrt(lead time)."""
    if lead_time_days <= 0:
        return 0.0
    return max(0.0, z_value(service_level) * max(0.0, demand_std_dev) * math.sqrt(lead_time_days))


def reorder_point(
    avg_daily_demand: float,
    lead_time_days: float,
    safety_stock_units: float,
) -> float:
    """ROP = Average Daily Demand x Lead Time + Safety Stock."""
    return max(
        0.0,
        max(0.0, avg_daily_demand) * max(0.0, lead_time_days) + max(0.0, safety_stock_units),
    )


def available_stock(current_stock: float, reserved_stock: float) -> float:
    """Stock that can actually be allocated to demand."""
    return max(0.0, float(current_stock) - float(reserved_stock))


def target_stock_level(
    avg_daily_demand: float,
    lead_time_days: float,
    review_period_days: float,
    safety_stock_units: float,
) -> float:
    """Target (order-up-to) level covering lead time + review period + safety."""
    return max(
        0.0,
        max(0.0, avg_daily_demand) * (max(0.0, lead_time_days) + max(0.0, review_period_days))
        + max(0.0, safety_stock_units),
    )


def recommended_order_quantity(
    target_stock: float,
    available: float,
    incoming_stock: float,
    minimum_order_quantity: float = 0.0,
    maximum_capacity: float | None = None,
) -> float:
    """Recommended Order Qty = max(Target - Available - Incoming, 0).

    The quantity is rounded up to the supplier MOQ when it is positive, and
    capped so that on-hand stock cannot exceed the warehouse capacity.
    """
    raw = max(0.0, float(target_stock) - float(available) - float(incoming_stock))
    if raw <= 0:
        return 0.0
    quantity = math.ceil(raw)
    if maximum_capacity is not None:
        headroom = max(0.0, float(maximum_capacity) - float(available) - float(incoming_stock))
        quantity = min(quantity, math.floor(headroom))
    if quantity <= 0:
        return 0.0
    if minimum_order_quantity and quantity < float(minimum_order_quantity):
        quantity = math.ceil(float(minimum_order_quantity))
    return float(quantity)


def days_of_cover(available: float, avg_daily_demand: float) -> float | None:
    """How many days the available stock lasts; None when demand is zero."""
    if avg_daily_demand <= 0:
        return None
    return round(max(0.0, float(available)) / float(avg_daily_demand), 2)


def classify_stock(
    *,
    available: float,
    reorder_point_units: float,
    safety_stock_units: float,
    capacity: float | None = None,
    avg_daily_demand: float = 0.0,
    lead_time_days: float = DEFAULT_LEAD_TIME_DAYS,
    overstock_multiple: float = 3.0,
) -> dict[str, Any]:
    """Classify stock into an operational alert level with an explanation.

    Levels
    ------
    ``critical``   available stock is at or below safety stock
    ``low``        available stock is at or below the reorder point
    ``overstock``  available stock exceeds ``overstock_multiple`` x reorder point
                   (or the configured capacity)
    ``ok``         healthy band between reorder point and overstock threshold
    ``stockout``   no available stock at all
    """
    cover = days_of_cover(available, avg_daily_demand)
    reasons: list[str] = []

    if available <= 0:
        level = "stockout"
        reasons.append("No available stock remains in this warehouse.")
    elif safety_stock_units > 0 and available <= safety_stock_units:
        level = "critical"
        reasons.append(
            f"Available stock ({available:.0f}) is at or below safety stock ({safety_stock_units:.0f})."
        )
    elif reorder_point_units > 0 and available <= reorder_point_units:
        level = "low"
        reasons.append(
            f"Available stock ({available:.0f}) is below the reorder point ({reorder_point_units:.0f})."
        )
    elif capacity and available > capacity:
        level = "overstock"
        reasons.append(f"Available stock exceeds warehouse capacity ({capacity:.0f}).")
    elif reorder_point_units > 0 and available > reorder_point_units * overstock_multiple:
        level = "overstock"
        reasons.append(
            f"Available stock is more than {overstock_multiple:g}x the reorder point; capital is tied up."
        )
    else:
        level = "ok"
        reasons.append("Stock level is within the healthy operating band.")

    stockout_risk = False
    if cover is not None:
        stockout_risk = cover < max(1.0, float(lead_time_days))
        if stockout_risk:
            reasons.append(
                f"Stock cover of {cover:.1f} day(s) is shorter than the {lead_time_days:.0f}-day lead time."
            )

    return {
        "alert_level": level,
        "days_of_cover": cover,
        "stockout_risk": stockout_risk,
        "explanation": " ".join(reasons),
    }


def inventory_metrics(
    *,
    current_stock: float,
    reserved_stock: float,
    incoming_stock: float,
    avg_daily_demand: float,
    daily_demand_history: Iterable[float],
    lead_time_days: float,
    service_level: float = DEFAULT_SERVICE_LEVEL,
    review_period_days: float = DEFAULT_REVIEW_PERIOD_DAYS,
    minimum_order_quantity: float = 0.0,
    capacity: float | None = None,
) -> dict[str, Any]:
    """Compute the full sizing picture for one product/warehouse pair."""
    available = available_stock(current_stock, reserved_stock)
    sigma = demand_std(daily_demand_history)
    ss = safety_stock(service_level, sigma, lead_time_days)
    rop = reorder_point(avg_daily_demand, lead_time_days, ss)
    target = target_stock_level(avg_daily_demand, lead_time_days, review_period_days, ss)
    qty = recommended_order_quantity(
        target, available, incoming_stock, minimum_order_quantity, capacity
    )
    classification = classify_stock(
        available=available,
        reorder_point_units=rop,
        safety_stock_units=ss,
        capacity=capacity,
        avg_daily_demand=avg_daily_demand,
        lead_time_days=lead_time_days,
    )
    return {
        "current_stock": round(float(current_stock), 2),
        "reserved_stock": round(float(reserved_stock), 2),
        "incoming_stock": round(float(incoming_stock), 2),
        "available_stock": round(available, 2),
        "avg_daily_demand": round(float(avg_daily_demand), 4),
        "demand_std_dev": round(sigma, 4),
        "service_level": service_level,
        "z_value": round(z_value(service_level), 4),
        "lead_time_days": lead_time_days,
        "review_period_days": review_period_days,
        "safety_stock": round(ss, 2),
        "reorder_point": round(rop, 2),
        "target_stock": round(target, 2),
        "recommended_order_quantity": qty,
        "replenishment_required": qty > 0,
        **classification,
    }
