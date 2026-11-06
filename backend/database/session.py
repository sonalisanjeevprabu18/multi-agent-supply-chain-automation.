"""Database engine, session factory and FastAPI dependency."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from backend.config import settings
from backend.models.models import Base

_engine: Engine | None = None
_session_factory: sessionmaker[Session] | None = None


def get_engine(url: str | None = None, echo: bool = False) -> Engine:
    """Return the process-wide engine (created lazily)."""
    global _engine, _session_factory
    target = url or settings.database_url
    if _engine is None or url is not None:
        kwargs: dict = {"echo": echo, "future": True}
        if target.startswith("sqlite"):
            kwargs["connect_args"] = {"check_same_thread": False}
        else:
            # Supabase pooler friendly settings
            kwargs.update(pool_pre_ping=True, pool_recycle=1800, pool_size=5, max_overflow=5)
        engine = create_engine(target, **kwargs)
        if url is None:
            _engine = engine
            _session_factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        else:
            sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        return engine
    return _engine


def get_session_factory(url: str | None = None) -> sessionmaker[Session]:
    global _session_factory
    if _session_factory is None or url is not None:
        engine = get_engine(url)
        factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
        if url is None:
            _session_factory = factory
        return factory
    return _session_factory


def get_db() -> Iterator[Session]:
    """FastAPI dependency yielding a session that is always closed."""
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()


@contextmanager
def session_scope(url: str | None = None) -> Iterator[Session]:
    """Transactional scope for background work and scripts."""
    factory = get_session_factory(url)
    session = factory()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def init_db(url: str | None = None, drop: bool = False) -> None:
    """Create all tables (idempotent). ``drop`` is only for tests/scripts."""
    engine = get_engine(url)
    if drop:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def reset_database(url: str | None = None) -> None:
    init_db(url=url, drop=True)
