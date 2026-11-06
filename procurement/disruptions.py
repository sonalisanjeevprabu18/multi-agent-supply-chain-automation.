"""Supplier disruption simulation, detection, impact assessment and recovery.

Everything is deterministic and derived from stored supplier/order/inventory
records, so the same disruption event produces the same assessment in tests and
in the dashboard.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Iterable

DISRUPTION_TYPES = (
    "delivery_delay",
    "supplier_unavailable",
    "lead_time_increase",
    "reliability_reduction",
)


class DisruptionError(ValueError):
    """Raised for an unknown disruption type or invalid parameters."""


def validate_disruption(
    disruption_type: str, delay_days: int, reliability_delta: float
) -> dict[str, Any]:
    """Normalise and validate a simulation request."""
    kind = str(disruption_type or "").strip().lower()
    if kind not in DISRUPTION_TYPES:
        raise DisruptionError(
            f"Unknown disruption_type '{disruption_type}'. Expected one of {', '.join(DISRUPTION_TYPES)}."
        )
    delay = int(delay_days)
    if delay < 0 or delay > 90:
        raise DisruptionError("delay_days must be between 0 and 90")
    delta = float(reliability_delta)
    if not -1.0 <= delta <= 0.0:
        raise DisruptionError("reliability_delta must be between -1.0 and 0.0")
    if kind in ("delivery_delay", "lead_time_increase") and delay == 0:
        raise DisruptionError(f"{kind} requires delay_days > 0")
    return {"disruption_type": kind, "delay_days": delay, "reliability_delta": delta}


def detect_disruptions(
    *,
    disruptions: Iterable[dict[str, Any]],
    as_of: date | None = None,
) -> list[dict[str, Any]]:
    """Keep only disruptions that are active on ``as_of``."""
    today = as_of or date.today()
    active: list[dict[str, Any]] = []
    for event in disruptions:
        if str(event.get("status", "active")).lower() != "active":
            continue
        start = _as_date(event.get("started_at") or event.get("start_date"))
        expected = _as_date(event.get("expected_resolution_date"))
        if start and today < start:
            continue
        if expected and today > expected:
            continue
        active.append(event)
    return active


def _as_date(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def effective_lead_time(supplier: dict[str, Any], disruption: dict[str, Any] | None) -> float:
    """Lead time including any active disruption impact."""
    base = float(supplier.get("lead_time_days") or 0.0)
    if not disruption:
        return base
    kind = str(disruption.get("disruption_type", "")).lower()
    delay = float(disruption.get("delay_days") or 0.0)
    if kind in ("delivery_delay", "lead_time_increase"):
        return base + delay
    if kind == "supplier_unavailable":
        return base + max(delay, 7.0)
    return base


def assess_stockout_risk(
    *,
    available_stock: float,
    avg_daily_demand: float,
    days_until_delivery: float,
) -> dict[str, Any]:
    """Will stock run out before the (delayed) replenishment lands?"""
    if avg_daily_demand <= 0:
        return {
            "risk": "unknown",
            "days_of_cover": None,
            "projected_shortfall": 0.0,
            "explanation": "No demand forecast available, so stockout risk cannot be estimated.",
        }
    cover = max(0.0, float(available_stock)) / float(avg_daily_demand)
    shortfall = max(0.0, avg_daily_demand * max(0.0, days_until_delivery) - float(available_stock))
    if shortfall <= 0:
        risk = "low"
        explanation = (
            f"Stock cover of {cover:.1f} day(s) exceeds the {days_until_delivery:.0f}-day wait for delivery."
        )
    elif cover <= 3:
        risk = "critical"
        explanation = (
            f"Only {cover:.1f} day(s) of cover against a {days_until_delivery:.0f}-day wait; "
            f"projected shortfall of {shortfall:.0f} units."
        )
    else:
        risk = "high"
        explanation = (
            f"Stock cover of {cover:.1f} day(s) is shorter than the {days_until_delivery:.0f}-day wait; "
            f"projected shortfall of {shortfall:.0f} units."
        )
    return {
        "risk": risk,
        "days_of_cover": round(cover, 2),
        "projected_shortfall": round(shortfall, 2),
        "explanation": explanation,
    }


def disruption_severity(delay_days: float, stockout_risk: str) -> str:
    risk = str(stockout_risk).lower()
    if risk == "critical":
        return "critical"
    if risk == "high":
        return "high" if delay_days >= 7 else "medium"
    if risk == "low":
        return "low"
    return "medium"


def find_alternative_suppliers(
    *,
    product_id: str,
    offers: Iterable[dict[str, Any]],
    excluded_supplier_ids: Iterable[Any],
    quantity: float,
    weights: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """Rank alternative active suppliers for the same product."""
    from procurement.supplier_selection import score_suppliers

    excluded = {str(s) for s in excluded_supplier_ids}
    candidates = [
        offer
        for offer in offers
        if str(offer.get("supplier_id")) not in excluded
        and str(offer.get("product_id", product_id)) == str(product_id)
    ]
    if not candidates:
        return []
    try:
        return score_suppliers(candidates, quantity, weights)
    except Exception:
        return []


def recovery_plan(
    *,
    stockout_risk: str,
    alternative_supplier: dict[str, Any] | None,
    transfer_feasible: bool,
    transfer_quantity: float,
) -> dict[str, Any]:
    """Pick a recovery action from the evidence, never from a hardcoded answer."""
    actions: list[str] = []
    rationale: list[str] = []
    if stockout_risk in ("critical", "high"):
        if transfer_feasible and transfer_quantity > 0:
            actions.append("transfer_stock")
            rationale.append(
                f"An internal transfer of {transfer_quantity:.0f} units closes the gap before "
                f"the delayed delivery arrives."
            )
        if alternative_supplier is not None:
            actions.append("switch_supplier")
            rationale.append(
                f"{alternative_supplier.get('supplier_name')} can supply at "
                f"{alternative_supplier.get('lead_time_days', 0):.0f} days "
                f"(score {alternative_supplier.get('score', 0):.1f})."
            )
        if not actions:
            actions.append("expedite")
            rationale.append(
                "Neither transfers nor alternatives are feasible; escalate expedited "
                "delivery with the incumbent supplier and accept partial shortfall."
            )
    else:
        actions.append("monitor")
        rationale.append(
            "Stock cover absorbs the delay, so the disruption is monitored without changing orders."
        )
    return {
        "actions": actions,
        "recovery_needed": any(a in ("transfer_stock", "switch_supplier", "expedite") for a in actions),
        "rationale": " ".join(rationale),
    }


def simulated_disruption_record(
    *,
    supplier: dict[str, Any],
    product_id: str | None,
    disruption_type: str,
    delay_days: int,
    reliability_delta: float,
    started_on: date | None = None,
    notes: str | None = None,
) -> dict[str, Any]:
    """Build the DB payload for a simulated disruption event."""
    started_on = started_on or date.today()
    duration = max(3, delay_days + 3)
    return {
        "supplier_id": supplier.get("supplier_id"),
        "product_id": product_id,
        "disruption_type": disruption_type,
        "delay_days": delay_days,
        "reliability_delta": reliability_delta,
        "started_at": started_on.isoformat(),
        "expected_resolution_date": (started_on + timedelta(days=duration)).isoformat(),
        "status": "active",
        "notes": notes
        or (
            f"Simulated {disruption_type} affecting {supplier.get('supplier_name')} "
            f"by {delay_days} day(s)."
        ),
    }
