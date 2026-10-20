"""Album looks, per-photo exceptions, drafts, batch renders and album activity.

The rendering pipeline is untouched: ``configs`` still stores the resolved,
saved config of every photo.  This module only decides *which* config to
save (look + patch) and reports how saved results relate to the current look.
"""

from __future__ import annotations

import hashlib
import json
import threading
import time
from dataclasses import dataclass

from immich_ki.client import UpstreamError
from immich_ki.look import apply, diff, overrides
from immich_ki.paths import relative_path
from immich_ki.store import canonical
from immich_ki.workspace import StorageUnavailable

ACTIVE = ("queued", "running", "publishing", "awaiting_import", "refresh_pending")
STATES = ("none", "draft", "busy", "done", "stale", "failed")
SCOPES = ("pending", "stale", "failed", "all", "ids")
CHUNK = 500
# Codes a batch item may report; anything else collapses to enqueue_failed.
BATCH_ERRORS = {
    "not_source_asset", "asset_not_in_album", "result_album_read_only", "insufficient_disk_space",
    "file_too_large", "unsafe_path", "unsupported_path", "not_regular_file", "source_changed",
    "source_unavailable", "not_configured", "revision_conflict", "path_conflict", "look_required",
    "look_conflict", "invalid_resource",
}


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _iso(value):
    # SQLite CURRENT_TIMESTAMP is UTC "YYYY-MM-DD HH:MM:SS".
    return value.replace(" ", "T") + "Z" if value else None


def _chunks(values):
    values = list(values)
    for start in range(0, len(values), CHUNK):
        yield values[start:start + CHUNK]


@dataclass(frozen=True)
class Resolution:
    encoded: str
    hash: str
    conflict: bool
    dropped: tuple

    @property
    def config(self):
        return json.loads(self.encoded)


