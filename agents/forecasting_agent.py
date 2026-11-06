"""Agent 1 - Demand Forecasting Agent."""

from __future__ import annotations

from typing import Any

from agents.base import AgentError, BaseAgent
from agents.state import WorkflowState
from backend.services import forecast_service


class DemandForecastingAgent(BaseAgent):
    """Generates product-wise demand forecasts from stored sales history."""

    name = "demand_forecasting_agent"
    description = (
        "Loads historical sales, ensures a trained XGBoost artifact exists, and "
        "produces product-wise demand predictions for the requested horizon."
    )

    def run(self, state: WorkflowState) -> dict[str, Any]:
        product_ids = self.focus_product_ids(state)
        horizon = int(state.get("horizon_days", 7))

        # Training happens only when no artifact exists (never per request).
        trained = forecast_service.ensure_models(self.session, product_ids)

        try:
            results = forecast_service.predict(
                self.session,
                product_ids,
                horizon_days=horizon,
                persist=True,
                execution_id=state.get("execution_id"),
            )
        except forecast_service.ForecastError as exc:
            raise AgentError(str(exc)) from exc

        if not results:
            raise AgentError("No forecasts were produced; sales history is empty.")

        forecasts = [
            {
                "product_id": r["product_id"],
                "sku": r["sku"],
                "product_name": r["product_name"],
                "model": r["model"],
                "horizon_days": r["horizon_days"],
                "avg_daily_demand": r["avg_daily_demand"],
                "total_predicted_units": r["total_predicted_units"],
                "fallback": r["fallback"],
                "predictions": r["predictions"],
            }
            for r in results
        ]
        xgb_count = sum(1 for f in forecasts if not f["fallback"])
        average = round(
            sum(f["total_predicted_units"] for f in forecasts) / len(forecasts), 2
        )
        summary = (
            f"Forecasted {len(forecasts)} product(s) over {horizon} day(s): "
            f"{xgb_count} with XGBoost, {len(forecasts) - xgb_count} with the moving-average "
            f"fallback. Mean forecasted demand {average} units."
        )
        if trained:
            summary += f" Trained {len(trained)} missing model artifact(s) on stored history."

        return {
            "forecasts": forecasts,
            "metrics": {
                "forecasted_products": len(forecasts),
                "xgboost_products": xgb_count,
                "fallback_products": len(forecasts) - xgb_count,
                "models_trained_inline": trained,
                "average_forecast_units": average,
            },
            "_summary": summary,
        }
