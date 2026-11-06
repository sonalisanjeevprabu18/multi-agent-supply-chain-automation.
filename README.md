# Multi-Agent AI System for Autonomous Business Process Automation

An SME supply-chain control tower. Seven specialized agents coordinate through a
LangGraph orchestrator over a shared state to forecast demand, monitor
multi-warehouse inventory, size replenishment, rank suppliers, detect supply
disruptions, plan warehouse transfers and verify every decision before it is
recorded.

**All core decisions are deterministic Python business logic. No LLM API is
required or called.** Forecasting, optimization, supplier ranking, disruption
recovery and verification work offline.

> Purchase orders and supplier disruptions are **simulated planning records**.
> Seeded data is **synthetic demonstration data** — never presented as real
> business records.

---

## 1. Feature summary

| Module | What actually runs |
| --- | --- |
| Data engineering & forecasting | CSV validation/cleaning, dense daily series, calendar + lag + rolling features, per-product XGBoost with a moving-average baseline, chronological hold-out, MAE/RMSE/WAPE, persisted artifacts, recursive 7/14/30-day forecasts |
| Inventory optimization | Multi-warehouse stock, safety stock `Zσ√LT`, reorder point, target level, recommended order quantity (MOQ + capacity aware), stockout/overstock alerts, transferable surplus, inter-warehouse transfers that preserve source safety stock, demand allocation |
| Procurement & disruption | Supplier master + per-product terms, min-max weighted ranking (cost / lead time / reliability), MOQ + status constraints, purchase-order recommendations, disruption simulation (delay, unavailability, lead-time increase, reliability drop), stockout-risk projection, alternative suppliers, recovery planning |
| Multi-agent orchestration | LangGraph `StateGraph` with 7 agents, typed shared state, conditional routing (logistics skipped when no recovery is needed), retry-once failure handling, execution + log persistence, decision verification with 6 independent checks |
| Backend | FastAPI, Pydantic v2, SQLAlchemy 2, 14 tables, CORS, OpenAPI docs, background execution with status polling, CSV exports |
| Frontend | Next.js App Router dashboard: executive KPIs, forecasting charts, inventory tables, supplier ranking, disruption simulator, agent timeline, reports |

## 2. Architecture

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the layer diagram, data
model, formulas and assumptions.

```
Next.js dashboard ──HTTP──> FastAPI ──> LangGraph (7 agents) ──> domain logic
      (Vercel)                 │             │                    (forecasting/
                               │             │                     inventory/
                               └─────────────┴──> Supabase PostgreSQL (14 tables)
```

Agent flow:

```
START → Demand Forecasting → Inventory Monitoring → Inventory Optimization
      → Procurement → Supplier Disruption ──┬─ recovery needed → Logistics ─┐
                                            └─ no recovery ───────────────►  │
                                                          Decision Verification → END
```

## 3. Repository layout

```
frontend/                 Next.js 15 + React 19 + TypeScript + Tailwind + Recharts
backend/
  main.py                 FastAPI app (CORS, lifespan, /health, /docs)
  api/                    routers: catalog, sales, forecast, inventory,
                          procurement, agents, reports
  schemas/                Pydantic models
  services/               analytics, sales, forecast, inventory, procurement,
                          agent, report services
  models/models.py        14 SQLAlchemy tables + indexes
  database/               session/engine, seed, sample data generator
agents/                   state, 7 agents, graph, orchestrator, runtime
forecasting/              preprocessing, feature_engineering, train, predict, evaluation
inventory/                calculations, transfers/allocation
procurement/              supplier_selection, purchase_orders, disruptions
tests/                    92 pytest tests (unit + integration + e2e)
data/sample/              synthetic CSV datasets
docs/                     ARCHITECTURE, API, DEPLOYMENT, TEST_REPORT
api/index.py              Vercel Python entrypoint
vercel.json               Vercel build/route config for the API
```

## 4. Local setup

Prerequisites: Python 3.11+, Node 18+, a Supabase project (or the documented
local SQLite fallback for development only).

### Backend

```bash
python -m venv .venv
source .venv/Scripts/activate      # Windows (bash); use .venv/bin/activate on macOS/Linux
pip install -r requirements.txt

cp .env.example .env               # fill in DATABASE_URL for Supabase
python -m backend.database.seed    # creates schema + synthetic demo data if empty
uvicorn backend.main:app --reload --port 8000
```

