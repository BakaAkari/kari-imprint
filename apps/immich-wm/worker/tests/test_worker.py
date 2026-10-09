from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from immich_wm.app import create_app
from immich_wm.paths import open_source, relative_path
from immich_wm.service import Conflict, Service
from immich_wm.settings import Settings
from PIL import Image

CONFIG = {'schema_version': 3, 'canvas': {'margins': {'bottom': 20}}, 'regions': []}


class FakeImmich:
    def __init__(self, settings):
        self.settings = settings
        self.asset_id = str(uuid4())
        self.output_id = str(uuid4())
        self.imported = False
        self.refreshed = []
        self.album_filters = []

    def asset(self, asset_id):
        return {'id': asset_id, 'libraryId': self.settings.source_library, 'type': 'IMAGE', 'originalPath': '/external/camera-exports/photo.jpg'}

    def search(self, library, page=1, path=None, albums=None):
        if albums:
            self.album_filters.append([str(album) for album in albums])
        if path is None:
            return {'items': [{'id': self.asset_id, 'libraryId': library, 'type': 'IMAGE',
                               'originalPath': '/external/camera-exports/photo.jpg',
                               'originalFileName': 'photo.jpg'}], 'nextPage': None}
        items = [{'id': self.output_id, 'libraryId': library, 'originalPath': path}] if self.imported else []
        return {'items': items, 'nextPage': None}

    def albums(self):
        return [{'id': str(uuid4()), 'name': '旅行', 'assetCount': 3}]

    def refresh(self, asset_id):
        self.refreshed.append(asset_id)

    def close(self):
        pass


@pytest.fixture
def setup(tmp_path):
    imports, output = tmp_path / 'imports', tmp_path / 'output'
    imports.mkdir()
    output.mkdir()
    Image.new('RGB', (120, 80), 'red').save(imports / 'photo.jpg')
    settings = Settings('http://localhost:2283', 'secret', str(uuid4()), str(uuid4()), imports, output, tmp_path / 'data', token='x'*32)
    return settings, FakeImmich(settings)


@pytest.fixture
def service(setup):
    settings, client = setup
    value = Service(settings, client)
    yield value
    value.store.close()


def save_job(service, config=CONFIG):
    asset = service.client.asset_id
    revision = service.config(asset)['revision']
    result = service.save(asset, deepcopy(config), revision)
    return service.enqueue(asset, result['revision'])


def test_a_b_a_source_and_renderer_changes(service):
    hashes = []
    for margin in (20, 40, 20):
        config = deepcopy(CONFIG)
        config['canvas']['margins']['bottom'] = margin
        job = save_job(service, config)
        service.render_next()
        row = service.store.job(job['id'])
        assert row['state'] == 'awaiting_import', row
        hashes.append(row['output_hash'])
    assert hashes[0] == hashes[2] != hashes[1]
    with Image.open(service.settings.output / 'photo.jpg') as image:
        assert image.size == (120, 100)
        assert image.getexif()[274] == 1
        assert image.info['icc_profile']
    Image.new('RGB', (120, 80), 'blue').save(service.settings.imports / 'photo.jpg')
    new = service.enqueue(service.client.asset_id, 3)
    assert new['render_key'] != job['render_key']
    service.render_next()
    assert service.store.job(new['id'])['state'] == 'awaiting_import'


def test_conflict_and_superseded(service):
    job = save_job(service)
    with pytest.raises(Conflict):
        service.save(service.client.asset_id, deepcopy(CONFIG), 0)
    service.save(service.client.asset_id, deepcopy(CONFIG), 1)
    service.render_next()
    assert service.store.job(job['id'])['state'] == 'superseded'
    assert not (service.settings.output / 'photo.jpg').exists()


