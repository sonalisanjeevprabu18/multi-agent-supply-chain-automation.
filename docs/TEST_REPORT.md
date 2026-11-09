# Test execution report

Everything below was executed on this machine on **2026-11-06**. No result was
inferred: every number comes from a command whose exit status was checked.

## 1. Environment

| Component | Version |
| --- | --- |
| OS | Windows 11 (Git Bash) |
| Python | 3.11.6 (`.venv`) |
| Node.js / npm | 24.14.0 / 11.9.x |
| FastAPI | 0.162.0 |
| SQLAlchemy | 2.1.8 |
| XGBoost | 3.2.0 |
| LangGraph | 1.2.20 |
| pandas / numpy | 3.1.1 / 2.4.6 |
| pytest | 9.2.0 |
| Next.js | 15.5.29 (dev server) |

Commands:

```bash
./.venv/Scripts/python -m pytest
cd frontend && npx tsc --noEmit
cd frontend && npm run build
```

## 2. Python test suite

**Result: 92 passed, 0 failed in 26.88 s** (`exit code 0`).

| File | Tests | Covers |
| --- | --- | --- |
| `tests/test_forecasting.py` | 18 | CSV validation (missing/duplicate/negative/bad date/wrong dtype), preprocessing, dense series, leakage-free feature engineering, chronological split, XGBoost training, moving-average baseline, insufficient-history fallback, MAE/RMSE/WAPE, artifact persistence and reload, backtest output |
| `tests/test_inventory.py` | 21 | safety stock, reorder point, target stock, recommended order quantity (MOQ, capacity, zero/negative cases), stock classification, days of cover, available stock with reservations, allocation, transferable surplus, transfer feasibility (source safety stock, destination need), multi-warehouse view |
| `tests/test_procurement.py` | 19 | supplier normalisation, weighted ranking (cost/speed/reliability), suspended supplier exclusion, missing-offer handling, MOQ enforcement, purchase-order totals and delivery dates, disruption validation, delay/unavailability/lead-time/reliability disruptions, stockout-risk projection, alternative supplier and recovery recommendation |
| `tests/test_agents.py` | 10 | each agent's real business logic, log persistence via `TimedAgent`, demo disruption simulation, verification approve/reject paths, unsupported-state rejection |
| `tests/test_workflow.py` | 7 | LangGraph sequencing, conditional skip of logistics without recovery, retry-once handling, failure persistence, execution status transitions, workflow result persistence |
| `tests/test_api.py` | 16 | every endpoint incl. CSV upload (valid + invalid), training 202/200, prediction, inventory optimization, supplier recommendation, disruption simulation, agent execution/status/logs/result, reports summary and CSV download, 404/422 handling, health |
| `tests/test_business_scenario.py` | 1 | full demonstration scenario end to end: forecast → monitoring → optimization → procurement → disruption → transfer → verification → persistence |

Tests run against a temporary SQLite database and a temporary artifact directory
created by `tests/conftest.py`; production persistence is Postgres (see
`docs/DEPLOYMENT.md`).

### Failures encountered and fixed (not skipped)

| Failure | Root cause | Fix |
| --- | --- | --- |
| `test_forecasting_agent_persists_forecasts` asserted a log row | the test called `agent.run()` directly, bypassing `TimedAgent` (which writes logs); no row could exist | test now runs the agent through `TimedAgent`, matching the graph, and asserts the completed log |
| `test_verification_agent_approves_and_flags_conflicts` failed its sizing check | quantities are `ceil()`-rounded, so `ceil(767.4)=768` exceeded a bound computed from the fractional requirement; only surfaced once XGBoost (not the fallback) produced fractional demand | verification now compares against `max(ceil(requirement), MOQ)` — integer rounding is legal |
| workflow demos always logged `0 with XGBoost` | training persisted `model_<id>.joblib` while inference loaded `model_<SKU>.joblib`, so artifacts were never found: every run retrained and fell back | `forecast_service` now trains keyed by SKU (`model_P001.joblib`) and maps ids back for reports |
| `SQLite Date type only accepts Python date objects` in the disruption agent (historical execution in the dev DB) | disruption payload dates were passed as strings | `simulate_disruption` coerces `started_at` / `expected_resolution_date` with `date.fromisoformat` |

