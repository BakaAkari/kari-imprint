"""Album look, exceptions, drafts, batch render, activity and v1→v2 migration."""

import sqlite3
from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from immich_ki.app import create_app
from immich_ki.client import UpstreamError
from immich_ki.service import Service
from immich_ki.settings import Settings
from PIL import Image
from test_worker import OPERATOR, FakeImmich, attach_login_transport

LOOK = {
    "schema_version": 3,
    "canvas": {"margins": {"bottom": 40}},
    "regions": [
        {
            "id": "footer",
            "type": "footer-bar",
            "enabled": True,
            "height": 0.1,
            "slots": {
                "primary-start": {
                    "enabled": True,
                    "content": {"chips": [{"field_id": "make"}], "separator": " "},
                    "style": {"color": "#222222"},
                },
            },
        }
    ],
}


def with_color(config, color):
    config = deepcopy(config)
    config["regions"][0]["slots"]["primary-start"]["style"]["color"] = color
    return config


def with_margin(config, bottom):
    config = deepcopy(config)
    config["canvas"]["margins"]["bottom"] = bottom
    return config


class AlbumImmich(FakeImmich):
    """FakeImmich with several photos in the source album."""

    def __init__(self, settings, count=4):
        super().__init__(settings)
        self.photos = {self.asset_id: "photo.jpg"}
        for index in range(1, count):
            self.photos[str(uuid4())] = f"photo{index}.jpg"
        for asset_id in self.photos:
            self.members[asset_id] = {self.source_album_id}
        self.mixed_albums = {self.source_album_id: [self._item(a) for a in self.photos]}
        self.asset_calls = 0

    def _item(self, asset_id):
        return {
            "id": asset_id,
            "libraryId": self.settings.source_library,
            "type": "IMAGE",
            "originalPath": "/external/camera-exports/" + self.photos[asset_id],
            "originalFileName": self.photos[asset_id],
        }

    def asset(self, asset_id):
        self.asset_calls += 1
        if str(asset_id) in self.photos and str(asset_id) != self.asset_id:
            return self._item(str(asset_id))
        return super().asset(asset_id)


@pytest.fixture
def album_setup(tmp_path):
    imports, output = tmp_path / "imports", tmp_path / "output"
    imports.mkdir()
    output.mkdir()
    settings = Settings(
        "http://localhost:2283", "secret", str(uuid4()), str(uuid4()), imports, output, tmp_path / "data",
        max_queue=2,
    )
    fake = AlbumImmich(settings)
    for name in fake.photos.values():
        Image.new("RGB", (120, 80), "red").save(imports / name)
    return settings, fake


@pytest.fixture
def api(album_setup):
    settings, fake = album_setup
    with TestClient(attach_login_transport(create_app(settings, fake, background=False))) as client:
        assert client.post("/api/auth/immich-login", json=OPERATOR).status_code == 200
        yield client, fake, client.app.state.service


def put_look(client, fake, config, expected=None):
    album = fake.source_album_id
    if expected is None:
        expected = client.get(f"/api/albums/{album}/look").json()["revision"]
    response = client.put(f"/api/albums/{album}/look", json={"expectedRevision": expected, "config": config})
    assert response.status_code == 200, response.text
    return response.json()


def put_config(client, fake, asset_id, config, album=None, expected=None):
    album = album or fake.source_album_id
    if expected is None:
        expected = client.get(f"/api/assets/{asset_id}/config", params={"album": album}).json()["revision"]
    return client.put(
        f"/api/assets/{asset_id}/config", json={"expectedRevision": expected, "config": config, "album": album}
    )


