"""Panel credential file: resolve, migrate and atomically persist the Immich API key."""
from __future__ import annotations

import json
import os
import tempfile
from contextlib import suppress
from pathlib import Path

CONFIG_NAME = "config.json"
MAX_KEY_LENGTH = 256


def load_panel_key(data: Path) -> str:
    """Return the stored API key from data/config.json, or '' when absent or invalid."""
    try:
        raw = json.loads((data / CONFIG_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return ""
    key = raw.get("apiKey") if isinstance(raw, dict) else ""
    if not isinstance(key, str):
        return ""
    key = key.strip()
    return key if key and len(key) <= MAX_KEY_LENGTH else ""


def save_panel_key(data: Path, key: str) -> None:
    """Atomically persist the API key with owner-only permissions."""
    data.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=data, prefix=".config-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump({"apiKey": key}, file, ensure_ascii=False)
            file.write("\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, data / CONFIG_NAME)
    except BaseException:
        with suppress(OSError):
            os.unlink(tmp)
        raise


def resolve_panel_key(data: Path, env_key: str) -> tuple[str, bool]:
    """Return (key, initialized), migrating the env key into the config file once."""
    key = load_panel_key(data)
    if key:
        return key, True
    env_key = env_key.strip()
    if env_key and len(env_key) <= MAX_KEY_LENGTH:
        save_panel_key(data, env_key)
        return env_key, True
    return "", False
