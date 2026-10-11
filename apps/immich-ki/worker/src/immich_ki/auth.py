"""Immich-backed authentication: init-mode association and Immich account login.

The API key entered in init mode only associates the panel with Immich and is
stored server-side. Day-to-day login uses the operator's Immich account
(email + password), verified against Immich and discarded immediately; the
panel then issues its own opaque session cookie. Transient credentials stay
server-side and never reach logs.
"""

from __future__ import annotations

import logging
import secrets
import time

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from immich_ki.keyconfig import save_panel_config

logger = logging.getLogger("immich_ki.auth")

PUBLIC_AUTH_PATHS = {"/api/auth/session", "/api/auth/immich-login", "/api/auth/logout", "/api/init"}
INIT_ONLY_PATHS = {"/api/health", "/api/auth/session", "/api/init"}

_WINDOW_SECONDS = 300
_MAX_FAILURES = 5
_MAX_KEY_LENGTH = 256
_MAX_CRED_LENGTH = 256


def validate_immich_key(url: str, key: str, transport) -> tuple[str, str]:
    """Check an API key against Immich. Returns (owner_email, error_code)."""
    try:
        with httpx.Client(
            base_url=url.rstrip("/") + "/api/",
            headers={"x-api-key": key},
            timeout=10,
            follow_redirects=False,
            transport=transport,
        ) as client:
            response = client.get("users/me")
    except httpx.HTTPError:
        return "", "immich_unreachable"
    if response.status_code == 401:
        return "", "invalid_key"
    if response.status_code == 403:
        return "", "key_scope_insufficient"
    if response.status_code != 200:
        return "", "immich_unreachable"
    try:
        email = str(response.json().get("email") or "")
    except ValueError:
        email = ""
    return email, ""


def validate_immich_login(url: str, email: str, password: str, transport) -> tuple[str, str]:
    """Verify Immich account credentials. Returns (email, error_code); password never persists."""
    try:
        with httpx.Client(
            base_url=url.rstrip("/") + "/api/", timeout=10, follow_redirects=False, transport=transport
        ) as client:
            response = client.post("auth/login", json={"email": email, "password": password})
            if response.status_code in {400, 401}:
                return "", "invalid_credentials"
            if response.status_code == 429:
                return "", "login_rate_limited"
            if not 200 <= response.status_code < 300:
                logger.info("immich auth/login returned status %s", response.status_code)
                return "", "immich_unreachable"
            try:
                payload = response.json()
            except ValueError:
                logger.info("immich auth/login returned a non-JSON body")
                return "", "immich_unreachable"
            token = str(payload.get("accessToken") or payload.get("access_token") or "")
            if not token:
                # Log key names only; never values.
                logger.info("immich auth/login response keys: %s", sorted(payload.keys()))
                return "", "immich_unreachable"
            me = client.get("users/me", headers={"Authorization": f"Bearer {token}"})
            if not 200 <= me.status_code < 300:
                logger.info("immich users/me returned status %s", me.status_code)
                return "", "immich_unreachable"
            try:
                return str(me.json().get("email") or ""), ""
            except ValueError:
                return "", ""
    except httpx.HTTPError as exc:
        logger.info("immich auth/login transport error: %s", type(exc).__name__)
        return "", "immich_unreachable"


def _secure_cookie(settings, request: Request) -> bool:
    return settings.public_origin.startswith("https://") if settings.public_origin else request.url.scheme == "https"


