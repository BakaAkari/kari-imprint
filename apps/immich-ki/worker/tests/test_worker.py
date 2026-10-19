from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from immich_ki.app import create_app
from immich_ki.paths import open_source, relative_path
from immich_ki.service import Conflict, Service
from immich_ki.settings import Settings
from PIL import Image

CONFIG = {"schema_version": 3, "canvas": {"margins": {"bottom": 20}}, "regions": []}


class FakeImmich:
    def __init__(self, settings):
        self.settings = settings
        self.asset_id = str(uuid4())
        self.output_id = str(uuid4())
        self.source_album_id = str(uuid4())
        self.result_album_id = str(uuid4())
        self.imported = False
        self.refreshed = []
        self.album_filters = []
        self.created = []
        self.attached = []
        self.thumbnail_asset_id = None
        self.owner_email = "akari@example.com"
        # Durable membership modelled on the real `GET /albums?assetId=` contract.
        self.members = {self.asset_id: {self.source_album_id}}

    def me(self):
        # The owner of the service API key (x-api-key), never the login identity.
        return {"email": self.owner_email}

    def asset(self, asset_id):
        from immich_ki.client import UpstreamError

        if str(asset_id) == self.asset_id:
            return {
                "id": asset_id,
                "libraryId": self.settings.source_library,
                "type": "IMAGE",
                "originalPath": "/external/camera-exports/photo.jpg",
            }
        if str(asset_id) == self.output_id:
            if not self.imported:
                raise UpstreamError(404)
            return {
                "id": asset_id,
                "libraryId": self.settings.output_library,
                "type": "IMAGE",
                "originalPath": "/external/camera-watermarked/Imprint/photo.jpg",
                "exifInfo": {"make": "FUJIFILM"} if self.refreshed else None,
            }
        raise UpstreamError(404)

    def album_membership(self, asset_id):
        return set(self.members.get(str(asset_id), set()))

    def search(self, library, page=1, path=None, albums=None):
        if albums:
            for album in albums:
                # Mirror the real client's wire contract: album ids must arrive
                # as strings, never as UUID objects.
                if not isinstance(album, str):
                    raise TypeError("album ids must be strings")
            self.album_filters.append(list(albums))
        if path is None:
            return {
                "items": [
                    {
                        "id": self.asset_id,
                        "libraryId": library,
                        "type": "IMAGE",
                        "originalPath": "/external/camera-exports/photo.jpg",
                        "originalFileName": "photo.jpg",
                    }
                ],
                "nextPage": None,
            }
        items = [{"id": self.output_id, "libraryId": library, "originalPath": path}] if self.imported else []
        return {"items": items, "nextPage": None}

    def albums(self):
        return [
            {"id": self.source_album_id, "name": "旅行", "assetCount": 3},
            {"id": self.result_album_id, "name": "旅行 Imprint", "assetCount": 1},
        ]

    def album(self, album_id):
        # Mirror the real client contract: /api/albums/:id returns albumName and
        # aggregate counts, but NOT an `assets` array (membership is only
        # available through `GET /albums?assetId=`).
        if str(album_id) == self.source_album_id:
            return {
                "id": self.source_album_id,
                "albumName": "旅行",
                "assetCount": 3,
                "albumThumbnailAssetId": self.thumbnail_asset_id,
            }
        if str(album_id) == self.result_album_id:
            return {
                "id": self.result_album_id,
                "albumName": "旅行 Imprint",
                "assetCount": 1,
                "albumThumbnailAssetId": self.thumbnail_asset_id,
            }
        raise ValueError("album_not_found")

    def create_album(self, name):
        self.created.append(name)
        self.result_album_id = str(uuid4())
        return self.result_album_id

    def add_to_album(self, album_id, asset_id):
        self.attached.append((str(album_id), str(asset_id)))
        self.members.setdefault(str(asset_id), set()).add(str(album_id))

    def refresh(self, asset_id):
        self.refreshed.append(asset_id)

    def close(self):
        pass


OPERATOR = {"email": "akari@example.com", "password": "panel-password"}


def attach_login_transport(app):
    """Give an app a fake Immich auth backend accepting only OPERATOR credentials."""
    import json as jsonlib

    import httpx

    def handler(request):
        if request.url.path == "/api/auth/login":
            body = jsonlib.loads(request.content)
            if body.get("email") == OPERATOR["email"] and body.get("password") == OPERATOR["password"]:
                return httpx.Response(200, json={"accessToken": "op-token"})
            return httpx.Response(401)
        if request.url.path == "/api/users/me" and request.headers.get("authorization") == "Bearer op-token":
            return httpx.Response(200, json={"email": OPERATOR["email"]})
        return httpx.Response(404)

    app.state.immich_key_transport = httpx.MockTransport(handler)
    return app


@pytest.fixture
def setup(tmp_path):
    imports, output = tmp_path / "imports", tmp_path / "output"
    imports.mkdir()
    output.mkdir()
    Image.new("RGB", (120, 80), "red").save(imports / "photo.jpg")
    settings = Settings(
        "http://localhost:2283", "secret", str(uuid4()), str(uuid4()), imports, output, tmp_path / "data"
    )
    return settings, FakeImmich(settings)


@pytest.fixture
def service(setup):
    settings, client = setup
    value = Service(settings, client)
    yield value
    value.store.close()


def save_job(service, config=CONFIG):
    asset = service.client.asset_id
    revision = service.config(asset)["revision"]
    result = service.save(asset, deepcopy(config), revision)
    return service.enqueue(asset, result["revision"])


def test_a_b_a_source_and_renderer_changes(service):
    hashes = []
    for margin in (20, 40, 20):
        config = deepcopy(CONFIG)
        config["canvas"]["margins"]["bottom"] = margin
        job = save_job(service, config)
        service.render_next()
        row = service.store.job(job["id"])
        assert row["state"] == "awaiting_import", row
        hashes.append(row["output_hash"])
    assert hashes[0] == hashes[2] != hashes[1]
    with Image.open(service.settings.output / service.settings.imprint_dir / "photo.jpg") as image:
        assert image.size == (120, 100)
        assert image.getexif()[274] == 1
        assert image.info["icc_profile"]
    Image.new("RGB", (120, 80), "blue").save(service.settings.imports / "photo.jpg")
    new = service.enqueue(service.client.asset_id, 3)
    assert new["render_key"] != job["render_key"]
    service.render_next()
    assert service.store.job(new["id"])["state"] == "awaiting_import"


def test_conflict_and_superseded(service):
    job = save_job(service)
    with pytest.raises(Conflict):
        service.save(service.client.asset_id, deepcopy(CONFIG), 0)
    changed = deepcopy(CONFIG)
    changed["canvas"]["margins"]["bottom"] = 30
    service.save(service.client.asset_id, changed, 1)
    service.render_next()
    assert service.store.job(job["id"])["state"] == "superseded"
    assert not (service.settings.output / service.settings.imprint_dir / "photo.jpg").exists()


