"""FastAPI application for the multi-agent supply-chain automation system."""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from backend.api import (
    routes_agents,
    routes_catalog,
    routes_forecast,
    routes_inventory,
    routes_procurement,
    routes_reports,
    routes_sales,
)
from backend.config import settings
from backend.database.seed import seed_database
from backend.database.session import get_engine, init_db, session_scope

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("supply_chain")

DESCRIPTION = """
Multi-Agent AI System for Autonomous Business Process Automation.

An SME supply-chain control tower: XGBoost demand forecasting, multi-warehouse
inventory optimization, supplier selection, disruption management and a LangGraph
orchestrator that runs seven specialized agents over a shared state.

* Forecasting, optimization, supplier ranking and verification are deterministic
  Python business logic - no LLM is required for any core workflow.
* All purchase orders and disruptions are **simulated planning records**.
* The seed data is synthetic and clearly labelled as such.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create the schema and seed synthetic demo data on an empty database."""
    init_db()
    auto_seed = os.getenv("AUTO_SEED", "true").strip().lower() in {"1", "true", "yes"}
    if auto_seed:
        try:
            with session_scope() as session:
                result = seed_database(session)
                if result.get("seeded"):
                    logger.info("Seeded synthetic demonstration data: %s", result)
        except Exception as exc:  # noqa: BLE001 - startup must not crash on seed issues
            logger.warning("Auto-seed skipped: %s", exc)
    logger.info(
        "Backend ready (env=%s, database=%s)",
        settings.app_env,
        "sqlite-dev" if settings.is_sqlite else "postgresql",
    )
    yield


app = FastAPI(
    title="Multi-Agent Supply Chain Automation API",
    description=DESCRIPTION,
    version="1.0.0",
    lifespan=lifespan,
    contact={"name": "Capstone Project"},
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins or ["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

for router in (
    routes_catalog.router,
    routes_sales.router,
    routes_forecast.router,
    routes_inventory.router,
    routes_procurement.router,
    routes_agents.router,
    routes_reports.router,
):
    app.include_router(router)


@app.exception_handler(ValueError)
async def value_error_handler(request: Request, exc: ValueError) -> JSONResponse:
    logger.warning("ValueError on %s: %s", request.url.path, exc)
    return JSONResponse(status_code=422, content={"detail": str(exc)})


@app.get("/", tags=["system"])
def root() -> dict:
    return {
        "service": "Multi-Agent Supply Chain Automation API",
        "version": "1.0.0",
        "docs": "/docs",
        "openapi": "/openapi.json",
        "health": "/health",
    }


@app.get("/health", tags=["system"])
def health() -> dict:
    """Liveness + database connectivity check."""
    database = {"status": "unknown", "dialect": "unknown"}
    try:
        engine = get_engine()
        database["dialect"] = engine.dialect.name
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database["status"] = "ok"
    except Exception as exc:  # noqa: BLE001 - health endpoint reports, never raises
        database["status"] = f"error: {exc}"
    return {
        "status": "ok" if database["status"] == "ok" else "degraded",
        "app_env": settings.app_env,
        "database": database,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "agent_workflow": "langgraph",
        "llm_required": False,
    }
