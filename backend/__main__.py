"""Module entrypoint: `python -m backend` (run from repo root) starts uvicorn.

This is a fallback for environments where invoking uvicorn directly is awkward
(e.g. corrupted PATH on Windows). The canonical entrypoint is:

    cd backend
    python -m uvicorn main:app --host 0.0.0.0 --port 8000

`python -m backend` resolves the same `main:app` ASGI application.
"""
from __future__ import annotations

import os
import sys

import uvicorn


def _resolve_app_import_string() -> str:
    """Return the dotted import string to pass to uvicorn."""
    # When executed as `python -m backend`, this module's package is `backend`,
    # so the FastAPI app lives at `backend.main:app`.
    pkg = __package__ or ""
    if pkg:
        return f"{pkg}.main:app"
    # When executed as `python backend/__main__.py`, fall back to `main:app`
    # with the backend dir added to sys.path.
    here = os.path.dirname(os.path.abspath(__file__))
    if here not in sys.path:
        sys.path.insert(0, here)
    return "main:app"


def main() -> None:
    import_string = _resolve_app_import_string()
    host = os.environ.get("AGNI_HOST", "0.0.0.0")
    port = int(os.environ.get("AGNI_PORT", "8000"))
    reload_flag = os.environ.get("AGNI_RELOAD", "0") == "1"
    uvicorn.run(import_string, host=host, port=port, reload=reload_flag)


if __name__ == "__main__":
    main()