def test_repeated_identical_save_and_render_deduplicates(service):
    """Re-saving the identical config must not create a new revision, so the
    enqueue dedup (keyed on revision + render_key) holds across the full
    PUT config → POST render flow during the waiting state."""
    asset = service.client.asset_id
    first = service.save(asset, deepcopy(CONFIG), 0)
    assert first["revision"] == 1
    job1 = service.enqueue(asset, first["revision"])
    assert job1["state"] == "queued"
    # An identical save keeps revision 1 rather than bumping to 2.
    second = service.save(asset, deepcopy(CONFIG), 1)
    assert second["revision"] == 1
    job2 = service.enqueue(asset, second["revision"])
    assert job2["id"] == job1["id"]
    with service.store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 1
    with service.store.transaction() as db:
        assert db.execute("SELECT generation FROM assets WHERE id=?", (asset,)).fetchone()[0] == 1


def test_published_file_then_crash_recovers(service, monkeypatch):
    job = save_job(service)
    original = __import__("os").fsync

    def crash(fd):
        import stat

        if stat.S_ISDIR(__import__("os").fstat(fd).st_mode):
            raise OSError("simulated crash after replace")
        original(fd)

    monkeypatch.setattr("os.fsync", crash)
    service.render_next()
    assert service.store.job(job["id"])["state"] == "publishing"
    assert (service.settings.output / service.settings.imprint_dir / "photo.jpg").exists()
    monkeypatch.setattr("os.fsync", original)
    service.recover()
    assert service.store.job(job["id"])["state"] == "awaiting_import"


def test_foreign_output_never_overwritten(service):
    output = service.settings.output / service.settings.imprint_dir / "photo.jpg"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(b"foreign")
    job = save_job(service)
    service.render_next()
    assert service.store.job(job["id"])["error"] == "output_conflict"
    assert output.read_bytes() == b"foreign"


def _save_job_with_album(service, config=CONFIG):
    asset = service.client.asset_id
    revision = service.config(asset)["revision"]
    result = service.save(asset, deepcopy(config), revision)
    return service.enqueue(asset, result["revision"], service.client.source_album_id)


def test_sync_reaches_done_only_after_ingestion_and_membership(service):
    """Accepting the refresh request must never be reported as completion."""
    job = _save_job_with_album(service)
    service.render_next()
    # Output not yet visible in the output library → still awaiting_import.
    assert service.sync(job["id"])["state"] == "awaiting_import"
    service.client.imported = True
    # Imported → attach + refresh requested, but not yet confirmed complete.
    assert service.sync(job["id"])["state"] == "refresh_pending"
    # Completion requires the output asset to be discoverable AND present in
    # the paired result album.  The fake models both after import + attach.
    assert service.sync(job["id"])["state"] == "done"
    # Re-running sync on a done job is an idempotent no-op, never re-attaching
    # or re-requesting refresh (no duplicate output).
    assert service.sync(job["id"])["state"] == "done"
    assert service.client.attached == [(service.client.result_album_id, service.client.output_id)]
    assert service.client.refreshed == [service.client.output_id]


def test_sync_done_requires_result_album_membership(service):
    """A discoverable output that is not in the result album is not 'saved'."""
    job = _save_job_with_album(service)
    service.render_next()
    service.client.imported = True
    assert service.sync(job["id"])["state"] == "refresh_pending"
    # Remove the output from the result album: completion must be withheld.
    service.client.members.pop(str(service.client.output_id), None)
    assert service.sync(job["id"])["state"] == "refresh_pending"
    # Restore membership → completion proceeds.
    service.client.add_to_album(service.client.result_album_id, service.client.output_id)
    assert service.sync(job["id"])["state"] == "done"


def test_path_escape_and_symlink(service, tmp_path):
    for path in ["/external/camera-exports-evil/a.jpg", "/external/camera-exports/../a.jpg"]:
        with pytest.raises(ValueError):
            relative_path(path, "/external/camera-exports")
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"secret")
    link = service.settings.imports / "link.jpg"
    link.symlink_to(outside)
    with pytest.raises(OSError):
        with open_source(service.settings.imports, "link.jpg"):
            pytest.fail("symlink accepted")


def test_auth_origin_strict_payload_and_no_paths(setup):
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        endpoint = f"/api/assets/{fake.asset_id}/config"
        assert client.get(endpoint).status_code == 401
        assert (
            client.post("/api/auth/immich-login", json=OPERATOR, headers={"origin": "http://evil.test"}).status_code
            == 403
        )
        assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 200
        assert client.put(endpoint, json={"expectedRevision": "0", "config": CONFIG}).status_code == 422
        response = client.put(endpoint, json={"expectedRevision": 0, "config": CONFIG})
        assert response.status_code == 200, response.text
        assert "/external/" not in response.text
        assert client.post(f"/api/assets/{fake.asset_id}/render", json={"revision": 1}).status_code == 202


def test_resource_survives_restart_and_database_backup(setup, tmp_path):
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        from io import BytesIO

        data = BytesIO()
        Image.new("RGBA", (40, 10), "black").save(data, format="PNG")
        response = client.post("/api/resources", files={"file": ("logo.png", data.getvalue(), "image/png")})
        assert response.status_code == 200, response.text
        resource_id = response.json()["resourceId"]
    service = Service(settings, fake)
    try:
        assert (service.resources / resource_id).is_file()
        backup = tmp_path / "backup.db"
        service.store.backup(backup)
        assert backup.stat().st_size > 0
    finally:
        service.store.close()


def test_source_change_before_publish_does_not_replace(service):
    job = save_job(service)
    Image.new("RGB", (120, 80), "blue").save(service.settings.imports / "photo.jpg")
    service.render_next()
    assert service.store.job(job["id"])["error"] == "source_changed"
    assert not (service.settings.output / service.settings.imprint_dir / "photo.jpg").exists()


def test_renderer_upgrade_changes_key_and_does_not_reuse_completed_job(service):
    from dataclasses import replace

    job = save_job(service)
    service.render_next()
    service.settings = replace(service.settings, renderer_version="m0-photo-srgb-v2")
    newer = service.enqueue(service.client.asset_id, 1)
    assert newer["id"] != job["id"] and newer["render_key"] != job["render_key"]
    service.render_next()
    assert service.store.job(newer["id"])["state"] == "awaiting_import"


def test_client_uses_actual_v3_preview_contract():
    import httpx
    from immich_ki.client import ImmichClient

    calls = []

    def handle(request):
        calls.append(request)
        return httpx.Response(200, content=b"jpeg", headers={"Content-Type": "image/jpeg"})

    client = ImmichClient("http://immich:2283", "private", transport=httpx.MockTransport(handle))
    try:
        asset_id = str(uuid4())
        data, mime = client.preview(asset_id)
        assert data == b"jpeg" and mime == "image/jpeg"
        assert calls[0].url.path == f"/api/assets/{asset_id}/thumbnail"
        assert calls[0].url.params["size"] == "preview"
        assert calls[0].headers["x-api-key"] == "private"
        client.preview(asset_id, thumbnail=True)
        assert calls[-1].url.params["size"] == "thumbnail"
        with pytest.raises(ValueError, match="preview_too_large"):
            client.preview(asset_id, maximum=1)
    finally:
        client.close()


