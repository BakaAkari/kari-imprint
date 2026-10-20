"""Live HTTP-level check of the album filter against the real Immich instance.

Run inside the immich-ki container:
    docker cp scripts/verify_immich_album_filter_live.py <container>:/tmp/
    docker exec <container> python /tmp/verify_immich_album_filter_live.py

Runs inside the immich-ki container: uses the real Immich URL/key, a throwaway
data dir, and a pre-authorized path so no panel login is needed. Prints only
status codes and item counts; never prints the API key or photo names.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from immich_ki import auth
from immich_ki.client import ImmichClient
from immich_ki.keyconfig import load_panel_config
from immich_ki.settings import Settings

real_data = Path(os.environ.get('KI_DATA_ROOT', '/data'))
key, _ = load_panel_config(real_data)
client = ImmichClient(os.environ['IMMICH_URL'], key)
albums = client.albums()
empty = next(a for a in albums if a['assetCount'] == 0)
full = next(a for a in albums if a['assetCount'] > 0)
client.close()

with tempfile.TemporaryDirectory(prefix='ki-verify-') as tmp:
    os.environ['KI_DATA_ROOT'] = tmp
    os.environ['IMMICH_API_KEY'] = key
    auth.PUBLIC_AUTH_PATHS = set(auth.PUBLIC_AUTH_PATHS) | {'/api/assets', '/api/albums'}
    from immich_ki.app import create_app
    app = create_app(Settings.from_env(), background=False)
    with TestClient(app, raise_server_exceptions=False) as http:
        for label, album_id in [('all', None), ('empty', empty['id']), ('populated', full['id'])]:
            query = f'?album={album_id}' if album_id else ''
            response = http.get(f'/api/assets{query}')
            body = response.json()
            detail = body if response.status_code != 200 else {'items': len(body['items']), 'nextPage': body.get('nextPage')}
            print(f'{label:10s} status={response.status_code} {detail}')
        print('random_uuid status=', http.get(f'/api/assets?album={uuid4()}').status_code)
        print('malformed   status=', http.get('/api/assets?album=not-a-uuid').status_code)
