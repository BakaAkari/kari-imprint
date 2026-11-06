"""Prepare the preview-parity harness (apps/web/scripts/preview-harness).

Writes into apps/web/public/harness/ (gitignored):
  photo-landscape.png / photo-portrait.png  shared test photos
  fields.json                               EXIF-like fields + the photo palette
  ref/<case>.png                            PIL renders of every catalog case
  fonts/, textures/                         copies of the render assets

Then open /scripts/preview-harness/index.html on the web dev server: it
renders each case through KariImprintCanvas and diffs it against ref/.
Run: uv run python scripts/render_preview_references.py
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

from kari_core.processor.kari_imprint import _dict_to_imprint_config
from kari_core.processor.renderer import render_pil
from kari_core.shared.layout.layout_engine import compute_layout
from kari_core.shared.palette import palette_fields
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "apps" / "web" / "public" / "harness"
CATALOG = ROOT / "packages" / "kari-core" / "tests" / "fixtures" / "style_catalog.json"
SIZES = {"landscape": (1500, 1000), "portrait": (1000, 1500)}
# No make: neither renderer resolves a brand logo, so logo slots compare equal.
FIELDS = {"camera_model": "X-T5", "lens_model": "XF 23mm F1.4 R LM WR", "focal_length": "35mm", "aperture": "f/2.8",
          "shutter": "1/250s", "iso": "ISO 160", "datetime": "2026:11:07 16:40", "make": "", "artist": "Akari"}


def photo(w: int, h: int) -> Image.Image:
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    for y in range(h):
        t = y / h
        draw.line([(0, y), (w, y)], fill=(int(70 + 90 * t), int(110 + 60 * t), int(150 - 40 * t)))
    r = min(w, h) * 0.11
    draw.ellipse([w * 0.62 - r, h * 0.27 - r, w * 0.62 + r, h * 0.27 + r], fill=(236, 214, 170))
    draw.polygon([(0, h), (w * 0.35, h * 0.55), (w * 0.6, h * 0.8), (w, h * 0.5), (w, h)], fill=(38, 52, 48))
    return img


def main() -> None:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "ref").mkdir(parents=True)
    shutil.copytree(ROOT / "assets" / "fonts", OUT / "fonts")
    shutil.copytree(ROOT / "assets" / "textures", OUT / "textures")
    photos = {name: photo(*size) for name, size in SIZES.items()}
    fields = {name: {**FIELDS, **palette_fields(img)} for name, img in photos.items()}
    for name, img in photos.items():
        img.save(OUT / f"photo-{name}.png")
    cases = []
    for case in json.loads(CATALOG.read_text(encoding="utf-8")):
        orientation = "landscape" if case["image"][0] >= case["image"][1] else "portrait"
        img = photos[orientation]
        config = _dict_to_imprint_config(json.loads(json.dumps(case["config"])))
        layout = compute_layout(config, img.width, img.height)
        out = render_pil(layout, img, bg_color=config.canvas.background, field_values=fields[orientation],
                         custom_text=config.custom_text, config=config)
        name = case["id"].replace("@", "_")
        out.convert("RGB").save(OUT / "ref" / f"{name}.png")
        cases.append({"id": case["id"], "file": name, "orientation": orientation, "config": case["config"]})
    (OUT / "fields.json").write_text(json.dumps({"fields": fields, "cases": cases}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(cases)} references in {OUT}")


if __name__ == "__main__":
    main()