def test_client_search_sends_album_ids_as_strings():
    """Real callers pass validated UUIDs; the wire body must carry strings."""
    import json as jsonlib
    from uuid import UUID

    import httpx
    from immich_ki.client import ImmichClient

    bodies = []

    def handle(request):
        bodies.append(jsonlib.loads(request.content))
        return httpx.Response(200, json={"assets": {"items": [], "nextPage": None}})

    client = ImmichClient("http://immich:2283", "private", transport=httpx.MockTransport(handle))
    try:
        album = uuid4()
        assert client.search(str(uuid4()), 1, albums=[album]) == {"items": [], "nextPage": None}
        assert bodies[0]["albumIds"] == [str(album)]
        client.search(str(uuid4()), 1, albums=[str(album)])
        assert bodies[1]["albumIds"] == [str(album)]
        assert UUID(bodies[1]["albumIds"][0]) == album
    finally:
        client.close()


def test_sync_requires_output_asset_identity_match(service):
    """A discoverable output that resolves to a different library/path is never 'saved'."""
    job = _save_job_with_album(service)
    service.render_next()
    service.client.imported = True
    assert service.sync(job["id"])["state"] == "refresh_pending"
    original_asset = service.client.asset

    def wrong_asset(asset_id):
        result = original_asset(asset_id)
        if str(asset_id) == service.client.output_id:
            result = {**result, "libraryId": str(uuid4()), "originalPath": "/external/other.jpg"}
        return result

    service.client.asset = wrong_asset
    assert service.sync(job["id"])["state"] == "refresh_pending"
    service.client.asset = original_asset
    assert service.sync(job["id"])["state"] == "done"


def test_sync_done_reechecks_currency_after_confirmation(service):
    """A save landing during the completion check supersedes the job, never 'done'."""
    job = _save_job_with_album(service)
    service.render_next()
    service.client.imported = True
    assert service.sync(job["id"])["state"] == "refresh_pending"
    original = service._refresh_complete

    def racing_complete(job_id, output_id):
        # A concurrent save commits while the network confirmation is in flight.
        changed = deepcopy(CONFIG)
        changed["canvas"]["margins"]["bottom"] = 50
        service.save(service.client.asset_id, changed, 1)
        return original(job_id, output_id)

    service._refresh_complete = racing_complete
    assert service.sync(job["id"])["state"] == "superseded"


def test_reconcile_retries_survive_restart_and_refresh_once(setup):
    from immich_ki.client import UpstreamError

    settings, fake = setup
    service = Service(settings, fake)
    job = save_job(service)
    service.render_next()
    assert service.reconcile_next(now=100) == job["id"]
    assert service.store.job(job["id"])["state"] == "awaiting_import"
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
        row = service.store.db.execute("SELECT * FROM sync_schedule WHERE job_id=?", (job["id"],)).fetchone()
        assert row["attempts"] == 2 and row["error"] == "sync_retry_pending"
        fake.refresh = original
        assert service.reconcile_next(now=114) is None
        service.reconcile_next(now=115)
        assert service.store.job(job["id"])["state"] == "refresh_pending"
        assert fake.refreshed == [fake.output_id]
        # refresh_pending now participates in reconciliation; once ingestion and
        # result-album membership are confirmed the job completes without any
        # further refresh request.
        assert service.reconcile_next(now=10000) == job["id"]
        assert service.store.job(job["id"])["state"] == "done"
        assert fake.refreshed == [fake.output_id]
    finally:
        service.store.close()


def test_reconcile_does_not_refresh_stale_revision(service):
    job = save_job(service)
    service.render_next()
    changed = deepcopy(CONFIG)
    changed["canvas"]["margins"]["bottom"] = 40
    service.save(service.client.asset_id, changed, 1)
    service.client.imported = True
    service.reconcile_next(now=100)
    assert service.store.job(job["id"])["state"] == "superseded"
    assert not service.client.refreshed


def test_reconcile_gives_up_after_bounded_attempts(setup):
    from immich_ki.service import MAX_SYNC_ATTEMPTS

    settings, fake = setup
    service = Service(settings, fake)
    job = save_job(service)
    service.render_next()
    service.reconcile_next(now=100)
    assert service.store.job(job["id"])["state"] == "awaiting_import"
    with service.store.transaction() as db:
        db.execute(
            "UPDATE sync_schedule SET attempts=?, next_at=0 WHERE job_id=?",
            (MAX_SYNC_ATTEMPTS, job["id"]),
        )
    # A job whose output never becomes confirmable must stop retrying rather
    # than polling Immich forever behind a permanent "waiting" label.
    assert service.reconcile_next(now=200) == job["id"]
    final = service.store.job(job["id"])
    assert final["state"] == "failed" and final["error"] == "sync_unconfirmed"
    assert service.store.db.execute("SELECT * FROM sync_schedule WHERE job_id=?", (job["id"],)).fetchone() is None
    assert service.reconcile_next(now=10000) is None


def test_output_preview_rejects_old_generation_and_foreign_bytes(service):
    from io import BytesIO

    job = save_job(service)
    service.render_next()
    with Image.open(BytesIO(service.output_preview(service.client.asset_id, job["generation"]))) as preview:
        assert preview.size == (120, 100)
        assert not preview.getexif()
    next_job = service.enqueue(service.client.asset_id, 1)
    with pytest.raises(Conflict, match="output_not_current"):
        service.output_preview(service.client.asset_id, job["generation"])
    service.render_next()
    (service.settings.output / service.settings.imprint_dir / "photo.jpg").write_bytes(b"foreign")
    with pytest.raises(Conflict, match="output_conflict"):
        service.output_preview(service.client.asset_id, next_job["generation"])


def test_editor_upload_and_latest_job_contract(setup):
    from io import BytesIO

    settings, fake = setup
    app = attach_login_transport(create_app(settings, fake, background=False))
    with TestClient(app) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        endpoint = f"/api/assets/{fake.asset_id}"
        assert client.get(endpoint + "/job").json() == {"job": None}
        image = BytesIO()
        Image.new("RGBA", (60, 20), "black").save(image, format="PNG")
        files = {"file": ("signature.png", image.getvalue(), "image/png")}
        response = client.post("/api/upload-resource", data={"kind": "signature"}, files=files)
        assert response.status_code == 200
        assert response.json()["ok"] and response.json()["kind"] == "signature"
        resource = response.json()["resource_id"]
        assert client.get("/api/resources/signature/" + resource).status_code == 200
        assert client.post("/api/upload-resource", data={"kind": "unknown"}, files=files).status_code == 422
        client.put(endpoint + "/config", json={"expectedRevision": 0, "config": CONFIG})
        job = client.post(endpoint + "/render", json={"revision": 1}).json()
        app.state.service.render_next()
        assert client.get(endpoint + "/job").json()["job"]["id"] == job["id"]
        preview = client.get(endpoint + "/output", params={"generation": job["generation"]})
        assert preview.status_code == 200 and preview.headers["cache-control"] == "no-store"
        assert client.get(endpoint + "/output?generation=0").status_code == 422
        # The download variant must return the published file byte for byte; a
        # download that silently returns the downscaled preview would mislead.
        full = client.get(endpoint + "/output", params={"generation": job["generation"], "variant": "full"})
        assert full.status_code == 200
        assert full.headers["content-disposition"].startswith("attachment;")
        published = (settings.output / settings.imprint_dir / "photo.jpg").read_bytes()
        assert full.content == published
        assert full.headers["content-type"] in {"image/jpeg", "image/png"}
        assert (
            client.get(endpoint + "/output", params={"generation": job["generation"], "variant": "tile"}).status_code
            == 422
        )


