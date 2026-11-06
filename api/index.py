"""Vercel Python runtime entrypoint.

Vercel expects a module-level ASGI application named ``app``. The repository root
is added to ``sys.path`` so the ``backend``/``agents``/``forecasting`` packages
resolve when the function is bundled from the project root.

Deployment notes (see docs/DEPLOYMENT.md):
* Set the Vercel project Root Directory to the repository root.
* ``vercel.json`` routes every request to this function.
* Requirements are installed from ``requirements.txt`` at the repository root.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.main import app  # noqa: E402  (path setup must run first)

__all__ = ["app"]
