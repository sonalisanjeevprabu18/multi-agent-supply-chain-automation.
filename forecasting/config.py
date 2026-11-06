"""Configuration for the forecasting package.

Model artifacts are written to a directory that is *not* inside the deployment
bundle when running on serverless platforms. Locally the default is
``backend/artifacts``; in production set MODEL_ARTIFACT_DIR to a writable path or
sync artifacts to Supabase Storage (see docs/ARCHITECTURE.md).
"""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def artifact_dir() -> Path:
    """Return (and create) the directory where trained model artifacts live."""
    configured = os.getenv("MODEL_ARTIFACT_DIR")
    path = Path(configured) if configured else REPO_ROOT / "backend" / "artifacts"
    if not path.is_absolute():
        path = REPO_ROOT / path
    path.mkdir(parents=True, exist_ok=True)
    return path


# ---- Model hyper-parameters (single source of truth) ----
XGB_PARAMS: dict = {
    "n_estimators": 300,
    "max_depth": 4,
    "learning_rate": 0.07,
    "subsample": 0.9,
    "colsample_bytree": 0.9,
    "min_child_weight": 1,
    "objective": "reg:squarederror",
    "random_state": 42,
    "n_jobs": 4,
}

MIN_OBSERVATIONS = 60      # minimum daily points to attempt XGBoost
MIN_TRAIN_ROWS = 40        # minimum supervised rows after feature construction
TEST_DAYS = 28             # chronological hold-out window
DEFAULT_HORIZONS = (7, 14, 30)
MAX_HORIZON = 30