def test_public_static_cache_and_compression_keep_api_private(setup, tmp_path, monkeypatch):
    web = tmp_path / "web"
    (web / "assets").mkdir(parents=True)
    (web / "index.html").write_text("<html>panel</html>")
    (web / "assets" / "index-test.js").write_text("const example = 1;\n" * 1000)
    monkeypatch.setenv("KI_WEB_ROOT", str(web))
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        result = client.get("/assets/index-test.js", headers={"Accept-Encoding": "gzip"})
        assert result.headers["content-encoding"] == "gzip"
        assert result.headers["cache-control"] == "public, max-age=31536000, immutable"
        assert len(result.content) > int(result.headers["content-length"]) * 5
        assert "Accept-Encoding" in result.headers["vary"]
        assert client.get("/").headers["cache-control"] == "no-cache"
        assert client.get("/api/health").headers["cache-control"] == "no-store"
        assert client.post("/api/auth/immich-login", json=OPERATOR).headers["cache-control"] == "no-store"
        assert client.get("/api/assets").headers["cache-control"] == "no-store"
        assert client.get("/assets/missing.js").headers["cache-control"] == "no-cache"


def test_public_origin_behind_http_proxy(setup):
    from dataclasses import replace

    settings, fake = setup
    origin = "https://immt.baka-akari.icu:18443"
    settings = replace(settings, public_origin=origin)
    with TestClient(
        attach_login_transport(create_app(settings, fake, background=False)), base_url="http://internal:2285"
    ) as client:
        response = client.post("/api/auth/immich-login", json=OPERATOR, headers={"Origin": origin})
        assert response.status_code == 200
        assert "Secure" in response.headers["set-cookie"]
        for bad in ["https://evil.example", origin + ".evil.example", "null", "http://internal:2285"]:
            response = client.post(
                "/api/auth/immich-login",
                json=OPERATOR,
                headers={
                    "Origin": bad,
                    "X-Forwarded-Proto": "https",
                    "X-Forwarded-Host": bad,
                },
            )
            assert response.status_code == 403
            assert response.json()["error"] == "invalid_origin"


@pytest.mark.parametrize(
    "origin",
    [
        "*",
        "https://example.com/",
        "https://user:pass@example.com",
        "https://example.com/path",
        "https://example.com?x=1",
        "https://example.com:99999",
        "https://example.com\n",
    ],
)
def test_invalid_public_origin_configuration(setup, origin):
    from dataclasses import replace

    with pytest.raises(ValueError):
        replace(setup[0], public_origin=origin)


def test_metadata_orientation_cache_and_file_changes(service, monkeypatch):
    import immich_ki.service as module

    calls = []
    monkeypatch.setattr(module, "get_exif", lambda p, **kw: calls.append(p) or {})
    path = service.settings.imports / "photo.jpg"
    exif = Image.Exif()
    exif[274] = 6
    Image.new("RGB", (160, 80), "blue").save(path, exif=exif)
    first = service.metadata(service.client.asset_id)
    assert (first["width"], first["height"]) == (80, 160)
    service.metadata(service.client.asset_id)
    assert len(calls) == 1
    Image.new("RGB", (90, 120), "green").save(path)
    assert service.metadata(service.client.asset_id)["width"] == 90
    assert len(calls) == 2


def test_maintenance_reports_output_conflict_without_deleting(service):
    import time

    save_job(service)
    service.render_next()
    output = service.settings.output / service.settings.imprint_dir / "photo.jpg"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(b"foreign-data")
    service.maintenance.tick(time.time() + 1000)
    assert service.maintenance.status()["issues"][0]["issue"] == "output_changed"
    assert output.read_bytes() == b"foreign-data"


def test_gc_preserves_referenced_resources_and_active_jobs(service):
    import os
    import time

    resource = service.resources / (uuid4().hex + ".png")
    unused = service.resources / (uuid4().hex + ".png")
    Image.new("RGBA", (20, 10)).save(resource)
    Image.new("RGBA", (20, 10)).save(unused)
    config = deepcopy(CONFIG)
    config["regions"] = [
        {
            "id": "signature",
            "type": "free",
            "enabled": True,
            "slots": {"sig1": {"enabled": True, "content": {"path": resource.name}}},
        }
    ]
    job = save_job(service, config)
    old = time.time() - 90000
    for p in (resource, unused, service.tmp / job["id"]):
        os.utime(p, (old, old))
    orphan = service.tmp / uuid4().hex
    orphan.mkdir()
    os.utime(orphan, (old, old))
    service.maintenance.gc()
    assert resource.exists() and not unused.exists()
    assert (service.tmp / job["id"]).exists() and not orphan.exists()


def test_backup_restore_checksums_resources_and_safe_job_recovery(service, tmp_path):
    import sqlite3

    from immich_ki.maintenance import restore_backup

    resource = service.resources / (uuid4().hex + ".png")
    Image.new("RGBA", (24, 12), "black").save(resource)
    config = deepcopy(CONFIG)
    config["regions"] = [
        {
            "id": "signature",
            "type": "free",
            "enabled": True,
            "slots": {"sig1": {"enabled": True, "content": {"path": resource.name}}},
        }
    ]
    save_job(service, config)
    result = service.maintenance.backup()
    backup = service.settings.data / "backups" / result["backupId"]
    restored = tmp_path / "restored"
    restore_backup(backup, restored)
    with sqlite3.connect(restored / "immich-ki.db") as db:
        assert db.execute("SELECT COUNT(*) FROM configs").fetchone()[0] == 1
        assert db.execute("SELECT state,error FROM jobs").fetchone() == ("failed", "restored_requires_review")
    assert (restored / "resources" / resource.name).read_bytes() == resource.read_bytes()
    from dataclasses import replace

    restored_output = tmp_path / "restored-output"
    restored_output.mkdir()
    restored_service = Service(replace(service.settings, data=restored, output=restored_output), service.client)
    try:
        new_job = restored_service.enqueue(service.client.asset_id, 1)
        restored_service.render_next()
        assert restored_service.store.job(new_job["id"])["state"] == "awaiting_import"
        assert (restored_output / restored_service.settings.imprint_dir / "photo.jpg").exists()
    finally:
        restored_service.store.close()
    with pytest.raises(ValueError, match="must_not_exist"):
        restore_backup(backup, restored)
    with (backup / "immich-ki.db").open("ab") as f:
        f.write(b"corrupt")
    with pytest.raises(ValueError, match="checksum"):
        restore_backup(backup, tmp_path / "corrupt-restore")
    assert not (tmp_path / "corrupt-restore").exists()


def test_low_space_blocks_enqueue_without_temporary_files(service, monkeypatch):
    from collections import namedtuple

    from immich_ki import maintenance

    service.save(service.client.asset_id, CONFIG, 0)
    monkeypatch.setattr(maintenance.shutil, "disk_usage", lambda p: namedtuple("Disk", "total used free")(100, 99, 1))
    with pytest.raises(ValueError, match="insufficient_disk_space"):
        service.enqueue(service.client.asset_id, 1)
    assert not list(service.tmp.iterdir())