def test_published_file_then_crash_recovers(service, monkeypatch):
    job = save_job(service)
    original = __import__('os').fsync
    def crash(fd):
        import stat
        if stat.S_ISDIR(__import__('os').fstat(fd).st_mode):
            raise OSError('simulated crash after replace')
        original(fd)
    monkeypatch.setattr('os.fsync', crash)
    service.render_next()
    assert service.store.job(job['id'])['state'] == 'publishing'
    assert (service.settings.output / 'photo.jpg').exists()
    monkeypatch.setattr('os.fsync', original)
    service.recover()
    assert service.store.job(job['id'])['state'] == 'awaiting_import'


def test_foreign_output_never_overwritten(service):
    output = service.settings.output / 'photo.jpg'
    output.write_bytes(b'foreign')
    job = save_job(service)
    service.render_next()
    assert service.store.job(job['id'])['error'] == 'output_conflict'
    assert output.read_bytes() == b'foreign'


def test_sync_never_claims_job_acceptance_is_completion(service):
    job = save_job(service)
    service.render_next()
    assert service.sync(job['id'])['state'] == 'awaiting_import'
    service.client.imported = True
    assert service.sync(job['id'])['state'] == 'refresh_pending'
    service.client.output_id = str(uuid4())
    with pytest.raises(Conflict, match='output_identity_changed'):
        service.sync(job['id'])


def test_path_escape_and_symlink(service, tmp_path):
    for path in ['/external/camera-exports-evil/a.jpg', '/external/camera-exports/../a.jpg']:
        with pytest.raises(ValueError):
            relative_path(path, '/external/camera-exports')
    outside = tmp_path / 'outside.jpg'
    outside.write_bytes(b'secret')
    link = service.settings.imports / 'link.jpg'
    link.symlink_to(outside)
    with pytest.raises(OSError):
        with open_source(service.settings.imports, 'link.jpg'):
            pytest.fail('symlink accepted')


def test_auth_origin_strict_payload_and_no_paths(setup):
    settings, fake = setup
    with TestClient(create_app(settings, fake, background=False)) as client:
        endpoint = f'/api/assets/{fake.asset_id}/config'
        assert client.get(endpoint).status_code == 401
        assert client.post('/api/login', json={'token': settings.token}, headers={'origin': 'http://evil.test'}).status_code == 403
        assert client.post('/api/login', json={'token': settings.token}).status_code == 200
        assert client.put(endpoint, json={'expectedRevision': '0', 'config': CONFIG}).status_code == 422
        response = client.put(endpoint, json={'expectedRevision': 0, 'config': CONFIG})
        assert response.status_code == 200, response.text
        assert '/external/' not in response.text
        assert client.post(f'/api/assets/{fake.asset_id}/render', json={'revision': 1}).status_code == 202


def test_resource_survives_restart_and_database_backup(setup, tmp_path):
    settings, fake = setup
    with TestClient(create_app(settings, fake, background=False)) as client:
        client.post('/api/login', json={'token': settings.token})
        from io import BytesIO
        data = BytesIO()
        Image.new('RGBA', (40, 10), 'black').save(data, format='PNG')
        response = client.post('/api/resources', files={'file': ('logo.png', data.getvalue(), 'image/png')})
        assert response.status_code == 200, response.text
        resource_id = response.json()['resourceId']
    service = Service(settings, fake)
    try:
        assert (service.resources / resource_id).is_file()
        backup = tmp_path / 'backup.db'
        service.store.backup(backup)
        assert backup.stat().st_size > 0
    finally:
        service.store.close()


def test_source_change_before_publish_does_not_replace(service):
    job = save_job(service)
    Image.new('RGB', (120, 80), 'blue').save(service.settings.imports / 'photo.jpg')
    service.render_next()
    assert service.store.job(job['id'])['error'] == 'source_changed'
    assert not (service.settings.output / 'photo.jpg').exists()


