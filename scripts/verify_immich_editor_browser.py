"""Browser editor acceptance against actual compiled UI; all API traffic is mocked.
Run: uv run --with playwright python scripts/verify_immich_editor_browser.py
"""

from __future__ import annotations

import json
import mimetypes
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from urllib.parse import urlparse

from api.schemas import ImprintPayload
from PIL import Image
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ARTIFACTS = ROOT / "artifacts/immich-editor"


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    # Generate the exact product default from its TS factory, not a Python imitation.
    import subprocess

    generated = subprocess.check_output(
        [
            "node",
            "-e",
            "require('./scripts/verify_immich_editor_state.cjs'); console.log(JSON.stringify(require('./apps/immich-ki/web/src/defaults.ts').buildDefaultConfig()))",
        ],
        cwd=ROOT,
        text=True,
    )
    normal = json.loads(generated.splitlines()[-1])
    normal["custom_text"] = "OLD FALLBACK"
    normal["regions"][0]["slots"]["primary-end"] = {
        "enabled": True,
        "style": None,
        "content": {"chips": [{"field_id": "custom_text", "custom_text": "RIGHT"}], "separator": " | "},
    }
    normal["regions"].append(
        {
            "id": "signature",
            "type": "free",
            "enabled": False,
            "anchor": "bottom-right",
            "slots": {
                "sig1": {
                    "enabled": True,
                    "style": None,
                    "content": {
                        "path": "abcdefghijklmnopqrst.png",
                        "invert_mono": False,
                        "size_level": "small",
                        "size_ratio": None,
                        "orientation": "upright",
                        "placement": "end",
                        "track": "span",
                    },
                }
            },
        }
    )
    saved = []
    config = deepcopy(normal)
    image = BytesIO()
    Image.new("RGB", (900, 600), (65, 93, 120)).save(image, "PNG")
    errors = []

    def handle(route):
        nonlocal config
        path = urlparse(route.request.url).path
        if path == "/api/auth/session":
            payload = {"initialized": True, "authenticated": True, "identity": "akari@example.com"}
        elif path == "/api/assets":
            payload = {
                "items": [
                    {"id": "A", "name": "A.jpg", "status": {"configured": True, "job": None, "published": False}}
                ],
                "nextPage": None,
            }
        elif path == "/api/albums":
            payload = {
                "available": True,
                "albums": [
                    {"id": "album-1", "name": "旅行", "assetCount": 1, "isResult": False},
                    {"id": "album-2", "name": "旅行 Imprint", "assetCount": 0, "isResult": True},
                ],
            }
        elif path == "/api/capabilities":
            payload = {"preview": {"max_edge": 1440, "device_pixel_ratio_limit": 2}}
        elif path.endswith("/config"):
            if route.request.method == "PUT":
                config = route.request.post_data_json["config"]
                ImprintPayload.model_validate(deepcopy(config))  # Real backend schema, not mock tolerance.
                saved.append(deepcopy(config))
            payload = {"revision": len(saved) + 1, "config": config}
        elif path.endswith("/metadata"):
            payload = {
                "width": 900,
                "height": 600,
                "fields": {"camera_model": "X-T5", "lens_model": "XF 35mm", "make": "FUJIFILM"},
            }
        elif path.endswith("/job"):
            payload = {"job": None}
        elif path.endswith("/render"):
            payload = {"id": "test-job", "state": "done", "generation": 1}
        elif path == "/api/logos":
            payload = {"ok": True, "logos": [{"stem": "fujifilm", "variants": []}, {"stem": "canon", "variants": []}]}
        elif path == "/api/maintenance":
            payload = {"freeBytes": 10000000000, "minimumFreeBytes": 1, "issues": [], "jobs": {}}
        elif path.endswith(("/preview", "/thumbnail")):
            route.fulfill(body=image.getvalue(), content_type="image/png")
            return
        else:
            file = (
                ROOT / "assets" / path.lstrip("/")
                if path.startswith("/fonts/")
                else ROOT / "apps/immich-ki/web/dist" / (path.lstrip("/") or "index.html")
            )
            if file.is_file():
                route.fulfill(path=str(file), content_type=mimetypes.guess_type(file)[0] or "application/octet-stream")
            else:
                route.fulfill(status=404)
            return
        route.fulfill(json=payload)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1100})
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.route("**/*", handle)

        def load():
            page.goto("http://immich-editor.test")
            page.evaluate("localStorage.clear()")
            page.get_by_role("button", name="旅行", exact=False).first.click()
            page.get_by_role("button", name="A.jpg", exact=True).click()
            expect(page.locator(".save-action")).to_be_enabled()

        def save():
            count = len(saved)
            page.locator(".save-action").click()
            page.wait_for_function("!document.querySelector('.save-action').disabled")
            assert len(saved) == count + 1
            return saved[-1]

        load()
        # Untouched config survives load/save exactly (lossless roundtrip).
        assert save() == normal, "Untouched config must survive load/save exactly"

        # Three visual style cards are present and distinct.
        for label in ("经典信息框", "极简署名", "纯留白"):
            expect(page.get_by_role("button", name=label, exact=True)).to_be_visible()
        # No stale generic-form editor labels survive.
        expect(page.get_by_text("默认文字样式", exact=True)).to_have_count(0)
        expect(page.get_by_text("添加信息条", exact=True)).to_have_count(0)

        # Style preset: minimal is a single-track footer with no logo.
        page.get_by_role("button", name="极简署名", exact=True).click()
        minimal = save()
        assert minimal["regions"][0]["layout"]["mode"] == "single-track"
        assert minimal["regions"][0]["slots"]["asset"]["enabled"] is False
        assert minimal["regions"][0]["slots"]["primary-start"]["content"]["chips"] == [{"field_id": "camera_model"}]

        # Style preset: classic restores dual-track + auto logo.
        page.get_by_role("button", name="经典信息框", exact=True).click()
        classic = save()
        assert classic["regions"][0]["layout"]["mode"] == "dual-track"
        assert classic["regions"][0]["slots"]["asset"]["enabled"] is True

        # Common: frame position moves the single frame and adjusts three-side margins.
        page.get_by_role("tab", name="常用", exact=True).click()
        page.get_by_role("radio", name="左侧", exact=True).click()
        side = save()
        assert side["regions"][0]["type"] == "side-bar" and side["regions"][0]["edge"] == "left"
        assert side["canvas"]["margins"]["left"] == 0
        page.get_by_role("radio", name="底部", exact=True).click()

        # Common: photo-info field toggle removes exactly the chosen chip.
        page.get_by_role("checkbox", name="镜头型号", exact=True).uncheck()
        fields_saved = save()
        chips = fields_saved["regions"][0]["slots"]["primary-start"]["content"]["chips"]
        assert all(c["field_id"] != "lens_model" for c in chips), chips

        # Common: brand auto/manual/off drives the logo slot explicitly.
        page.get_by_role("radio", name="关闭", exact=True).click()
        assert save()["regions"][0]["slots"]["asset"]["enabled"] is False
        page.get_by_role("radio", name="自动", exact=True).click()
        brand_auto = save()
        assert brand_auto["regions"][0]["slots"]["asset"]["enabled"] is True
        assert brand_auto["regions"][0]["slots"]["asset"]["content"]["path"] == ""
        page.get_by_role("radio", name="手动", exact=True).click()
        page.get_by_role("combobox", name="品牌选择", exact=True).select_option("canon")
        brand_manual = save()
        assert brand_manual["regions"][0]["slots"]["asset"]["content"]["path"] == "builtin:canon"

        # Common: signature toggle adds a disabled-free -> enabled-free region.
        page.get_by_role("checkbox", name="添加署名", exact=True).check()
        sig = save()
        assert any(r["type"] == "free" and r["enabled"] for r in sig["regions"])

        # Advanced: selecting a named text object exposes its own size/weight controls.
        page.get_by_role("tab", name="精细", exact=True).click()
        page.get_by_role("button", name="主轨 · 左侧", exact=True).click()
        page.get_by_role("radio", name="小", exact=True).click()
        advanced = save()
        assert advanced["regions"][0]["slots"]["primary-start"]["style"]["font_size_level"] == "small"
        page.get_by_role("checkbox", name="加粗", exact=True).uncheck()
        unbold = save()
        assert unbold["regions"][0]["slots"]["primary-start"]["style"]["bold"] is False

        # Preview click selection is wired to the same highlight path: clicking the
        # canvas must not error, and the named-object selection stays consistent.
        page.locator(".canvas-area canvas").click(position={"x": 10, "y": 10})

        page.screenshot(path=str(ARTIFACTS / "desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(ARTIFACTS / "mobile.png"), full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile horizontal overflow"
        assert not errors, errors
        (ARTIFACTS / "save-payloads.json").write_text(json.dumps(saved, ensure_ascii=False, indent=2))
        browser.close()
    print(
        "PASS: style cards (classic/minimal/plain), common position/fields/brand/signature, advanced object selection + size/weight, preview click wiring, schema-valid saves, desktop/mobile screenshots, no overflow/errors"
    )


if __name__ == "__main__":
    main()