def test_look_get_put_revision_and_validation(api):
    client, fake, _ = api
    album = fake.source_album_id
    assert client.get(f"/api/albums/{album}/look").json() == {"revision": 0, "config": None}
    saved = put_look(client, fake, LOOK, 0)
    assert saved["revision"] == 1 and saved["impact"] == {"follow": 0, "exceptions": 0, "stale": 0}
    assert saved["config"]["regions"][0]["id"] == "footer"
    # Identical save keeps the revision; a stale expectedRevision is a conflict.
    assert put_look(client, fake, LOOK, 1)["revision"] == 1
    stale = client.put(f"/api/albums/{album}/look", json={"expectedRevision": 0, "config": LOOK})
    assert stale.status_code == 409 and stale.json() == {"error": "revision_conflict"}
    assert client.get(f"/api/albums/{album}/look").json()["revision"] == 1
    bad = client.put(f"/api/albums/{album}/look", json={"expectedRevision": 1, "config": {"schema_version": 2}})
    assert bad.status_code == 422 and "/external" not in bad.text
    assert client.put(f"/api/albums/{album}/look", json={"expectedRevision": True, "config": LOOK}).status_code == 422
    assert client.get("/api/albums/not-a-uuid/look").status_code == 422
    result = client.put(f"/api/albums/{fake.result_album_id}/look", json={"expectedRevision": 0, "config": LOOK})
    assert result.status_code == 422 and result.json()["error"] == "result_album_read_only"
    assert client.get(f"/api/albums/{fake.result_album_id}/summary").json()["error"] == "result_album_read_only"


def test_config_requires_look_and_binds_follow_or_exception(api):
    client, fake, service = api
    asset = fake.asset_id
    response = put_config(client, fake, asset, LOOK, expected=0)
    assert response.status_code == 422 and response.json()["error"] == "look_required"
    put_look(client, fake, LOOK)
    follow = put_config(client, fake, asset, LOOK).json()
    assert set(follow) == {
        "revision", "saved", "look", "mode", "overrides", "resolved", "draft", "stale", "conflict", "dropped"
    }
    assert follow["mode"] == "follow" and follow["overrides"] == [] and follow["revision"] == 1
    assert follow["resolved"] == follow["saved"] == follow["look"]["config"]
    assert follow["stale"] is False and follow["conflict"] is False and follow["draft"] is None
    red = with_color(LOOK, "#FF0000")
    exception = put_config(client, fake, asset, red).json()
    assert exception["mode"] == "exception" and exception["revision"] == 2
    assert exception["overrides"] == ["regions/footer/slots/primary-start/style/color"]
    assert exception["resolved"] == exception["saved"]
    # Idempotent: the same resolved config keeps the revision and creates no job.
    again = put_config(client, fake, asset, red, expected=2).json()
    assert again["revision"] == 2
    with service.store.transaction() as db:
        assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 0
    # Membership and result-album rules are the ones of single renders.
    other = put_config(client, fake, asset, red, album=fake.result_album_id, expected=2)
    assert other.status_code == 422 and other.json()["error"] == "result_album_read_only"
    fake.members[asset] = set()
    missing = put_config(client, fake, asset, red, expected=2)
    assert missing.status_code == 422 and missing.json()["error"] == "asset_not_in_album"


def test_follow_endpoint_resets_patch(api):
    client, fake, _ = api
    asset = fake.asset_id
    put_look(client, fake, LOOK)
    put_config(client, fake, asset, with_color(LOOK, "#FF0000"))
    response = client.post(f"/api/assets/{asset}/follow", json={"album": fake.source_album_id, "expectedRevision": 1})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["mode"] == "follow" and body["revision"] == 2 and body["saved"] == body["look"]["config"]
    conflict = client.post(f"/api/assets/{asset}/follow", json={"album": fake.source_album_id, "expectedRevision": 0})
    assert conflict.status_code == 409


