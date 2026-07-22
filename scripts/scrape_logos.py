"""Scrape official brand logos from Wikipedia/Wikimedia for camera & phone brands.

Output: assets/logos/<key>.png (transparent PNG preferred), plus assets/logos/manifest.csv
Existing files are not overwritten unless --force is passed.
"""
from __future__ import annotations

import csv
import io
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
OUT_DIR = ROOT / "assets" / "logos"
MAX_W = 1200

# (output_key, wikipedia_page, note)
BRANDS: list[tuple[str, str, str]] = [
    # camera brands (existing: canon nikon sony fujifilm olympus panasonic pentax ricoh leica hasselblad)
    ("sigma", "Sigma Corporation", "camera"),
    ("kodak", "Kodak", "camera"),
    ("casio", "Casio", "camera"),
    ("gopro", "GoPro", "action camera"),
    ("insta360", "Insta360", "action camera"),
    ("phaseone", "Phase One (company)", "medium format"),
    ("zeiss", "Carl Zeiss AG", "optics"),
    ("samsung", "Samsung", "camera+phone"),
    # phone brands
    ("apple", "Apple Inc.", "phone"),
    ("google", "Google", "phone (Pixel)"),
    ("huawei", "Huawei", "phone"),
    ("xiaomi", "Xiaomi", "phone"),
    ("oppo", "Oppo", "phone"),
    ("vivo", "Vivo (technology company)", "phone"),
    ("honor", "Honor (brand)", "phone"),
    ("oneplus", "OnePlus", "phone"),
    ("realme", "Realme", "phone"),
    ("nothing", "Nothing (company)", "phone"),
    ("asus", "Asus", "phone (ROG/Zenfone)"),
    ("motorola", "Motorola Mobility", "phone"),
    ("sharp", "Sharp Corporation", "phone (Aquos)"),
    ("meizu", "Meizu", "phone"),
    ("nokia", "Nokia", "phone"),
    ("redmi", "Redmi", "phone"),
    ("iqoo", "IQOO", "phone"),
]

UA = {"User-Agent": "kari-imprint-logo-scraper/1.0 (contact: local dev)"}


def fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def wiki_logo_url(page: str) -> tuple[str | None, str]:
    """Return (image_url, source_page_url) from Wikipedia page summary + pageimages API."""
    api = f"https://en.wikipedia.org/api/rest_v1/page/summary/{urllib.parse.quote(page)}"
    try:
        data = json.loads(fetch(api))
    except Exception as exc:
        data = {}
        summary_err = str(exc)
    else:
        summary_err = ""
    img = data.get("originalimage") or data.get("thumbnail")
    if img:
        return img["source"], data.get("content_urls", {}).get("desktop", {}).get("page", "")
    # fallback: MediaWiki pageimages API
    try:
        q = urllib.parse.urlencode({
            "action": "query", "format": "json", "prop": "pageimages",
            "piprop": "original|name", "titles": page,
        })
        d2 = json.loads(fetch(f"https://en.wikipedia.org/w/api.php?{q}"))
        for p in d2.get("query", {}).get("pages", {}).values():
            orig = p.get("original")
            if orig:
                return orig["source"], ""
    except Exception:
        pass
    # fallback: Commons file search
    try:
        q = urllib.parse.urlencode({
            "action": "query", "format": "json", "list": "search",
            "srsearch": f"File: {page} logo svg", "srnamespace": 6, "srlimit": 1,
        })
        d3 = json.loads(fetch(f"https://commons.wikimedia.org/w/api.php?{q}"))
        hits = d3.get("query", {}).get("search", [])
        if hits:
            title = hits[0]["title"]  # e.g. "File:OPPO LOGO 2019.svg"
            q2 = urllib.parse.urlencode({
                "action": "query", "format": "json", "prop": "imageinfo",
                "iiprop": "url", "titles": title,
            })
            d4 = json.loads(fetch(f"https://commons.wikimedia.org/w/api.php?{q2}"))
            for p in d4.get("query", {}).get("pages", {}).values():
                infos = p.get("imageinfo", [])
                if infos:
                    return infos[0]["url"], ""
    except Exception:
        pass
    return None, f"no-image{':' + summary_err if summary_err else ''}"


def commons_render_png(svg_url: str, width: int = MAX_W) -> bytes:
    """Render a Commons SVG to PNG via Special:FilePath."""
    filename = urllib.parse.unquote(svg_url.rsplit("/", 1)[-1])
    render = (
        "https://commons.wikimedia.org/wiki/Special:FilePath/"
        + urllib.parse.quote(filename)
        + f"?width={width}"
    )
    return fetch(render)


def has_real_transparency(img: Image.Image) -> bool:
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    extrema = alpha.getextrema()
    lo = extrema[0] if isinstance(extrema, tuple) else extrema
    return lo < 250


def process(key: str, page: str, force: bool) -> dict:
    out = OUT_DIR / f"{key}.png"
    row = {"key": key, "page": page, "status": "", "source": "", "file": out.name}
    if out.exists() and not force:
        row["status"] = "skip-existing"
        return row
    url, src = wiki_logo_url(page)
    row["source"] = src
    if not url:
        row["status"] = f"fail:{src}"
        return row
    try:
        raw = commons_render_png(url) if url.lower().endswith(".svg") else fetch(url)
        img = Image.open(io.BytesIO(raw))
        img.load()
    except Exception as exc:
        row["status"] = f"fail:download:{exc}"
        return row
    img = img.convert("RGBA")
    if img.width > MAX_W:
        h = round(img.height * MAX_W / img.width)
        img = img.resize((MAX_W, h), Image.Resampling.LANCZOS)
    transparent = has_real_transparency(img)
    img.save(out, "PNG")
    row["status"] = "ok" if transparent else "ok-opaque-bg"
    row["size"] = f"{img.width}x{img.height}"
    return row


def main() -> None:
    force = "--force" in sys.argv
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = []
    for key, page, _note in BRANDS:
        row = process(key, page, force)
        rows.append(row)
        print(f"{key:10s} {row['status']:20s} {row.get('size',''):12s} {row['source']}")
        time.sleep(0.4)  # be polite
    manifest = OUT_DIR / "manifest.csv"
    with manifest.open("a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["key", "page", "status", "size", "source", "file"])
        if manifest.stat().st_size == 0:
            writer.writeheader()
        for row in rows:
            row.setdefault("size", "")
            writer.writerow(row)
    ok = sum(1 for r in rows if r["status"].startswith("ok"))
    print(f"\ndone: {ok}/{len(rows)} fetched -> {OUT_DIR}")


if __name__ == "__main__":
    main()