def test_gallery_status_badges_and_album_filter(setup):
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        listed = client.get("/api/assets").json()
        assert listed["items"][0]["status"] == {"configured": False, "job": None, "published": False}
        albums = client.get("/api/albums").json()
        assert albums["available"] is True and albums["albums"][0]["name"] == "旅行"
        endpoint = f"/api/assets/{fake.asset_id}"
        client.put(endpoint + "/config", json={"expectedRevision": 0, "config": CONFIG})
        client.post(endpoint + "/render", json={"revision": 1})
        client.app.state.service.render_next()
        status = client.get("/api/assets").json()["items"][0]["status"]
        assert status == {"configured": True, "job": "awaiting_import", "published": True}
        selected = fake.source_album_id
        filtered = client.get("/api/assets", params={"album": selected}).json()
        assert filtered["items"][0]["status"]["job"] == "awaiting_import"
        assert fake.album_filters == [[selected]]
        assert client.get("/api/assets", params={"album": "not-a-uuid"}).status_code == 422


def test_imprint_album_is_never_a_source(setup):
    """A result album may hold watermarked photos; editing it would double-stamp."""
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        albums = client.get("/api/albums").json()["albums"]
        result = next(a for a in albums if a["name"] == "旅行 Imprint")
        assert result["isResult"] is True
        assert next(a for a in albums if a["name"] == "旅行")["isResult"] is False
        response = client.get("/api/assets", params={"album": result["id"]})
        assert response.status_code == 422 and response.json()["error"] == "result_album_read_only"
        enqueue = client.post(
            f"/api/assets/{fake.asset_id}/render", json={"revision": 1, "sourceAlbumId": result["id"]}
        )
        assert enqueue.status_code == 422 and enqueue.json()["error"] == "result_album_read_only"
        assert fake.album_filters == [] and fake.attached == []


def test_render_pairs_source_album_with_one_imprint_album(setup):
    """Same-name pairing creates the suffix album once and reuses it, never stacking."""
    settings, fake = setup
    fake.result_album_id = ""  # The paired result album does not exist yet.
    fake.albums = lambda: [{"id": fake.source_album_id, "name": "旅行", "assetCount": 3}]
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        service = client.app.state.service
        endpoint = f"/api/assets/{fake.asset_id}"
        # A distinct second revision (not an identical re-save, which is idempotent)
        # so the pairing path is exercised twice while the result album is reused.
        revisions = [(1, CONFIG), (2, {**deepcopy(CONFIG), "canvas": {"margins": {"bottom": 40}}})]
        for revision, config in revisions:
            client.put(endpoint + "/config", json={"expectedRevision": revision - 1, "config": config})
            created = client.post(
                endpoint + "/render", json={"revision": revision, "sourceAlbumId": fake.source_album_id}
            ).json()
            fake.imported = True  # The published file is now visible in the output library.
            service.render_next()
            synced = client.post(f"/api/jobs/{created['id']}/sync").json()
            assert synced["state"] == "refresh_pending"
        assert fake.created == ["旅行 Imprint"]
        assert fake.attached == [(fake.result_album_id, fake.output_id)] * 2


def test_render_rejects_album_that_does_not_contain_the_asset(setup):
    """Pairing must not widen scope: the photo has to belong to the chosen album."""
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        # The photo is a member of source_album_id only; a different (existing)
        # album is rejected via the real `GET /albums?assetId=` membership query.
        other = str(uuid4())
        fake.album = lambda album_id: {"id": album_id, "albumName": "旅行", "assetCount": 0}
        client.put(f"/api/assets/{fake.asset_id}/config", json={"expectedRevision": 0, "config": CONFIG})
        response = client.post(f"/api/assets/{fake.asset_id}/render", json={"revision": 1, "sourceAlbumId": other})
        assert response.status_code == 422 and response.json()["error"] == "asset_not_in_album"
        assert fake.attached == []


def test_ambiguous_album_pair_is_refused(setup):
    """Two same-name result albums must be reported, never guessed."""
    settings, fake = setup
    fake.albums = lambda: [
        {"id": str(uuid4()), "name": "旅行 Imprint", "assetCount": 0},
        {"id": str(uuid4()), "name": "旅行 Imprint", "assetCount": 0},
        {"id": fake.source_album_id, "name": "旅行", "assetCount": 3},
    ]
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        client.put(f"/api/assets/{fake.asset_id}/config", json={"expectedRevision": 0, "config": CONFIG})
        created = client.post(
            f"/api/assets/{fake.asset_id}/render", json={"revision": 1, "sourceAlbumId": fake.source_album_id}
        ).json()
        fake.imported = True
        client.app.state.service.render_next()
        synced = client.post(f"/api/jobs/{created['id']}/sync")
        assert synced.status_code == 422 and synced.json()["error"] == "ambiguous_album_pair"
        assert fake.created == [] and fake.attached == []


def test_albums_endpoint_degrades_when_scope_missing(setup):
    from immich_ki.client import UpstreamError

    settings, fake = setup

    def forbidden():
        raise UpstreamError(403)

    fake.albums = forbidden
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        response = client.get("/api/albums")
        assert response.status_code == 200
        assert response.json() == {"albums": [], "available": False}

    def offline():
        raise UpstreamError(503)

    fake.albums = offline
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        assert client.get("/api/albums").status_code == 502


def test_value_errors_expose_only_safe_codes(setup):
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        assert client.get("/api/assets/not-a-uuid/config").status_code == 422
        response = client.get(f"/api/assets/{fake.asset_id}/metadata")
        assert response.status_code == 200, response.text
        fake.asset = lambda _id: {
            "id": _id,
            "libraryId": str(uuid4()),
            "type": "IMAGE",
            "originalPath": "/external/other/x.jpg",
        }
        assert client.get(f"/api/assets/{uuid4()}/config").json() == {"error": "not_source_asset"}


def test_output_relative_imprint_prefix_and_validation():
    from immich_ki.paths import output_relative

    assert output_relative("2026/02/DSCF8543.jpg", "Imprint") == "Imprint/2026/02/DSCF8543.jpg"
    # Archive mode: an empty imprint means the output root already is the
    # imprint directory, so the relative path passes through unchanged.
    assert output_relative("2026/02/DSCF8543.jpg", "") == "2026/02/DSCF8543.jpg"
    for bad in (".", "..", ".hidden", "a/b", "/abs", "x" * 65, ".ki-tmp"):
        with pytest.raises(ValueError, match="invalid_imprint_dir"):
            output_relative("a.jpg", bad)
    with pytest.raises(ValueError, match="unsafe_path"):
        output_relative("../a.jpg", "Imprint")


def test_settings_reject_bad_imprint_dir(setup):
    from dataclasses import replace

    settings, _ = setup
    assert settings.imprint_dir == "Imprint"
    for bad in ("a/b", "..", ".hidden", ".ki-tmp", "x" * 65):
        with pytest.raises(ValueError, match="invalid_imprint_dir"):
            replace(settings, imprint_dir=bad)


def test_settings_reject_limits_above_validation_caps(setup):
    from dataclasses import replace

    settings, _ = setup
    assert settings.max_bytes == 256 * 1024 * 1024
    assert settings.max_pixels == 400_000_000
    with pytest.raises(ValueError, match="invalid_limit"):
        replace(settings, max_pixels=600_000_000)
    with pytest.raises(ValueError, match="invalid_limit"):
        replace(settings, max_output_edge=65536)