* Swagger UI: <http://localhost:8000/docs>
* Health: <http://localhost:8000/health>
* Startup auto-seeds **only when the database is empty** (`AUTO_SEED=false` disables).

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local         # or create it; NEXT_PUBLIC_API_URL=http://localhost:8000
npm run dev
```

Open <http://localhost:3000>.

### One-command demo flow

1. Open the dashboard → **Run demonstration scenario**.
2. Open **Agent Monitoring** to follow the seven-agent timeline.
3. Review forecasts, inventory alerts, procurement recommendations and the
   verification verdict for the same execution.

## 5. Business scenario (built into the synthetic data)

Product **P001** demand rises ~35 % in warehouse **W1** while W1 holds only 45
units; **W2/W3** hold surplus. The workflow then:

1. Forecasts the demand spike (XGBoost artifact).
2. Flags W1 as critical / stockout risk.
3. Computes safety stock, ROP and the replenishment quantity.
4. Ranks suppliers and recommends a purchase order.
5. Simulates a 10-day supplier delay and assesses the impact.
6. Plans a transfer from W2 into W1, keeping W2 above its safety stock.
7. Verification approves the transfer and **defers the purchase order** because
   the internal transfer already covers the requirement.
8. Persists forecasts, recommendations, orders, transfers, disruptions, logs and
   the workflow result — all visible on the monitoring page.

## 6. API

Full reference: [`docs/API.md`](docs/API.md). Highlights:

```
GET  /health
GET  /api/products            POST /api/products
GET  /api/warehouses          GET  /api/inventory
POST /api/sales/upload        GET  /api/sales/template
POST /api/forecast/train      POST /api/forecast/predict
GET  /api/forecast/results    GET  /api/forecast/metrics
GET  /api/forecast/backtest/{product_id}
POST /api/inventory/optimize  GET  /api/inventory/recommendations
GET  /api/inventory/transfers
POST /api/suppliers/recommend POST /api/procurement/generate
POST /api/disruptions/simulate GET /api/disruptions/active
POST /api/agents/execute      GET  /api/agents/status/{execution_id}
GET  /api/agents/logs/{id}    GET  /api/agents/result/{id}
GET  /api/reports/summary     GET  /api/reports/download?report=
```

## 7. Testing

```bash
source .venv/Scripts/activate
python -m pytest
```

92 tests cover CSV validation, preprocessing, feature leakage, training and
fallbacks, metrics, every inventory formula, supplier scoring, purchase-order
validation, disruption assessment, each agent, the LangGraph workflow (including
conditional routing, retries and failure persistence), all API endpoints and the
end-to-end business scenario. Actual results are recorded in
[`docs/TEST_REPORT.md`](docs/TEST_REPORT.md).

## 8. Deployment

Vercel (frontend + Python API) and Supabase PostgreSQL. Step-by-step
instructions, environment variables and serverless limits:
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

Environment variables are documented in [`.env.example`](.env.example). Never
commit `.env` files or the Supabase service-role key to Git.

## 9. Known limitations

* **Not deployed from this workspace.** No Vercel/GitHub credentials were
  available, so the deployment steps are complete and verified locally but the
  production URLs are not yet live.
* **SQLite fallback.** When `DATABASE_URL` is unset the API uses a local SQLite
  file for development convenience. Production must set `DATABASE_URL` to the
  Supabase PostgreSQL pooler URL (`ALLOW_SQLITE_FALLBACK=false` enforces this).
* **Model artifacts on serverless.** Artifacts live on disk (`MODEL_ARTIFACT_DIR`).
  Vercel's filesystem is ephemeral and the xgboost wheel is large; upload artifacts
  to Supabase Storage or run the API on a container host if the bundle exceeds the
  250 MB function limit. Forecasts fall back to the moving-average baseline when an
  artifact is missing, and the UI labels it.
* **Background workflows.** In-process threads work locally; serverless hosting
  must use `wait_for_completion=true` (the default in the UI) or an external worker.
* **Authentication** is not implemented — run behind platform access control on a
  private project.
* **Restocking is planning only.** Nothing is ordered from a real supplier.
* Supplier reliability is static seeded data, not learned from delivery history.

## 10. Module ownership

| Member | Module | Primary files |
| --- | --- | --- |
| 1 | Data engineering & demand forecasting | `forecasting/`, `backend/services/forecast_service.py`, `backend/database/` |
| 2 | Inventory optimization & warehouse management | `inventory/`, `backend/services/inventory_service.py` |
| 3 | Procurement & disruption management | `procurement/`, `backend/services/procurement_service.py` |
| 4 | Orchestration, backend & integration | `agents/`, `backend/api/`, `backend/main.py`, `frontend/` |

## 11. Research context

This capstone implements the multi-agent business-process-automation pattern
described in the accompanying literature (agent specialization, shared state,
orchestration, verification). Unlike LLM-only agent designs, every decision here is
reproducible and auditable: the same inputs produce the same recommendations, and
verification re-derives the constraints instead of trusting the proposing agent.
