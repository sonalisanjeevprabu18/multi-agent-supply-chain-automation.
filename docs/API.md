# API reference

Interactive documentation is served by FastAPI at `/docs` (Swagger UI) and
`/openapi.json`. All endpoints below are implemented and exercised by
`tests/test_api.py`.

Base URL: `NEXT_PUBLIC_API_URL` (default `http://localhost:8000`).

## System

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/` | Service metadata + links |
| GET | `/health` | Liveness + real `SELECT 1` database check |
| GET | `/openapi.json` | OpenAPI schema |

`GET /health` response:

```json
{
  "status": "ok",
  "app_env": "development",
  "database": {"status": "ok", "dialect": "postgresql"},
  "timestamp": "2026-11-05T12:00:00+00:00",
  "agent_workflow": "langgraph",
  "llm_required": false
}
```

## Catalog

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/products?search=&limit=&offset=` | Product list |
| POST | `/api/products` | 201; 409 on duplicate SKU |
| GET | `/api/warehouses` | 3 seeded warehouses |
| GET | `/api/inventory?warehouse_id=&product_id=` | Stock **plus** computed safety stock, ROP, alert level, recommended quantity |
| GET | `/api/inventory/raw` | Stored stock rows only |
| GET | `/api/suppliers` | Supplier master + per-product offers |
| GET | `/api/suppliers/{id}/offers` | One supplier's offers |
| GET | `/api/dashboard/snapshot` | Lightweight counters |

## Sales ingestion

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/sales/upload` | `multipart/form-data`, field `file`; CSV only, ≤ `MAX_UPLOAD_MB` |
| GET | `/api/sales/template` | Example CSV download |
| GET | `/api/sales/summary` | Row count + date coverage |

Upload outcomes: `200` accepted (rows upserted), `413` too large, `415` wrong type,
`422` validation failed with `{"detail": {"errors": [...], "warnings": [...]}}`.
Rows are attributed to existing SKUs/warehouse codes, or new ones are created.

## Forecasting

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/forecast/train?background=true` | `202`; offline training of XGBoost + baseline |
| GET | `/api/forecast/train/status` | `idle` / `running` / `completed` / `failed` |
| POST | `/api/forecast/predict` | `{product_ids?, horizon_days (1-30), persist}` |
| GET | `/api/forecast/results?product_id=` | Latest persisted forecast batch per product |
| GET | `/api/forecast/metrics` | Per-product MAE / RMSE / WAPE for both models |

Pass `?background=false` to train inside the request (used by the test suite).
The in-process training registry is per instance; a multi-instance deployment
should read `/api/forecast/metrics` (persisted artifact registry) instead.

## Inventory optimization

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/inventory/optimize` | `{warehouse_id?, product_ids?, service_level, review_period_days}` |
| GET | `/api/inventory/recommendations?warehouse_id=` | Persisted sizing recommendations |
| GET | `/api/inventory/transfers` | Persisted transfer recommendations |
| GET | `/api/inventory/transfers/plan?product_id=` | Non-persisting feasibility preview |
| GET | `/api/inventory/alerts` | Grouped alerts (404 when none) |

## Procurement and disruption

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/suppliers/recommend` | `{product_id, quantity, weights{cost,lead_time,reliability}}` |
| POST | `/api/procurement/generate` | Simulated POs for every replenishment need |
| GET | `/api/procurement/orders` | Persisted orders |
| POST | `/api/disruptions/simulate` | `delivery_delay`, `supplier_unavailable`, `lead_time_increase`, `reliability_reduction` |
| GET | `/api/disruptions/active` | Active events (status + date window) |
| GET | `/api/disruptions/{id}/assessment` | Impact, alternatives, transfer suggestion, recovery |
| POST | `/api/disruptions/{id}/resolve` | Marks the event resolved |

Weights are normalised server-side, so any positive values are accepted.

## Agents

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/api/agents/execute` | `202`; `{scenario, horizon_days, service_level, focus_product_id?, target_warehouse_id?, supplier_weights, wait_for_completion}` |
| POST | `/api/agents/demo?wait_for_completion=true` | End-to-end demonstration scenario |
| GET | `/api/agents/status/{execution_id}` | Status, progress %, summary, logs |
| GET | `/api/agents/logs/{execution_id}` | Ordered agent log entries |
| GET | `/api/agents/result/{execution_id}` | Persisted verification + decisions (409 if unfinished) |
| GET | `/api/agents/executions` | Execution history |
| GET | `/api/agents/graph` | Node/edge definition rendered by the monitoring page |

`scenario` is `standard_workflow` or `disruption_demo`. `disruption_demo` creates a
simulated 10-day supplier delay if no disruption is active, which is what makes the
conditional logistics edge run.

## Reports

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/reports/summary` | Executive KPIs, forecast performance, agent statistics |
| GET | `/api/reports/available` | Supported report names |
| GET | `/api/reports/download?report=` | `inventory`, `forecasts`, `purchase_orders`, `transfers`, `disruptions`, `agent_executions`, `sales` |

## Error format

Errors use FastAPI's shape: `{"detail": "message"}` or a structured object for
validation failures. Status codes used: 200, 201, 202, 404, 409, 413, 415, 422, 500.