## 3. Frontend checks

| Check | Command | Result |
| --- | --- | --- |
| TypeScript (strict, no emit) | `npx tsc --noEmit` | exit 0, no diagnostics |
| Production build | `npm run build` | exit 0, 12 static pages generated |
| Route sizes | build output | `/` 3.52 kB · `/forecasting` 116 kB · `/inventory` 5.9 kB · `/procurement` 6.06 kB · `/disruptions` 6.09 kB · `/agents` 4.12 kB · `/reports` 5.14 kB (First Load JS 103 kB shared) |

## 4. Live API verification (local servers)

`uvicorn backend.main:app --port 8000` + `next dev -p 3000`, both running,
database seeded with 3 warehouses, 8 products, 5 suppliers (1 suspended),
22 supplier offers, 24 inventory rows and 4,320 sales rows.

| Check | Observed |
| --- | --- |
| `GET /health` | `200` · `{"status":"ok","database":{"status":"ok","dialect":"sqlite"},"agent_workflow":"langgraph","llm_required":false}` |
| `POST /api/forecast/train?background=false` | `200` in 4.98 s · `n_products: 8, n_trained: 8, n_fallback: 0` |
| Model metrics (P001) | XGBoost WAPE **0.0995** vs moving average **0.1354** (28-day chronological hold-out) |
| `POST /api/forecast/predict` (14 days) | `200` in 1.29 s · 8 products, all `model: xgboost` |
| `GET /api/forecast/backtest/1?days=28` | `200` · 28 actual/predicted points, `model: xgboost` |
| `POST /api/agents/demo?wait_for_completion=true` | `202` in 1.55 s · `status: completed`, `progress: 100` |
| Demonstration results | 1 critical alert, 767-unit replenishment, PO 767 × P001 @ ₹3,221.40, 10-day supplier delay, 767-unit W2→W1 transfer |
| Verification | 4/5 checks passed; transfer **approved**, duplicate purchase order **rejected** ("covered by an internal transfer; defer to the next cycle") |
| Agent logs | 15 persisted rows (7 started + 7 completed + 1 simulated), all with durations |
| Frontend | all 9 pages returned `200`; dashboard rendered 8 products, 3 warehouses, ₹1,17,495 inventory value, 4,320 sales rows; browser console had no errors and every XHR was `200` |

Screenshots (redesigned SupplyFlow AI interface): `docs/screenshots/ui-01-overview.png`,
`ui-02-forecasting.png`, `ui-03-forecasting-charts.png`, `ui-04-inventory.png`,
`ui-05-warehouses.png`, `ui-06-procurement-drawer.png`, `ui-07-disruptions.png`,
`ui-08-agent-timeline.png`, `ui-09-reports.png` (captured from the running app in the
browser panel; the panel viewport is ~830 CSS px wide, so captures show the responsive
single-column layout rather than a 1440 px desktop frame).

## 5. Checks NOT performed (honest gaps)

| Item | Status |
| --- | --- |
| Supabase/Postgres integration test | **not run** — no Supabase project credentials in this environment; SQLAlchemy is dialect-agnostic and the schema is created from the same models, but this remains unverified against a real Postgres instance |
| Vercel deployment / production URLs | **not run** — no Vercel credentials; `vercel.json` + `api/index.py` are in place and the ASGI app is tested locally |
| GitHub push | **done** — the full history is on `origin/main` at `github.com/sonalisanjeevprabu18/multi-agent-supply-chain-automation.` |
| Load/performance testing | not run; demo workflow completes in ~1.6 s on 4,320 sales rows |
| Cross-browser testing | Chromium only |
| Accessibility audit | not run (semantic tables, labels and focusable controls are used) |

These are documented as limitations rather than reported as passing.