def test_renderer_upgrade_changes_key_and_does_not_reuse_completed_job(service):
    from dataclasses import replace
    job = save_job(service)
    service.render_next()
    service.settings = replace(service.settings, renderer_version='m0-photo-srgb-v2')
    newer = service.enqueue(service.client.asset_id, 1)
    assert newer['id'] != job['id'] and newer['render_key'] != job['render_key']
    service.render_next()
    assert service.store.job(newer['id'])['state'] == 'awaiting_import'


def test_client_uses_actual_v3_preview_contract():
    import httpx
    from immich_wm.client import ImmichClient
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(200, content=b'jpeg', headers={'Content-Type': 'image/jpeg'})
    client = ImmichClient('http://immich:2283', 'private', transport=httpx.MockTransport(handle))
    try:
        asset_id = str(uuid4())
        data, mime = client.preview(asset_id)
        assert data == b'jpeg' and mime == 'image/jpeg'
        assert calls[0].url.path == f'/api/assets/{asset_id}/thumbnail'
        assert calls[0].url.params['size'] == 'preview'
        assert calls[0].headers['x-api-key'] == 'private'
        client.preview(asset_id, thumbnail=True)
        assert calls[-1].url.params['size'] == 'thumbnail'
        with pytest.raises(ValueError, match='preview_too_large'):
            client.preview(asset_id, maximum=1)
    finally:
        client.close()


def test_reconcile_retries_survive_restart_and_refresh_once(setup):
    from immich_wm.client import UpstreamError
    settings, fake = setup
    service = Service(settings, fake)
    job = save_job(service)
    service.render_next()
    assert service.reconcile_next(now=100) == job['id']
    assert service.store.job(job['id'])['state'] == 'awaiting_import'
    service.store.close()
    service = Service(settings, fake)
    try:
        assert service.reconcile_next(now=104) is None
        fake.imported = True
        original = fake.refresh
        def offline(_):
            raise UpstreamError(503)
        fake.refresh = offline
        service.reconcile_next(now=105)
        row = service.store.db.execute('SELECT * FROM sync_schedule WHERE job_id=?', (job['id'],)).fetchone()
        assert row['attempts'] == 2 and row['error'] == 'sync_retry_pending'
        fake.refresh = original
        assert service.reconcile_next(now=114) is None
        service.reconcile_next(now=115)
        assert service.store.job(job['id'])['state'] == 'refresh_pending'
        assert fake.refreshed == [fake.output_id]
        assert service.reconcile_next(now=10000) is None
    finally:
        service.store.close()


def test_reconcile_does_not_refresh_stale_revision(service):
    job = save_job(service)
    service.render_next()
    service.save(service.client.asset_id, CONFIG, 1)
    service.client.imported = True
    service.reconcile_next(now=100)
    assert service.store.job(job['id'])['state'] == 'superseded'
    assert not service.client.refreshed


def test_output_preview_rejects_old_generation_and_foreign_bytes(service):
    from io import BytesIO
    job = save_job(service)
    service.render_next()
    with Image.open(BytesIO(service.output_preview(service.client.asset_id, job['generation']))) as preview:
        assert preview.size == (120, 100)
        assert not preview.getexif()
    next_job = service.enqueue(service.client.asset_id, 1)
    with pytest.raises(Conflict, match='output_not_current'):
        service.output_preview(service.client.asset_id, job['generation'])
    service.render_next()
    (service.settings.output / 'photo.jpg').write_bytes(b'foreign')
    with pytest.raises(Conflict, match='output_conflict'):
        service.output_preview(service.client.asset_id, next_job['generation'])


