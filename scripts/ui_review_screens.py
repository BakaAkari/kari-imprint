"""Screenshot the companion panel (mocked API) for UI review. Dev-only tool."""
from __future__ import annotations

import mimetypes
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / 'apps/immich-ki/web/dist'
OUT = ROOT / '.ui-review'
OUT.mkdir(exist_ok=True)

ASSET = '11111111-1111-4111-8111-111111111111'


def payload_for(path: str, method: str):
    if path == '/api/auth/session':
        return {'mode': 'token', 'initialized': True, 'authenticated': False}
    if path in {'/api/auth/immich-login', '/api/login', '/api/init'}:
        return {'ok': True}
    if path == '/api/assets':
        items = []
        states = [None, 'awaiting_import', 'refresh_pending', 'failed', 'done', 'running']
        for i in range(8):
            state = states[i % len(states)]
            items.append({'id': f'11111111-1111-4111-8111-11111111111{i:02d}', 'name': f'DSCF{1000 + i}.jpg',
                          'status': {'configured': state is not None, 'job': state, 'published': state in ('awaiting_import', 'refresh_pending', 'done')}})
        return {'items': items, 'nextPage': None}
    if path == '/api/albums':
        return {'albums': [{'id': '33333333-3333-4333-8333-333333333333', 'name': '旅行 2026', 'assetCount': 42}], 'available': True}
    if path == '/api/capabilities':
        return {'preview': {'max_edge': 1440, 'device_pixel_ratio_limit': 2}}
    if path.endswith('/job'):
        return {'job': None}
    if path.endswith('/config'):
        return {'revision': 0, 'config': None}
    if path.endswith('/metadata'):
        return {'fields': {'make': 'FUJIFILM', 'camera_model': 'FUJIFILM X-T5', 'lens_model': 'XF 35mm F1.4 R',
                           'focal_length': '35mm', 'aperture': 'f/1.4', 'shutter': '1/250', 'iso': 'ISO 125'}, 'width': 960, 'height': 640}
    if path == '/api/logos':
        return {'ok': True, 'logos': [{'stem': 'fujifilm', 'variants': []}, {'stem': 'nikon', 'variants': []}]}
    return None


def main():
    from io import BytesIO

    from PIL import Image
    image = BytesIO()
    Image.new('RGB', (960, 640), (40, 90, 150)).save(image, 'PNG')
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for label, viewport in [('desktop', {'width': 1600, 'height': 1000}), ('mobile', {'width': 390, 'height': 844})]:
            page = browser.new_page(viewport=viewport)
            errors = []
            page.on('pageerror', lambda e, errs=errors: errs.append(str(e)))

            def handle(route):
                path = urlparse(route.request.url).path
                payload = payload_for(path, route.request.method)
                if payload is not None:
                    route.fulfill(json=payload)
                elif path.endswith('/preview') or (path.startswith('/api/assets/') and path.endswith('/thumbnail')):
                    route.fulfill(body=image.getvalue(), content_type='image/png')
                elif path.startswith('/api/builtin-logos/'):
                    logo = BytesIO()
                    Image.new('RGBA', (120, 40), (30, 30, 30, 255)).save(logo, format='PNG')
                    route.fulfill(body=logo.getvalue(), content_type='image/png')
                else:
                    file = DIST / (path.lstrip('/') or 'index.html')
                    if file.is_file():
                        route.fulfill(path=str(file), content_type=mimetypes.guess_type(file)[0] or 'application/octet-stream')
                    else:
                        route.fulfill(status=404)
            page.route('**/*', handle)
            page.goto('http://panel.test')
            page.screenshot(path=str(OUT / f'{label}-1-login.png'))
            page.get_by_label('Immich 邮箱').fill('demo@example.com')
            page.get_by_label('Immich 密码').fill('x' * 12)
            page.get_by_role('button', name='进入图库').click()
            page.wait_for_selector('.asset-card')
            page.screenshot(path=str(OUT / f'{label}-2-gallery.png'))
            page.get_by_role('button', name='DSCF1001.jpg', exact=True).click()
            page.wait_for_selector('canvas')
            page.wait_for_timeout(600)
            page.screenshot(path=str(OUT / f'{label}-3-editor.png'))
            if label == 'desktop':
                page.locator('.maintenance summary').click()
                page.screenshot(path=str(OUT / f'{label}-4-maintenance.png'))
            print(label, 'js errors:', errors)
            page.unroute('**/*')
            page.close()
        browser.close()


if __name__ == '__main__':
    main()
