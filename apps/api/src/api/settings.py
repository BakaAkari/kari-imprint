"""Runtime settings for the Web API."""

from __future__ import annotations

import copy
import os
import tempfile
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

_API_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = Path(__file__).resolve().parents[4]
_DEFAULT_CONFIG_PATH = _API_ROOT / "config" / "default.toml"


@dataclass(frozen=True)
class WebApiSettings:
    """Configuration for upload/output storage and request safety limits."""

    data_dir: Path
    upload_dir: Path
    output_dir: Path
    resources_dir: Path
    tmp_dir: Path
    assets_dir: Path
    api_prefix: str = "/tools/watermark-v3/api"
    max_upload_bytes: int = 80 * 1024 * 1024
    max_resource_bytes: int = 5 * 1024 * 1024
    max_image_pixels: int = 100_000_000
    preview_max_image_pixels: int = 100_000_000
    max_resource_pixels: int = 25_000_000
    preview_max_edge: int = 1600
    preview_device_pixel_ratio_limit: float = 2.0
    output_quality: int = 95
    max_concurrent_jobs: int = 1
    file_ttl_seconds: int = 3600
    allowed_extensions: frozenset[str] = frozenset(
        {".jpg", ".jpeg", ".png", ".heic", ".heif", ".tif", ".tiff", ".webp"}
    )

    @classmethod
    def from_env(cls) -> WebApiSettings:
        """Create settings from config files with optional environment overrides."""

        config = _load_runtime_config()
        server_cfg = config.get("server", {})
        paths_cfg = config.get("paths", {})
        upload_cfg = config.get("upload", {})
        preview_cfg = config.get("preview", {})
        process_cfg = config.get("process", {})
        output_cfg = config.get("output", {})
        resource_cfg = config.get("resource", {})
        storage_cfg = config.get("storage", {})

        root = Path(
            os.environ.get(
                "KARI_IMPRINT_DATA_DIR",
                str(_pick_path(paths_cfg.get("data_dir"), Path(tempfile.gettempdir()) / "kari-imprint")),
            )
        ).expanduser()
        assets_dir = Path(
            os.environ.get(
                "KARI_IMPRINT_ASSETS_DIR",
                str(_pick_path(paths_cfg.get("assets_dir"), _REPO_ROOT / "assets")),
            )
        ).expanduser()

        max_image_pixels = _env_int(
            "KARI_IMPRINT_MAX_IMAGE_PIXELS",
            _pick_int(process_cfg.get("max_pixels"), 100_000_000),
        )
        preview_max_image_pixels = _env_int(
            "KARI_IMPRINT_PREVIEW_MAX_IMAGE_PIXELS",
            _pick_int(upload_cfg.get("max_image_pixels"), max_image_pixels),
        )

        allowed_extensions = _env_extensions(
            _pick_str_list(upload_cfg.get("allowed_extensions"), ["jpg", "jpeg", "png", "webp"])
        )

        settings = cls(
            data_dir=root,
            upload_dir=root / "uploads",
            output_dir=root / "outputs",
            resources_dir=root / "resources",
            tmp_dir=root / "tmp",
            assets_dir=assets_dir,
            api_prefix=_env_str(
                "KARI_IMPRINT_API_PREFIX",
                _pick_str(server_cfg.get("api_prefix"), "/tools/watermark-v3/api"),
            ),
            max_upload_bytes=_env_int(
                "KARI_IMPRINT_MAX_UPLOAD_BYTES",
                _pick_int(upload_cfg.get("max_file_bytes"), 80 * 1024 * 1024),
            ),
            max_resource_bytes=_env_int(
                "KARI_IMPRINT_MAX_RESOURCE_BYTES",
                _pick_int(resource_cfg.get("max_file_bytes"), 5 * 1024 * 1024),
            ),
            max_image_pixels=max_image_pixels,
            preview_max_image_pixels=preview_max_image_pixels,
            max_resource_pixels=_env_int(
                "KARI_IMPRINT_MAX_RESOURCE_PIXELS",
                _pick_int(resource_cfg.get("max_pixels"), 25_000_000),
            ),
            preview_max_edge=_env_int(
                "KARI_IMPRINT_PREVIEW_MAX_EDGE",
                _pick_int(preview_cfg.get("max_edge"), 1600),
            ),
            preview_device_pixel_ratio_limit=_env_float(
                "KARI_IMPRINT_PREVIEW_DPR_LIMIT",
                _pick_float(preview_cfg.get("device_pixel_ratio_limit"), 2.0),
            ),
            output_quality=_env_int(
                "KARI_IMPRINT_OUTPUT_QUALITY",
                _pick_int(output_cfg.get("quality"), 95),
            ),
            max_concurrent_jobs=_env_int(
                "KARI_IMPRINT_MAX_CONCURRENT_JOBS",
                _pick_int(process_cfg.get("concurrency"), 1),
            ),
            file_ttl_seconds=_env_int(
                "KARI_IMPRINT_FILE_TTL_SECONDS",
                _pick_int(storage_cfg.get("file_ttl_seconds"), 3600),
            ),
            allowed_extensions=allowed_extensions,
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if self.max_upload_bytes <= 0:
            raise ValueError("max_upload_bytes must be positive")
        if self.max_resource_bytes <= 0:
            raise ValueError("max_resource_bytes must be positive")
        if self.max_image_pixels <= 0:
            raise ValueError("max_image_pixels must be positive")
        if self.preview_max_image_pixels <= 0:
            raise ValueError("preview_max_image_pixels must be positive")
        if self.max_resource_pixels <= 0:
            raise ValueError("max_resource_pixels must be positive")
        if self.preview_max_edge <= 0:
            raise ValueError("preview_max_edge must be positive")
        if self.preview_device_pixel_ratio_limit <= 0:
            raise ValueError("preview_device_pixel_ratio_limit must be positive")
        if not 1 <= self.output_quality <= 100:
            raise ValueError("output_quality must be between 1 and 100")
        if self.max_concurrent_jobs < 1:
            raise ValueError("max_concurrent_jobs must be at least 1")
        if self.file_ttl_seconds <= 0:
            raise ValueError("file_ttl_seconds must be positive")
        if not self.allowed_extensions:
            raise ValueError("allowed_extensions must not be empty")

    def ensure_dirs(self) -> None:
        """Create all runtime storage directories."""

        for path in (self.data_dir, self.upload_dir, self.output_dir, self.resources_dir, self.tmp_dir):
            path.mkdir(parents=True, exist_ok=True)

    def capabilities(self) -> dict[str, Any]:
        """Return the runtime limits safe to expose to the frontend."""

        return {
            "upload": {
                "max_file_bytes": self.max_upload_bytes,
                "allowed_extensions": sorted(ext.lstrip(".") for ext in self.allowed_extensions),
            },
            "preview": {
                "max_edge": self.preview_max_edge,
                "device_pixel_ratio_limit": self.preview_device_pixel_ratio_limit,
            },
            "process": {
                "max_image_pixels": self.max_image_pixels,
                "concurrency": self.max_concurrent_jobs,
            },
        }


def _load_runtime_config() -> dict[str, Any]:
    config = _load_toml(_DEFAULT_CONFIG_PATH)
    override_path = os.environ.get("KARI_IMPRINT_CONFIG_PATH", "").strip()
    if override_path:
        config = _merge_dicts(config, _load_toml(Path(override_path).expanduser()))
    return config


def _load_toml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    with path.open("rb") as file:
        return tomllib.load(file)


def _merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dicts(merged[key], value)
        else:
            merged[key] = value
    return merged


def _pick_path(*values: Any) -> Path:
    for value in values:
        if value:
            return Path(str(value)).expanduser()
    return Path(tempfile.gettempdir()) / "kari-imprint"


def _pick_str(value: Any, default: str) -> str:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return default


def _pick_int(*values: Any) -> int:
    for value in values:
        if value is None or value == "":
            continue
        try:
            return int(value)
        except (TypeError, ValueError):
            continue
    raise ValueError("No valid int value found")


def _pick_float(*values: Any) -> float:
    for value in values:
        if value is None or value == "":
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    raise ValueError("No valid float value found")


def _pick_str_list(value: Any, default: list[str]) -> list[str]:
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return [item.strip() for item in value if item.strip()]
    return default


def _env_str(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except ValueError:
        return default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_extensions(default: list[str]) -> frozenset[str]:
    raw = os.environ.get("KARI_IMPRINT_ALLOWED_EXTENSIONS", "").strip()
    values = [item.strip() for item in raw.split(",") if item.strip()] if raw else default
    return frozenset({f".{ext.lstrip('.').lower()}" for ext in values})


settings = WebApiSettings.from_env()
settings.ensure_dirs()