def test_logo_catalog_and_protected_bytes(setup, monkeypatch, tmp_path):
    from kari_core.processor import renderer

    logo_root = tmp_path / "logos"
    logo_root.mkdir()
    Image.new("RGBA", (30, 10), "red").save(logo_root / "canon.png")
    monkeypatch.setattr(renderer, "LOGOS_DIR", logo_root)
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        assert client.get("/api/builtin-logos/canon").status_code == 401
        client.post("/api/auth/immich-login", json=OPERATOR)
        assert client.get("/api/logos").json()["logos"] == [{"stem": "canon", "variants": []}]
        assert client.get("/api/builtin-logos/canon").status_code == 200
        assert client.get("/api/builtin-logos/canon", params={"variant": "../escape"}).status_code == 422


def test_env_key_migrates_into_config_file(setup):
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        session = client.get("/api/auth/session").json()
    assert session["initialized"] is True and session["mode"] == "immich_key"
    config = settings.data / "config.json"
    assert config.is_file()
    assert config.stat().st_mode & 0o777 == 0o600
    import json

    # The env key migrates into the config file AND its owner is bound to the
    # verified owner of the service key (users/me), never to a first login.
    assert json.loads(config.read_text()) == {"apiKey": "secret", "ownerEmail": "akari@example.com"}


def test_immich_key_login_success_and_single_operator_revocation(setup):
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        assert client.get("/api/auth/session").json()["authenticated"] is False
        assert client.get("/api/assets").status_code == 401
        response = client.post("/api/auth/immich-login", json=OPERATOR)
        assert response.status_code == 200
        assert client.get("/api/auth/session").json()["authenticated"] is True
        assert client.get("/api/assets").status_code == 200
        previous = client.cookies.get("ki_session")
        assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 200
        assert client.cookies.get("ki_session") != previous
        client.cookies.set("ki_session", previous)
        assert client.get("/api/assets").status_code == 401


def test_immich_login_rejects_wrong_password_malformed_and_rate_limits(setup):
    settings, fake = setup
    app = attach_login_transport(create_app(settings, fake, background=False))
    with TestClient(app) as client:
        wrong = {**OPERATOR, "password": "wrong"}
        assert client.post("/api/auth/immich-login", json=wrong).status_code == 401
        assert client.post("/api/auth/immich-login", json={"email": "", "password": "x"}).status_code == 422
        assert client.post("/api/auth/immich-login", json={"email": "a@b.c", "password": "y" * 257}).status_code == 422
        assert client.get("/api/auth/session").json()["authenticated"] is False
        for _ in range(4):
            assert client.post("/api/auth/immich-login", json=wrong).status_code == 401
        response = client.post("/api/auth/immich-login", json=OPERATOR)
        assert response.status_code == 429 and response.json()["error"] == "login_rate_limited"


def test_immich_login_never_logs_credentials(setup, caplog):
    import logging

    settings, fake = setup
    app = attach_login_transport(create_app(settings, fake, background=False))
    with caplog.at_level(logging.INFO, logger="immich_ki.auth"):
        with TestClient(app) as client:
            assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 200
            assert client.post("/api/auth/immich-login", json={**OPERATOR, "password": "wrong"}).status_code == 401
    assert OPERATOR["password"] not in caplog.text


def test_immich_login_restricted_to_config_owner(setup):
    from dataclasses import replace

    from immich_ki.keyconfig import save_panel_config

    settings, fake = setup
    # A config bound to another account (e.g. after key rotation) rejects other Immich users.
    save_panel_config(settings.data, "secret", "owner@example.com")
    app = attach_login_transport(create_app(replace(settings, api_key=""), fake, background=False))
    with TestClient(app) as client:
        response = client.post("/api/auth/immich-login", json=OPERATOR)
        assert response.status_code == 403 and response.json()["error"] == "forbidden_account"


def test_login_fails_closed_when_owner_unresolved(setup):
    """An unbound owner must reject every valid login, never bind to first login."""

    from immich_ki.client import UpstreamError

    settings, fake = setup

    # Simulate an Immich that cannot resolve the key owner at startup.
    def unreachable():
        raise UpstreamError(502)

    fake.me = unreachable
    app = attach_login_transport(create_app(settings, fake, background=False))
    with TestClient(app) as client:
        # A valid Immich account still cannot log in: the panel owner is unbound.
        response = client.post("/api/auth/immich-login", json=OPERATOR)
        assert response.status_code == 403 and response.json()["error"] == "owner_unbound"


def test_owner_recovers_at_runtime_without_restart(setup):
    """A startup owner lookup that fails must not require a restart to recover."""
    from immich_ki.client import UpstreamError

    settings, fake = setup
    unreachable = [True]

    def me():
        if unreachable[0]:
            raise UpstreamError(502)
        return {"email": "akari@example.com"}

    fake.me = me
    app = attach_login_transport(create_app(settings, fake, background=False))
    with TestClient(app) as client:
        # Owner still unresolved: login is fail-closed.
        assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 403
        # Immich comes back; the next login re-resolves the owner and succeeds.
        unreachable[0] = False
        assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 200
        session = client.get("/api/auth/session").json()
        assert session["authenticated"] is True
        assert session["identity"] == "akari@example.com"


def test_validate_immich_key_rejects_malformed_identity():
    """users/me must be a dict with a non-empty string email; anything else is
    an upstream contract violation, never an empty-but-valid identity."""
    import httpx
    from immich_ki.auth import validate_immich_key

    def client_for(body):
        def handler(request):
            if isinstance(body, Exception):
                return httpx.Response(200, text="not json")
            return httpx.Response(200, json=body)

        return httpx.MockTransport(handler)

    for body in ({}, {"email": ""}, {"email": 123}, {"email": None}, [], "x", 42, None):
        email, error = validate_immich_key("http://immich:2283", "k", client_for(body))
        assert error == "key_identity_invalid" and email == ""

    def not_json(request):
        return httpx.Response(200, text="not json")

    email, error = validate_immich_key("http://immich:2283", "k", httpx.MockTransport(not_json))
    assert error == "key_identity_invalid" and email == ""

    def ok(request):
        return httpx.Response(200, json={"email": "  owner@example.com  "})

    email, error = validate_immich_key("http://immich:2283", "k", httpx.MockTransport(ok))
    assert error == "" and email == "owner@example.com"


def test_resolve_owner_from_key_requires_string_email(setup):
    from immich_ki.owner import resolve_owner_from_key

    settings, fake = setup
    fake.me = lambda: {"email": ["not", "a", "string"]}
    # A non-string email must not be persisted, and no owner is bound.
    assert resolve_owner_from_key(settings, fake, "k", "") == ""
    fake.me = lambda: {"email": "   "}
    assert resolve_owner_from_key(settings, fake, "k", "") == ""
    # A malformed body (list) must not raise.
    fake.me = lambda: ["unexpected"]
    assert resolve_owner_from_key(settings, fake, "k", "") == ""


def test_renderer_version_includes_implementation_fingerprint(service):
    from immich_ki.fingerprint import implementation_fingerprint

    fingerprint = implementation_fingerprint()
    assert len(fingerprint) == 16
    assert fingerprint == implementation_fingerprint()  # deterministic
    version = service.renderer_version
    assert "impl-" + fingerprint in version
    assert "-logos-" in version
    assert version.startswith(service.settings.renderer_version + "-impl-")