class AlbumLooks:
    SUMMARY_TTL = 10.0
    CACHE_LIMIT = 1024

    def __init__(self, service, *, clock=time.monotonic):
        self.service, self.store, self.clock = service, service.store, clock
        self.cache_lock = threading.Lock()
        self.resolutions: dict[tuple[str, str], Resolution] = {}
        self.summaries: dict[str, tuple[float, str, str]] = {}

    # ── caches ────────────────────────────────────────────────────────────

    def invalidate(self):
        with self.cache_lock:
            self.summaries.clear()

    def resolve(self, look, patch_text):
        """Resolved config for ``look`` row + stored patch, with conflict fallback."""
        if patch_text is None:
            return Resolution(look["config"], look["hash"], False, ())
        key = (look["hash"], patch_text)
        with self.cache_lock:
            hit = self.resolutions.get(key)
        if hit is not None:
            return hit
        config, dropped = apply(json.loads(look["config"]), json.loads(patch_text))
        cacheable = True
        try:
            encoded = canonical(self.service.validate(config))
            result = Resolution(encoded, _sha(encoded), False, tuple(dropped))
        except ValueError:
            result = Resolution(look["config"], look["hash"], True, tuple(dropped))
        except OSError:
            # A missing resource may be transient; never cache that outcome.
            cacheable = False
            result = Resolution(look["config"], look["hash"], True, tuple(dropped))
        if cacheable:
            with self.cache_lock:
                if len(self.resolutions) >= self.CACHE_LIMIT:
                    self.resolutions.pop(next(iter(self.resolutions)))
                self.resolutions[key] = result
        return result

    # ── album look ────────────────────────────────────────────────────────

    @staticmethod
    def _look(db, album_id):
        row = db.execute("SELECT revision, config, hash FROM album_looks WHERE album_id=?", (album_id,)).fetchone()
        return dict(row) if row else None

    def get_look(self, album_id):
        with self.store.transaction() as db:
            look = self._look(db, album_id)
        return {"revision": look["revision"], "config": json.loads(look["config"])} if look else {
            "revision": 0, "config": None}

    def save_look(self, album_id, config, expected):
        encoded = canonical(self.service.validate(config))
        digest = _sha(encoded)
        with self.store.transaction() as db:
            look = self._look(db, album_id)
            current = look["revision"] if look else 0
            if current != expected:
                from immich_ki.service import Conflict

                raise Conflict("revision_conflict")
            revision = current
            if look is None or look["hash"] != digest:
                revision = current + 1
                db.execute(
                    "INSERT OR REPLACE INTO album_looks(album_id,revision,config,hash,updated) "
                    "VALUES(?,?,?,?,CURRENT_TIMESTAMP)",
                    (album_id, revision, encoded, digest),
                )
            bound = [r[0] for r in db.execute("SELECT asset_id FROM asset_looks WHERE album_id=?", (album_id,))]
        self.invalidate()
        rows = self._rows(bound)
        impact = {
            "follow": sum(1 for r in rows.values() if r["bound"] and r["patch"] is None),
            "exceptions": sum(1 for r in rows.values() if r["bound"] and r["patch"] is not None),
            "stale": sum(1 for r in rows.values() if r["outdated"]),
        }
        return {"revision": revision, "config": json.loads(encoded), "impact": impact}

    # ── per-photo view ────────────────────────────────────────────────────

    def view(self, asset_id, album_id):
        with self.store.transaction() as db:
            asset = db.execute("SELECT revision FROM assets WHERE id=?", (asset_id,)).fetchone()
            saved = db.execute(
                "SELECT c.config, c.hash FROM configs c JOIN assets a ON a.id=c.asset_id AND a.revision=c.revision "
                "WHERE a.id=?",
                (asset_id,),
            ).fetchone()
            binding = db.execute("SELECT album_id, patch FROM asset_looks WHERE asset_id=?", (asset_id,)).fetchone()
            draft = db.execute("SELECT config FROM drafts WHERE asset_id=?", (asset_id,)).fetchone()
            look = self._look(db, album_id)
        saved_config = json.loads(saved["config"]) if saved else None
        result = {
            "revision": asset["revision"] if asset else 0,
            "saved": saved_config,
            "look": {"revision": look["revision"], "config": json.loads(look["config"])} if look else None,
            "mode": "follow",
            "overrides": [],
            "resolved": None,
            "draft": json.loads(draft["config"]) if draft else None,
            "stale": False,
            "conflict": False,
            "dropped": [],
        }
        if binding is not None and binding["album_id"] == album_id and look is not None:
            resolution = self.resolve(look, binding["patch"])
            result.update(
                mode="follow" if binding["patch"] is None else "exception",
                overrides=overrides(json.loads(binding["patch"])) if binding["patch"] else [],
                resolved=resolution.config,
                # Same rule as the gallery: the look/exception changed, or a newer
                # saved revision has not been rendered yet (e.g. after "follow").
                stale=(saved is not None and saved["hash"] != resolution.hash) or self._rows([asset_id])[asset_id]["outdated"],
                conflict=resolution.conflict,
                dropped=list(resolution.dropped),
            )
        elif saved_config is not None:
            # Legacy configs (or a binding to another album) are their own base.
            result.update(
                mode="standalone",
                resolved=saved_config,
                overrides=overrides(diff(result["look"]["config"], saved_config)) if look else [],
            )
        elif look is not None:
            result["resolved"] = result["look"]["config"]
        return result

    def _require_look(self, db, album_id):
        look = self._look(db, album_id)
        if look is None:
            raise ValueError("look_required")
        return look

    def save_asset(self, asset_id, album_id, path, config, expected):
        with self.store.transaction() as db:
            self._require_look(db, album_id)
        encoded = canonical(self.service.validate(config))
        validated = json.loads(encoded)
        with self.store.transaction() as db:
            look = self._require_look(db, album_id)
            patch = diff(json.loads(look["config"]), validated)
            self.service.store_config(db, asset_id, path, encoded, expected)
            self._bind(db, asset_id, album_id, canonical(patch) if patch else None)
            db.execute("DELETE FROM drafts WHERE asset_id=?", (asset_id,))
        self.invalidate()
        return self.view(asset_id, album_id)

    def follow(self, asset_id, album_id, path, expected):
        with self.store.transaction() as db:
            look = self._require_look(db, album_id)
            self.service.store_config(db, asset_id, path, look["config"], expected)
            self._bind(db, asset_id, album_id, None)
            db.execute("DELETE FROM drafts WHERE asset_id=?", (asset_id,))
        self.invalidate()
        return self.view(asset_id, album_id)

    @staticmethod
    def _bind(db, asset_id, album_id, patch_text):
        db.execute(
            "INSERT OR REPLACE INTO asset_looks(asset_id,album_id,patch) VALUES(?,?,?)",
            (asset_id, album_id, patch_text),
        )

    def put_draft(self, asset_id, album_id, config):
        encoded = canonical(self.service.validate(config))
        with self.store.transaction() as db:
            db.execute(
                "INSERT OR REPLACE INTO drafts(asset_id,config,updated) VALUES(?,?,CURRENT_TIMESTAMP)",
                (asset_id, encoded),
            )
        self.invalidate()
        return self.view(asset_id, album_id)

    def delete_draft(self, asset_id):
        with self.store.transaction() as db:
            db.execute("DELETE FROM drafts WHERE asset_id=?", (asset_id,))
        self.invalidate()

    # ── status ────────────────────────────────────────────────────────────

    def _rows(self, asset_ids):
        """Raw per-asset facts with the derived state; DB only, bulk queries."""
        ids = list(dict.fromkeys(asset_ids))
        assets, saved, jobs, bindings, drafts, batches, looks = {}, {}, {}, {}, set(), {}, {}
        with self.store.transaction() as db:
            for chunk in _chunks(ids):
                marks = ",".join("?" * len(chunk))
                for r in db.execute(
                    f"SELECT id, revision, published_hash FROM assets WHERE id IN ({marks})", chunk
                ):
                    assets[r["id"]] = r
                for r in db.execute(
                    "SELECT c.asset_id, c.hash FROM configs c JOIN assets a ON a.id=c.asset_id "
                    f"AND a.revision=c.revision WHERE a.id IN ({marks})",
                    chunk,
                ):
                    saved[r["asset_id"]] = r["hash"]
                for r in db.execute(
                    "SELECT j.asset_id, j.state, j.revision FROM jobs j JOIN assets a ON a.id=j.asset_id "
                    f"AND a.generation=j.generation WHERE a.id IN ({marks})",
                    chunk,
                ):
                    jobs[r["asset_id"]] = r
                for r in db.execute(f"SELECT asset_id, album_id, patch FROM asset_looks WHERE asset_id IN ({marks})", chunk):
                    bindings[r["asset_id"]] = r
                drafts.update(r[0] for r in db.execute(f"SELECT asset_id FROM drafts WHERE asset_id IN ({marks})", chunk))
                for r in db.execute(f"SELECT asset_id, error FROM render_batches WHERE asset_id IN ({marks})", chunk):
                    batches[r["asset_id"]] = r["error"]
            for album_id in {b["album_id"] for b in bindings.values()}:
                look = self._look(db, album_id)
                if look:
                    looks[album_id] = look
        rows = {}
        for asset_id in ids:
            asset, job, binding = assets.get(asset_id), jobs.get(asset_id), bindings.get(asset_id)
            look = looks.get(binding["album_id"]) if binding else None
            published = bool(asset and asset["published_hash"] is not None)
            saved_hash = saved.get(asset_id)
            look_changed = bool(
                look and saved_hash and self.resolve(look, binding["patch"]).hash != saved_hash
            )
            outdated = published and (look_changed or (job is not None and job["revision"] != asset["revision"]))
            job_state = job["state"] if job else None
            batch_waiting = asset_id in batches and batches[asset_id] is None
            if job_state in ACTIVE or batch_waiting:
                state = "busy"
            elif job_state == "failed" or batches.get(asset_id):
                state = "failed"
            elif asset_id in drafts:
                state = "draft"
            elif outdated:
                state = "stale"
            elif published and job_state == "done":
                state = "done"
            else:
                state = "none"
            configured = bool(asset and asset["revision"] > 0)
            rows[asset_id] = {
                "configured": configured,
                "job": job_state,
                "published": published,
                "state": state,
                "exception": (binding["patch"] is not None) if binding else configured,
                "draft": asset_id in drafts,
                "bound": binding is not None,
                "patch": binding["patch"] if binding else None,
                "outdated": outdated,
                "saved_hash": saved_hash,
            }
        return rows

    def statuses(self, asset_ids):
        public = ("configured", "job", "published", "state", "exception", "draft")
        return {k: {f: v[f] for f in public} for k, v in self._rows(asset_ids).items()}

    def _activity_signature(self):
        """Cheap fingerprint of everything that changes a photo's state."""
        with self.store.transaction() as db:
            # updated has 1 s resolution; a per-state weight (its distinct offset in
            # this list) catches transitions within the same second.
            jobs = db.execute(
                "SELECT COUNT(*), MAX(updated), MAX(rowid), SUM(instr("
                "'|queued|running|publishing|awaiting_import|refresh_pending|done|failed|superseded|', '|' || state || '|'"
                ")) FROM jobs"
            ).fetchone()
            other = db.execute(
                "SELECT (SELECT COUNT(*) FROM drafts), (SELECT MAX(updated) FROM drafts), "
                "(SELECT COUNT(*) FROM render_batches), (SELECT MAX(updated) FROM render_batches)"
            ).fetchone()
        return json.dumps([list(jobs), list(other)], default=str)

    def summary(self, album_id, list_assets):
        now = self.clock()
        # Job state changes in the worker loop do not call invalidate(); the
        # signature makes a finished render visible immediately instead of
        # after the TTL (the cache then only saves the Immich album listing).
        signature = self._activity_signature()
        with self.cache_lock:
            hit = self.summaries.get(album_id)
            if hit and hit[0] > now and hit[2] == signature:
                return json.loads(hit[1])
        items = list_assets()
        rows = self._rows(a["id"] for a in items)
        counts = dict.fromkeys(STATES, 0)
        for row in rows.values():
            counts[row["state"]] += 1
        with self.store.transaction() as db:
            look = self._look(db, album_id)
        result = {
            "total": len(rows),
            "counts": counts,
            "exceptions": sum(1 for r in rows.values() if r["exception"]),
            "look": {"revision": look["revision"]} if look else None,
        }
        with self.cache_lock:
            self.summaries[album_id] = (now + self.SUMMARY_TTL, json.dumps(result), signature)
        return result

    # ── batch render ──────────────────────────────────────────────────────

    def queue(self, album_id, scope, asset_ids, items):
        from immich_ki.service import Conflict

        settings = self.service.settings
        by_id = {a["id"]: a for a in items}
        errors = []
        if scope == "ids":
            targets = []
            for asset_id in asset_ids:
                if asset_id in by_id:
                    targets.append(asset_id)
                else:
                    errors.append({"assetId": asset_id, "error": "asset_not_in_album"})
        else:
            targets = list(by_id)
        rows = self._rows(targets)
        wanted = {"pending": {"none"}, "stale": {"stale"}, "failed": {"failed"}}.get(scope)
        queued = up_to_date = drafts = 0
        for asset_id in targets:
            row = rows[asset_id]
            if wanted is not None and row["state"] not in wanted:
                continue
            if row["draft"]:
                drafts += 1
                continue
            try:
                path = relative_path(by_id[asset_id]["originalPath"], settings.source_prefix)
                if self._queue_one(asset_id, album_id, path, row):
                    queued += 1
                else:
                    up_to_date += 1
            except (ValueError, KeyError, Conflict) as exc:
                errors.append({"assetId": asset_id, "error": self._code(exc)})
        self.invalidate()
        return {"queued": queued, "skipped": {"upToDate": up_to_date, "drafts": drafts, "errors": errors}}

    @staticmethod
    def _code(exc):
        code = str(exc)
        return code if code in BATCH_ERRORS else "enqueue_failed"

    def _queue_one(self, asset_id, album_id, path, row):
        """Save the resolved config (if changed) and add the photo to the batch.

        Returns False when the saved config is already current and the output
        is done or in progress.
        """
        with self.store.transaction() as db:
            look = self._look(db, album_id)
            asset = db.execute("SELECT revision FROM assets WHERE id=?", (asset_id,)).fetchone()
            saved = db.execute(
                "SELECT c.config FROM configs c JOIN assets a ON a.id=c.asset_id AND a.revision=c.revision "
                "WHERE a.id=?",
                (asset_id,),
            ).fetchone()
            binding = db.execute("SELECT album_id, patch FROM asset_looks WHERE asset_id=?", (asset_id,)).fetchone()
        bind = False
        if binding is not None and binding["album_id"] == album_id and look is not None:
            resolution = self.resolve(look, binding["patch"])
            if resolution.conflict:
                raise ValueError("look_conflict")
            encoded = resolution.encoded
        elif saved is not None:
            encoded = saved["config"]  # Standalone: render what was saved.
        elif look is not None:
            encoded, bind = look["config"], True
        else:
            raise ValueError("look_required")
        if row["saved_hash"] == _sha(encoded) and row["state"] in {"done", "busy"}:
            return False
        with self.store.transaction() as db:
            current = db.execute("SELECT revision FROM assets WHERE id=?", (asset_id,)).fetchone()
            if (current["revision"] if current else 0) != (asset["revision"] if asset else 0):
                from immich_ki.service import Conflict

                raise Conflict("revision_conflict")
            self.service.store_config(db, asset_id, path, encoded, current["revision"] if current else 0)
            if bind:
                self._bind(db, asset_id, album_id, None)
            db.execute(
                "INSERT OR REPLACE INTO render_batches(asset_id,album_id,created,error,updated) "
                "VALUES(?,?,CURRENT_TIMESTAMP,NULL,CURRENT_TIMESTAMP)",
                (asset_id, album_id),
            )
        return True

    def _fail(self, asset_id, code):
        with self.store.transaction() as db:
            db.execute(
                "UPDATE render_batches SET error=?, updated=CURRENT_TIMESTAMP WHERE asset_id=?",
                (code if code in BATCH_ERRORS else "enqueue_failed", asset_id),
            )
        self.invalidate()

    def feed(self, limit=4):
        """Move waiting batch items into the render queue while it has room.

        Returns the number of jobs created.  Per-item failures are recorded on
        the batch row; transient Immich/storage failures propagate (the row
        stays waiting) so the worker loop backs off.
        """
        from immich_ki.service import Conflict

        created = 0
        for _ in range(limit):
            with self.store.transaction() as db:
                pending = db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running')").fetchone()[0]
                if pending >= self.service.settings.max_queue:
                    return created
                row = db.execute(
                    "SELECT asset_id, album_id FROM render_batches WHERE error IS NULL ORDER BY rowid LIMIT 1"
                ).fetchone()
                if row is None:
                    return created
                asset = db.execute("SELECT revision FROM assets WHERE id=?", (row["asset_id"],)).fetchone()
            asset_id, album_id = row["asset_id"], row["album_id"]
            if asset is None or asset["revision"] == 0:
                self._fail(asset_id, "not_configured")
                continue
            try:
                self.service.enqueue(asset_id, asset["revision"], album_id)
                created += 1
            except Conflict as exc:
                if str(exc) == "queue_full":
                    return created
                if str(exc) == "revision_conflict":
                    with self.store.transaction() as db:
                        now = db.execute("SELECT revision FROM assets WHERE id=?", (asset_id,)).fetchone()
                    if now and now["revision"] != asset["revision"]:
                        continue  # A newer save landed; retry with it.
                self._fail(asset_id, str(exc))
            except StorageUnavailable:
                raise
            except UpstreamError as exc:
                if exc.status != 404:
                    raise
                self._fail(asset_id, "source_unavailable")
            except FileNotFoundError:
                self._fail(asset_id, "source_unavailable")
            except ValueError as exc:
                self._fail(asset_id, str(exc))
        return created

    # ── activity ──────────────────────────────────────────────────────────

    def activity(self, album_id):
        marks = ",".join("?" * len(ACTIVE))
        with self.store.transaction() as db:
            jobs = db.execute(
                "SELECT j.id, j.asset_id, j.state, j.error, j.generation, j.updated FROM jobs j "
                "JOIN assets a ON a.id=j.asset_id AND a.generation=j.generation "
                "WHERE (j.id IN (SELECT job_id FROM job_albums WHERE source_album_id=?) "
                "OR j.asset_id IN (SELECT asset_id FROM asset_looks WHERE album_id=?)) "
                f"AND (j.state IN ({marks}) OR j.updated >= datetime('now','-15 minutes')) "
                "ORDER BY j.updated DESC, j.rowid DESC LIMIT 500",
                (album_id, album_id, *ACTIVE),
            ).fetchall()
            failures = db.execute(
                "SELECT asset_id, error, updated FROM render_batches WHERE album_id=? AND error IS NOT NULL "
                "AND updated >= datetime('now','-15 minutes') ORDER BY rowid LIMIT 500",
                (album_id,),
            ).fetchall()
            waiting = [
                r[0]
                for r in db.execute(
                    "SELECT asset_id FROM render_batches WHERE album_id=? AND error IS NULL ORDER BY rowid",
                    (album_id,),
                )
            ]
        entries = {}
        for j in jobs:
            entries[j["asset_id"]] = {
                "assetId": j["asset_id"], "id": j["id"], "state": j["state"], "error": j["error"],
                "generation": j["generation"], "updated": _iso(j["updated"]),
            }
        for f in failures:
            job = entries.get(f["asset_id"])
            if job is None or (job["state"] not in ACTIVE and _iso(f["updated"]) >= job["updated"]):
                entries[f["asset_id"]] = {
                    "assetId": f["asset_id"], "id": None, "state": "failed", "error": f["error"],
                    "generation": None, "updated": _iso(f["updated"]),
                }
        for asset_id in waiting:
            entry = entries.get(asset_id)
            if entry is not None and entry["state"] not in ACTIVE:
                del entries[asset_id]  # Waiting supersedes an older finished job.
        ordered = sorted(entries.values(), key=lambda e: e["updated"] or "", reverse=True)
        return {"jobs": ordered, "waiting": len(waiting), "waitingAssetIds": waiting[:500]}
