"""Mocked browser acceptance for the immich-ki album browsing flow.

Covers: hidden result albums, infinite-scroll paging with dedup, the
photo editor (open/save, automatic local drafts with badge + discard toast,
back navigation with scroll restore),
stale request isolation across album switches, and error states.

Build apps/immich-ki/web first, then run from the repo root:
    uv run --with playwright python scripts/verify_immich_album_navigation.py
No external services, credentials, or real photos are used.
"""

from __future__ import annotations

import mimetypes
import re
import time
from contextlib import suppress
from io import BytesIO
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from api.schemas import ImprintPayload
from PIL import Image
from playwright.sync_api import Error, expect, sync_playwright

GALLERY_SCROLL = ".gallery-scroll"
IDENTITY = "tester"
TRIP_TOTAL = 40


def main():
    root = Path(__file__).resolve().parents[1]
    dist = root / "apps/immich-ki/web/dist"
    config = ImprintPayload.model_validate(
        {"schema_version": 3, "canvas": {"margins": {"bottom": 100}}, "regions": []}
    ).model_dump()

    def item(asset_id, name, width=400, height=800):
        return {
            "id": asset_id,
            "name": name,
            "width": width,
            "height": height,
            "status": {"configured": False, "job": None, "published": False},
        }

    trip_page1 = [item(f"p{i}", f"P{i}.jpg") for i in range(1, 7)]
    # Page 2 re-sends p3 on purpose: the gallery must deduplicate it. It is
    # long enough that the square-tile grid scrolls well past 400px (test G).
    trip_page2 = [item(f"p{i}", f"P{i}.jpg") for i in range(7, TRIP_TOTAL + 1)] + [item("p3", "P3.jpg")]
    city_page1 = [item(f"t{i}", f"T{i}.jpg") for i in range(1, 4)]
    slow_page1 = [item("s1", "S1.jpg"), item("s2", "S2.jpg")]
    albums = [
        {"id": "trip", "name": "Trip 2024", "assetCount": TRIP_TOTAL},
        {"id": "city", "name": "City Walk", "assetCount": 3},
        {"id": "slow", "name": "Slow Album", "assetCount": 2},
        {"id": "empty", "name": "Empty Album", "assetCount": 0},
        {"id": "result-a", "name": "Trip 2024 Imprint", "assetCount": TRIP_TOTAL, "isResult": True},
    ]
    pages = {
        ("trip", "1"): (trip_page1, "2"),
        ("trip", "2"): (trip_page2, None),
        ("city", "1"): (city_page1, None),
        ("slow", "1"): (slow_page1, None),
        ("empty", "1"): ([], None),
    }

    buffer = BytesIO()
    Image.new("RGB", (60, 90), (40, 90, 150)).save(buffer, "PNG")
    png = buffer.getvalue()

    asset_requests = []  # every /api/assets list call as (album, page)
    render_payloads = []  # bodies of POST /api/assets/<id>/render
    rendered = []  # asset ids rendered (reported back via album activity)
    drafts = {}  # server-side drafts by asset id
    look = {"revision": 0, "config": None}  # album look
    held_page2 = []  # deferred trip page-2 responses (released in test C)
    held_slow = []  # deferred slow-album responses (released in test I)
    flags = {"hold_page2": True, "hold_slow": True, "albums_fail": False}
    errors = []

    def release(routes, payload):
        for route in routes:
            # An aborted fetch (album switch) may already be gone; ignore that.
            with suppress(Error):
                route.fulfill(json=payload)
        routes.clear()

    def wait_for_request(album, page_num, timeout=10):
        deadline = time.time() + timeout
        while time.time() < deadline and (album, page_num) not in asset_requests:
            page.wait_for_timeout(50)
        assert (album, page_num) in asset_requests, f"{album} page {page_num} was never requested"

    def handle(route):
        parsed = urlparse(route.request.url)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == "/api/auth/session":
            payload = {"mode": "immich", "initialized": True, "authenticated": True, "identity": IDENTITY}
        elif path == "/api/assets":
            album = query.get("album", [""])[0]
            page_num = query.get("page", ["1"])[0]
            asset_requests.append((album, page_num))
            if album == "trip" and page_num == "2" and flags["hold_page2"]:
                held_page2.append(route)
                return
            if album == "slow" and flags["hold_slow"]:
                held_slow.append(route)
                return
            items, following = pages.get((album, page_num), ([], None))
            # Server-side drafts show up in the gallery status, as on the real worker.
            items = [{**item, "status": {**item["status"], "draft": item["id"] in drafts, **({"state": "draft"} if item["id"] in drafts else {})}} for item in items]
            payload = {"items": items, "nextPage": following}
        elif path == "/api/albums":
            payload = {"available": not flags["albums_fail"], "albums": [] if flags["albums_fail"] else albums}
        elif path == "/api/capabilities":
            payload = {
                "upload": {"max_file_bytes": 268435456, "allowed_extensions": ["jpg", "png"]},
                "preview": {"max_edge": 1440, "device_pixel_ratio_limit": 2},
                "process": {"max_image_pixels": 400000000, "concurrency": 2},
            }
        elif path == "/api/logos":
            payload = {"ok": True, "logos": []}
        elif path == "/api/maintenance":
            payload = {"freeBytes": 10000000000, "minimumFreeBytes": 1, "jobs": {}, "issues": []}
        elif path == "/api/jobs/job-1":
            payload = {"id": "job-1", "asset_id": "p3", "revision": 2, "generation": 1, "state": "done", "error": None}
        elif path.endswith("/render"):
            render_payloads.append(route.request.post_data_json)
            rendered.append(path.split("/")[3])
            payload = {
                "id": "job-1",
                "asset_id": path.split("/")[3],
                "revision": 2,
                "generation": 1,
                "state": "queued",
                "error": None,
            }
        elif path.endswith("/look"):
            if route.request.method == "PUT":
                look.update(revision=look["revision"] + 1, config=route.request.post_data_json["config"])
            payload = {**look, "impact": {"follow": 0, "exceptions": 0, "stale": 0}}
        elif path.endswith("/summary"):
            route.fulfill(status=404, json={"error": "not_found"})
            return
        elif path.endswith("/activity"):
            payload = {"jobs": [{"assetId": a, "id": "job-1", "state": "done", "error": None, "generation": 1} for a in rendered], "waiting": 0}
        elif path.endswith("/draft"):
            asset_id = path.split("/")[3]
            if route.request.method == "PUT":
                drafts[asset_id] = route.request.post_data_json["config"]
            else:
                drafts.pop(asset_id, None)
            payload = {"ok": True}
        elif path.endswith("/config"):
            asset_id = path.split("/")[3]
            if route.request.method == "PUT":
                drafts.pop(asset_id, None)
            payload = {"revision": 2 if route.request.method == "PUT" else 1, "saved": config, "look": look if look["config"] else None,
                       "mode": "standalone", "overrides": [], "resolved": None, "draft": drafts.get(asset_id), "stale": False, "conflict": False}
        elif path.endswith("/job"):
            payload = {"job": None}
        elif path.endswith("/metadata"):
            payload = {"width": 6000, "height": 4000, "fields": {}}
        elif path.endswith(("/preview", "/thumbnail")):
            route.fulfill(body=png, content_type="image/png")
            return
        else:
            file = (
                root / "assets" / path.lstrip("/")
                if path.startswith("/fonts/")
                else dist / (path.lstrip("/") or "index.html")
            )
            if file.is_file():
                route.fulfill(path=str(file), content_type=mimetypes.guess_type(file)[0] or "application/octet-stream")
            else:
                route.fulfill(status=404)
            return
        route.fulfill(json=payload)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.route("**/*", handle)
        page.goto("http://immich-navigation.test")

        def album_button(name):
            return page.locator(".album-item").filter(has=page.locator(".album-name").get_by_text(name, exact=True))

        def tile(name):
            # Tile accessible names are "<file>，<status>".
            return page.locator(f'.photo-tile[aria-label^="{name}，"]')

        def draft_keys():
            # Drafts live on the worker (design 2026-10-20), keyed by asset.
            page.wait_for_timeout(300)
            return sorted(drafts)

        def wait_loaded():
            page.wait_for_function(
                "document.querySelector('.preview-stage canvas')?.width > 300"
                " && !document.querySelector('.dock-actions .primary')?.disabled"
            )

        status_pill = page.locator(".status-pill")
        save_button = page.locator(".dock-actions .primary")
        crumb_name = page.locator(".crumbs .crumb-name")
        toast = page.locator(".toast")

        # A ─ album list: result albums are never offered as sources, even if an
        # older worker still returns them; normal albums are selectable.
        expect(album_button("Trip 2024 Imprint")).to_have_count(0)
        trip_card = album_button("Trip 2024")
        expect(trip_card).to_have_count(1)
        expect(trip_card).to_be_enabled()
        expect(trip_card).to_contain_text(f"{TRIP_TOTAL} 张")

        # E (part 1) ─ with no photo selected, editor and settings panel are absent.
        expect(page.locator(".app.is-browsing")).to_have_count(1)
        expect(page.locator(".edit")).to_have_count(0)
        expect(page.locator(".panel")).to_have_count(0)

        # B ─ selecting the normal album renders page 1 of the grid only.
        trip_card.click()
        expect(trip_card).to_have_attribute("aria-pressed", "true")
        expect(page.locator(".album-side h2")).to_have_text("Trip 2024")
        expect(page.locator(".photo-tile")).to_have_count(6)
        expect(tile("P7.jpg")).to_have_count(0)

        # C ─ scrolling to the bottom auto-loads page 2; there is no pager UI.
        page.locator(GALLERY_SCROLL).evaluate("el => { el.scrollTop = el.scrollHeight; }")
        wait_for_request("trip", "2")
        release(held_page2, {"items": trip_page2, "nextPage": None})
        flags["hold_page2"] = False
        expect(page.locator(".photo-tile")).to_have_count(TRIP_TOTAL)
        expect(page.get_by_role("button", name=re.compile("下一页|上一页|Next|Prev"))).to_have_count(0)
        expect(page.locator(".gallery-sentinel")).to_contain_text(f"共 {TRIP_TOTAL} 张")

        # D ─ a photo repeated by page 2 still appears exactly once.
        expect(tile("P3.jpg")).to_have_count(1)

        # E (part 2) ─ clicking a photo opens editor, canvas and settings panel.
        tile("P2.jpg").click()
        expect(page.locator(".app.is-editing .edit")).to_be_visible()
        expect(page.locator(".panel")).to_have_count(1)
        expect(crumb_name).to_have_text("P2.jpg")
        wait_loaded()
        expect(save_button).to_be_enabled()
        expect(save_button).to_have_text("保存到 Immich")

        # H ─ leaving a dirty photo keeps its changes as a local draft (no modal),
        # announces it in a toast, and restores it when the photo is reopened.
        page.get_by_role("radio", name="深色", exact=True).click()
        expect(status_pill).to_contain_text("草稿")
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.keyboard.press("ArrowRight")
        expect(crumb_name).to_have_text("P3.jpg")
        expect(page.locator(".modal")).to_have_count(0)
        expect(toast).to_contain_text("「P2.jpg」的修改已存为草稿")
        expect(toast.get_by_role("button", name="放弃草稿")).to_be_visible()
        assert draft_keys() == ["p2"], draft_keys()
        wait_loaded()
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.keyboard.press("ArrowLeft")
        expect(crumb_name).to_have_text("P2.jpg")
        wait_loaded()
        expect(status_pill).to_contain_text("草稿")
        expect(page.get_by_role("radio", name="深色", exact=True)).to_be_checked()
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.keyboard.press("ArrowRight")
        expect(crumb_name).to_have_text("P3.jpg")
        wait_loaded()
        expect(save_button).to_be_enabled()
        expect(save_button).to_have_text("保存到 Immich")
        assert draft_keys() == ["p2"], draft_keys()

        # F ─ saving posts the render job with the current source album id.
        save_button.click()
        expect(status_pill).to_contain_text(re.compile("排队中|正在生成|已保存到 Immich"))
        assert render_payloads == [{"revision": 2, "sourceAlbumId": "trip"}], render_payloads

        def close_photo():
            page.locator(".crumbs button").first.click()

        # G ─ closing the photo restores the album view and its scroll offset;
        # the unsaved photo carries a draft badge in the gallery.
        expect(page.locator(".crumbs button").first).to_have_text("← Trip 2024")
        close_photo()
        expect(page.locator(".edit")).to_have_count(0)
        expect(page.locator(".panel")).to_have_count(0)
        expect(page.locator(".photo-grid")).to_be_visible()
        expect(tile("P2.jpg")).to_have_attribute("aria-label", "P2.jpg，草稿")
        expect(tile("P2.jpg").locator(".asset-badge.draft")).to_have_text("草稿")
        page.locator(GALLERY_SCROLL).evaluate("el => { el.scrollTop = 400; }")
        page.wait_for_function("document.querySelector('.gallery-scroll').scrollTop === 400")
        visible_tile = page.evaluate("""() => {
            const scroll = document.querySelector('.gallery-scroll');
            const bounds = scroll.getBoundingClientRect();
            for (const tile of scroll.querySelectorAll('.photo-tile')) {
                const box = tile.getBoundingClientRect();
                if (box.top >= bounds.top && box.bottom <= bounds.bottom) return tile.getAttribute('aria-label');
            }
            return null;
        }""")
        assert visible_tile, "no fully visible photo tile at the target scroll offset"
        captured = page.evaluate("document.querySelector('.gallery-scroll').scrollTop")
        assert captured > 100, f"gallery was not scrolled before opening a photo: {captured}"
        # Dispatch the click through the DOM: Playwright's own click auto-scrolls
        # the tile into view, which would change the offset under test.
        clicked = page.evaluate(
            """(name) => {
            for (const tile of document.querySelectorAll('.photo-tile')) {
                if (tile.getAttribute('aria-label') === name) { tile.click(); return true; }
            }
            return false;
        }""",
            visible_tile,
        )
        assert clicked, f"photo tile {visible_tile} vanished before the click"
        expect(page.locator(".edit")).to_be_visible()
        wait_loaded()
        # Esc (nothing selected) returns to the gallery.
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.keyboard.press("Escape")
        expect(page.locator(".edit")).to_have_count(0)
        expect(page.locator(".panel")).to_have_count(0)
        page.wait_for_function(f"Math.abs(document.querySelector('.gallery-scroll').scrollTop - {captured}) <= 5")
        restored = page.evaluate("document.querySelector('.gallery-scroll').scrollTop")
        assert abs(restored - captured) <= 5, (captured, restored)

        # H (part 2) ─ the toast's discard action drops the draft and its badge.
        tile("P2.jpg").click()
        expect(crumb_name).to_have_text("P2.jpg")
        wait_loaded()
        expect(status_pill).to_contain_text("草稿")
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.keyboard.press("ArrowRight")
        expect(crumb_name).to_have_text("P3.jpg")
        expect(toast).to_contain_text("「P2.jpg」的修改已存为草稿")
        toast.get_by_role("button", name="放弃草稿").click()
        expect(toast).to_have_count(0)
        assert draft_keys() == [], draft_keys()
        wait_loaded()
        close_photo()
        expect(tile("P2.jpg")).to_have_attribute("aria-label", "P2.jpg，未生成")

        # I ─ switching albums requests the new id and drops the stale response.
        album_button("Slow Album").click()
        wait_for_request("slow", "1")
        album_button("City Walk").click()
        expect(tile("T1.jpg")).to_be_visible()
        assert ("city", "1") in asset_requests
        release(held_slow, {"items": slow_page1, "nextPage": None})
        flags["hold_slow"] = False
        expect(tile("S1.jpg")).to_have_count(0)
        expect(page.locator(".photo-tile")).to_have_count(3)

        # K ─ an album without usable photos says so.
        album_button("Empty Album").click()
        expect(page.get_by_text("此相册在当前源库中没有可用照片")).to_be_visible()
        expect(page.locator(".photo-tile")).to_have_count(0)

        # J ─ album read failure surfaces the permission alert after a reload.
        flags["albums_fail"] = True
        page.reload()
        expect(page.get_by_text("无法读取相册，请检查 Immich 的 album.read 权限。")).to_be_visible()

        # L ─ the whole session stayed free of page errors.
        assert not errors, errors
        browser.close()
    print(
        "PASS: hidden result album, infinite scroll (auto page 2, no pager, dedup), editor open + render payload, auto draft (toast, restore, badge, discard), scroll restore, stale album response dropped, empty + permission errors, no page errors"
    )


if __name__ == "__main__":
    main()
