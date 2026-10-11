"""Album ownership and durable pairing; never infer photo identity from a name."""
from uuid import UUID


def is_result(name):
    return str(name).rstrip().casefold().endswith('imprint')


class AlbumCoordinator:
    def __init__(self, store, client):
        self.store, self.client = store, client

    def source(self, album_id, asset_id=None):
        album = self.client.album(str(UUID(str(album_id))))
        if is_result(album['albumName']):
            raise ValueError('result_album_read_only')
        if asset_id is not None and not any(a['id'] == asset_id for a in album.get('assets', [])):
            raise ValueError('asset_not_in_album')
        return album

    def attach(self, job_id, output_id):
        with self.store.transaction() as db:
            context = db.execute('SELECT source_album_id FROM job_albums WHERE job_id=?', (job_id,)).fetchone()
        if context is None:
            return  # Legacy jobs retain their original behavior.
        source_id = context[0]
        source = self.source(source_id)
        name = source['albumName'].rstrip() + ' Imprint'
        with self.store.transaction() as db:
            pair = db.execute('SELECT result_album_id FROM album_pairs WHERE source_album_id=?', (source_id,)).fetchone()
        if pair:
            target = self.client.album(pair[0])
            if not is_result(target['albumName']):
                raise ValueError('album_pair_changed')
            target_id = pair[0]
        else:
            candidates = [a for a in self.client.albums() if a['name'] == name]
            if len(candidates) > 1:
                raise ValueError('ambiguous_album_pair')
            target_id = candidates[0]['id'] if candidates else self.client.create_album(name)
            with self.store.transaction() as db:
                existing = db.execute('SELECT source_album_id FROM album_pairs WHERE result_album_id=?', (target_id,)).fetchone()
                if existing and existing[0] != source_id:
                    raise ValueError('ambiguous_album_pair')
                db.execute('INSERT INTO album_pairs(source_album_id,result_album_id) VALUES(?,?)', (source_id, target_id))
        # PUT is idempotent, including a crash after add but before journal update.
        self.client.add_to_album(target_id, output_id)
