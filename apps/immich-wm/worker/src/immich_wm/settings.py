from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID


@dataclass(frozen=True)
class Settings:
    immich_url: str
    api_key: str = field(repr=False)
    source_library: str
    output_library: str
    imports: Path
    output: Path
    data: Path
    source_prefix: str = "/external/camera-exports"
    output_prefix: str = "/external/camera-watermarked"
    max_bytes: int = 256 * 1024 * 1024
    max_pixels: int = 400_000_000
    max_output_pixels: int = 460_000_000
    max_queue: int = 20
    preview_edge: int = 1440
    min_free_bytes: int = 512 * 1024 * 1024
    max_output_edge: int = 56000
    imprint_dir: str = "Imprint"
    # Explicit M0 renderer identifier; bump whenever render inputs/implementation change.
    renderer_version: str = "m0-photo-srgb-v1"
    token: str = field(default="", repr=False)
    public_origin: str = ""
    oidc_issuer: str = ""
    oidc_client_id: str = ""
    oidc_client_secret: str = field(default="", repr=False)
    oidc_allowed_group: str = ""

    def __post_init__(self):
        parsed = urlsplit(self.immich_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ValueError("invalid_immich_url")
        if self.public_origin:
            origin = urlsplit(self.public_origin)
            if (origin.scheme not in {"http", "https"} or not origin.hostname
                    or origin.username or origin.password or origin.path
                    or origin.query or origin.fragment or len(self.public_origin) > 2048
                    or any(c.isspace() for c in self.public_origin)):
                raise ValueError("invalid_public_origin")
            if origin.port is not None and not 1 <= origin.port <= 65535:
                raise ValueError("invalid_public_origin")
        oidc_values = (self.oidc_issuer, self.oidc_client_id, self.oidc_client_secret, self.oidc_allowed_group)
        if any(oidc_values):
            issuer = urlsplit(self.oidc_issuer)
            if (not all(oidc_values) or not self.public_origin.startswith('https://')
                    or issuer.scheme != 'https' or not issuer.hostname or issuer.path
                    or issuer.username or issuer.password or issuer.query or issuer.fragment
                    or any(c.isspace() for c in self.oidc_issuer)
                    or any(len(v) > 2048 for v in oidc_values)):
                raise ValueError('invalid_oidc_configuration')
        UUID(self.source_library)
        UUID(self.output_library)
        if self.source_library == self.output_library:
            raise ValueError("libraries_must_differ")
        from immich_wm.paths import output_relative
        output_relative('probe.jpg', self.imprint_dir)
        if not self.api_key or (not self.oidc_issuer and len(self.token) < 32):
            raise ValueError("missing_credentials")
        roots = [p.resolve() for p in (self.imports, self.output, self.data)]
        if any(a == b or a in b.parents or b in a.parents for i,a in enumerate(roots) for b in roots[i+1:]):
            raise ValueError("overlapping_roots")
        for value, limit in [(self.max_bytes, 1024**3), (self.max_pixels, 500_000_000), (self.max_output_pixels, 600_000_000), (self.max_queue, 100), (self.preview_edge, 4096), (self.min_free_bytes, 1024**4), (self.max_output_edge, 60000)]:
            if type(value) is not int or not 1 <= value <= limit:
                raise ValueError("invalid_limit")

    @classmethod
    def from_env(cls):
        return cls(
            immich_url=os.environ["IMMICH_URL"], api_key=os.environ["IMMICH_API_KEY"],
            source_library=os.environ["WM_SOURCE_LIBRARY_ID"], output_library=os.environ["WM_OUTPUT_LIBRARY_ID"],
            imports=Path(os.environ.get("WM_IMPORTS_ROOT", "/imports")),
            output=Path(os.environ.get("WM_OUTPUT_ROOT", "/output")), data=Path(os.environ.get("WM_DATA_ROOT", "/data")),
            min_free_bytes=int(os.environ.get("WM_MIN_FREE_BYTES", str(512 * 1024 * 1024))),
            source_prefix=os.environ.get("WM_SOURCE_PREFIX", "/external/camera-exports"),
            output_prefix=os.environ.get("WM_OUTPUT_PREFIX", "/external/camera-watermarked"),
            imprint_dir=os.environ.get("WM_IMPRINT_DIR", "Imprint"),
            token=os.environ.get("WM_M0_TOKEN", ""),
            public_origin=os.environ.get("WM_PUBLIC_ORIGIN", ""),
            oidc_issuer=os.environ.get("WM_OIDC_ISSUER", ""),
            oidc_client_id=os.environ.get("WM_OIDC_CLIENT_ID", ""),
            oidc_client_secret=os.environ.get("WM_OIDC_CLIENT_SECRET", ""),
            oidc_allowed_group=os.environ.get("WM_OIDC_ALLOWED_GROUP", ""),
        )
