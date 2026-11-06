"""Supplier scoring, ranking and selection.

Weighted scoring over three normalised criteria:

* **cost**        lower unit price is better
* **lead time**   shorter delivery is better
* **reliability** higher historical reliability is better

Normalisation is min-max over the candidate set (score 0..1). When every
candidate ties on a criterion, that criterion contributes its full value (0.5)
instead of dividing by zero. Scores are reported on a 0-100 scale.

Hard filters: supplier status must be ``active`` and the requested quantity must
satisfy the supplier's minimum order quantity.
"""

from __future__ import annotations

from typing import Any, Iterable

DEFAULT_WEIGHTS: dict[str, float] = {"cost": 0.4, "lead_time": 0.3, "reliability": 0.3}
WEIGHT_KEYS = ("cost", "lead_time", "reliability")


class SupplierSelectionError(ValueError):
    """Raised when no eligible supplier exists for a requirement."""


def normalise_weights(weights: dict[str, float] | None) -> dict[str, float]:
    """Clamp to non-negative values and renormalise so the weights sum to 1."""
    raw = dict(DEFAULT_WEIGHTS)
    if weights:
        for key in WEIGHT_KEYS:
            if key in weights and weights[key] is not None:
                try:
                    raw[key] = max(0.0, float(weights[key]))
                except (TypeError, ValueError):
                    continue
    total = sum(raw.values())
    if total <= 0:
        return dict(DEFAULT_WEIGHTS)
    return {key: round(value / total, 6) for key, value in raw.items()}


def _min_max(value: float, low: float, high: float) -> float:
    if high - low <= 1e-12:
        return 0.5
    return (value - low) / (high - low)


def score_suppliers(
    offers: Iterable[dict[str, Any]],
    quantity: float,
    weights: dict[str, float] | None = None,
) -> list[dict[str, Any]]:
    """Score, rank and explain supplier offers for a required quantity.

    Each offer needs: ``supplier_id``, ``supplier_name``, ``unit_price``,
    ``lead_time_days``, ``reliability_score``, ``minimum_order_quantity`` and
    optionally ``supplier_status`` (defaults to ``active``).
    """
    normalised = normalise_weights(weights)
    candidates = [dict(offer) for offer in offers]

    for offer in candidates:
        offer["supplier_status"] = str(offer.get("supplier_status") or "active").lower()
        offer["unit_price"] = float(offer.get("unit_price") or 0.0)
        offer["lead_time_days"] = float(offer.get("lead_time_days") or 0.0)
        offer["reliability_score"] = max(0.0, min(1.0, float(offer.get("reliability_score") or 0.0)))
        offer["minimum_order_quantity"] = float(offer.get("minimum_order_quantity") or 0.0)

    eligible = [c for c in candidates if c["supplier_status"] == "active"]
    ineligible = [c for c in candidates if c["supplier_status"] != "active"]

    for offer in ineligible:
        offer["eligible"] = False
        offer["score"] = 0.0
        offer["disqualification_reason"] = (
            f"supplier_status={offer['supplier_status']} (not accepting orders)"
        )

    eligible = [c for c in eligible if c["unit_price"] > 0]
    if not eligible:
        raise SupplierSelectionError(
            "No active supplier with a valid price is available for this product."
        )

    prices = [c["unit_price"] for c in eligible]
    lead_times = [c["lead_time_days"] for c in eligible]
    reliabilities = [c["reliability_score"] for c in eligible]
    p_low, p_high = min(prices), max(prices)
    l_low, l_high = min(lead_times), max(lead_times)
    r_low, r_high = min(reliabilities), max(reliabilities)

    for offer in eligible:
        cost_score = 1.0 - _min_max(offer["unit_price"], p_low, p_high)
        lead_score = 1.0 - _min_max(offer["lead_time_days"], l_low, l_high)
        reliability = _min_max(offer["reliability_score"], r_low, r_high)
        composite = (
            normalised["cost"] * cost_score
            + normalised["lead_time"] * lead_score
            + normalised["reliability"] * reliability
        )
        offer["component_scores"] = {
            "cost": round(cost_score, 4),
            "lead_time": round(lead_score, 4),
            "reliability": round(reliability, 4),
        }
        offer["score"] = round(composite * 100, 2)
        meets_moq = quantity >= offer["minimum_order_quantity"] or quantity <= 0
        offer["meets_moq"] = meets_moq
        offer["eligible"] = meets_moq
        if not meets_moq:
            offer["disqualification_reason"] = (
                f"requested quantity {quantity:.0f} is below minimum order quantity "
                f"{offer['minimum_order_quantity']:.0f}"
            )
        offer["total_cost"] = round(offer["unit_price"] * max(quantity, 0.0), 2)
        offer["explanation"] = _explain(offer, normalised, quantity)

    ranked = sorted(
        candidates,
        key=lambda c: (c["eligible"], c["score"]),
        reverse=True,
    )
    for position, offer in enumerate(ranked, start=1):
        offer["rank"] = position
    return ranked


def _explain(offer: dict[str, Any], weights: dict[str, float], quantity: float) -> str:
    components = offer["component_scores"]
    return (
        f"{offer['supplier_name']} scores {offer['score']:.1f}/100 "
        f"(cost {components['cost']:.2f} x {weights['cost']:.2f}, "
        f"lead time {components['lead_time']:.2f} x {weights['lead_time']:.2f}, "
        f"reliability {components['reliability']:.2f} x {weights['reliability']:.2f}) "
        f"at {offer['unit_price']:.2f} per unit and {offer['lead_time_days']:.0f} day lead time; "
        f"estimated order cost {offer['total_cost']:.2f} for {max(quantity, 0):.0f} units."
    )


def select_best_supplier(
    offers: Iterable[dict[str, Any]],
    quantity: float,
    weights: dict[str, float] | None = None,
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Return the top eligible offer plus the full ranking."""
    ranked = score_suppliers(offers, quantity, weights)
    for offer in ranked:
        if offer.get("eligible"):
            return offer, ranked
    raise SupplierSelectionError(
        "Every candidate supplier fails a constraint (inactive, invalid price or MOQ)."
    )


def rank_for_quantity(
    offers: Iterable[dict[str, Any]],
    quantity: float,
    weights: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Convenience payload used by the API and the procurement agent."""
    ranked = score_suppliers(offers, quantity, weights)
    best = next((o for o in ranked if o.get("eligible")), None)
    return {
        "quantity": round(max(0.0, float(quantity)), 2),
        "weights": normalise_weights(weights),
        "ranked_suppliers": ranked,
        "recommended_supplier_id": best["supplier_id"] if best else None,
        "recommended_supplier_name": best["supplier_name"] if best else None,
        "recommendation": (
            best["explanation"]
            if best
            else "No eligible supplier satisfies the constraints for this quantity."
        ),
    }
