"""Shared test fixtures.

The suite runs against an isolated SQLite file plus a temporary artifact
directory. Tests never touch the development database or ``backend/dev.db``.
"""

from __future__ import annotations

import os
import tempfile
from datetime import date
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="supply-chain-tests-"))
os.environ["DATABASE_URL"] = f"sqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["ALLOW_SQLITE_FALLBACK"] = "true"
os.environ["MODEL_ARTIFACT_DIR"] = str(_TMP / "artifacts")
os.environ["AUTO_SEED"] = "false"
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.database.seed import seed_database  # noqa: E402
from backend.database.session import init_db, session_scope  # noqa: E402
from backend.main import app  # noqa: E402

SEED_END = date(2026, 10, 31)
SEED_DAYS = 140


@pytest.fixture(scope="session", autouse=True)
def seeded_database():
    """Create the schema and load deterministic synthetic demo data once."""
    init_db(drop=True)
    with session_scope() as session:
        summary = seed_database(session, days=SEED_DAYS, end_date=SEED_END)
    assert summary["seeded"] is True
    yield summary


@pytest.fixture()
def session():
    """Function-scoped session bound to the test database."""
    with session_scope() as db_session:
        yield db_session


@pytest.fixture(scope="session")
def trained_models(seeded_database):
    """Train the forecasting artifacts once for the whole session."""
    from backend.services import forecast_service

    with session_scope() as db_session:
        return forecast_service.train(db_session)


@pytest.fixture()
def client(seeded_database):
    """FastAPI TestClient (runs the app lifespan, without re-seeding)."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def artifact_dir(seeded_database) -> Path:
    from forecasting.config import artifact_dir as resolve

    return resolve()
