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
            payload = {"id": "test-job", "asset_id": "A", "revision": len(saved) + 1, "state": "done", "generation": 1, "error": None}
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
            page.get_by_role("button", name="A.jpg", exact=False).click()
            expect(save_button()).to_be_enabled()
            page.wait_for_selector(".preview-stage canvas")

        def save_button():
            return page.locator(".dock-actions .primary")

        def save():
            count = len(saved)
            save_button().click()
            page.wait_for_function("!document.querySelector('.dock-actions .primary').disabled")
            assert len(saved) == count + 1
            return saved[-1]

        def open_section(name):
            head = page.get_by_role("button", name=name, exact=False).and_(page.locator(".section-head"))
            if head.get_attribute("aria-expanded") != "true":
                head.click()

        load()
        # Untouched config survives load/save exactly (lossless roundtrip).
        assert save() == normal, "Untouched config must survive load/save exactly"

        # Every style card is present and renders a live thumbnail of the photo.
        for label in ("经典", "极简单行", "深色", "模糊背景", "纯留白"):
            expect(page.get_by_role("radio", name=label, exact=True)).to_be_visible()
        expect(page.locator(".style-thumb canvas")).to_have_count(5)

        # Style: minimal is a single-track footer with no logo; the right line keeps the params.
        page.get_by_role("radio", name="极简单行", exact=True).click()
        minimal = save()
        assert minimal["regions"][0]["layout"]["mode"] == "single-track"
        assert minimal["regions"][0]["slots"]["asset"]["enabled"] is False
        assert minimal["regions"][0]["slots"]["primary-start"]["content"]["chips"] == [{"field_id": "camera_model"}]
        # The existing signature survives a style switch.
        assert any(r["type"] == "free" for r in minimal["regions"])

        # Style: dark keeps the structure but uses a dark canvas.
        page.get_by_role("radio", name="深色", exact=True).click()
        dark = save()
        assert dark["canvas"]["background"] == "#141414"
        assert dark["regions"][0]["slots"]["asset"]["enabled"] is True

        page.get_by_role("radio", name="经典", exact=True).click()
        classic = save()
        assert classic["regions"][0]["layout"]["mode"] == "dual-track"
        assert classic["canvas"]["background"] == "#FFFFFF"

        # Position moves the single frame; the white space value is preserved.
        page.get_by_role("radio", name="左侧", exact=True).click()
        side = save()
        assert side["regions"][0]["type"] == "side-bar" and side["regions"][0]["edge"] == "left"
        assert side["canvas"]["margins"] == {"top": 60, "right": 60, "bottom": 60, "left": 0}
        page.keyboard.press("b")  # keyboard shortcut back to the footer
        assert save()["regions"][0]["type"] == "footer-bar"

        # Text: field chips toggle exactly the chosen field on that line.
        open_section("文字")
        page.get_by_role("group", name="上行 · 左 显示的信息").get_by_role("button", name="镜头型号").click()
        chips = save()["regions"][0]["slots"]["primary-start"]["content"]["chips"]
        assert [c["field_id"] for c in chips] == ["camera_model"], chips
        line = page.locator(".line-card").first
        line.get_by_role("radio", name="小", exact=True).click()
        line.get_by_role("radio", name="常规", exact=True).click()
        styled = save()["regions"][0]["slots"]["primary-start"]["style"]
        assert styled["font_size_level"] == "small" and styled["bold"] is False
        assert styled["font_family"] == "NotoSansCJKsc-Regular.otf"

        # Undo (keyboard) walks back one step at a time, not to the start.
        page.locator("body").click(position={"x": 5, "y": 5})
        page.keyboard.press("Meta+z")
        assert save()["regions"][0]["slots"]["primary-start"]["style"]["bold"] is True

        # Brand: auto / manual / off drive the logo slot explicitly.
        open_section("品牌 Logo")
        page.get_by_role("radio", name="不显示", exact=True).click()
        assert save()["regions"][0]["slots"]["asset"]["enabled"] is False
        page.get_by_role("radio", name="自动识别", exact=True).click()
        brand_auto = save()
        assert brand_auto["regions"][0]["slots"]["asset"]["content"]["path"] == ""
        page.get_by_role("radio", name="指定", exact=True).click()
        assert save()["regions"][0]["slots"]["asset"]["content"]["path"] == "builtin:fujifilm", "manual defaults to the detected brand"
        page.get_by_role("combobox", name="品牌", exact=True).select_option("canon")
        assert save()["regions"][0]["slots"]["asset"]["content"]["path"] == "builtin:canon"

        # Signature: the stored graphic can be switched on.
        open_section("署名")
        page.get_by_role("checkbox", name="在照片右下角显示署名").check()
        sig = save()
        assert any(r["type"] == "free" and r["enabled"] for r in sig["regions"])

        # Status honesty: after saving, an edit shows the unsaved state.
        expect(page.locator(".status-pill")).not_to_have_class("dirty")
        page.keyboard.press("r")
        expect(page.locator(".status-pill.dirty")).to_be_visible()

        # Preview click selects the clicked object without errors.
        page.locator(".preview-stage canvas").click(position={"x": 10, "y": 10})

        page.screenshot(path=str(ARTIFACTS / "desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(ARTIFACTS / "mobile.png"), full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile horizontal overflow"
        assert not errors, errors
        (ARTIFACTS / "save-payloads.json").write_text(json.dumps(saved, ensure_ascii=False, indent=2))
        browser.close()
    print(
        "PASS: five live style cards, orthogonal style switch, position keeps margin, line fields/size/weight, keyboard undo, brand auto/manual/off, signature, honest dirty status, schema-valid saves, desktop/mobile screenshots, no overflow/errors"
    )


if __name__ == "__main__":
    main()