def test_look_change_propagates_and_marks_stale(api):
    client, fake, service = api
    ids = list(fake.photos)
    put_look(client, fake, LOOK)
    put_config(client, fake, ids[0], LOOK)  # follower
    put_config(client, fake, ids[1], with_color(LOOK, "#FF0000"))  # exception: color
    for asset_id in ids[:2]:
        revision = service.config(asset_id)["revision"]
        service.enqueue(asset_id, revision, fake.source_album_id)
        service.render_next()
    new_look = with_color(with_margin(LOOK, 80), "#00FF00")
    saved = put_look(client, fake, new_look)
    assert saved["impact"] == {"follow": 1, "exceptions": 1, "stale": 2}
    follower = client.get(f"/api/assets/{ids[0]}/config", params={"album": fake.source_album_id}).json()
    assert follower["stale"] is True and follower["resolved"] == follower["look"]["config"]
    exception = client.get(f"/api/assets/{ids[1]}/config", params={"album": fake.source_album_id}).json()
    assert exception["stale"] is True and exception["mode"] == "exception"
    assert exception["resolved"]["canvas"]["margins"]["bottom"] == 80
    assert exception["resolved"]["regions"][0]["slots"]["primary-start"]["style"]["color"] == "#FF0000"
    assert exception["saved"]["canvas"]["margins"]["bottom"] == 40
    items = {i["id"]: i["status"] for i in client.get("/api/assets", params={"album": fake.source_album_id}).json()["items"]}
    # awaiting_import is still "busy"; once confirmed done it is "stale".
    assert items[ids[0]]["state"] == "busy"
    with service.store.transaction() as db:
        db.execute("UPDATE jobs SET state='done'")
    items = {i["id"]: i["status"] for i in client.get("/api/assets", params={"album": fake.source_album_id}).json()["items"]}
    assert items[ids[0]] == {
        "configured": True, "job": "done", "published": True, "state": "stale", "exception": False, "draft": False
    }
    assert items[ids[1]]["state"] == "stale" and items[ids[1]]["exception"] is True
    assert items[ids[2]]["state"] == "none" and items[ids[2]]["exception"] is False
    # Back to the original look: nothing is stale any more.
    put_look(client, fake, LOOK)
    assert client.get(f"/api/assets/{ids[1]}/config", params={"album": fake.source_album_id}).json()["stale"] is False
    items = {i["id"]: i["status"] for i in client.get("/api/assets", params={"album": fake.source_album_id}).json()["items"]}
    assert items[ids[0]]["state"] == items[ids[1]]["state"] == "done"


def test_conflicting_exception_falls_back_to_look(api):
    client, fake, _ = api
    asset = fake.asset_id
    put_look(client, fake, LOOK)
    taller = deepcopy(LOOK)
    taller["regions"][0]["height"] = 0.2
    put_config(client, fake, asset, taller)
    side = deepcopy(LOOK)
    side["regions"][0].update(type="side-bar", edge="right")
    side["regions"][0].pop("height")
    put_look(client, fake, side)
    view = client.get(f"/api/assets/{asset}/config", params={"album": fake.source_album_id}).json()
    # height is not allowed on a side bar: the resolved config would be invalid.
    assert view["conflict"] is True and view["resolved"] == view["look"]["config"] and view["stale"] is True
    render = client.post(f"/api/albums/{fake.source_album_id}/render", json={"scope": "ids", "assetIds": [asset]})
    assert render.json()["skipped"]["errors"] == [{"assetId": asset, "error": "look_conflict"}]


def test_dropped_paths_when_look_becomes_plain(api):
    client, fake, _ = api
    asset = fake.asset_id
    put_look(client, fake, LOOK)
    put_config(client, fake, asset, with_color(LOOK, "#FF0000"))
    plain = {"schema_version": 3, "canvas": {"margins": {"bottom": 40}}, "regions": []}
    put_look(client, fake, plain)
    view = client.get(f"/api/assets/{asset}/config", params={"album": fake.source_album_id}).json()
    assert view["conflict"] is False and view["resolved"]["regions"] == []
    assert view["dropped"] == ["regions/footer/slots/primary-start/style/color"]


def test_drafts_are_server_side_and_skip_batches(api):
    client, fake, _ = api
    asset = fake.asset_id
    album = fake.source_album_id
    put_look(client, fake, LOOK)
    draft = client.put(f"/api/assets/{asset}/draft", json={"config": with_color(LOOK, "#00FF00"), "album": album})
    assert draft.status_code == 200 and draft.json()["draft"]["regions"][0]["slots"]["primary-start"]["style"]["color"] == "#00FF00"
    invalid = client.put(f"/api/assets/{asset}/draft", json={"config": {"schema_version": 3, "regions": "x"}, "album": album})
    assert invalid.status_code == 422
    assert client.put(f"/api/assets/{asset}/draft", json={"config": LOOK}).status_code == 422
    status = client.get("/api/assets", params={"album": album}).json()["items"]
    assert {i["id"]: i["status"]["state"] for i in status}[asset] == "draft"
    batch = client.post(f"/api/albums/{album}/render", json={"scope": "all"}).json()
    assert batch["queued"] == 3 and batch["skipped"]["drafts"] == 1
    # Saving clears the draft.
    assert put_config(client, fake, asset, LOOK).json()["draft"] is None
    assert client.put(f"/api/assets/{asset}/draft", json={"config": LOOK, "album": album}).status_code == 200
    assert client.delete(f"/api/assets/{asset}/draft").json() == {"ok": True}
    view = client.get(f"/api/assets/{asset}/config", params={"album": album}).json()
    assert view["draft"] is None


