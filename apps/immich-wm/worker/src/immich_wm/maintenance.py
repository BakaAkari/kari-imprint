"""Conservative maintenance: never delete or repair source/published photos."""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from immich_wm.client import UpstreamError
from immich_wm.paths import open_source


def references(config):
    for region in config['regions']:
        for slot in region['slots'].values():
            name = (slot.get('content') or {}).get('path', '')
            if name and not name.startswith('builtin:'):
                yield name


class Maintenance:
    def __init__(self, service):
        self.service = service
        self.next_gc = 0
        with service.store.transaction() as db:
            db.execute('''CREATE TABLE IF NOT EXISTS asset_checks (
                asset_id TEXT PRIMARY KEY REFERENCES assets(id), checked REAL NOT NULL, issue TEXT)''')
            db.execute('UPDATE asset_checks SET checked=0')

    def require_space(self, extra=0):
        s = self.service.settings
        for root in (s.data, s.output):
            if shutil.disk_usage(root).free < s.min_free_bytes + extra:
                raise ValueError('insufficient_disk_space')

    def status(self):
        s = self.service
        with s.store.lock:
            counts = {r[0]: r[1] for r in s.store.db.execute('SELECT state,COUNT(*) FROM jobs GROUP BY state')}
            issues = [dict(r) for r in s.store.db.execute(
                'SELECT asset_id AS assetId,issue,checked FROM asset_checks WHERE issue IS NOT NULL ORDER BY checked DESC LIMIT 100')]
        return {'freeBytes': min(shutil.disk_usage(s.settings.data).free, shutil.disk_usage(s.settings.output).free),
                'minimumFreeBytes': s.settings.min_free_bytes, 'jobs': counts, 'issues': issues}

    def tick(self, now=None):
        now = time.time() if now is None else now
        s = self.service
        with s.store.transaction() as db:
            row = db.execute('''SELECT a.* FROM assets a LEFT JOIN asset_checks c ON c.asset_id=a.id
                WHERE COALESCE(c.checked,0)<? ORDER BY COALESCE(c.checked,0),a.id LIMIT 1''', (now-600,)).fetchone()
        if row:
            asset = dict(row)
            issue = None
            try:
                _, path = s.source(asset['id'])
                if path != asset['path']:
                    issue = 'source_moved'
                else:
                    with open_source(s.settings.imports, path):
                        pass
                with s.store.lock:
                    # Do not race a publication, nor report an old revision after edits.
                    fresh = s.store.db.execute('SELECT generation,revision FROM assets WHERE id=?', (asset['id'],)).fetchone()
                    if tuple(fresh) != (asset['generation'], asset['revision']):
                        return
                    if asset['published_hash']:
                        actual = s._output_hash(asset['path'])
                        if actual != asset['published_hash']:
                            issue = 'output_missing' if actual is None else 'output_changed'
                    for name in references(s.config(asset['id'])['config']):
                        with open_source(s.resources, name):
                            pass
            except UpstreamError as exc:
                issue = 'source_missing' if exc.status == 404 else 'upstream_unavailable'
            except (FileNotFoundError, ValueError, OSError):
                issue = 'source_or_resource_unavailable'
            with s.store.transaction() as db:
                db.execute('INSERT OR REPLACE INTO asset_checks(asset_id,checked,issue) VALUES(?,?,?)', (asset['id'], now, issue))
        if now >= self.next_gc:
            self.gc(now)
            self.next_gc = now + 3600

    def gc(self, now=None):
        now = time.time() if now is None else now
        s = self.service
        cutoff = now - 86400
        with s.store.lock:
            # Preserve historical configs too, so backups and old revisions remain usable.
            used = set()
            for row in s.store.db.execute('SELECT config FROM configs'):
                used.update(references(json.loads(row[0])))
            active = {r[0] for r in s.store.db.execute("SELECT id FROM jobs WHERE state IN ('queued','running','publishing')")}
            for file in s.resources.iterdir():
                if (re.fullmatch(r'[0-9a-f]{32}\.png', file.name) and not file.is_symlink()
                        and file.is_file() and file.name not in used and file.stat().st_mtime < cutoff):
                    file.unlink()
            for directory in s.tmp.iterdir():
                if (re.fullmatch(r'[0-9a-f]{32}', directory.name) and directory.name not in active
                        and not directory.is_symlink() and directory.is_dir() and directory.stat().st_mtime < cutoff):
                    shutil.rmtree(directory)

    def backup(self):
        s = self.service
        self.require_space()
        root = s.settings.data / 'backups'
        root.mkdir(mode=0o700, exist_ok=True)
        key = uuid4().hex
        staging = root / ('.' + key)
        target = root / key
        staging.mkdir(mode=0o700)
        try:
            with s.store.lock:
                resources = [p for p in s.resources.iterdir() if re.fullmatch(r'[0-9a-f]{32}\.png', p.name) and p.is_file() and not p.is_symlink()]
                self.require_space(sum(p.stat().st_size for p in resources) + (s.settings.data/'immich-wm.db').stat().st_size)
                s.store.backup(staging/'immich-wm.db')
                (staging/'resources').mkdir(mode=0o700)
                for source in resources:
                    shutil.copy2(source, staging/'resources'/source.name)
                files = {str(p.relative_to(staging)): hashlib.sha256(p.read_bytes()).hexdigest()
                         for p in staging.rglob('*') if p.is_file()}
                manifest = {'version': 1, 'renderer': s.renderer_version, 'sourceLibrary': s.settings.source_library,
                            'outputLibrary': s.settings.output_library, 'sourcePrefix': s.settings.source_prefix,
                            'outputPrefix': s.settings.output_prefix, 'created': time.time(), 'files': files}
                (staging/'manifest.json').write_text(json.dumps(manifest, sort_keys=True))
                for p in staging.rglob('*'):
                    if p.is_file():
                        with p.open('rb') as f:
                            os.fsync(f.fileno())
            staging.rename(target)
            return {'backupId': key, 'files': len(files)}
        except Exception:
            shutil.rmtree(staging, ignore_errors=True)
            raise


