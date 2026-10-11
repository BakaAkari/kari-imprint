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
    defaults = ImprintPayload.model_validate({"schema_version": 3, "regions": []}).model_dump()
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
        "content": {
            "chips": [
                {"field_id": "custom_text", "custom_text": "RIGHT"},
                {"field_id": "custom_text", "custom_text": ""},
            ],
            "separator": " | ",
        },
    }
    normal["regions"][0]["slots"]["secondary-end"] = {
        "enabled": False,
        "style": deepcopy(normal["defaults"]),
        "content": {"chips": [], "separator": "/"},
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
            payload = {"initialized": True, "authenticated": True}
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
            payload = {"width": 900, "height": 600, "fields": {"camera_model": "Test camera"}}
        elif path.endswith("/job"):
            payload = {"job": None}
        elif path.endswith("/render"):
            payload = {"id": "test-job", "state": "done", "generation": 1}
        elif path == "/api/logos":
            payload = {"ok": True, "logos": []}
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
        assert save() == normal, "Untouched config must survive load/save exactly"
        expect(page.get_by_text("上排文字字段", exact=True)).to_have_count(0)
        expect(page.get_by_text("高级参数 · ADVANCED", exact=True)).to_have_count(0)
        expect(page.get_by_text("默认文字样式", exact=True)).to_have_count(1)
        page.get_by_text("默认文字样式", exact=True).click()
        expect(page.get_by_role("combobox", name="字号方式", exact=True)).to_have_value("level")
        page.get_by_role("combobox", name="字体", exact=True).select_option("NotoSansCJKsc-Regular.otf")
        page.get_by_role("combobox", name="字号方式", exact=True).select_option("ratio")
        page.get_by_role("spinbutton", name="字号比例", exact=True).fill("0.5")
        styled = save()
        assert styled["defaults"]["bold"] is False
        assert styled["defaults"]["font_family"] == "NotoSansCJKsc-Regular.otf"
        assert styled["defaults"]["font_size_ratio"] == 0.5
        page.get_by_role("spinbutton", name="字号比例", exact=True).fill("0.51")
        assert save()["defaults"]["font_size_ratio"] == 0.5
        page.get_by_role("spinbutton", name="字号比例", exact=True).fill("0.2")
        save()
        page.get_by_text("默认文字样式", exact=True).click()
        primary = page.locator('[aria-label="区域 footer"] [data-slot="primary-start"]')
        primary.locator("summary").first.click()
        primary.get_by_role("button", name="+ 字段", exact=True).click()
        primary.get_by_label("字段 3", exact=True).select_option("custom_text")
        primary.get_by_placeholder("自定义文本").fill("LOCAL ONLY")
        modified = save()
        assert modified["regions"][0]["slots"]["primary-start"]["content"]["chips"][-1] == {
            "field_id": "custom_text",
            "custom_text": "LOCAL ONLY",
        }
        assert modified["regions"][0]["slots"]["primary-end"] == normal["regions"][0]["slots"]["primary-end"]
        assert modified["regions"][1] == normal["regions"][1]
        assert modified["custom_text"] == "OLD FALLBACK"
        primary.get_by_placeholder("自定义文本").fill("")
        cleared = save()
        assert cleared["regions"][0]["slots"]["primary-start"]["content"]["chips"][-1] == {
            "field_id": "custom_text",
            "custom_text": "",
        }
        # Empty local text retains the actual backend fallback semantics, never deletes other chips.
        primary.get_by_placeholder("自定义文本").fill("LOCAL ONLY")
        primary.get_by_text("此处文字样式 · 独立设置", exact=True).click()
        primary.get_by_label("使用独立样式", exact=True).check()
        primary.get_by_role("textbox", name="文字颜色", exact=True).fill("#123456")
        primary.get_by_label("使用独立样式", exact=True).uncheck()
        assert save()["regions"][0]["slots"]["primary-start"]["style"] is None
        page.screenshot(path=str(ARTIFACTS / "desktop.png"), full_page=True)
        page.get_by_text("位置与布局", exact=True).first.click()
        page.get_by_role("combobox", name="边框位置", exact=True).select_option("left")
        page.get_by_role("combobox", name="排版轨道", exact=True).select_option("single-track")
        expect(page.get_by_text("主轨 · 起点", exact=False).first).to_be_visible()
        expect(page.get_by_text("次轨 · 起点", exact=False).first).to_contain_text("单轨时不显示")
        side = save()
        assert side["regions"][0]["type"] == "side-bar"
        assert side["regions"][0]["layout"]["mode"] == "single-track"
        assert side["regions"][0]["slots"]["secondary-end"] == normal["regions"][0]["slots"]["secondary-end"]
        page.set_viewport_size({"width": 390, "height": 844})
        page.screenshot(path=str(ARTIFACTS / "mobile.png"), full_page=True)
        assert page.evaluate("document.documentElement.scrollWidth <= window.innerWidth"), "Mobile horizontal overflow"
        config = defaults
        page.set_viewport_size({"width": 1440, "height": 1100})
        load()
        assert save() == defaults, "No-flow config must not acquire synthetic slots/signatures"
        page.get_by_role("button", name="添加信息条", exact=True).click()
        added = save()
        assert len(added["regions"]) == 1
        assert added["regions"][0]["type"] == "footer-bar"
        page.get_by_role("button", name="添加签名", exact=True).click()
        assert len(save()["regions"]) == 2
        assert not errors, errors
        (ARTIFACTS / "save-payloads.json").write_text(json.dumps(saved, ensure_ascii=False, indent=2))
        browser.close()
    print(
        "PASS: exact UI roundtrip, unique ownership, per-chip custom text + legacy fallback, style inheritance, disabled signature retention, side/single-track, no-flow add, schema-valid saves, desktop/mobile screenshots, no overflow/errors"
    )


if __name__ == "__main__":
    main()