def test_batch_feeder_respects_queue_limit_and_pairs_album(api):
    client, fake, service = api
    album = fake.source_album_id
    put_look(client, fake, LOOK)
    first = client.post(f"/api/albums/{album}/render", json={"scope": "pending"}).json()
    assert first == {"queued": 4, "skipped": {"upToDate": 0, "drafts": 0, "errors": []}}
    activity = client.get(f"/api/albums/{album}/activity").json()
    assert activity["waiting"] == 4 and activity["jobs"] == [] and len(activity["waitingAssetIds"]) == 4
    states = {i["id"]: i["status"]["state"] for i in client.get("/api/assets", params={"album": album}).json()["items"]}
    assert set(states.values()) == {"busy"}

    def pending():
        with service.store.transaction() as db:
            return db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running')").fetchone()[0]

    assert service.looks.feed(limit=10) == 2 and pending() == 2
    assert service.looks.feed(limit=10) == 0 and pending() == 2
    activity = client.get(f"/api/albums/{album}/activity").json()
    assert activity["waiting"] == 2 and len(activity["jobs"]) == 2
    job = activity["jobs"][0]
    assert set(job) == {"assetId", "id", "state", "error", "generation", "updated"}
    assert job["state"] == "queued" and job["generation"] == 1 and job["updated"].endswith("Z")
    while service.render_next() is not None or service.looks.feed(limit=10):
        assert pending() <= service.settings.max_queue
    with service.store.transaction() as db:
        rows = db.execute("SELECT j.state, a.source_album_id FROM jobs j JOIN job_albums a ON a.job_id=j.id").fetchall()
    assert len(rows) == 4 and {r[0] for r in rows} == {"awaiting_import"} and {r[1] for r in rows} == {album}
    activity = client.get(f"/api/albums/{album}/activity").json()
    assert activity["waiting"] == 0 and {j["state"] for j in activity["jobs"]} == {"awaiting_import"}
    # Everything is current: nothing to queue again.
    with service.store.transaction() as db:
        db.execute("UPDATE jobs SET state='done'")
    again = client.post(f"/api/albums/{album}/render", json={"scope": "all"}).json()
    assert again["queued"] == 0 and again["skipped"]["upToDate"] == 4
    # A look change makes them stale; scope=stale re-renders with new revisions.
    put_look(client, fake, with_margin(LOOK, 60))
    stale = client.post(f"/api/albums/{album}/render", json={"scope": "stale"}).json()
    assert stale["queued"] == 4
    assert {service.config(a)["revision"] for a in fake.photos} == {2}


