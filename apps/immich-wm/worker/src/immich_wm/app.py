"""Companion preview same-origin API. Session login uses a random operator token, not Immich key."""
from __future__ import annotations

import hashlib
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from api.schemas import StrictModel
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image
from pydantic import Field, ValidationError
from starlette.middleware.gzip import GZipMiddleware

from immich_wm.auth import PUBLIC_AUTH_PATHS, install_auth
from immich_wm.client import ImmichClient, UpstreamError
from immich_wm.service import Conflict, Service
from immich_wm.settings import Settings

PUBLIC_VALUE_ERRORS = {
    'not_source_asset', 'file_too_large', 'invalid_image', 'source_changed',
    'unsupported_path', 'unsafe_path', 'not_regular_file', 'invalid_preview',
    'invalid_resource', 'output_too_large', 'renderer_changed', 'queue_full',
    'job_not_found', 'insufficient_disk_space', 'must_not_exist', 'checksum_mismatch',
}


class Login(StrictModel):
    token: str = Field(min_length=32, max_length=256)


class SaveConfig(StrictModel):
    expectedRevision: int = Field(ge=0, le=2**31 - 1)
    config: dict


class Render(StrictModel):
    revision: int = Field(ge=1, le=2**31 - 1)


def public_job(job):
    return {key: job[key] for key in ('id', 'asset_id', 'revision', 'generation', 'state', 'error')}


