"""OIDC and Immich API key authentication. Transient credentials and opaque sessions stay server-side."""
from __future__ import annotations

import logging
import secrets
import time

import httpx
from authlib.integrations.starlette_client import OAuth
from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse
from starlette.concurrency import run_in_threadpool

logger = logging.getLogger('immich_wm.auth')

PUBLIC_AUTH_PATHS = {'/api/auth/session', '/api/auth/oidc/login', '/api/auth/oidc/callback', '/api/auth/immich-key'}

_KEY_LOGIN_WINDOW_SECONDS = 300
_KEY_LOGIN_MAX_FAILURES = 5
_KEY_MAX_LENGTH = 256


def _validate_immich_key(url: str, key: str, transport) -> tuple[str, str]:
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


def install_auth(app, settings, sessions):
    enabled = bool(settings.oidc_issuer)
    transactions = {}
    key_failures: dict[str, list[float]] = {}
    app.state.immich_key_transport = None  # Tests inject an httpx transport here.
    oauth = OAuth()
    provider = None
    if enabled:
        provider = oauth.register(
            'pocket', client_id=settings.oidc_client_id, client_secret=settings.oidc_client_secret,
            server_metadata_url=settings.oidc_issuer + '/.well-known/openid-configuration',
            client_kwargs={'scope': 'openid profile groups', 'code_challenge_method': 'S256', 'timeout': 15},
        )
    app.state.oidc_provider = provider

    @app.get('/api/auth/session')
    def session(request: Request):
        methods = ['immich_key']
        if enabled:
            methods.insert(0, 'oidc')
        elif settings.token:
            methods.append('token')
        return {'mode': 'oidc' if enabled else 'token', 'methods': methods,
                'authenticated': sessions.get(request.cookies.get('wm_session', ''), 0) > time.monotonic()}

    @app.post('/api/auth/immich-key')
    async def immich_key_login(request: Request):
        try:
            body = await request.json()
        except Exception:
            return JSONResponse({'error': 'invalid_request'}, 422)
        key = body.get('key', '') if isinstance(body, dict) else ''
        if not isinstance(key, str) or not key.strip() or len(key.strip()) > _KEY_MAX_LENGTH:
            return JSONResponse({'error': 'invalid_request'}, 422)
        key = key.strip()
        host = request.client.host if request.client else ''
        now = time.monotonic()
        failures = [t for t in key_failures.get(host, ()) if t > now - _KEY_LOGIN_WINDOW_SECONDS]
        if len(failures) >= _KEY_LOGIN_MAX_FAILURES:
            return JSONResponse({'error': 'login_rate_limited'}, 429)
        email, error = await run_in_threadpool(
            _validate_immich_key, settings.immich_url, key, request.app.state.immich_key_transport)
        if error:
            # The key itself never reaches logs or responses; only the outcome does.
            logger.info('immich key login failed: %s', error)
            if error in {'invalid_key', 'key_scope_insufficient'}:
                failures.append(now)
                key_failures[host] = failures
            status = {'invalid_key': 401, 'key_scope_insufficient': 403}.get(error, 502)
            return JSONResponse({'error': error}, status)
        logger.info('immich key login ok for %s', email)
        now = time.monotonic()
        sessions.clear()  # Single operator; a new login revokes the previous session.
        session_id = secrets.token_urlsafe(32)
        sessions[session_id] = now + 8 * 3600
        response = JSONResponse({'ok': True})
        response.set_cookie('wm_session', session_id, httponly=True, samesite='strict',
                            secure=(settings.public_origin.startswith('https://') if settings.public_origin
                                    else request.url.scheme == 'https'), max_age=8 * 3600)
        return response


    @app.get('/api/auth/oidc/login')
    async def start(request: Request):
        if not enabled:
            return JSONResponse({'error': 'oidc_disabled'}, 404)
        now = time.monotonic()
        for key in list(transactions):
            if transactions[key][0] <= now:
                transactions.pop(key, None)
        if len(transactions) >= 128:
            return JSONResponse({'error': 'login_busy'}, 429)
        # The browser only receives a random binding; Authlib's state, nonce and
        # PKCE verifier are kept here, never in localStorage or readable cookies.
        key = secrets.token_urlsafe(32)
        request.scope['session'] = {}
        try:
            response = await provider.authorize_redirect(
                request, settings.public_origin + '/api/auth/oidc/callback')
        except Exception:
            return JSONResponse({'error': 'identity_service_unavailable'}, 502)
        transactions[key] = (now + 300, request.session)
        response.set_cookie('__Host-wm_oidc', key, secure=True, httponly=True, samesite='lax', max_age=300)
        return response

    @app.get('/api/auth/oidc/callback')
    async def callback(request: Request):
        def failure():
            response = RedirectResponse('/?auth_error=login_failed', status_code=303)
            response.delete_cookie('__Host-wm_oidc', secure=True, httponly=True, samesite='lax')
            return response

        if not enabled:
            return JSONResponse({'error': 'oidc_disabled'}, 404)
        transaction = transactions.pop(request.cookies.get('__Host-wm_oidc', ''), None)
        if not transaction or transaction[0] <= time.monotonic():
            return failure()
        request.scope['session'] = transaction[1]
        try:
            token = await provider.authorize_access_token(request, claims_options={
                'iss': {'essential': True, 'value': settings.oidc_issuer},
                'sub': {'essential': True}, 'exp': {'essential': True},
            }, leeway=30)
            user = token['userinfo']  # Authlib verifies JWT signature, issuer, audience, expiry and nonce.
            if user.get('nonce_supported') is False:
                return failure()
            groups = user.get('groups', [])
            if not isinstance(groups, list) or settings.oidc_allowed_group not in groups or not user.get('sub'):
                return failure()
        except Exception:
            # Never include provider errors, authorization codes or tokens in logs/UI.
            return failure()
        now = time.monotonic()
        for key in list(sessions):
            if sessions[key] <= now:
                sessions.pop(key, None)
        if len(sessions) >= 128:
            return failure()
        sessions.pop(request.cookies.get('wm_session', ''), None)
        session_id = secrets.token_urlsafe(32)
        sessions[session_id] = now + 3600
        response = RedirectResponse('/', status_code=303)
        response.set_cookie('wm_session', session_id, secure=True, httponly=True, samesite='strict', max_age=3600)
        response.delete_cookie('__Host-wm_oidc', secure=True, httponly=True, samesite='lax')
        return response

    @app.post('/api/auth/logout')
    def logout(request: Request):
        sessions.pop(request.cookies.get('wm_session', ''), None)
        response = JSONResponse({'ok': True})
        response.delete_cookie('wm_session', secure=bool(settings.public_origin.startswith('https://')),
                               httponly=True, samesite='strict')
        return response
