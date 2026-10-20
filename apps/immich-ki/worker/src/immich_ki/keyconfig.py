"""Panel credential file: resolve, migrate and atomically persist the Immich API key."""
from __future__ import annotations

import json
import os
import tempfile
from contextlib import suppress
from pathlib import Path

CONFIG_NAME = "config.json"
MAX_KEY_LENGTH = 256


def load_panel_config(data: Path) -> tuple[str, str]:
    """Return (api_key, owner_email) from data/config.json, ('', '') when absent or invalid."""
    try:
        raw = json.loads((data / CONFIG_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return "", ""
    if not isinstance(raw, dict):
        return "", ""
    key = raw.get("apiKey")
    key = key.strip() if isinstance(key, str) else ""
    if not key or len(key) > MAX_KEY_LENGTH:
        return "", ""
    email = raw.get("ownerEmail")
    email = email.strip() if isinstance(email, str) else ""
    return key, email


def save_panel_config(data: Path, key: str, owner_email: str) -> None:
    """Atomically persist the API key and its owner with owner-only permissions."""
    data.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=data, prefix=".config-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump({"apiKey": key, "ownerEmail": owner_email}, file, ensure_ascii=False)
            file.write("\n")
        os.chmod(tmp, 0o600)
        os.replace(tmp, data / CONFIG_NAME)
    except BaseException:
        with suppress(OSError):
            os.unlink(tmp)
        raise


def resolve_panel_config(data: Path, env_key: str) -> tuple[str, str, bool]:
    """Return (key, owner_email, initialized), migrating the env key into the config file once."""
    key, email = load_panel_config(data)
    if key:
        return key, email, True
    env_key = env_key.strip()
    if env_key and len(env_key) <= MAX_KEY_LENGTH:
        save_panel_config(data, env_key, "")
        return env_key, "", True
    return "", "", False
