from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[1]


def run(command: list[str], cwd: Path) -> list[dict]:
    # Resolve npm/uv to their real executables (npm.cmd on Windows) and force
    # UTF-8 so fixture text survives non-UTF-8 console code pages.
    executable = shutil.which(command[0]) or command[0]
    env = {**os.environ, "PYTHONUTF8": "1"}
    result = subprocess.run(
        [executable, *command[1:]], cwd=cwd, check=True, capture_output=True, text=True, encoding="utf-8", env=env,
    )
    return json.loads(result.stdout)


def main() -> None:
    python_output = run(
        ["uv", "run", "python", "packages/kari-core/tests/scripts/export_flow_fixtures.py"],
        ROOT,
    )
    typescript_output = run(["npm", "run", "--silent", "test:flow-fixtures"], ROOT / "apps/web")
    if python_output != typescript_output:
        raise SystemExit("TS/Python Flow Layout fixture outputs differ")
    print(f"Flow Layout parity passed: {len(python_output)} fixtures")


if __name__ == "__main__":
    main()
