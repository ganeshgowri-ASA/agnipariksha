"""JWT auth for /api/* HTTP routes and /ws/* WebSocket routes.

Behaviour
---------
- ``AUTH_ENABLED=False`` (default for dev/demo) → all checks pass through.
- ``AUTH_ENABLED=True``  → a valid HS256 JWT is required.

HTTP clients pass tokens via ``Authorization: Bearer <token>``.
WebSocket clients pass tokens via the ``token`` query parameter
(``/ws/events?token=…``) since browsers cannot set custom headers on
``new WebSocket(...)``.

Tokens are minted out-of-band (e.g. by a SSO bridge) — this server only
validates them. A ``/api/auth/dev-token`` endpoint is provided so the
frontend dev loop can obtain a token when auth is enabled.
"""
from __future__ import annotations

import time
from typing import Optional

from fastapi import Depends, HTTPException, Request, WebSocket, status

from .config import get_settings


def _load_jwt():
    """Lazy-import PyJWT so the rest of the app boots even if PyJWT's
    optional C-extension deps (cryptography) are broken on the host."""
    try:
        import jwt  # PyJWT
        return jwt
    except Exception:  # pragma: no cover
        return None


class AuthError(HTTPException):
    def __init__(self, detail: str = "unauthorised") -> None:
        super().__init__(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


def _decode(token: str) -> dict:
    s = get_settings()
    jwt = _load_jwt()
    if jwt is None:
        raise AuthError("jwt library not installed on server")
    try:
        return jwt.decode(
            token,
            s.JWT_SECRET,
            algorithms=[s.JWT_ALG],
            audience=s.JWT_AUDIENCE,
            leeway=s.JWT_LEEWAY_S,
        )
    except Exception as exc:  # PyJWT raises a small zoo of subclasses
        raise AuthError(f"invalid token: {exc.__class__.__name__}") from exc


def mint_dev_token(subject: str = "dev", ttl_s: int = 60 * 60 * 8) -> str:
    """Mint a short-lived HS256 token for local dev / testing only."""
    s = get_settings()
    jwt = _load_jwt()
    if jwt is None:
        raise RuntimeError("PyJWT not installed")
    now = int(time.time())
    return jwt.encode(
        {"sub": subject, "aud": s.JWT_AUDIENCE, "iat": now, "exp": now + ttl_s},
        s.JWT_SECRET,
        algorithm=s.JWT_ALG,
    )


def require_user(request: Request) -> dict:
    """FastAPI dependency for HTTP routes — returns the decoded claims."""
    s = get_settings()
    if not s.AUTH_ENABLED:
        return {"sub": "anonymous", "auth": "disabled"}
    auth = request.headers.get("authorization", "")
    if not auth.lower().startswith("bearer "):
        raise AuthError("missing bearer token")
    return _decode(auth.split(" ", 1)[1].strip())


async def require_ws(ws: WebSocket) -> Optional[dict]:
    """Validate a WebSocket connection before ``accept``.

    On failure, closes the socket with policy violation (1008) and returns
    ``None``. Callers should ``return`` immediately if the result is None.
    """
    s = get_settings()
    if not s.AUTH_ENABLED:
        return {"sub": "anonymous", "auth": "disabled"}
    token = ws.query_params.get("token", "")
    if not token:
        await ws.close(code=1008)
        return None
    try:
        return _decode(token)
    except AuthError:
        await ws.close(code=1008)
        return None


# Re-export the dependency in a form FastAPI consumers can use directly.
CurrentUser = Depends(require_user)