def test_editor_upload_and_latest_job_contract(setup):
    from io import BytesIO
    settings, fake = setup
    app = create_app(settings, fake, background=False)
    with TestClient(app) as client:
        client.post('/api/login', json={'token': settings.token})
        endpoint = f'/api/assets/{fake.asset_id}'
        assert client.get(endpoint+'/job').json() == {'job': None}
        image = BytesIO()
        Image.new('RGBA', (60, 20), 'black').save(image, format='PNG')
        files = {'file': ('signature.png', image.getvalue(), 'image/png')}
        response = client.post('/api/upload-resource', data={'kind': 'signature'}, files=files)
        assert response.status_code == 200
        assert response.json()['ok'] and response.json()['kind'] == 'signature'
        resource = response.json()['resource_id']
        assert client.get('/api/resources/signature/'+resource).status_code == 200
        assert client.post('/api/upload-resource', data={'kind': 'unknown'}, files=files).status_code == 422
        client.put(endpoint+'/config', json={'expectedRevision': 0, 'config': CONFIG})
        job = client.post(endpoint+'/render', json={'revision': 1}).json()
        app.state.service.render_next()
        assert client.get(endpoint+'/job').json()['job']['id'] == job['id']
        preview = client.get(endpoint+'/output', params={'generation': job['generation']})
        assert preview.status_code == 200 and preview.headers['cache-control'] == 'no-store'
        assert client.get(endpoint+'/output?generation=0').status_code == 422


def test_public_static_cache_and_compression_keep_api_private(setup, tmp_path, monkeypatch):
    web = tmp_path / 'web'
    (web / 'assets').mkdir(parents=True)
    (web / 'index.html').write_text('<html>panel</html>')
    (web / 'assets' / 'index-test.js').write_text('const example = 1;\n' * 1000)
    monkeypatch.setenv('WM_WEB_ROOT', str(web))
    settings, fake = setup
    with TestClient(create_app(settings, fake, background=False)) as client:
        result = client.get('/assets/index-test.js', headers={'Accept-Encoding': 'gzip'})
        assert result.headers['content-encoding'] == 'gzip'
        assert result.headers['cache-control'] == 'public, max-age=31536000, immutable'
        assert len(result.content) > int(result.headers['content-length']) * 5
        assert 'Accept-Encoding' in result.headers['vary']
        assert client.get('/').headers['cache-control'] == 'no-cache'
        assert client.get('/api/health').headers['cache-control'] == 'no-store'
        assert client.post('/api/login', json={'token': settings.token}).headers['cache-control'] == 'no-store'
        assert client.get('/api/assets').headers['cache-control'] == 'no-store'
        assert client.get('/assets/missing.js').headers['cache-control'] == 'no-cache'


def test_public_origin_behind_http_proxy(setup):
    from dataclasses import replace
    settings, fake = setup
    origin = 'https://immt.baka-akari.icu:18443'
    settings = replace(settings, public_origin=origin)
    with TestClient(create_app(settings, fake, background=False), base_url='http://internal:2285') as client:
        response = client.post('/api/login', json={'token': settings.token}, headers={'Origin': origin})
        assert response.status_code == 200
        assert 'Secure' in response.headers['set-cookie']
        for bad in ['https://evil.example', origin + '.evil.example', 'null', 'http://internal:2285']:
            response = client.post('/api/login', json={'token': settings.token}, headers={
                'Origin': bad, 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': bad,
            })
            assert response.status_code == 403
            assert response.json()['error'] == 'invalid_origin'


@pytest.mark.parametrize('origin', ['*', 'https://example.com/', 'https://user:pass@example.com',
                                   'https://example.com/path', 'https://example.com?x=1',
                                   'https://example.com:99999', 'https://example.com\n'])
def test_invalid_public_origin_configuration(setup, origin):
    from dataclasses import replace
    with pytest.raises(ValueError):
        replace(setup[0], public_origin=origin)


