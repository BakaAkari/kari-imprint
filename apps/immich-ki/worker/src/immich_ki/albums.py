"""Album ownership and durable pairing; never infer photo identity from a name."""

import threading
import time
from concurrent.futures import ThreadPoolExecutor
from uuid import UUID

from immich_ki.client import UpstreamError


def is_result(name):
    return str(name).rstrip().casefold().endswith("imprint")


class SourceAlbums:
    """Lists only albums the panel can work on.

    Result albums are hidden (they hold generated outputs), and so are albums
    with no image in the source library -- e.g. albums of RAW files that live
    only in the camera archive library.  Per-album answers are cached briefly
    so opening the panel does not fan out to Immich on every request.
    """

    TTL = 300.0

    def __init__(self, client, library, *, clock=time.monotonic):
        self.client, self.library, self.clock = client, library, clock
        self.cache: dict[str, tuple[float, bool]] = {}
        self.lock = threading.Lock()

    def _eligible(self, album_id):
        now = self.clock()
        with self.lock:
            hit = self.cache.get(album_id)
            if hit and hit[0] > now:
                return hit[1]
        try:
            value = self.client.album_has_images(self.library, album_id)
        except UpstreamError:
            # Unknown is not "empty": keep the album visible and do not cache.
            return True
        with self.lock:
            self.cache[album_id] = (now + self.TTL, value)
        return value

    def list(self):
        albums = [a for a in self.client.albums() if not is_result(a["name"])]
        with ThreadPoolExecutor(max_workers=8) as pool:
            flags = list(pool.map(lambda a: self._eligible(a["id"]), albums))
        return [{**a, "isResult": False} for a, ok in zip(albums, flags, strict=True) if ok]


class AlbumCoordinator:
    def __init__(self, store, client):
        self.store, self.client = store, client

    def source(self, album_id, asset_id=None):
        album = self.client.album(str(UUID(str(album_id))))
        if is_result(album["albumName"]):
            raise ValueError("result_album_read_only")
        if asset_id is not None and str(UUID(str(album_id))) not in self.client.album_membership(asset_id):
            raise ValueError("asset_not_in_album")
        return album

    def attach(self, job_id, output_id):
        with self.store.transaction() as db:
            context = db.execute("SELECT source_album_id FROM job_albums WHERE job_id=?", (job_id,)).fetchone()
        if context is None:
            return  # Legacy jobs retain their original behavior.
        source_id = context[0]
        source = self.source(source_id)
        name = source["albumName"].rstrip() + " Imprint"
        with self.store.transaction() as db:
            pair = db.execute(
                "SELECT result_album_id FROM album_pairs WHERE source_album_id=?", (source_id,)
            ).fetchone()
        if pair:
            target = self.client.album(pair[0])
            if not is_result(target["albumName"]):
                raise ValueError("album_pair_changed")
            target_id = pair[0]
        else:
            candidates = [a for a in self.client.albums() if a["name"] == name]
            if len(candidates) > 1:
                raise ValueError("ambiguous_album_pair")
            target_id = candidates[0]["id"] if candidates else self.client.create_album(name)
            with self.store.transaction() as db:
                existing = db.execute(
                    "SELECT source_album_id FROM album_pairs WHERE result_album_id=?", (target_id,)
                ).fetchone()
                if existing and existing[0] != source_id:
                    raise ValueError("ambiguous_album_pair")
                db.execute(
                    "INSERT INTO album_pairs(source_album_id,result_album_id) VALUES(?,?)", (source_id, target_id)
                )
        # PUT is idempotent, including a crash after add but before journal update.
        self.client.add_to_album(target_id, output_id)
