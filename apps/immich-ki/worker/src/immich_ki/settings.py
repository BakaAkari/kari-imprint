from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path, PurePosixPath
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
    public_origin: str = ""

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
        UUID(self.source_library)
        UUID(self.output_library)
        from immich_ki.paths import output_relative
        output_relative('probe.jpg', self.imprint_dir)
        # Archive mode (方案A): source and output may be the same Immich library
        # when outputs live in a dedicated subdir of the source tree. Without an
        # imprint subdir the output path would collide with the source path.
        if not self.imprint_dir and self.source_prefix == self.output_prefix:
            raise ValueError("output_collides_with_source")
        # api_key may be empty at startup: the panel then enters init mode and
        # waits for the operator to associate an Immich API key via /api/init.
        if not isinstance(self.api_key, str) or len(self.api_key) > 256:
            raise ValueError("invalid_api_key")
        imports_root, output_root, data_root = (p.resolve() for p in (self.imports, self.output, self.data))
        if data_root in {imports_root, output_root} or data_root in imports_root.parents \
                or data_root in output_root.parents or imports_root in data_root.parents \
                or output_root in data_root.parents:
            raise ValueError("overlapping_roots")
        # The output mount may sit inside the imports tree (publish target is a
        # subdir of the source library); any other imports/output overlap is
        # ambiguous and rejected.
        if output_root == imports_root or output_root in imports_root.parents:
            raise ValueError("overlapping_roots")
        for value, limit in [(self.max_bytes, 1024**3), (self.max_pixels, 500_000_000), (self.max_output_pixels, 600_000_000), (self.max_queue, 100), (self.preview_edge, 4096), (self.min_free_bytes, 1024**4), (self.max_output_edge, 60000)]:
            if type(value) is not int or not 1 <= value <= limit:
                raise ValueError("invalid_limit")

    @property
    def reserved_output(self) -> str | None:
        """Source-tree subdir reserved for published outputs (archive mode).

        Only meaningful when source and output are the same Immich library:
        assets under this prefix are outputs, not watermarkable sources.
        """
        if self.source_library != self.output_library:
            return None
        reserved = ''
        if self.source_prefix == self.output_prefix:
            reserved = self.imprint_dir
        else:
            try:
                nested = PurePosixPath(self.output_prefix).relative_to(PurePosixPath(self.source_prefix))
                if nested.parts:
                    reserved = nested.as_posix()
            except ValueError:
                reserved = self.imprint_dir
        return reserved or None

    @classmethod
    def from_env(cls):
        return cls(
            immich_url=os.environ["IMMICH_URL"], api_key=os.environ.get("IMMICH_API_KEY", ""),
            source_library=os.environ["KI_SOURCE_LIBRARY_ID"], output_library=os.environ["KI_OUTPUT_LIBRARY_ID"],
            imports=Path(os.environ.get("KI_IMPORTS_ROOT", "/imports")),
            output=Path(os.environ.get("KI_OUTPUT_ROOT", "/output")), data=Path(os.environ.get("KI_DATA_ROOT", "/data")),
            min_free_bytes=int(os.environ.get("KI_MIN_FREE_BYTES", str(512 * 1024 * 1024))),
            source_prefix=os.environ.get("KI_SOURCE_PREFIX", "/external/camera-exports"),
            output_prefix=os.environ.get("KI_OUTPUT_PREFIX", "/external/camera-watermarked"),
            imprint_dir=os.environ.get("KI_IMPRINT_DIR", "Imprint"),
            public_origin=os.environ.get("KI_PUBLIC_ORIGIN", ""),
        )
