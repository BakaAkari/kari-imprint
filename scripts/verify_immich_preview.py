"""Browser regression for source-coordinate layout with Immich thumbnails.

Build apps/immich-ki/web first, then run:
  uv run --with playwright python scripts/verify_immich_preview.py
Uses generated images and mocked API responses; no NAS credentials or mutations.
"""
from __future__ import annotations

import json
import mimetypes
import tempfile
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from api.schemas import ImprintPayload
from kari_core.processor.kari_imprint import _dict_to_imprint_config
from kari_core.shared.layout.layout_engine import compute_layout
from PIL import Image
from playwright.sync_api import sync_playwright


def main():
    root = Path(__file__).resolve().parents[1]
    dist = root / 'apps/immich-ki/web/dist'
    if not (dist / 'index.html').is_file():
        raise RuntimeError('Build apps/immich-ki/web before running this check')
    cases = [
        ('small', (960, 640), (960, 640), 100, None),
        ('large-pixel-margin', (6000, 4000), (1440, 960), 100, None),
        ('large-ratio-footer', (6000, 4000), (1440, 960), 0, 0.15),
        ('rotated-source', (4000, 6000), (960, 1440), 100, None),
    ]
    errors = []
    with tempfile.TemporaryDirectory(prefix='immich-preview-') as tmp, sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('pageerror', lambda error: errors.append(str(error)))
        for name, source, preview, margin, height in cases:
            config = ImprintPayload.model_validate({
                'schema_version': 3, 'canvas': {'margins': {'bottom': margin}},
                'regions': [{'id': 'footer', 'type': 'footer-bar', 'height': height, 'slots': {}}],
            }).model_dump()
            layout = compute_layout(_dict_to_imprint_config(config), *source)
            scale = min(preview[0] / source[0], preview[1] / source[1], 1)
            expected = [round(layout.canvas.w * scale), round(layout.canvas.h * scale)]
            image = BytesIO()
            Image.new('RGB', preview, (40, 90, 150)).save(image, 'PNG')

            saved_payloads = []

            def handle(route, *, name=name, config=config, source=source, image=image, saved_payloads=saved_payloads):
                path = urlparse(route.request.url).path
                if path == '/api/auth/session':
                    payload = {'mode': 'token', 'initialized': True, 'authenticated': False}
                elif path in {'/api/auth/immich-login', '/api/login', '/api/init'}:
                    payload = {'ok': True}
                elif path == '/api/assets':
                    payload = {'items': [{'id': '11111111-1111-4111-8111-111111111111', 'name': name,
                                          'status': {'configured': True, 'job': 'awaiting_import', 'published': True}}], 'nextPage': None}
                elif path == '/api/albums':
                    payload = {'albums': [{'id': '33333333-3333-4333-8333-333333333333', 'name': '旅行', 'assetCount': 1}], 'available': True}
                elif path == '/api/capabilities':
                    payload = {'preview': {'max_edge': 1440, 'device_pixel_ratio_limit': 2}}
                elif path.endswith('/job'):
                    payload = {'job': None}
                elif path.endswith('/look'):
                    # Album look API (design 2026-10-20); saving creates the look first.
                    payload = {'revision': 0, 'config': None, 'impact': {'follow': 0, 'exceptions': 0, 'stale': 0}}
                    if route.request.method == 'PUT':
                        payload.update(revision=1, config=route.request.post_data_json['config'])
                elif path.endswith('/activity'):
                    payload = {'jobs': [{'assetId': '11111111-1111-4111-8111-111111111111', 'id': '22222222222242228222222222222222', 'state': 'refresh_pending', 'error': None, 'generation': 1}] if saved_payloads else [], 'waiting': 0}
                elif path.endswith(('/summary', '/draft')):
                    payload = None if path.endswith('/summary') else {'ok': True}
                elif path.endswith('/config'):
                    if route.request.method == 'PUT':
                        saved_payloads.append(route.request.post_data_json['config'])
                    payload = {'revision': 1, 'saved': config, 'look': None, 'mode': 'standalone', 'overrides': [],
                               'resolved': None, 'draft': None, 'stale': False, 'conflict': False}
                elif path.endswith('/render'):
                    payload = {'id': '22222222222242228222222222222222', 'asset_id': '11111111-1111-4111-8111-111111111111', 'revision': 1, 'generation': 1, 'state': 'refresh_pending', 'error': None}
                elif path.endswith('/metadata'):
                    payload = {'fields': {}, 'width': source[0], 'height': source[1]}
                elif path == '/api/logos':
                    payload = {'ok': True, 'logos': []}
                else:
                    payload = None
                if payload is not None:
                    route.fulfill(json=payload)
                elif path.endswith('/preview'):
                    route.fulfill(body=image.getvalue(), content_type='image/png')
                else:
                    file = root / 'assets' / path.lstrip('/') if path.startswith('/fonts/') else dist / (path.lstrip('/') or 'index.html')
                    if file.is_file():
                        route.fulfill(path=str(file), content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream')
                    else:
                        route.fulfill(status=404)

            page.route('**/*', handle)
            page.goto('http://immich-preview.test')
            page.get_by_label('Immich 邮箱').fill('demo@example.com')
            page.get_by_label('Immich 密码').fill('x' * 12)
            page.get_by_role('button', name='登录', exact=True).click()
            page.locator('.album-item', has_text='旅行').click()
            tile = page.locator('.photo-tile', has_text=name)
            # Gallery badge reflects the server job state (awaiting_import is still processing).
            tile.locator('.asset-badge', has_text='处理中').wait_for()
            tile.click()
            page.wait_for_function(
                "document.querySelector('.preview-stage canvas')?.width > 300"
                " && !document.querySelector('.dock-actions .primary')?.disabled"
            )
            actual = page.locator('.preview-stage canvas').evaluate('(c) => [c.width, c.height]')
            assert actual == expected, (name, actual, expected)
            # Source image must end before the white footer at its scaled height.
            pixels = page.locator('.preview-stage canvas').evaluate('''(c) => {
              const ctx = c.getContext('2d');
              return [Array.from(ctx.getImageData(2, 2, 1, 1).data),
                      Array.from(ctx.getImageData(2, c.height - 2, 1, 1).data)];
            }''')
            assert pixels == [[40, 90, 150, 255], [255, 255, 255, 255]], (name, pixels)
            page.locator('.dock-actions .primary').click()
            page.locator('.status-pill').filter(has_text='已收录，等待 Immich 刷新').wait_for()
            assert saved_payloads, name
            assert saved_payloads[-1]['canvas']['margins'] == config['canvas']['margins'], name
            page.screenshot(path=str(Path(tmp) / f'{name}.png'))
            page.unroute('**/*', handle)
            print(json.dumps({'case': name, 'canvas': actual, 'passed': True}))
        browser.close()
    assert not errors, errors


if __name__ == '__main__':
    main()