def restore_backup(source: Path, destination: Path):
    """Offline only, empty destination, no destructive replacement and no secrets."""
    if destination.exists():
        raise ValueError('restore_destination_must_not_exist')
    manifest = json.loads((source/'manifest.json').read_text())
    if manifest.get('version') != 1 or 'immich-wm.db' not in manifest['files']:
        raise ValueError('invalid_backup')
    for name, digest in manifest['files'].items():
        if name != 'immich-wm.db' and not re.fullmatch(r'resources/[0-9a-f]{32}\.png', name):
            raise ValueError('invalid_backup_path')
        with open_source(source, name) as f:
            if hashlib.sha256(f.read()).hexdigest() != digest:
                raise ValueError('backup_checksum_mismatch')
    # Validate DB and required resource closure before creating the destination.
    with closing(sqlite3.connect(f'file:{source / "immich-wm.db"}?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('invalid_backup_database')
        for row in db.execute('SELECT config FROM configs'):
            for name in references(json.loads(row[0])):
                if 'resources/'+name not in manifest['files']:
                    raise ValueError('backup_resource_missing')
    destination.mkdir(mode=0o700)
    try:
        for name in manifest['files']:
            target = destination/name
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            shutil.copy2(source/name, target)
        with closing(sqlite3.connect(destination/'immich-wm.db')) as db, db:
            # Snapshots/output photos are deliberately not part of this backup.
            # Never replay an old publication into existing outputs on restore.
            db.execute("UPDATE jobs SET state='failed',error='restored_requires_review' WHERE state IN ('queued','running','publishing')")
        shutil.copy2(source/'manifest.json', destination/'restored-manifest.json')
    except Exception:
        shutil.rmtree(destination)
        raise
