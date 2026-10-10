"""Immich API key authentication: init-mode association and panel sessions.

The panel's sole credential is one Immich API key stored in the container
config directory. Before that key exists the panel runs in init mode and only
accepts /api/init; afterwards the operator logs in by presenting the same key.
Transient credentials and opaque sessions stay server-side.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
import time

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from immich_wm.keyconfig import save_panel_key

logger = logging.getLogger('immich_wm.auth')

PUBLIC_AUTH_PATHS = {'/api/auth/session', '/api/auth/immich-key', '/api/init'}
INIT_ONLY_PATHS = {'/api/health', '/api/auth/session', '/api/init'}

_WINDOW_SECONDS = 300
_MAX_FAILURES = 5
_MAX_KEY_LENGTH = 256


def validate_immich_key(url: str, key: str, transport) -> tuple[str, str]:
    """Check a user-supplied key against Immich. Returns (email, error_code)."""
    try:
        with httpx.Client(base_url=url.rstrip('/') + '/api/', headers={'x-api-key': key},
                          timeout=10, follow_redirects=False, transport=transport) as client:
            response = client.get('users/me')
    except httpx.HTTPError:
        return '', 'immich_unreachable'
    if response.status_code == 401:
        return '', 'invalid_key'
    if response.status_code == 403:
        return '', 'key_scope_insufficient'
    if response.status_code != 200:
        return '', 'immich_unreachable'
    try:
        email = str(response.json().get('email') or '')
    except ValueError:
        email = ''
    return email, ''


def _secure_cookie(settings, request: Request) -> bool:
    return settings.public_origin.startswith('https://') if settings.public_origin else request.url.scheme == 'https'


def install_auth(app, settings, sessions, panel):
    """Register auth endpoints. ``panel`` is the mutable PanelState from app.py."""
    failures: dict[str, list[float]] = {}
    app.state.immich_key_transport = None  # Tests inject an httpx transport here.

    def _recent_failures(request: Request) -> list[float]:
        host = request.client.host if request.client else ''
        now = time.monotonic()
        return [t for t in failures.get(host, ()) if t > now - _WINDOW_SECONDS]

    def _rate_limited(request: Request) -> bool:
        return len(_recent_failures(request)) >= _MAX_FAILURES

    def _record_failure(request: Request) -> None:
        host = request.client.host if request.client else ''
        recent = _recent_failures(request)
        recent.append(time.monotonic())
        failures[host] = recent

    def _issue_session(request: Request) -> JSONResponse:
        now = time.monotonic()
        sessions.clear()  # Single operator; a new login revokes the previous session.
        session_id = secrets.token_urlsafe(32)
        sessions[session_id] = now + 8 * 3600
        response = JSONResponse({'ok': True})
        response.set_cookie('wm_session', session_id, httponly=True, samesite='strict',
                            secure=_secure_cookie(settings, request), max_age=8 * 3600)
        return response

    async def _read_key(request: Request) -> tuple[str, JSONResponse | None]:
        try:
            body = await request.json()
        except Exception:
            return '', JSONResponse({'error': 'invalid_request'}, 422)
        key = body.get('key', '') if isinstance(body, dict) else ''
        if not isinstance(key, str) or not key.strip() or len(key.strip()) > _MAX_KEY_LENGTH:
            return '', JSONResponse({'error': 'invalid_request'}, 422)
        return key.strip(), None

    @app.get('/api/auth/session')
    def session(request: Request):
        return {'mode': 'immich_key' if panel.initialized else 'init',
                'initialized': panel.initialized,
                'authenticated': panel.initialized
                and sessions.get(request.cookies.get('wm_session', ''), 0) > time.monotonic()}

    @app.post('/api/auth/immich-key')
    async def immich_key_login(request: Request):
        if not panel.initialized:
            return JSONResponse({'error': 'init_required'}, 403)
        key, error_response = await _read_key(request)
        if error_response is not None:
            return error_response
        if _rate_limited(request):
            return JSONResponse({'error': 'login_rate_limited'}, 429)
        # Constant-time comparison against the stored key; no Immich roundtrip,
        # so login still works while Immich is briefly down.
        if not secrets.compare_digest(hashlib.sha256(key.encode()).digest(),
                                      hashlib.sha256(panel.key.encode()).digest()):
            _record_failure(request)
            logger.info('panel key login failed: invalid_key')
            return JSONResponse({'error': 'invalid_key'}, 401)
        logger.info('panel key login ok')
        return _issue_session(request)

    @app.post('/api/init')
    async def init(request: Request):
        if panel.initialized:
            return JSONResponse({'error': 'already_initialized'}, 409)
        key, error_response = await _read_key(request)
        if error_response is not None:
            return error_response
        if _rate_limited(request):
            return JSONResponse({'error': 'login_rate_limited'}, 429)
        email, error = await run_in_threadpool(
            validate_immich_key, settings.immich_url, key, request.app.state.immich_key_transport)
        if error:
            # The key itself never reaches logs or responses; only the outcome does.
            logger.info('panel init failed: %s', error)
            if error in {'invalid_key', 'key_scope_insufficient'}:
                _record_failure(request)
            status = {'invalid_key': 401, 'key_scope_insufficient': 403}.get(error, 502)
            return JSONResponse({'error': error}, status)
        save_panel_key(settings.data, key)
        panel.key = key
        panel.on_key(key)
        panel.initialized = True
        logger.info('panel init ok for %s', email)
        return _issue_session(request)