@pytest.mark.parametrize('fault', [None, 'nonce', 'aud', 'iss', 'expired', 'signature', 'group', 'state', 'binding'])
def test_oidc_signed_tokens_and_browser_binding(setup, fault):
    import time
    from dataclasses import replace
    from urllib.parse import parse_qs, urlsplit

    import httpx
    from joserfc import jwt
    from joserfc.jwk import RSAKey

    settings, fake = setup
    issuer = 'https://id.example.com'
    origin = 'https://panel.example.com'
    settings = replace(settings, public_origin=origin, oidc_issuer=issuer,
                       oidc_client_id='test-client', oidc_client_secret='test-secret',
                       oidc_allowed_group='kari-imprint-admin')
    app = create_app(settings, fake, background=False)
    key = RSAKey.generate_key(2048)
    key.ensure_kid()
    pending = {}

    def upstream(request):
        if request.url.path == '/.well-known/openid-configuration':
            return httpx.Response(200, json={
                'issuer': issuer, 'authorization_endpoint': issuer+'/authorize',
                'token_endpoint': issuer+'/token', 'jwks_uri': issuer+'/jwks',
                'id_token_signing_alg_values_supported': ['RS256'],
            })
        if request.url.path == '/jwks':
            return httpx.Response(200, json={'keys': [key.as_dict(private=False)]})
        assert request.url.path == '/token'
        form = parse_qs(request.content.decode())
        import base64
        import hashlib
        challenge = base64.urlsafe_b64encode(hashlib.sha256(form['code_verifier'][0].encode()).digest()).rstrip(b'=').decode()
        assert challenge == pending['code_challenge'][0]
        claims = {'iss': issuer, 'aud': 'test-client', 'sub': 'user-1', 'iat': int(time.time()),
                  'exp': int(time.time())+300, 'nonce': pending['nonce'][0], 'groups': ['kari-imprint-admin']}
        if fault in {'iss', 'aud', 'nonce'}:
            claims[fault] = 'wrong'
        if fault == 'expired':
            claims['exp'] = int(time.time())-600
        if fault == 'group':
            claims['groups'] = ['other']
        signing_key = RSAKey.generate_key(2048) if fault == 'signature' else key
        encoded = jwt.encode({'alg': 'RS256', 'kid': key.kid}, claims, signing_key)
        return httpx.Response(200, json={'access_token': 'test-access', 'token_type': 'Bearer', 'id_token': encoded})

    app.state.oidc_provider.client_kwargs['transport'] = httpx.MockTransport(upstream)
    with TestClient(app, base_url=origin) as client:
        assert client.get('/api/assets').status_code == 401
        assert client.post('/api/login', json={'token': settings.token}, headers={'Origin': origin}).status_code == 404
        start = client.get('/api/auth/oidc/login', follow_redirects=False)
        assert start.status_code == 302
        pending.update(parse_qs(urlsplit(start.headers['location']).query))
        assert pending['code_challenge_method'] == ['S256']
        assert pending['redirect_uri'] == [origin+'/api/auth/oidc/callback']
        assert 'Secure' in start.headers['set-cookie'] and 'HttpOnly' in start.headers['set-cookie']
        if fault == 'binding':
            client.cookies.clear()
        params = {'code': 'one-time-code', 'state': 'wrong' if fault == 'state' else pending['state'][0]}
        callback = client.get('/api/auth/oidc/callback', params=params, follow_redirects=False)
        assert callback.status_code == 303
        assert client.get('/api/auth/session').json()['authenticated'] is (fault is None)
        assert client.get('/api/assets').status_code == (200 if fault is None else 401)
        if fault is None:
            assert 'Secure' in callback.headers['set-cookie']
            replay = client.get('/api/auth/oidc/callback', params=params, follow_redirects=False)
            assert 'auth_error' in replay.headers['location']
            assert client.post('/api/auth/logout').status_code == 403
            assert client.post('/api/auth/logout', headers={'Origin': origin}).status_code == 200
            assert not client.get('/api/auth/session').json()['authenticated']


def test_metadata_orientation_cache_and_file_changes(service, monkeypatch):
    import immich_wm.service as module
    calls = []
    monkeypatch.setattr(module, 'get_exif', lambda p, **kw: calls.append(p) or {})
    path = service.settings.imports/'photo.jpg'
    exif = Image.Exif()
    exif[274] = 6
    Image.new('RGB', (160, 80), 'blue').save(path, exif=exif)
    first = service.metadata(service.client.asset_id)
    assert (first['width'], first['height']) == (80, 160)
    service.metadata(service.client.asset_id)
    assert len(calls) == 1
    Image.new('RGB', (90, 120), 'green').save(path)
    assert service.metadata(service.client.asset_id)['width'] == 90
    assert len(calls) == 2