def create_app(settings: Settings | None = None, client=None, *, background=True):
    settings = settings or Settings.from_env()
    upstream = client or ImmichClient(settings.immich_url, settings.api_key)
    service = Service(settings, upstream)
    sessions = {}
    login_times = []
    stopped = threading.Event()

    def run():
        next_maintenance = 0.0
        while not stopped.wait(0.5):
            try:
                if service.render_next() is None:
                    service.reconcile_next()
                if time.monotonic() >= next_maintenance:
                    service.maintenance.tick()
                    next_maintenance = time.monotonic() + 5
            except Exception:
                # No raw core/upstream paths, keys or EXIF in logs/responses.
                stopped.set()

    @asynccontextmanager
    async def lifespan(_app):
        thread = threading.Thread(target=run, daemon=True)
        if background:
            thread.start()
        yield
        stopped.set()
        if background:
            thread.join()
        service.store.close()
        upstream.close()

    app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    app.state.service = service
    install_auth(app, settings, sessions)
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)

    @app.middleware('http')
    async def guard(request: Request, call_next):
        if request.url.path.startswith('/api/'):
            if request.method not in {'GET', 'HEAD'}:
                origin = request.headers.get('origin')
                expected_origin = settings.public_origin or str(request.base_url).rstrip('/')
                if (origin and origin != expected_origin) or (settings.oidc_issuer and origin != expected_origin):
                    return JSONResponse({'error': 'invalid_origin'}, 403)
            if request.url.path not in {'/api/login', '/api/health'} | PUBLIC_AUTH_PATHS:
                session = request.cookies.get('wm_session', '')
                if sessions.get(session, 0) < time.monotonic():
                    sessions.pop(session, None)
                    return JSONResponse({'error': 'login_required'}, 401)
            # Bound body before FastAPI JSON/multipart parsing (including chunked).
            body = bytearray()
            async for chunk in request.stream():
                body.extend(chunk)
                if len(body) > (11 * 1024 * 1024 if request.url.path in {'/api/resources', '/api/upload-resource'} else 256 * 1024):
                    return JSONResponse({'error': 'request_too_large'}, 413)
            request._body = bytes(body)
        try:
            response = await call_next(request)
        except Exception:
            return JSONResponse({'error': 'operation_failed'}, 500)
        # Only public build assets may be cached. Photos and authenticated API
        # responses must never become persistent browser/proxy cache entries.
        path = request.url.path
        if response.status_code in {200, 304} and path.startswith('/assets/'):
            response.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
        elif response.status_code in {200, 304} and path.startswith('/fonts/'):
            response.headers['Cache-Control'] = 'public, max-age=86400'
        elif path.startswith('/api/'):
            response.headers['Cache-Control'] = 'no-store'
        else:
            response.headers['Cache-Control'] = 'no-cache'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        response.headers['Referrer-Policy'] = 'no-referrer'
        return response

    @app.exception_handler(RequestValidationError)
    @app.exception_handler(ValidationError)
    async def invalid(_request, _exc):
        return JSONResponse({'error': 'invalid_request'}, 422)

    @app.exception_handler(ValueError)
    async def invalid_value(_request, exc):
        code = str(exc)
        return JSONResponse({'error': code if code in PUBLIC_VALUE_ERRORS else 'invalid_input_or_asset'}, 422)

    @app.exception_handler(Conflict)
    async def conflict(_request, exc):
        return JSONResponse({'error': str(exc)}, 409)

    @app.exception_handler(UpstreamError)
    async def upstream_error(_request, _exc):
        return JSONResponse({'error': 'immich_unavailable'}, 502)

    @app.get('/api/health')
    def health():
        return {'ok': not stopped.is_set(), 'phase': 'M1-preview'}

    @app.post('/api/login')
    def login(body: Login, request: Request):
        if settings.oidc_issuer:
            return JSONResponse({'error': 'token_login_disabled'}, 404)
        now = time.monotonic()
        login_times[:] = [t for t in login_times if t > now - 60]
        if len(login_times) >= 10:
            raise HTTPException(429)
        login_times.append(now)
        if not secrets.compare_digest(hashlib.sha256(body.token.encode()).digest(), hashlib.sha256(settings.token.encode()).digest()):
            raise HTTPException(401)
        sessions.clear()  # M0 single operator; new login revokes previous session.
        session = secrets.token_urlsafe(32)
        sessions[session] = now + 8 * 3600
        response = JSONResponse({'ok': True})
        response.set_cookie('wm_session', session, httponly=True, samesite='strict', secure=(settings.public_origin.startswith('https://') if settings.public_origin else request.url.scheme == 'https'), max_age=8*3600)
        return response

    @app.get('/api/maintenance')
    def maintenance_status():
        return service.maintenance.status()

    @app.post('/api/maintenance/backup')
    def backup():
        return service.maintenance.backup()

    @app.get('/api/capabilities')
    def capabilities():
        return {'upload': {'max_file_bytes': settings.max_bytes, 'allowed_extensions': ['.jpg', '.jpeg', '.png']},
                'preview': {'max_edge': settings.preview_edge, 'device_pixel_ratio_limit': 2},
                'process': {'max_image_pixels': settings.max_pixels, 'concurrency': 1}}

    @app.get('/api/albums')
    def list_albums():
        try:
            return {'albums': upstream.albums(), 'available': True}
        except UpstreamError as exc:
            if exc.status == 403:
                # The panel key may lack album.read; filtering stays hidden.
                return {'albums': [], 'available': False}
            raise

    @app.get('/api/assets')
    def assets(page: Annotated[int, Field(ge=1, le=10000)] = 1,
               album: UUID | None = None):
        result = upstream.search(settings.source_library, page, albums=[album] if album else None)
        items = []
        for asset in result['items']:
            try:
                from immich_wm.paths import relative_path
                relative_path(asset['originalPath'], settings.source_prefix)
                if asset.get('libraryId') != settings.source_library or asset.get('type') != 'IMAGE':
                    continue
                items.append({'id': asset['id'], 'name': asset['originalFileName']})
            except (KeyError, ValueError):
                continue
        statuses = service.gallery_status([item['id'] for item in items])
        for item in items:
            item['status'] = statuses[item['id']]
        return {'items': items, 'nextPage': result.get('nextPage')}

    @app.get('/api/assets/{asset_id}/preview')
    def preview(asset_id: UUID):
        service.source(str(asset_id))
        data, mime = upstream.preview(str(asset_id))
        if mime.split(';')[0] not in {'image/jpeg', 'image/png', 'image/webp'}:
            raise ValueError('invalid_preview')
        return Response(data, media_type=mime)

    @app.get('/api/assets/{asset_id}/thumbnail')
    def thumbnail(asset_id: UUID):
        service.source(str(asset_id))
        data, mime = upstream.preview(str(asset_id), maximum=2 * 1024 * 1024, thumbnail=True)
        if mime.split(';')[0] not in {'image/jpeg', 'image/png', 'image/webp'}:
            raise ValueError('invalid_preview')
        return Response(data, media_type=mime)

    @app.get('/api/assets/{asset_id}/metadata')
    def metadata(asset_id: UUID):
        return service.metadata(str(asset_id))

    @app.get('/api/assets/{asset_id}/config')
    def get_config(asset_id: UUID):
        service.source(str(asset_id))
        return service.config(str(asset_id))

    @app.get('/api/assets/{asset_id}/job')
    def latest_job(asset_id: UUID):
        service.source(str(asset_id))
        job = service.latest_job(str(asset_id))
        return {'job': public_job(job) if job else None}

    @app.get('/api/assets/{asset_id}/output')
    def output(asset_id: UUID, generation: Annotated[int, Field(ge=1, le=2**31-1)]):
        service.source(str(asset_id))
        return Response(service.output_preview(str(asset_id), generation), media_type='image/jpeg')

    @app.put('/api/assets/{asset_id}/config')
    def save(asset_id: UUID, body: SaveConfig):
        return service.save(str(asset_id), body.config, body.expectedRevision)

    @app.post('/api/assets/{asset_id}/render', status_code=202)
    def render(asset_id: UUID, body: Render):
        return public_job(service.enqueue(str(asset_id), body.revision))

    @app.get('/api/jobs/{job_id}')
    def job(job_id: UUID):
        return public_job(service.store.job(job_id.hex))

    @app.post('/api/jobs/{job_id}/sync')
    def sync(job_id: UUID):
        return public_job(service.sync(job_id.hex))

    @app.post('/api/resources')
    def upload(file: UploadFile = File()):
        service.maintenance.require_space(10 * 1024 * 1024)
        raw = file.file.read(10 * 1024 * 1024 + 1)
        if len(raw) > 10 * 1024 * 1024:
            raise HTTPException(413)
        with Image.open(BytesIO(raw)) as image:
            if image.format not in {'JPEG', 'PNG', 'WEBP'} or image.width * image.height > 4_000_000:
                raise ValueError('invalid_resource')
            image.load()
            normalized = BytesIO()
            image.convert('RGBA').save(normalized, format='PNG')
        name = uuid4().hex + '.png'
        with service.store.lock, (service.resources / name).open('xb') as output:
            output.write(normalized.getvalue())
        return {'resourceId': name}

    @app.post('/api/upload-resource')
    def editor_upload(file: UploadFile = File(), kind: Literal['logo', 'signature'] = Form()):
        result = upload(file)
        return {'ok': True, 'filename': result['resourceId'], 'kind': kind, 'resource_id': result['resourceId']}

    @app.get('/api/resources/logo/{resource_id}')
    @app.get('/api/resources/signature/{resource_id}')
    @app.get('/api/resources/{resource_id}')
    def resource(resource_id: str):
        if len(resource_id) != 36 or not resource_id.endswith('.png'):
            raise ValueError('invalid_resource')
        UUID(resource_id[:-4])
        return FileResponse(service.resources / resource_id, media_type='image/png')

    @app.get('/api/logos')
    def logos():
        from immich_wm.logos import catalog
        return {'ok': True, 'logos': catalog()}

    @app.get('/api/builtin-logos/{name}')
    def builtin_logo(name: str, variant: Annotated[str, Field(max_length=16)] = '', dark: bool = False):
        from immich_wm.logos import resolve
        return FileResponse(resolve(name, variant, dark))

    from kari_core.core.config_loader import FONTS_DIR
    if FONTS_DIR.is_dir():
        app.mount('/fonts', StaticFiles(directory=FONTS_DIR), name='fonts')

    web = Path(os.environ.get('WM_WEB_ROOT', str(Path(__file__).resolve().parents[3] / 'web' / 'dist')))
    if web.is_dir():
        app.mount('/', StaticFiles(directory=web, html=True), name='web')
    return app
