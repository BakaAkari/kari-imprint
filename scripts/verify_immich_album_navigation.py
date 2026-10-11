"""Mocked browser acceptance for album/editor ownership and async navigation.

Build apps/immich-ki/web, then uv run --with playwright python this_file.
No external services, credentials, or real photos are used.
"""
from __future__ import annotations

import mimetypes
from contextlib import suppress
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from api.schemas import ImprintPayload
from kari_core.processor.kari_imprint import _dict_to_imprint_config
from kari_core.shared.layout.layout_engine import compute_layout
from PIL import Image
from playwright.sync_api import Error, expect, sync_playwright


def main():
    root = Path(__file__).resolve().parents[1]
    dist = root / 'apps/immich-ki/web/dist'
    config = ImprintPayload.model_validate({'schema_version': 3, 'canvas': {'margins': {'bottom': 100}}, 'regions': []}).model_dump()
    original = (6000, 4000)
    cap = 1440
    bounds = compute_layout(_dict_to_imprint_config(deepcopy(config)), *original).canvas
    scale = cap / max(original)
    expected = (round(bounds.w * scale), round(bounds.h * scale))
    image = BytesIO()
    Image.new('RGB', (960, 640), (40, 90, 150)).save(image, 'PNG')
    held = []
    requests = {'all': 0}
    delay_metadata = False
    errors = []

    def item(name):
        return {'id': name, 'name': name + '.jpg', 'status': {'configured': True, 'job': 'awaiting_import', 'published': False}}

    def handle(route):
        parsed = urlparse(route.request.url)
        path = parsed.path
        if path == '/api/auth/session':
            payload = {'initialized': True, 'authenticated': True}
        elif path == '/api/assets':
            album = parse_qs(parsed.query).get('album', ['all'])[0]
            requests[album] = requests.get(album, 0) + 1
            if album == 'all' and requests[album] > 1:
                held.append(route)
                return
            if album == 'error':
                route.fulfill(status=503, json={'error': 'output_unavailable'})
                return
            payload = {'items': [] if album == 'empty' else [item('A' if album == 'all' else 'B')], 'nextPage': None}
        elif path == '/api/albums':
            payload = {'available': True, 'albums': [{'id': key, 'name': key, 'assetCount': 1} for key in ('B', 'empty', 'error')]}
        elif path == '/api/capabilities':
            payload = {'preview': {'max_edge': 1440, 'device_pixel_ratio_limit': 2}}
        elif path.endswith('/job'):
            payload = {'job': None}
        elif path.endswith('/config'):
            payload = {'revision': 1, 'config': config}
        elif path.endswith('/metadata'):
            if delay_metadata:
                held.append(route)
                return
            payload = {'width': 6000, 'height': 4000, 'fields': {}}
        elif path == '/api/logos':
            payload = {'ok': True, 'logos': []}
        elif path == '/api/maintenance':
            payload = {'freeBytes': 10000000000, 'minimumFreeBytes': 1, 'issues': [], 'jobs': {}}
        elif path.endswith(('/preview', '/thumbnail')):
            route.fulfill(body=image.getvalue(), content_type='image/png')
            return
        else:
            file = root / 'assets' / path.lstrip('/') if path.startswith('/fonts/') else dist / (path.lstrip('/') or 'index.html')
            route.fulfill(path=str(file), content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream') if file.is_file() else route.fulfill(status=404)
            return
        route.fulfill(json=payload)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route('**/*', handle)
        page.goto('http://immich-navigation.test')
        page.get_by_role('button', name='A.jpg', exact=True).click()
        page.wait_for_function("document.querySelector('canvas')?.width > 300 && !document.querySelector('.save-action').disabled")
        # The 6000x4000 original, not the reduced 960x640 preview, sets the scale.
        width, height, dpr = page.locator('canvas').evaluate('(c)=>[c.width,c.height,window.devicePixelRatio]')
        ratio = min(dpr, 2)
        assert (width, height) == (expected[0] * ratio, expected[1] * ratio), (width, height, expected, ratio)
        assert width != 960 and height != 640
        # Hold the old album badge poll, then navigate while it remains in flight.
        page.wait_for_timeout(5200)
        assert held, 'Expected an in-flight gallery poll'
        page.get_by_label('相册过滤').select_option('B')
        expect(page.get_by_role('button', name='B.jpg', exact=True)).to_be_visible()
        expect(page.locator('canvas')).to_have_count(0)
        expect(page.locator('.statusbar')).to_have_text('未选择照片')
        expect(page.locator('.save-action')).to_be_disabled()
        for route in held:
            # An actually aborted fetch is the intended result.
            with suppress(Error):
                route.fulfill(json={'items': [item('STALE')], 'nextPage': None})
        held.clear()
        expect(page.get_by_role('button', name='STALE.jpg', exact=True)).to_have_count(0)
        page.get_by_role('button', name='B.jpg', exact=True).click()
        page.wait_for_function("document.querySelector('canvas')?.width > 300 && !document.querySelector('.save-action').disabled")
        # Any editor edit must mark the revision dirty.
        page.get_by_label('自定义文字').fill('DIRTY')
        expect(page.locator('.save-action')).to_contain_text('*')
        page.once('dialog', lambda dialog: dialog.dismiss())
        page.get_by_label('相册过滤').select_option('empty')
        expect(page.get_by_label('相册过滤')).to_have_value('B')
        expect(page.locator('canvas')).to_have_count(1)
        expect(page.locator('.save-action')).to_contain_text('*')
        page.once('dialog', lambda dialog: dialog.accept())
        page.get_by_label('相册过滤').select_option('empty')
        expect(page.get_by_text('此相册在当前源库中没有可用照片')).to_be_visible()
        expect(page.locator('canvas')).to_have_count(0)
        # Navigation stays available while metadata has not completed.
        delay_metadata = True
        page.get_by_label('相册过滤').select_option('B')
        page.get_by_role('button', name='B.jpg', exact=True).click()
        expect(page.locator('.photo-loading')).to_be_visible()
        page.get_by_label('相册过滤').select_option('empty')
        expect(page.get_by_text('此相册在当前源库中没有可用照片')).to_be_visible()
        for route in held:
            with suppress(Error):
                route.fulfill(json={'width': 6000, 'height': 4000, 'fields': {}})
        page.wait_for_timeout(100)
        expect(page.locator('canvas')).to_have_count(0)
        expect(page.locator('.photo-loading')).to_have_count(0)
        expect(page.locator('.statusbar')).to_have_text('未选择照片')
        page.get_by_label('相册过滤').select_option('error')
        expect(page.locator('.asset-list [role=alert]')).to_be_visible()
        expect(page.get_by_text('此相册在当前源库中没有可用照片')).to_have_count(0)
        assert not errors, errors
        browser.close()
    print('PASS: source dimensions, album reset, stale poll, dirty cancel/accept, loading cancellation, empty/error distinction')


if __name__ == '__main__':
    main()
