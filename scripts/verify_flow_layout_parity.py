from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).parents[1]


def run(command: list[str], cwd: Path) -> list[dict]:
    result = subprocess.run(command, cwd=cwd, check=True, capture_output=True, text=True)
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
