"""OIDC authentication. Transient credentials and opaque sessions stay server-side."""
from __future__ import annotations

import secrets
import time

from authlib.integrations.starlette_client import OAuth
from fastapi import Request
from fastapi.responses import JSONResponse, RedirectResponse

PUBLIC_AUTH_PATHS = {'/api/auth/session', '/api/auth/oidc/login', '/api/auth/oidc/callback'}


def install_auth(app, settings, sessions):
    enabled = bool(settings.oidc_issuer)
    transactions = {}
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
        return {'mode': 'oidc' if enabled else 'token',
                'authenticated': sessions.get(request.cookies.get('wm_session', ''), 0) > time.monotonic()}

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
