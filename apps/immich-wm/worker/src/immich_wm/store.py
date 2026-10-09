"""M0 durable revisions and publishing journal; one process owns the database."""
from __future__ import annotations

import fcntl
import json
import sqlite3
import threading
from contextlib import closing, contextmanager
from pathlib import Path


def canonical(value) -> str:
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


class Store:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        self.lockfile = (root / 'worker.lock').open('a')
        try:
            fcntl.flock(self.lockfile, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            self.lockfile.close()
            raise RuntimeError('worker_already_running') from None
        self.lock = threading.RLock()
        self.db = sqlite3.connect(root / 'immich-wm.db', check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.db.execute('PRAGMA foreign_keys=ON')
        version = self.db.execute('PRAGMA user_version').fetchone()[0]
        if version not in {0, 1}:
            self.close()
            raise ValueError('unsupported_database_version')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS assets (
          id TEXT PRIMARY KEY, path TEXT NOT NULL UNIQUE, revision INTEGER NOT NULL DEFAULT 0,
          generation INTEGER NOT NULL DEFAULT 0, output_id TEXT, published_hash TEXT
        );
        CREATE TABLE IF NOT EXISTS configs (
          asset_id TEXT REFERENCES assets(id), revision INTEGER NOT NULL, config TEXT NOT NULL,
          hash TEXT NOT NULL, created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(asset_id, revision)
        );
        CREATE TABLE IF NOT EXISTS jobs (
          id TEXT PRIMARY KEY, asset_id TEXT REFERENCES assets(id), revision INTEGER NOT NULL,
          generation INTEGER NOT NULL, source_hash TEXT NOT NULL, render_key TEXT NOT NULL,
          renderer TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN
            ('queued','running','publishing','awaiting_import','refresh_pending','done','failed','superseded')),
          output_hash TEXT, previous_hash TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0,
          created TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY(asset_id,revision) REFERENCES configs(asset_id,revision)
        );
        CREATE TABLE IF NOT EXISTS sync_schedule (
          job_id TEXT PRIMARY KEY REFERENCES jobs(id), attempts INTEGER NOT NULL,
          next_at REAL NOT NULL, error TEXT
        );
        PRAGMA user_version=1;
        ''')

    @contextmanager
    def transaction(self):
        with self.lock, self.db:
            yield self.db

    def job(self, job_id):
        with self.lock:
            row = self.db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
            if row is None:
                raise ValueError('job_not_found')
            return dict(row)

    def close(self):
        self.db.close()
        self.lockfile.close()

    def backup(self, destination: Path):
        with self.lock, closing(sqlite3.connect(destination)) as target:
            self.db.backup(target)