def test_logout_revokes_session(setup):
    settings, fake = setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 200
        assert client.get("/api/assets").status_code == 200
        session = client.cookies.get("ki_session")
        response = client.post("/api/auth/logout")
        assert response.status_code == 200 and response.json() == {"ok": True}
        # The server-side session is revoked, not just the cookie.
        client.cookies.set("ki_session", session)
        assert client.get("/api/assets").status_code == 401


def test_render_rejects_second_frame_region(setup):
    """The panel enforces a single information frame without touching stored config."""
    settings, fake = setup
    two_frames = deepcopy(CONFIG)
    two_frames["regions"] = [
        {
            "id": "footer",
            "type": "footer-bar",
            "enabled": True,
            "height": 0.1,
            "slots": {
                "primary-start": {"enabled": True, "content": {"chips": [{"field_id": "make"}], "separator": " "}}
            },
        },
        {
            "id": "side",
            "type": "side-bar",
            "enabled": True,
            "edge": "right",
            "slots": {
                "primary-start": {"enabled": True, "content": {"chips": [{"field_id": "iso"}], "separator": " "}}
            },
        },
    ]
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        response = client.put(f"/api/assets/{fake.asset_id}/config", json={"expectedRevision": 0, "config": two_frames})
        assert response.status_code == 422 and response.json()["error"] == "too_many_frames"
        # The prior config was not silently replaced.
        assert client.get(f"/api/assets/{fake.asset_id}/config").json()["revision"] == 0


def test_client_membership_uses_albums_by_asset_query():
    """The real membership contract is `GET /albums?assetId=`, not album.assets."""

    import httpx
    from immich_ki.client import ImmichClient

    calls = []

    def handle(request):
        calls.append(request)
        if request.url.path == "/api/albums":
            assert request.url.params.get("assetId") == "11111111-1111-1111-1111-111111111111"
            return httpx.Response(200, json=[{"id": "22222222-2222-2222-2222-222222222222"}])
        if request.url.path == "/api/albums/22222222-2222-2222-2222-222222222222/assets":
            return httpx.Response(200, json=[{"success": True}])
        return httpx.Response(404)

    client = ImmichClient("http://immich:2283", "private", transport=httpx.MockTransport(handle))
    try:
        asset = "11111111-1111-1111-1111-111111111111"
        album = "22222222-2222-2222-2222-222222222222"
        assert client.album_membership(asset) == {album}
        client.add_to_album(album, asset)
        paths = [c.url.path for c in calls]
        assert paths[0] == "/api/albums"  # membership read-back, not album detail
        assert paths[-1] == "/api/albums"
    finally:
        client.close()


def test_init_mode_gates_api_and_init_success_persists_key(setup):
    import json
    from dataclasses import replace

    import httpx

    settings, fake = setup
    settings = replace(settings, api_key="")
    assert not (settings.data / "config.json").exists()

    def upstream(request):
        assert request.url.path == "/api/users/me"
        if request.headers["x-api-key"] == "good-key":
            return httpx.Response(200, json={"email": "akari@example.com"})
        if request.headers["x-api-key"] == "scoped-key":
            return httpx.Response(403)
        return httpx.Response(401)

    app = attach_login_transport(create_app(settings, fake, background=False))
    app.state.immich_key_transport = httpx.MockTransport(upstream)
    with TestClient(app) as client:
        session = client.get("/api/auth/session").json()
        assert session["mode"] == "init" and session["initialized"] is False
        response = client.get("/api/assets")
        assert response.status_code == 403 and response.json()["error"] == "init_required"
        assert client.get("/api/health").json()["initialized"] is False
        # Login is closed before initialization.
        assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 403
        response = client.post("/api/init", json={"key": "bad-key"})
        assert response.status_code == 401 and response.json()["error"] == "invalid_key"
        response = client.post("/api/init", json={"key": "scoped-key"})
        assert response.status_code == 403 and response.json()["error"] == "key_scope_insufficient"
        response = client.post("/api/init", json={"key": "good-key"})
        assert response.status_code == 200
        assert client.get("/api/auth/session").json()["initialized"] is True
        assert client.get("/api/assets").status_code == 200
        # Init is single-use.
        assert client.post("/api/init", json={"key": "good-key"}).status_code == 409
    config = settings.data / "config.json"
    assert json.loads(config.read_text()) == {"apiKey": "good-key", "ownerEmail": "akari@example.com"}
    assert config.stat().st_mode & 0o777 == 0o600
    # A restart with the config file present comes up initialized, no init mode.
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        assert client.get("/api/auth/session").json()["initialized"] is True
        assert client.get("/api/assets").status_code == 401


def test_init_success_swaps_upstream_key(setup):
    from dataclasses import replace

    import httpx
    from immich_ki.client import ImmichClient

    settings, _fake = setup
    settings = replace(settings, api_key="")
    transport = httpx.MockTransport(lambda request: httpx.Response(200, json={"email": "akari@example.com"}))
    http = ImmichClient(settings.immich_url, "", transport=transport)
    app = create_app(settings, http, background=False)
    app.state.immich_key_transport = transport
    with TestClient(app) as client:
        assert client.post("/api/init", json={"key": "swapped-key"}).status_code == 200
    assert http.http.headers["x-api-key"] == "swapped-key"


def test_immich_login_accepts_created_status_and_snake_case_token(setup):
    import httpx

    settings, fake = setup

    def handler(request):
        if request.url.path == "/api/auth/login":
            return httpx.Response(201, json={"access_token": "op-token"})
        if request.url.path == "/api/users/me":
            return httpx.Response(200, json={"email": OPERATOR["email"]})
        return httpx.Response(404)

    app = create_app(settings, fake, background=False)
    app.state.immich_key_transport = httpx.MockTransport(handler)
    with TestClient(app) as client:
        assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 200
        assert client.get("/api/auth/session").json()["authenticated"] is True


def test_archive_mode_same_library_reserved_subdir(tmp_path):
    from dataclasses import replace

    imports = tmp_path / "imports"
    output = imports / "imprint"
    output.mkdir(parents=True)
    library = str(uuid4())
    settings = Settings(
        "http://localhost:2283",
        "secret",
        library,
        library,
        imports,
        output,
        tmp_path / "data",
        source_prefix="/external/camera-data/finished",
        output_prefix="/external/camera-data/finished/imprint",
        imprint_dir="",
    )
    # 方案A: source and output may share one library when outputs live in a
    # dedicated subdir of the source tree (output mount inside imports tree).
    assert settings.reserved_output == "imprint"
    # Equal prefixes without an imprint subdir would overwrite the source file.
    with pytest.raises(ValueError, match="output_collides_with_source"):
        replace(settings, output_prefix="/external/camera-data/finished")
    # Legacy mode: distinct libraries keep no reserved subdir.
    legacy = replace(settings, output_library=str(uuid4()), output_prefix="/external/camera-watermarked-m0")
    assert legacy.reserved_output is None


def test_archive_mode_reject_ambiguous_root_overlap(tmp_path):
    imports = tmp_path / "imports"
    output = tmp_path / "output"
    imports.mkdir()
    output.mkdir()
    library = str(uuid4())
    with pytest.raises(ValueError, match="overlapping_roots"):
        Settings(
            "http://localhost:2283",
            "secret",
            library,
            library,
            imports,
            imports,
            tmp_path / "data",
            source_prefix="/external/a",
            output_prefix="/external/b",
        )
    with pytest.raises(ValueError, match="overlapping_roots"):
        Settings(
            "http://localhost:2283",
            "secret",
            library,
            library,
            output,
            tmp_path / "output" / "nested" / ".." / "..",
            tmp_path / "data",
            source_prefix="/external/a",
            output_prefix="/external/b",
            imprint_dir="",
        )