def test_batch_item_failures_are_reported_without_blocking(api):
    client, fake, service = api
    album = fake.source_album_id
    ids = list(fake.photos)
    put_look(client, fake, LOOK)
    stranger = str(uuid4())
    response = client.post(f"/api/albums/{album}/render", json={"scope": "ids", "assetIds": [ids[0], ids[1], stranger]})
    body = response.json()
    assert body["queued"] == 2 and body["skipped"]["errors"] == [{"assetId": stranger, "error": "asset_not_in_album"}]
    (service.settings.imports / fake.photos[ids[0]]).unlink()
    assert service.looks.feed(limit=10) == 1
    activity = client.get(f"/api/albums/{album}/activity").json()
    by_asset = {j["assetId"]: j for j in activity["jobs"]}
    assert by_asset[ids[0]] == {
        "assetId": ids[0], "id": None, "state": "failed", "error": "source_unavailable",
        "generation": None, "updated": by_asset[ids[0]]["updated"],
    }
    assert by_asset[ids[1]]["state"] == "queued" and activity["waiting"] == 0
    states = {i["id"]: i["status"]["state"] for i in client.get("/api/assets", params={"album": album}).json()["items"]}
    assert states[ids[0]] == "failed"
    Image.new("RGB", (120, 80), "red").save(service.settings.imports / fake.photos[ids[0]])
    retry = client.post(f"/api/albums/{album}/render", json={"scope": "failed"}).json()
    assert retry["queued"] == 1
    assert service.looks.feed(limit=10) == 1
    # A transient Immich outage leaves the item waiting instead of failing it.
    while service.render_next() is not None:
        pass
    client.post(f"/api/albums/{album}/render", json={"scope": "ids", "assetIds": [ids[2]]})
    original = fake.album_membership
    fake.album_membership = lambda asset_id: (_ for _ in ()).throw(UpstreamError(503))
    with pytest.raises(UpstreamError):
        service.looks.feed(limit=10)
    fake.album_membership = original
    assert client.get(f"/api/albums/{album}/activity").json()["waiting"] == 1


def test_batch_request_validation(api):
    client, fake, _ = api
    endpoint = f"/api/albums/{fake.source_album_id}/render"
    for body in (
        {"scope": "everything"},
        {"scope": "ids"},
        {"scope": "ids", "assetIds": []},
        {"scope": "ids", "assetIds": ["nope"]},
        {"scope": "all", "assetIds": [fake.asset_id]},
        {"scope": "ids", "assetIds": [fake.asset_id, fake.asset_id]},
        {"scope": "all", "extra": 1},
    ):
        response = client.post(endpoint, json=body)
        assert response.status_code == 422 and response.json() == {"error": "invalid_request"}, body
    no_look = client.post(endpoint, json={"scope": "pending"}).json()
    assert no_look["queued"] == 0 and {e["error"] for e in no_look["skipped"]["errors"]} == {"look_required"}
    result = client.post(f"/api/albums/{fake.result_album_id}/render", json={"scope": "all"})
    assert result.status_code == 422 and result.json()["error"] == "result_album_read_only"


def test_summary_counts_cache_and_invalidation(api):
    client, fake, service = api
    album = fake.source_album_id
    summary = client.get(f"/api/albums/{album}/summary").json()
    assert summary == {
        "total": 4,
        "counts": {"none": 4, "draft": 0, "busy": 0, "done": 0, "stale": 0, "failed": 0},
        "exceptions": 0,
        "look": None,
    }
    searches = len(fake.count_queries)
    assert client.get(f"/api/albums/{album}/summary").json() == summary
    assert len(fake.count_queries) == searches  # cached
    put_look(client, fake, LOOK)
    put_config(client, fake, fake.asset_id, with_color(LOOK, "#FF0000"))
    client.post(f"/api/albums/{album}/render", json={"scope": "ids", "assetIds": [list(fake.photos)[1]]})
    summary = client.get(f"/api/albums/{album}/summary").json()
    assert summary["look"] == {"revision": 1} and summary["exceptions"] == 1
    assert summary["counts"]["busy"] == 1 and summary["counts"]["none"] == 3
    # The TTL expires on its own as well.
    # (one enumeration for the batch render, one for the invalidated summary)
    assert len(fake.count_queries) == searches + 2
    service.looks.clock = lambda: 1e12
    client.get(f"/api/albums/{album}/summary")
    assert len(fake.count_queries) == searches + 3


def test_activity_is_database_only_and_window_limited(api):
    client, fake, service = api
    album = fake.source_album_id
    put_look(client, fake, LOOK)
    client.post(f"/api/albums/{album}/render", json={"scope": "ids", "assetIds": [fake.asset_id]})
    service.looks.feed()
    service.render_next()
    calls = fake.asset_calls
    activity = client.get(f"/api/albums/{album}/activity").json()
    assert fake.asset_calls == calls
    assert [j["state"] for j in activity["jobs"]] == ["awaiting_import"]
    with service.store.transaction() as db:
        db.execute("UPDATE jobs SET state='done'")
        db.execute("UPDATE jobs SET updated=datetime('now','-16 minutes')")
    assert client.get(f"/api/albums/{album}/activity").json() == {"jobs": [], "waiting": 0, "waitingAssetIds": []}
    assert client.get(f"/api/albums/{uuid4()}/activity").json()["jobs"] == []
    assert client.get("/api/albums/x/activity").status_code == 422


