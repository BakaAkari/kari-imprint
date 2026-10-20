"""Verify the curated public logo bundle before building a companion image."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root/'apps/immich-ki/logo-manifest.json').read_text())
for name, expected in manifest.items():
    path = root/'assets/logos'/name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        raise SystemExit(f'Missing or changed bundled logo: {name}')
print(f'Verified {len(manifest)} bundled logos')