def test_maintenance_reports_output_conflict_without_deleting(service):
    import time
    save_job(service)
    service.render_next()
    output = service.settings.output/'photo.jpg'
    output.write_bytes(b'foreign-data')
    service.maintenance.tick(time.time()+1000)
    assert service.maintenance.status()['issues'][0]['issue'] == 'output_changed'
    assert output.read_bytes() == b'foreign-data'


def test_gc_preserves_referenced_resources_and_active_jobs(service):
    import os
    import time
    resource = service.resources/(uuid4().hex+'.png')
    unused = service.resources/(uuid4().hex+'.png')
    Image.new('RGBA', (20, 10)).save(resource)
    Image.new('RGBA', (20, 10)).save(unused)
    config = deepcopy(CONFIG)
    config['regions'] = [{'id':'signature','type':'free','enabled':True,
                          'slots':{'sig1':{'enabled':True,'content':{'path':resource.name}}}}]
    job = save_job(service, config)
    old = time.time()-90000
    for p in (resource, unused, service.tmp/job['id']):
        os.utime(p,(old,old))
    orphan = service.tmp/uuid4().hex
    orphan.mkdir()
    os.utime(orphan,(old,old))
    service.maintenance.gc()
    assert resource.exists() and not unused.exists()
    assert (service.tmp/job['id']).exists() and not orphan.exists()


def test_backup_restore_checksums_resources_and_safe_job_recovery(service, tmp_path):
    import sqlite3

    from immich_wm.maintenance import restore_backup
    resource = service.resources/(uuid4().hex+'.png')
    Image.new('RGBA',(24,12),'black').save(resource)
    config = deepcopy(CONFIG)
    config['regions'] = [{'id':'signature','type':'free','enabled':True,
                          'slots':{'sig1':{'enabled':True,'content':{'path':resource.name}}}}]
    save_job(service, config)
    result = service.maintenance.backup()
    backup = service.settings.data/'backups'/result['backupId']
    restored = tmp_path/'restored'
    restore_backup(backup, restored)
    with sqlite3.connect(restored/'immich-wm.db') as db:
        assert db.execute('SELECT COUNT(*) FROM configs').fetchone()[0] == 1
        assert db.execute('SELECT state,error FROM jobs').fetchone() == ('failed','restored_requires_review')
    assert (restored/'resources'/resource.name).read_bytes() == resource.read_bytes()
    from dataclasses import replace
    restored_output = tmp_path/'restored-output'
    restored_output.mkdir()
    restored_service = Service(replace(service.settings, data=restored, output=restored_output), service.client)
    try:
        new_job = restored_service.enqueue(service.client.asset_id, 1)
        restored_service.render_next()
        assert restored_service.store.job(new_job['id'])['state'] == 'awaiting_import'
        assert (restored_output/'photo.jpg').exists()
    finally:
        restored_service.store.close()
    with pytest.raises(ValueError, match='must_not_exist'):
        restore_backup(backup, restored)
    with (backup/'immich-wm.db').open('ab') as f:
        f.write(b'corrupt')
    with pytest.raises(ValueError, match='checksum'):
        restore_backup(backup, tmp_path/'corrupt-restore')
    assert not (tmp_path/'corrupt-restore').exists()


def test_low_space_blocks_enqueue_without_temporary_files(service, monkeypatch):
    from collections import namedtuple

    from immich_wm import maintenance
    service.save(service.client.asset_id, CONFIG, 0)
    monkeypatch.setattr(maintenance.shutil, 'disk_usage', lambda p:namedtuple('Disk','total used free')(100,99,1))
    with pytest.raises(ValueError, match='insufficient_disk_space'):
        service.enqueue(service.client.asset_id,1)
    assert not list(service.tmp.iterdir())