def test_legacy_save_without_album_stays_compatible(api):
    client, fake, _ = api
    asset = fake.asset_id
    put_look(client, fake, LOOK)
    put_config(client, fake, asset, LOOK)
    legacy = client.put(f"/api/assets/{asset}/config", json={"expectedRevision": 1, "config": with_margin(LOOK, 10)})
    assert legacy.status_code == 200 and set(legacy.json()) == {"revision", "config"}
    assert set(client.get(f"/api/assets/{asset}/config").json()) == {"revision", "config"}
    view = client.get(f"/api/assets/{asset}/config", params={"album": fake.source_album_id}).json()
    assert view["mode"] == "standalone" and view["overrides"] == ["canvas/margins/bottom"]
    assert view["resolved"] == view["saved"] and view["stale"] is False


def test_migration_v1_to_v2_keeps_configs_as_standalone(album_setup):
    settings, fake = album_setup
    service = Service(settings, fake)
    config = with_margin(LOOK, 30)
    service.save(fake.asset_id, deepcopy(config), 0)
    job = service.enqueue(fake.asset_id, 1)
    service.store.close()
    db_path = settings.data / "immich-ki.db"
    with sqlite3.connect(db_path) as db:
        db.executescript(
            """
            DROP TRIGGER jobs_touch; DROP TABLE album_looks; DROP TABLE asset_looks; DROP TABLE drafts;
            DROP TABLE render_batches; DROP INDEX job_albums_album; DROP INDEX jobs_asset_generation;
            PRAGMA user_version=1;
            """
        )
    db.close()
    service = Service(settings, fake)
    try:
        assert service.store.db.execute("PRAGMA user_version").fetchone()[0] == 2
        assert service.config(fake.asset_id)["revision"] == 1
        assert service.store.job(job["id"])["state"] == "queued"
        view = service.looks.view(fake.asset_id, fake.source_album_id)
        assert view["mode"] == "standalone" and view["saved"]["canvas"]["margins"]["bottom"] == 30
        assert view["look"] is None and view["stale"] is False and view["overrides"] == []
        # The trigger is back: state changes refresh `updated`.
        service.store.db.execute("UPDATE jobs SET updated='2000-01-01 00:00:00'")
        service.store.db.execute("UPDATE jobs SET state='failed'")
        assert service.store.job(job["id"])["updated"] > "2000-01-01 00:00:00"
    finally:
        service.store.close()
    with sqlite3.connect(db_path) as db:
        db.execute("PRAGMA user_version=3")
    db.close()
    with pytest.raises(ValueError, match="unsupported_database_version"):
        Service(settings, fake)


def test_gc_keeps_resources_referenced_by_looks_and_drafts(api):
    client, fake, service = api
    import os

    names = []
    for _ in range(2):
        response = client.post("/api/resources", files={"file": ("s.png", _png(), "image/png")})
        names.append(response.json()["resourceId"])
    look = deepcopy(LOOK)
    look["regions"].append(_signature(names[0]))
    put_look(client, fake, look)
    draft = deepcopy(LOOK)
    draft["regions"].append(_signature(names[1]))
    assert client.put(
        f"/api/assets/{fake.asset_id}/draft", json={"config": draft, "album": fake.source_album_id}
    ).status_code == 200
    for name in names:
        os.utime(service.resources / name, (0, 0))
    service.maintenance.gc()
    assert all((service.resources / name).exists() for name in names)


def _png():
    from io import BytesIO

    data = BytesIO()
    Image.new("RGBA", (20, 10), "black").save(data, format="PNG")
    return data.getvalue()


def _signature(name):
    return {
        "id": "sig",
        "type": "free",
        "enabled": True,
        "slots": {"sig1": {"enabled": True, "content": {"path": name, "invert_mono": False}}},
    }