def install_auth(app, settings, sessions, panel):
    """Register auth endpoints. ``panel`` is the mutable PanelState from app.py."""
    failures: dict[str, list[float]] = {}
    app.state.immich_key_transport = None  # Tests inject an httpx transport here.

    def _recent_failures(request: Request) -> list[float]:
        host = request.client.host if request.client else ""
        now = time.monotonic()
        return [t for t in failures.get(host, ()) if t > now - _WINDOW_SECONDS]

    def _rate_limited(request: Request) -> bool:
        return len(_recent_failures(request)) >= _MAX_FAILURES

    def _record_failure(request: Request) -> None:
        host = request.client.host if request.client else ""
        recent = _recent_failures(request)
        recent.append(time.monotonic())
        failures[host] = recent

    def _issue_session(request: Request) -> JSONResponse:
        now = time.monotonic()
        sessions.clear()  # Single operator; a new login revokes the previous session.
        session_id = secrets.token_urlsafe(32)
        sessions[session_id] = now + 8 * 3600
        response = JSONResponse({"ok": True})
        response.set_cookie(
            "ki_session",
            session_id,
            httponly=True,
            samesite="strict",
            secure=_secure_cookie(settings, request),
            max_age=8 * 3600,
        )
        return response

    async def _read_key(request: Request) -> tuple[str, JSONResponse | None]:
        try:
            body = await request.json()
        except Exception:
            return "", JSONResponse({"error": "invalid_request"}, 422)
        key = body.get("key", "") if isinstance(body, dict) else ""
        if not isinstance(key, str) or not key.strip() or len(key.strip()) > _MAX_KEY_LENGTH:
            return "", JSONResponse({"error": "invalid_request"}, 422)
        return key.strip(), None

    async def _read_credentials(request: Request) -> tuple[str, str, JSONResponse | None]:
        try:
            body = await request.json()
        except Exception:
            return "", "", JSONResponse({"error": "invalid_request"}, 422)
        email = body.get("email", "") if isinstance(body, dict) else ""
        password = body.get("password", "") if isinstance(body, dict) else ""
        email = email.strip() if isinstance(email, str) else ""
        if (
            not email
            or len(email) > _MAX_CRED_LENGTH
            or not isinstance(password, str)
            or not password
            or len(password) > _MAX_CRED_LENGTH
        ):
            return "", "", JSONResponse({"error": "invalid_request"}, 422)
        return email, password, None

    @app.get("/api/auth/session")
    def session(request: Request):
        return {
            "mode": "immich_key" if panel.initialized else "init",
            "initialized": panel.initialized,
            "authenticated": panel.initialized
            and sessions.get(request.cookies.get("ki_session", ""), 0) > time.monotonic(),
        }

    @app.post("/api/auth/immich-login")
    async def immich_login(request: Request):
        if not panel.initialized:
            return JSONResponse({"error": "init_required"}, 403)
        email, password, error_response = await _read_credentials(request)
        if error_response is not None:
            return error_response
        if _rate_limited(request):
            return JSONResponse({"error": "login_rate_limited"}, 429)
        identity, error = await run_in_threadpool(
            validate_immich_login, settings.immich_url, email, password, request.app.state.immich_key_transport
        )
        if error:
            # The password never reaches logs or responses; only the outcome does.
            logger.info("immich account login failed: %s", error)
            if error in {"invalid_credentials", "login_rate_limited"}:
                _record_failure(request)
            status = {"invalid_credentials": 401, "login_rate_limited": 429}.get(error, 502)
            return JSONResponse({"error": error}, status)
        if not panel.owner:
            # Fail closed: never bind the owner to whoever logs in first.
            _record_failure(request)
            logger.info("immich account login rejected: panel owner is not bound to a key")
            return JSONResponse({"error": "owner_unbound"}, 403)
        if identity != panel.owner:
            _record_failure(request)
            logger.info("immich account login rejected: %s is not the panel owner", identity)
            return JSONResponse({"error": "forbidden_account"}, 403)
        logger.info("immich account login ok for %s", identity)
        return _issue_session(request)

    @app.post("/api/auth/logout")
    def logout(request: Request):
        sessions.pop(request.cookies.get("ki_session", ""), None)
        response = JSONResponse({"ok": True})
        response.delete_cookie("ki_session", path="/")
        return response

    @app.post("/api/init")
    async def init(request: Request):
        if panel.initialized:
            return JSONResponse({"error": "already_initialized"}, 409)
        key, error_response = await _read_key(request)
        if error_response is not None:
            return error_response
        if _rate_limited(request):
            return JSONResponse({"error": "login_rate_limited"}, 429)
        email, error = await run_in_threadpool(
            validate_immich_key, settings.immich_url, key, request.app.state.immich_key_transport
        )
        if error:
            # The key itself never reaches logs or responses; only the outcome does.
            logger.info("panel init failed: %s", error)
            if error in {"invalid_key", "key_scope_insufficient"}:
                _record_failure(request)
            status = {"invalid_key": 401, "key_scope_insufficient": 403}.get(error, 502)
            return JSONResponse({"error": error}, status)
        save_panel_config(settings.data, key, email)
        panel.key = key
        panel.owner = email
        panel.on_key(key)
        panel.initialized = True
        logger.info("panel init ok for %s", email)
        return _issue_session(request)
