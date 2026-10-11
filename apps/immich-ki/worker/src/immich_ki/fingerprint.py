"""Renderer implementation fingerprint for cross-deployment recovery detection.

The service key's ``renderer_version`` must change whenever the code that turns
a config into pixels changes, otherwise a recovered job silently reuses a
renderer whose behaviour no longer matches the original. The base version in
``Settings.renderer_version`` is a coarse bump; this fingerprint hashes the
actual render-pipeline source so layout/compression edits invalidate stale jobs
without a manual version edit.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import kari_core

import immich_ki

# Render-relevant modules only. Do not include config/schema files that do not
# affect the emitted bytes, or unrelated bumps would needlessly invalidate jobs.
_RENDER_PIPELINE_FILES = (
    "shared/layout/layout_engine.py",
    "shared/assembler.py",
    "processor/renderer.py",
    "processor/kari_imprint.py",
    "processor/schemas.py",
)


def _pipeline_paths():
    core = Path(kari_core.__file__).resolve().parent
    paths = [core / relative for relative in _RENDER_PIPELINE_FILES]
    paths.append(Path(immich_ki.__file__).resolve().parent / "render.py")
    return paths


def implementation_fingerprint() -> str:
    digest = hashlib.sha256()
    for path in _pipeline_paths():
        if not path.is_file():
            continue
        digest.update(path.name.encode())
        digest.update(path.read_bytes())
    return digest.hexdigest()[:16]