def test_source_and_gallery_exclude_reserved_output_subdir(setup):
    settings, _fake = setup
    archive_settings = Settings(
        settings.immich_url,
        settings.api_key,
        settings.source_library,
        settings.source_library,
        settings.imports,
        settings.output,
        settings.data / "archive",
        source_prefix="/external/camera-exports",
        output_prefix="/external/camera-exports/Imprint",
        imprint_dir="",
    )
    archived = FakeImmich(archive_settings)
    archived.asset_id = "imprint-asset"
    imprint_asset = {
        "id": "imprint-asset",
        "libraryId": archive_settings.source_library,
        "type": "IMAGE",
        "originalPath": "/external/camera-exports/Imprint/2026/photo.jpg",
        "originalFileName": "photo.jpg",
    }
    archived.asset = lambda asset_id: dict(imprint_asset, id=asset_id)
    archived.search = lambda library, page=1, path=None, albums=None: {
        "items": [imprint_asset] if path is None else [],
        "nextPage": None,
    }
    service = Service(archive_settings, archived)
    try:
        with pytest.raises(ValueError, match="not_source_asset"):
            service.source("imprint-asset")
    finally:
        service.store.close()
    with TestClient(attach_login_transport(create_app(archive_settings, archived, background=False))) as client:
        client.post("/api/auth/immich-login", json=OPERATOR)
        assert client.get("/api/assets").json()["items"] == []


def test_metadata_does_not_depend_on_output_and_recreates_scratch(service, monkeypatch):
    import shutil

    import immich_ki.service as module

    monkeypatch.setattr(module, "get_exif", lambda *a, **kw: {})
    shutil.rmtree(service.tmp)
    service.settings.output.rmdir()
    shutil.rmtree(service.metadata_tmp)
    assert service.metadata(service.client.asset_id)["width"] == 120
    assert service.metadata_tmp.is_dir()
    assert not service.settings.output.exists()  # Missing mount is never recreated.
    assert list(service.metadata_tmp.iterdir()) == []


def test_output_workspace_recreated_and_symlink_rejected(service, tmp_path):
    service.tmp.rmdir()
    service.maintenance.gc()
    assert service.tmp.is_dir()
    service.tmp.rmdir()
    target = tmp_path / "outside"
    target.mkdir()
    service.tmp.symlink_to(target, target_is_directory=True)
    with pytest.raises(ValueError, match="unsafe_workspace"):
        service.enqueue(service.client.asset_id, 1)
    assert list(target.iterdir()) == []


def test_output_unavailable_is_safe_and_recovers(setup, monkeypatch):
    import shutil

    import immich_ki.service as module

    monkeypatch.setattr(module, "get_exif", lambda *a, **kw: {})
    settings, fake = setup
    settings.output.rmdir()
    app = attach_login_transport(create_app(settings, fake, background=False))
    with TestClient(app) as client:
        assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 200
        assert client.get("/api/health").json()["error"] == "output_unavailable"
        assert client.get(f"/api/assets/{fake.asset_id}/metadata").status_code == 200
        assert (
            client.put(
                f"/api/assets/{fake.asset_id}/config", json={"expectedRevision": 0, "config": CONFIG}
            ).status_code
            == 200
        )
        response = client.post(f"/api/assets/{fake.asset_id}/render", json={"revision": 1})
        assert response.status_code == 503
        assert response.json() == {"error": "output_unavailable"}
        assert not settings.output.exists()
        settings.output.mkdir()
        assert client.get("/api/health").json()["ok"] is True
        assert client.post(f"/api/assets/{fake.asset_id}/render", json={"revision": 1}).status_code == 202
        shutil.rmtree(app.state.service.tmp)
        assert client.get("/api/health").json()["ok"] is True


def test_workspace_permission_failure_is_not_raw_os_error(service, monkeypatch):
    import errno

    import immich_ki.workspace as module

    real_open = module.os.open

    def deny(path, *args, **kwargs):
        if str(path).startswith(".probe-"):
            raise PermissionError(errno.EACCES, "sensitive mount path")
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(module.os, "open", deny)
    with pytest.raises(module.StorageUnavailable, match=r"^output_unavailable$"):
        service.ensure_output()


def test_background_recovers_output_after_runtime_disappearance(setup):
    import shutil
    import time

    settings, fake = setup
    app = create_app(settings, fake)
    with TestClient(app) as client:
        shutil.rmtree(settings.output)
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            if client.get("/api/health").json()["error"] == "output_unavailable":
                break
            time.sleep(0.05)
        # Give the worker a tick to observe the missing mount, not just health.
        time.sleep(0.7)
        settings.output.mkdir()
        deadline = time.monotonic() + 7
        while time.monotonic() < deadline:
            if client.get("/api/health").json()["ok"]:
                break
            time.sleep(0.05)
        assert client.get("/api/health").json()["ok"] is True
        assert app.state.service.tmp.is_dir()


def test_output_root_write_check_even_when_scratch_writable(service, monkeypatch):
    import errno

    import immich_ki.workspace as module

    real_open = module.os.open

    def deny_root_probe(path, *args, **kwargs):
        if str(path).startswith(".ki-probe-"):
            raise PermissionError(errno.EACCES, "secret-output-root")
        return real_open(path, *args, **kwargs)

    monkeypatch.setattr(module.os, "open", deny_root_probe)
    with pytest.raises(module.StorageUnavailable, match=r"^output_unavailable$"):
        service.ensure_output()


def test_missing_publication_snapshot_does_not_block_queue(service):
    import shutil

    job = save_job(service)
    with service.store.transaction() as db:
        db.execute(
            "UPDATE jobs SET state='publishing',output_hash='expected',previous_hash=NULL WHERE id=?", (job["id"],)
        )
    shutil.rmtree(service.tmp / job["id"])
    service.recover()
    failed = service.store.job(job["id"])
    assert failed["state"] == "failed"
    assert failed["error"] == "publication_source_missing"
    next_job = save_job(service)
    service.render_next()
    assert service.store.job(next_job["id"])["state"] == "awaiting_import"


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [({"max_output_pixels": 1000}, "output_too_large"), ({"max_pixels": 100}, "image_too_large")],
)
def test_render_child_error_codes_survive_the_process_boundary(setup, overrides, expected):
    from dataclasses import replace

    settings, client = setup
    value = Service(replace(settings, **overrides), client)
    try:
        job = save_job(value)
        value.render_next()
        row = value.store.job(job["id"])
        assert row["state"] == "failed"
        assert row["error"] == expected
    finally:
        value.store.close()


def test_render_error_parser_only_accepts_known_codes():
    from immich_ki.render import ERROR_PREFIX, parse_error

    assert parse_error(f"Traceback ...\n/secret/path.py\n{ERROR_PREFIX}unsupported_image\n".encode()) == "unsupported_image"
    assert parse_error(f"{ERROR_PREFIX}/etc/passwd".encode()) == "render_failed"
    assert parse_error(b"Traceback (most recent call last):\n  File '/x.py'") == "render_failed"
    assert parse_error(None) == "render_failed"
