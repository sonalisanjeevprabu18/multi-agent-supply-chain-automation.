"""Backend configuration loaded from environment variables / .env file."""

from __future__ import annotations

import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env loader so the app needs no extra dependency at import time."""
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv(REPO_ROOT / ".env")


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _normalise_pg_url(url: str) -> str:
    """SQLAlchemy 2.x requires an explicit driver."""
    if url.startswith("postgres://"):
        return "postgresql+psycopg2://" + url[len("postgres://"):]
    if url.startswith("postgresql://"):
        return "postgresql+psycopg2://" + url[len("postgresql://"):]
    return url


class Settings:
    """Runtime settings, read once at import."""

    def __init__(self) -> None:
        self.app_env: str = os.getenv("APP_ENV", "development")
        self.allow_sqlite_fallback: bool = _bool(os.getenv("ALLOW_SQLITE_FALLBACK"), True)
        self.database_url: str = self._resolve_database_url()
        self.cors_origins: list[str] = [
            origin.strip()
            for origin in os.getenv(
                "CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
            ).split(",")
            if origin.strip()
        ]
        self.max_upload_mb: int = int(os.getenv("MAX_UPLOAD_MB", "5"))
        self.workflow_inline_budget_seconds: int = int(
            os.getenv("WORKFLOW_INLINE_BUDGET_SECONDS", "50")
        )
        self.supabase_url: str = os.getenv("SUPABASE_URL", "")
        self.supabase_service_role_key: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        self.supabase_storage_bucket: str = os.getenv(
            "SUPABASE_STORAGE_BUCKET", "supply-chain-artifacts"
        )

    def _resolve_database_url(self) -> str:
        url = os.getenv("DATABASE_URL", "").strip()
        if url:
            return _normalise_pg_url(url)
        if not self.allow_sqlite_fallback:
            raise RuntimeError(
                "DATABASE_URL is not configured and ALLOW_SQLITE_FALLBACK is disabled. "
                "Set DATABASE_URL to your Supabase PostgreSQL connection string."
            )
        # LOCAL DEVELOPMENT ONLY. Documented limitation: never use this in production.
        dev_db = REPO_ROOT / "backend" / "dev.db"
        dev_db.parent.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{dev_db.as_posix()}"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")

    @property
    def using_supabase_postgres(self) -> bool:
        return self.database_url.startswith("postgresql")


settings = Settings()