def test_gallery_status_badges_and_album_filter(setup):
    settings, fake = setup
    with TestClient(create_app(settings, fake, background=False)) as client:
        client.post('/api/login', json={'token': settings.token})
        listed = client.get('/api/assets').json()
        assert listed['items'][0]['status'] == {'configured': False, 'job': None, 'published': False}
        albums = client.get('/api/albums').json()
        assert albums['available'] is True and albums['albums'][0]['name'] == '旅行'
        endpoint = f'/api/assets/{fake.asset_id}'
        client.put(endpoint + '/config', json={'expectedRevision': 0, 'config': CONFIG})
        client.post(endpoint + '/render', json={'revision': 1})
        client.app.state.service.render_next()
        status = client.get('/api/assets').json()['items'][0]['status']
        assert status == {'configured': True, 'job': 'awaiting_import', 'published': True}
        selected = str(uuid4())
        filtered = client.get('/api/assets', params={'album': selected}).json()
        assert filtered['items'][0]['status']['job'] == 'awaiting_import'
        assert fake.album_filters == [[selected]]
        assert client.get('/api/assets', params={'album': 'not-a-uuid'}).status_code == 422


def test_albums_endpoint_degrades_when_scope_missing(setup):
    from immich_wm.client import UpstreamError
    settings, fake = setup

    def forbidden():
        raise UpstreamError(403)
    fake.albums = forbidden
    with TestClient(create_app(settings, fake, background=False)) as client:
        client.post('/api/login', json={'token': settings.token})
        response = client.get('/api/albums')
        assert response.status_code == 200
        assert response.json() == {'albums': [], 'available': False}

    def offline():
        raise UpstreamError(503)
    fake.albums = offline
    with TestClient(create_app(settings, fake, background=False)) as client:
        client.post('/api/login', json={'token': settings.token})
        assert client.get('/api/albums').status_code == 502


def test_value_errors_expose_only_safe_codes(setup):
    settings, fake = setup
    with TestClient(create_app(settings, fake, background=False)) as client:
        client.post('/api/login', json={'token': settings.token})
        assert client.get('/api/assets/not-a-uuid/config').status_code == 422
        response = client.get(f"/api/assets/{fake.asset_id}/metadata")
        assert response.status_code == 200, response.text
        fake.asset = lambda _id: {'id': _id, 'libraryId': str(uuid4()), 'type': 'IMAGE', 'originalPath': '/external/other/x.jpg'}
        assert client.get(f'/api/assets/{uuid4()}/config').json() == {'error': 'not_source_asset'}


def test_settings_reject_limits_above_validation_caps(setup):
    from dataclasses import replace
    settings, _ = setup
    assert settings.max_bytes == 256 * 1024 * 1024
    assert settings.max_pixels == 400_000_000
    with pytest.raises(ValueError, match='invalid_limit'):
        replace(settings, max_pixels=600_000_000)
    with pytest.raises(ValueError, match='invalid_limit'):
        replace(settings, max_output_edge=65536)


def test_logo_catalog_and_protected_bytes(setup, monkeypatch, tmp_path):
    from kari_core.processor import renderer
    logo_root=tmp_path/'logos'
    logo_root.mkdir()
    Image.new('RGBA',(30,10),'red').save(logo_root/'canon.png')
    monkeypatch.setattr(renderer,'LOGOS_DIR',logo_root)
    settings,fake=setup
    with TestClient(create_app(settings,fake,background=False)) as client:
        assert client.get('/api/builtin-logos/canon').status_code==401
        client.post('/api/login',json={'token':settings.token})
        assert client.get('/api/logos').json()['logos']==[{'stem':'canon','variants':[]}]
        assert client.get('/api/builtin-logos/canon').status_code==200
        assert client.get('/api/builtin-logos/canon',params={'variant':'../escape'}).status_code==422
