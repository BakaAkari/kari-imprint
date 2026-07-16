from __future__ import annotations

from pathlib import Path

import api.settings as settings_module


def test_runtime_config_override_merges_without_repeating_defaults(tmp_path: Path, monkeypatch) -> None:
    override = tmp_path / "runtime.toml"
    override.write_text(
        """
[preview]
max_edge = 900
device_pixel_ratio_limit = 1.5

[process]
max_pixels = 42000000
concurrency = 2

[output]
quality = 88
""".strip(),
        encoding="utf-8",
    )
    monkeypatch.setenv("KARI_IMPRINT_CONFIG_PATH", str(override))

    loaded = settings_module.WebApiSettings.from_env()

    assert loaded.preview_max_edge == 900
    assert loaded.preview_device_pixel_ratio_limit == 1.5
    assert loaded.max_image_pixels == 42_000_000
    assert loaded.max_concurrent_jobs == 2
    assert loaded.max_upload_bytes == 104_857_600
    assert loaded.output_quality == 88


def test_capabilities_do_not_expose_server_paths(tmp_path: Path) -> None:
    loaded = settings_module.WebApiSettings(
        data_dir=tmp_path,
        upload_dir=tmp_path / "uploads",
        output_dir=tmp_path / "outputs",
        resources_dir=tmp_path / "resources",
        tmp_dir=tmp_path / "tmp",
        assets_dir=tmp_path / "assets",
    )

    capabilities = loaded.capabilities()

    assert "paths" not in capabilities
    assert capabilities["preview"]["max_edge"] == loaded.preview_max_edge