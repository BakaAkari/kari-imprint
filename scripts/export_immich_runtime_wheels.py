"""Export hash-pinned CPython 3.13 / Linux amd64 runtime wheels from uv.lock.

Run after regenerating apps/immich-wm/worker/requirements.lock. The deployment
fallback uses direct artifact URLs to avoid unreliable package index lookups.
"""
import tomllib
from pathlib import Path
from urllib.parse import unquote, urlsplit

from packaging.markers import default_environment
from packaging.requirements import Requirement
from packaging.tags import compatible_tags, cpython_tags
from packaging.utils import parse_wheel_filename


def main():
    root = Path(__file__).resolve().parents[1]
    worker = root / 'apps/immich-wm/worker'
    packages = {p['name']: p for p in tomllib.loads((root / 'uv.lock').read_text())['package']}
    platforms = [f'manylinux_2_{v}_x86_64' for v in range(36, 4, -1)] + [
        'manylinux2014_x86_64', 'manylinux2010_x86_64', 'manylinux1_x86_64', 'linux_x86_64',
    ]
    tags = [*cpython_tags((3, 13), ['cp313'], platforms), *compatible_tags((3, 13), 'cp313', platforms)]
    rank = {tag: index for index, tag in enumerate(tags)}
    env = default_environment()
    env.update(sys_platform='linux', platform_system='Linux', platform_machine='x86_64', os_name='posix',
               python_version='3.13', python_full_version='3.13.12')
    lines = ['# Generated from uv.lock for CPython 3.13 / Linux amd64; do not loosen versions.']
    for line in (worker / 'requirements.lock').read_text().splitlines():
        if not line or line.lstrip().startswith('#'):
            continue
        requirement = Requirement(line)
        if requirement.marker and not requirement.marker.evaluate(env):
            continue
        package = packages[requirement.name.lower().replace('_', '-')]
        if package['version'] not in requirement.specifier:
            raise ValueError(f'Stale requirements.lock: {requirement.name}')
        matches = []
        for wheel in package.get('wheels', []):
            name = unquote(urlsplit(wheel['url']).path.rsplit('/', 1)[-1])
            supported = [rank[tag] for tag in parse_wheel_filename(name)[3] if tag in rank]
            if supported:
                matches.append((min(supported), wheel))
        if not matches:
            raise ValueError(f'No target wheel: {requirement.name}')
        wheel = min(matches, key=lambda item: item[0])[1]
        lines.append(f"{wheel['url']} --hash={wheel['hash']}")
    (worker / 'requirements-linux-amd64.lock').write_text('\n'.join(lines) + '\n')
    print(f'Exported {len(lines) - 1} hash-pinned runtime artifacts')


if __name__ == '__main__':
    main()
