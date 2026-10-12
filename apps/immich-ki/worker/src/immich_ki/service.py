from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import kari_core.processor  # noqa: F401 - register processors
from api.schemas import ImprintPayload
from kari_core.core.output_metadata import load_photograph
from kari_core.core.util import get_exif
from kari_core.shared.render_values import resolve_field_values
from loguru import logger
from PIL import Image

from immich_ki.client import UpstreamError
from immich_ki.logos import bundle_hash
from immich_ki.logos import resolve as resolve_logo
from immich_ki.paths import digest_file, open_source, output_relative, parent_fd, relative_path, snapshot
from immich_ki.store import Store, canonical
from immich_ki.workspace import StorageUnavailable, workspace

# Existing core diagnostics include EXIF dictionaries and source paths.
logger.disable('kari_core')


def sha(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _code_fingerprint() -> str:
    """Hash the render-critical kari_core modules so renderer_version moves
    whenever layout or rendering code changes, not only when logos change."""
    from kari_core.processor import kari_imprint, renderer
    from kari_core.shared.layout import layout_engine
    digest = hashlib.sha256()
    for module in (layout_engine, renderer, kari_imprint):
        path = Path(module.__file__)
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:16]


class Conflict(Exception):
    pass


class Service:
    def __init__(self, settings, client):
        self.settings, self.client = settings, client
        self.logo_version = bundle_hash()
        self.sync_lock = threading.Lock()
        self.decode_lock = threading.Lock()
        self.metadata_lock = threading.Lock()
        self.metadata_cache = {}
        self.recovery_needed = True
        if not settings.imports.is_dir():
            raise ValueError('missing_mount')
        self.store = Store(settings.data)
        from immich_ki.albums import AlbumCoordinator
        self.albums = AlbumCoordinator(self.store, client)
        self.tmp = settings.output / '.ki-tmp'
        self.metadata_tmp = workspace(settings.data, 'metadata-tmp', code='workspace_unavailable')
        self.resources = settings.data / 'resources'
        self.resources.mkdir(exist_ok=True, mode=0o700)
        try:
            self.ensure_output()
            self.recover()
        except StorageUnavailable:
            # Read-only editing remains available while the output mount recovers.
            pass
        from immich_ki.maintenance import Maintenance
        self.maintenance = Maintenance(self)

    def ensure_output(self):
        try:
            workspace(self.settings.output, '.ki-tmp', code='output_unavailable', check_parent=True)
        except StorageUnavailable:
            self.recovery_needed = True
            raise

    @property
    def renderer_version(self):
        return (self.settings.renderer_version + '-impl-' + _code_fingerprint()
                + '-logos-' + self.logo_version)

    def source(self, asset_id):
        asset = self.client.asset(asset_id)
        if asset.get('libraryId') != self.settings.source_library or asset.get('type') != 'IMAGE' or asset.get('isTrashed') or asset.get('isOffline'):
            raise ValueError('not_source_asset')
        path = relative_path(asset['originalPath'], self.settings.source_prefix)
        reserved = self.settings.reserved_output
        if reserved and (path == reserved or path.startswith(reserved + '/')):
            raise ValueError('not_source_asset')
        return asset, path

    def config(self, asset_id):
        with self.store.transaction() as db:
            row = db.execute('SELECT c.* FROM configs c JOIN assets a ON a.id=c.asset_id AND a.revision=c.revision WHERE a.id=?', (asset_id,)).fetchone()
            return {'revision': row['revision'], 'config': json.loads(row['config'])} if row else {'revision': 0, 'config': None}

    def validate(self, config):
        # Reuse the existing strict schema, without accepting its legacy coercion
        # of schema_version. M0 only accepts canonical v3 inputs.
        if type(config.get('schema_version')) is not int or config['schema_version'] != 3:
            raise ValueError('canonical_v3_required')
        config = ImprintPayload.model_validate(deepcopy(config)).model_dump()
        # Single-frame contract: the UI forbids adding a second frame region;
        # the backend enforces the same rule on save so legacy multi-layer
        # payloads cannot be re-published through the API.
        frames = [r for r in config['regions']
                  if r.get('enabled') and r.get('type') in {'footer-bar', 'side-bar'}]
        if len(frames) > 1:
            raise ValueError('single_frame_only')
        for region in config['regions']:
            for slot in region['slots'].values():
                content = slot.get('content') or {}
                resource = content.get('path', '')
                if resource.startswith('builtin:'):
                    resolve_logo(resource.split(':', 1)[1])
                elif resource:
                    with open_source(self.resources, resource) as file:
                        digest_file(file, 10 * 1024 * 1024)
        return config

    def save(self, asset_id, config, expected):
        _, path = self.source(asset_id)
        encoded = canonical(self.validate(config))
        with self.store.transaction() as db:
            db.execute('INSERT OR IGNORE INTO assets(id,path) VALUES(?,?)', (asset_id, path))
            asset = db.execute('SELECT * FROM assets WHERE id=?', (asset_id,)).fetchone()
            if asset is None or asset['path'] != path:
                raise Conflict('path_conflict')
            if asset['revision'] != expected:
                raise Conflict('revision_conflict')
            revision = expected + 1
            db.execute('INSERT INTO configs(asset_id,revision,config,hash) VALUES(?,?,?,?)', (asset_id, revision, encoded, sha(encoded)))
            db.execute('UPDATE assets SET revision=? WHERE id=?', (revision, asset_id))
        return {'revision': revision, 'config': json.loads(encoded)}

    def enqueue(self, asset_id, revision, source_album_id=None):
        if source_album_id is not None:
            self.albums.source(source_album_id, asset_id)
        self.ensure_output()
        self.maintenance.require_space(3 * self.settings.max_bytes)
        _, path = self.source(asset_id)
        job_id = uuid4().hex
        directory = self.tmp / job_id
        directory.mkdir(mode=0o700)
        try:
            source_hash = snapshot(self.settings.imports, path, directory / ('source' + Path(path).suffix), self.settings.max_bytes)
            with self.store.transaction() as db:
                asset = db.execute('SELECT * FROM assets WHERE id=?', (asset_id,)).fetchone()
                if asset is None or asset['revision'] != revision or asset['path'] != path:
                    raise Conflict('revision_conflict')
                config = db.execute('SELECT * FROM configs WHERE asset_id=? AND revision=?', (asset_id, revision)).fetchone()
                resources = {}
                (directory / 'resources').mkdir()
                for region in json.loads(config['config'])['regions']:
                    for slot in region['slots'].values():
                        name = (slot.get('content') or {}).get('path', '')
                        if name and not name.startswith('builtin:') and name not in resources:
                            resources[name] = snapshot(self.resources, name, directory / 'resources' / name, 10 * 1024 * 1024)
                key = sha(canonical([config['hash'], source_hash, resources, self.renderer_version, source_album_id]))
                active = db.execute("SELECT id FROM jobs WHERE asset_id=? AND generation=? AND revision=? AND render_key=? AND state IN ('queued','running')", (asset_id, asset['generation'], revision, key)).fetchone()
                if active:
                    shutil.rmtree(directory, ignore_errors=True)
                    return self.store.job(active['id'])
                if db.execute("SELECT COUNT(*) FROM jobs WHERE state IN ('queued','running')").fetchone()[0] >= self.settings.max_queue:
                    raise Conflict('queue_full')
                generation = asset['generation'] + 1
                db.execute('UPDATE assets SET generation=? WHERE id=?', (generation, asset_id))
                db.execute('INSERT INTO jobs(id,asset_id,revision,generation,source_hash,render_key,renderer,state) VALUES(?,?,?,?,?,?,?,?)', (job_id, asset_id, revision, generation, source_hash, key, self.renderer_version, 'queued'))
                if source_album_id is not None:
                    db.execute('INSERT INTO job_albums(job_id,source_album_id) VALUES(?,?)', (job_id, source_album_id))
            return self.store.job(job_id)
        except Exception:
            shutil.rmtree(directory, ignore_errors=True)
            raise

    def _current(self, db, job):
        asset = db.execute('SELECT * FROM assets WHERE id=?', (job['asset_id'],)).fetchone()
        return asset, asset['revision'] == job['revision'] and asset['generation'] == job['generation']

    def render_next(self):
        self.ensure_output()
        with self.decode_lock:
            if self.recovery_needed:
                self.recover()
            return self._render_next()

    def _render_next(self):
        with self.store.transaction() as db:
            row = db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY rowid LIMIT 1").fetchone()
            if row is None:
                return None
            job = dict(row)
            asset, current = self._current(db, job)
            if not current:
                db.execute("UPDATE jobs SET state='superseded' WHERE id=?", (job['id'],))
                shutil.rmtree(self.tmp / job['id'], ignore_errors=True)
                return job['id']
            config = json.loads(db.execute('SELECT config FROM configs WHERE asset_id=? AND revision=?', (job['asset_id'], job['revision'])).fetchone()[0])
            db.execute("UPDATE jobs SET state='running', attempts=attempts+1 WHERE id=?", (job['id'],))
        directory = self.tmp / job['id']
        try:
            if job['renderer'] != self.renderer_version:
                raise ValueError('renderer_changed')
            source = directory / ('source' + Path(asset['path']).suffix)
            target = directory / ('result' + Path(asset['path']).suffix)
            for region in config['regions']:
                for slot in region['slots'].values():
                    content = slot.get('content') or {}
                    name = content.get('path', '')
                    if name and not name.startswith('builtin:'):
                        content['path'] = str(directory / 'resources' / name)
            request = directory / 'render.json'
            request.write_text(canonical({'config': config, 'source': str(source), 'target': str(target),
                'maxPixels': self.settings.max_pixels, 'maxOutputPixels': self.settings.max_output_pixels,
                'maxOutputEdge': self.settings.max_output_edge}))
            subprocess.run([sys.executable, '-m', 'immich_ki.render', str(request)], check=True,
                           timeout=900, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            with Image.open(target) as image:
                if image.width * image.height > self.settings.max_output_pixels:
                    raise ValueError('output_too_large')
                image.verify()
            with target.open('rb') as file:
                output_hash = digest_file(file, self.settings.max_bytes)
                os.fsync(file.fileno())
            with self.store.transaction() as db:
                asset, current = self._current(db, job)
                if not current:
                    db.execute("UPDATE jobs SET state='superseded' WHERE id=?", (job['id'],))
                    return job['id']
                with open_source(self.settings.imports, asset['path']) as file:
                    if digest_file(file, self.settings.max_bytes) != job['source_hash']:
                        raise Conflict('source_changed')
                previous = self._output_hash(asset['path'])
                if previous != asset['published_hash']:
                    raise Conflict('output_conflict')
                db.execute("UPDATE jobs SET state='publishing',output_hash=?,previous_hash=? WHERE id=?", (output_hash, previous, job['id']))
            # Keep the same process mutex across the committed intent, file rename
            # and final DB write; save/enqueue acquire this lock as well.
            self.publish(job['id'])
        except Exception as exc:
            with self.store.transaction() as db:
                state = db.execute('SELECT state FROM jobs WHERE id=?', (job['id'],)).fetchone()[0]
                if state == 'publishing':
                    self.recovery_needed = True
                else:
                    code = str(exc) if isinstance(exc, (Conflict, ValueError)) and str(exc) in {'source_changed','output_conflict','output_too_large','renderer_changed'} else 'render_failed'
                    db.execute("UPDATE jobs SET state='failed',error=? WHERE id=?", (code, job['id']))
        finally:
            if self.store.job(job['id'])['state'] not in {'queued', 'running', 'publishing'}:
                shutil.rmtree(directory, ignore_errors=True)
        return job['id']

    def _output_hash(self, source_path):
        try:
            with open_source(self.settings.output, output_relative(source_path, self.settings.imprint_dir)) as file:
                return digest_file(file, self.settings.max_bytes)
        except FileNotFoundError:
            return None

    def publish(self, job_id):
        with self.store.lock:
            job = self.store.job(job_id)
            with self.store.transaction() as db:
                asset, current = self._current(db, job)
                actual = self._output_hash(asset['path'])
                if actual == job['output_hash']:
                    db.execute('UPDATE assets SET published_hash=? WHERE id=?', (actual, asset['id']))
                    db.execute("UPDATE jobs SET state='awaiting_import' WHERE id=?", (job_id,))
                    return
                if not current:
                    db.execute("UPDATE jobs SET state='superseded' WHERE id=?", (job_id,))
                    return
                if actual != job['previous_hash']:
                    db.execute("UPDATE jobs SET state='failed',error='output_conflict' WHERE id=?", (job_id,))
                    return
                with open_source(self.settings.imports, asset['path']) as file:
                    if digest_file(file, self.settings.max_bytes) != job['source_hash']:
                        db.execute("UPDATE jobs SET state='failed',error='source_changed' WHERE id=?", (job_id,))
                        return
                temp = self.tmp / job_id / ('result' + Path(asset['path']).suffix)
                with temp.open('rb') as file:
                    if digest_file(file, self.settings.max_bytes) != job['output_hash']:
                        raise ValueError('invalid_publication')
                with parent_fd(self.settings.output, output_relative(asset['path'], self.settings.imprint_dir), create=True) as (fd, name):
                    os.replace(temp, name, dst_dir_fd=fd)
                    os.fsync(fd)
                db.execute('UPDATE assets SET published_hash=? WHERE id=?', (job['output_hash'], asset['id']))
                db.execute("UPDATE jobs SET state='awaiting_import' WHERE id=?", (job_id,))

    def recover(self):
        with self.store.transaction() as db:
            publishing = [r[0] for r in db.execute("SELECT id FROM jobs WHERE state='publishing'")]
            db.execute("UPDATE jobs SET state='queued' WHERE state='running'")
        for job_id in publishing:
            try:
                self.publish(job_id)
            except FileNotFoundError:
                # A missing mount is retryable. Lost staged bytes on an available
                # mount are not: do not let one unrecoverable publication starve
                # every later job forever. Never touch the existing output.
                self.ensure_output()
                with self.store.transaction() as db:
                    db.execute("UPDATE jobs SET state='failed',error='publication_source_missing' WHERE id=? AND state='publishing'", (job_id,))
        self.recovery_needed = False

    def reconcile_next(self, now=None):
        """Persist retry deadlines before network IO; resume after restart."""
        now = time.time() if now is None else now
        with self.store.transaction() as db:
            row = db.execute("""SELECT j.id, COALESCE(s.attempts, 0) AS attempts
              FROM jobs j LEFT JOIN sync_schedule s ON s.job_id=j.id
              WHERE j.state IN ('awaiting_import','refresh_pending') AND COALESCE(s.next_at, 0)<=?
              ORDER BY COALESCE(s.next_at, 0), j.rowid LIMIT 1""", (now,)).fetchone()
            if row is None:
                return None
            attempt = row['attempts'] + 1
            db.execute('INSERT OR REPLACE INTO sync_schedule(job_id,attempts,next_at,error) VALUES(?,?,?,NULL)',
                       (row['id'], attempt, now + min(300, 5 * 2 ** min(attempt - 1, 6))))
        try:
            self.sync(row['id'])
        except (UpstreamError, Conflict, ValueError):
            with self.store.transaction() as db:
                db.execute("UPDATE sync_schedule SET error='sync_retry_pending' WHERE job_id=?", (row['id'],))
        return row['id']

    def latest_job(self, asset_id):
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM jobs WHERE asset_id=? ORDER BY generation DESC LIMIT 1', (asset_id,)).fetchone()
            return dict(row) if row else None

    def gallery_status(self, asset_ids):
        """Badge data for a gallery page; no paths or config contents exposed."""
        statuses = {}
        with self.store.transaction() as db:
            for asset_id in asset_ids:
                asset = db.execute('SELECT revision, generation, published_hash FROM assets WHERE id=?', (asset_id,)).fetchone()
                if asset is None:
                    statuses[asset_id] = {'configured': False, 'job': None, 'published': False}
                    continue
                job = db.execute('SELECT state FROM jobs WHERE asset_id=? ORDER BY generation DESC LIMIT 1', (asset_id,)).fetchone()
                statuses[asset_id] = {'configured': asset['revision'] > 0,
                                      'job': job['state'] if job else None,
                                      'published': asset['published_hash'] is not None}
        return statuses

    def output_preview(self, asset_id, generation):
        # Never serve bytes for a stale URL or a file changed outside this worker.
        with self.decode_lock, self.store.lock:
            job = self.latest_job(asset_id)
            if not job or job['generation'] != generation or job['state'] not in {'awaiting_import', 'refresh_pending', 'done'}:
                raise Conflict('output_not_current')
            asset = self.store.db.execute('SELECT * FROM assets WHERE id=?', (asset_id,)).fetchone()
            if asset['published_hash'] != job['output_hash']:
                raise Conflict('output_not_current')
            from io import BytesIO
            with open_source(self.settings.output, output_relative(asset['path'], self.settings.imprint_dir)) as file:
                if digest_file(file, self.settings.max_bytes) != job['output_hash']:
                    raise Conflict('output_conflict')
                file.seek(0)
                pixels, metadata = load_photograph(file, max_pixels=self.settings.max_output_pixels)
            try:
                pixels.thumbnail((self.settings.preview_edge, self.settings.preview_edge))
                result = BytesIO()
                pixels.save(result, format='JPEG', quality=90, icc_profile=metadata.icc_profile)
                return result.getvalue()
            finally:
                pixels.close()

    def sync(self, job_id):
        with self.sync_lock:
            return self._sync(job_id)

    def _sync(self, job_id):
        job = self.store.job(job_id)
        if job['state'] not in {'awaiting_import', 'refresh_pending'}:
            raise Conflict('not_published')
        with self.store.transaction() as db:
            asset, current = self._current(db, job)
            if not current:
                db.execute("UPDATE jobs SET state='superseded' WHERE id=?", (job_id,))
                return self.store.job(job_id)
            path = self.settings.output_prefix.rstrip('/') + '/' + output_relative(asset['path'], self.settings.imprint_dir)
        matches = []
        for page in range(1, 11):
            result = self.client.search(self.settings.output_library, page, path=path)
            matches.extend(a for a in result['items'] if a.get('libraryId') == self.settings.output_library and a.get('originalPath') == path)
            if not result.get('nextPage'):
                break
        if not matches:
            return job
        if len(matches) != 1:
            raise Conflict('ambiguous_output')
        output_id = matches[0]['id']
        with self.store.transaction() as db:
            asset, current = self._current(db, job)
            if not current:
                raise Conflict('superseded')
            if asset['output_id'] and asset['output_id'] != output_id:
                raise Conflict('output_identity_changed')
        # First pass (awaiting_import): the output is in the library, so pair
        # the album and ask Immich to regenerate metadata/thumbnails.
        # Second pass (refresh_pending): the refresh had a backoff window to
        # finish; verify the pairing still holds and close the loop as done.
        if job['state'] == 'awaiting_import':
            self.albums.attach(job_id, output_id)
            self.client.refresh(output_id)
        with self.store.transaction() as db:
            asset, current = self._current(db, job)
            if not current:
                db.execute("UPDATE jobs SET state='superseded' WHERE id=?", (job_id,))
                return self.store.job(job_id)
            db.execute('UPDATE assets SET output_id=? WHERE id=?', (output_id, asset['id']))
            next_state = 'done' if job['state'] == 'refresh_pending' else 'refresh_pending'
            db.execute("UPDATE jobs SET state=? WHERE id=?", (next_state, job_id))
        return self.store.job(job_id)

    def metadata(self, asset_id):
        # Metadata does not require full image decoding or colour conversion.
        # Keep it independent of the renderer's large-image memory lock.
        with self.metadata_lock:
            return self._metadata(asset_id)

    def _metadata(self, asset_id):
        _, path = self.source(asset_id)
        with open_source(self.settings.imports, path) as file:
            stat = os.fstat(file.fileno())
            if stat.st_size > self.settings.max_bytes:
                raise ValueError('file_too_large')
            key = (asset_id, path, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
            cached = self.metadata_cache.get(key)
            if cached and cached[0] > time.monotonic():
                return deepcopy(cached[1])
            with Image.open(file) as header:
                if header.format not in {'JPEG', 'PNG'} or header.width * header.height > self.settings.max_pixels:
                    raise ValueError('invalid_image')
                size = header.size
                if header.getexif().get(274, 1) in {5, 6, 7, 8}:
                    size = (size[1], size[0])
        directory = workspace(self.settings.data, 'metadata-tmp', code='workspace_unavailable') / uuid4().hex
        directory.mkdir(mode=0o700)
        try:
            target = directory / ('source' + Path(path).suffix)
            snapshot(self.settings.imports, path, target, self.settings.max_bytes)
            fields = resolve_field_values(get_exif(target, timeout=15), str(target))
            result = {'width': size[0], 'height': size[1], 'fields': fields}
            with open_source(self.settings.imports, path) as file:
                current = os.fstat(file.fileno())
                if (current.st_size, current.st_mtime_ns, current.st_ctime_ns) != key[2:]:
                    raise ValueError('source_changed')
            if len(self.metadata_cache) >= 64:
                self.metadata_cache.pop(next(iter(self.metadata_cache)))
            self.metadata_cache[key] = (time.monotonic() + 300, result)
            return deepcopy(result)
        finally:
            shutil.rmtree(directory, ignore_errors=True)
