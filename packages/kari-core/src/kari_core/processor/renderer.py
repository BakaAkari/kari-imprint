"""Region-Based PIL Renderer — 后端图像渲染器。

此模块只负责按 LayoutResult 绘制 / 粘贴，不做任何位置计算。
所有坐标、尺寸均来自 layout engine 输出的 LayoutResult。

职责边界：
  - 布局引擎 (shared.layout.layout_engine): 计算每个元素在画布上的绝对位置
  - 本渲染器: 把内容（文本 / Logo / 签名）按指定位置粘贴到画布上
"""

from __future__ import annotations

import re
from dataclasses import replace
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont

from kari_core.core.auto_logo import match_brand_stem
from kari_core.core.config_loader import FONTS_DIR, LOGOS_DIR
from kari_core.core.image_io import load_logo
from kari_core.core.logger import logger
from kari_core.processor.effects import (
    compose_background,
    effect_is_active,
    needs_composed_background,
    photo_radius_px,
    round_photo_corners,
    save_corner_backgrounds,
)
from kari_core.shared.layout.layout_engine import (
    DIVIDER_OPACITY,
    ComputedElement,
    ImprintConfig,
    LayoutResult,
    LogoContent,
    SignatureContent,
    TextContent,
    divider_color,
    resolve_ink_scheme,
)
from kari_core.shared.layout.text_fit import FittedText, fit_layout_texts, fit_single

_LOGO_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}

# Runtime cache keyed by (absolute path, mtime_ns, size) → (w, h). Aspect ratio
# is a rendering-time fact derived from the file, not a user-facing config
# value, so it never crosses the API boundary; caching by mtime+size is enough
# to keep repeated renders cheap without going stale on edits.
_LOGO_DIMS_CACHE: dict[tuple[str, int, int], tuple[int, int]] = {}


def _read_image_dimensions(path: str) -> tuple[int, int] | None:
    try:
        stat = Path(path).stat()
    except OSError:
        return None
    key = (path, stat.st_mtime_ns, stat.st_size)
    cached = _LOGO_DIMS_CACHE.get(key)
    if cached is not None:
        return cached
    try:
        with Image.open(path) as img:
            dims = img.size
    except (FileNotFoundError, OSError, Image.UnidentifiedImageError):
        return None
    _LOGO_DIMS_CACHE[key] = dims
    return dims

# ── 颜色解析 ──────────────────────────────────────────────────────────


def _parse_color(color_str: str) -> tuple[int, int, int, int]:
    """将颜色字符串解析为 RGBA 元组。

    支持格式:
      - #RRGGBB
      - #RRGGBBAA
      - 常见 CSS 颜色名（白/黑等通过 Pillow 解析）
    """
    color_str = color_str.strip().lstrip("#")
    if len(color_str) == 6:
        return (
            int(color_str[0:2], 16),
            int(color_str[2:4], 16),
            int(color_str[4:6], 16),
            255,
        )
    if len(color_str) == 8:
        return (
            int(color_str[0:2], 16),
            int(color_str[2:4], 16),
            int(color_str[4:6], 16),
            int(color_str[6:8], 16),
        )
    # 回退: 尝试 Pillow ImageColor
    try:
        from PIL import ImageColor

        rgba = ImageColor.getcolor(f"#{color_str}" if color_str else "white", "RGBA")
        if isinstance(rgba, int):
            return (rgba, rgba, rgba, 255)
        return rgba  # type: ignore[return-value]
    except Exception:
        return (255, 255, 255, 255)


# ── 文本解析（chips → 实际字符串）─────────────────────────────────────


def _resolve_field_value(
    field_id: str, field_values: dict[str, str], custom_text: str
) -> str:
    """将 field_id 解析为实际文本值。"""
    if field_id == "custom_text":
        return custom_text or ""
    if field_id == "empty":
        return ""
    return field_values.get(field_id, "")


def _build_text(
    content: TextContent, field_values: dict[str, str], custom_text: str
) -> str:
    """将 TextContent 的 chips 拼接为实际文本字符串。

    Mirrors ``buildText`` in ``apps/web/src/KariImprintCanvas.tsx``: empty values
    contribute no separator, and the make is dropped when the camera model on
    the same line already starts with it ("Canon" + "Canon EOS R5").
    """
    field_ids = {chip.field_id for chip in content.chips}
    make = (field_values.get("make") or "").strip()
    model = (field_values.get("camera_model") or "").strip()
    redundant_make = bool(
        make and "camera_model" in field_ids and (model.lower() == make.lower() or model.lower().startswith(make.lower() + " "))
    )
    texts: list[str] = []
    for chip in content.chips:
        if chip.field_id == "empty" or (chip.field_id == "make" and redundant_make):
            continue
        # 优先使用 chip 级别的 custom_text（前端 v3Types 支持）
        chip_custom = getattr(chip, "custom_text", "") or ""
        if chip.field_id == "custom_text" and chip_custom:
            value = chip_custom
        else:
            value = _resolve_field_value(chip.field_id, field_values, custom_text)
        if value:
            texts.append(value)
    return content.separator.join(texts)


# ── 字体加载 ──────────────────────────────────────────────────────────


def _load_font(font_path: str, size: int) -> ImageFont.FreeTypeFont:
    """加载指定字体；仅回退到支持中文且保持字号的内置字体。"""
    path = Path(font_path)
    if not path.is_absolute():
        path = FONTS_DIR / font_path

    try:
        return ImageFont.truetype(str(path), size)
    except OSError:
        for fallback in (
            FONTS_DIR / "NotoSansCJKsc-Regular.otf",
            FONTS_DIR / "AlibabaPuHuiTi-2-45-Light.otf",
        ):
            try:
                return ImageFont.truetype(str(fallback), size)
            except OSError:
                continue
        # A tiny Latin-only default can make a successful export appear blank.
        # Fail the render instead of publishing a silently degraded watermark.
        raise OSError("watermark_font_unavailable") from None


# ── Anchor → PIL paste 左上角坐标 ─────────────────────────────────────


def _anchor_to_paste_offset(
    anchor: str, element_w: int, element_h: int
) -> tuple[int, int]:
    """将 LayoutResult 中的 anchor 点转换为 PIL paste 所需的左上角偏移量。

    LayoutResult 中 ComputedElement.rect.(x, y) 是 anchor 点的绝对坐标。
    本函数返回从 anchor 点到元素左上角的 (dx, dy) 偏移。
    """
    dx = 0
    dy = 0

    if "center" in anchor:
        dx = -element_w // 2
    elif "right" in anchor:
        dx = -element_w

    if "middle" in anchor:
        dy = -element_h // 2
    elif "bottom" in anchor:
        dy = -element_h

    return dx, dy


# ── 元素渲染 ──────────────────────────────────────────────────────────


_NOTO_WEIGHTS = {"NotoSansCJKsc-Regular.otf", "NotoSansCJKsc-Bold.otf"}


def effective_font_family(style) -> str:
    """The font file to measure and draw with.

    The browser preview selects weight from ``style.bold`` (400/700 of the
    same Noto family), so for the two bundled Noto weights the ``bold`` flag
    decides the file here too; otherwise fitting would truncate the output at
    a different point than the preview the user approved.
    """
    family = style.font_family
    if family in _NOTO_WEIGHTS:
        return "NotoSansCJKsc-Bold.otf" if style.bold else "NotoSansCJKsc-Regular.otf"
    return family


class _FontCache:
    """Per-render font cache so text fitting can probe many sizes cheaply."""

    def __init__(self) -> None:
        self._fonts: dict[tuple[str, int], ImageFont.FreeTypeFont] = {}

    def get(self, family: str, size: int) -> ImageFont.FreeTypeFont:
        key = (family, max(1, int(size)))
        font = self._fonts.get(key)
        if font is None:
            font = _load_font(family, key[1])
            self._fonts[key] = font
        return font

    def measure(self, el: ComputedElement, text: str, size: int) -> float:
        return float(self.get(effective_font_family(el.style), size).getlength(text))


def _slot_length(el: ComputedElement) -> int:
    direction = el.style.text_direction or "horizontal"
    return el.rect.h if direction in {"rotate-cw", "rotate-ccw"} else el.rect.w


def _render_text_element(
    el: ComputedElement,
    field_values: dict[str, str],
    custom_text: str,
    fitted: FittedText | None = None,
    fonts: _FontCache | None = None,
) -> Image.Image:
    """将文本元素渲染为透明背景的 PIL Image。

    ``fitted`` carries the size/text chosen by ``fit_layout_texts``; when it is
    omitted the element is fitted to its own slot length.
    """
    content = el.content
    if not isinstance(content, TextContent):
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))

    fonts = fonts or _FontCache()
    style = el.style
    direction = getattr(style, "text_direction", None) or "horizontal"
    text = _build_text(content, field_values, custom_text)
    font_size = style.font_size or 16
    if fitted is not None:
        text, font_size = fitted.text, fitted.font_size
    elif text and direction != "vertical-glyphs":
        single = fit_single(text, font_size, _slot_length(el), lambda t, s: fonts.measure(el, t, s))
        text, font_size = single.text, single.font_size
    if not text:
        return Image.new("RGBA", (1, 1), (0, 0, 0, 0))

    font = fonts.get(effective_font_family(style), font_size)
    color = _parse_color(style.color)

    if direction == "vertical-glyphs":
        glyphs = list(text)
        advance = max(1, round(font_size * style.line_height))
        boxes = [font.getbbox(glyph) for glyph in glyphs]
        width = max((max(1, int(box[2] - box[0])) for box in boxes), default=font_size)
        img = Image.new("RGBA", (width, max(1, advance * len(glyphs))), (0, 0, 0, 0))
        draw = ImageDraw.Draw(img)
        for index, (glyph, box) in enumerate(zip(glyphs, boxes, strict=True)):
            glyph_w = max(1, int(box[2] - box[0]))
            draw.text(((width - glyph_w) // 2 - box[0], index * advance - box[1]), glyph, font=font, fill=color)
        return img

    # 测量文本尺寸（getbbox 返回 (left, top, right, bottom)）
    bbox = font.getbbox(text)
    if bbox:
        text_w = max(1, int(bbox[2] - bbox[0]))
        text_h = max(1, int(bbox[3] - bbox[1]))
        offset_x = int(bbox[0])
        ascent_offset = int(bbox[1])
    else:
        text_w = max(1, font_size * len(text))
        text_h = font_size
        offset_x = 0
        ascent_offset = 0

    img = Image.new("RGBA", (text_w, text_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.text((-offset_x, -ascent_offset), text, font=font, fill=color)

    if direction in {"rotate-cw", "rotate-ccw"}:
        # Side-bar Flow is the footer rotated by 90°. The text is flush with
        # the slot's anchor endpoint (top or bottom), exactly like the Canvas
        # preview; the slot bitmap is at least as long as the slot.
        rotated = img.rotate(-90 if direction == "rotate-cw" else 90, expand=True)
        length = max(el.rect.h, rotated.height)
        slot = Image.new("RGBA", (max(1, el.rect.w, rotated.width), max(1, length)), (0, 0, 0, 0))
        paste_y = 0 if "top" in el.anchor else slot.height - rotated.height
        slot.paste(rotated, ((slot.width - rotated.width) // 2, paste_y), rotated)
        return slot

    return img


def _iter_builtin_logo_files() -> list[Path]:
    """Return the sorted list of builtin logo files served by /api/logos.

    Auto-Logo only considers builtins so that the front-end preview (which
    knows the builtin registry via `/api/logos`) and PIL Process see the same
    match.
    """
    if not LOGOS_DIR.exists():
        return []
    return sorted(
        (
            f for f in LOGOS_DIR.iterdir()
            if f.is_file()
            and not f.name.startswith(".")
            and not f.name.startswith("._")
            and f.suffix.lower() in _LOGO_EXTENSIONS
        ),
        key=lambda item: item.name.lower(),
    )


def _parse_logo_stem(raw: str) -> tuple[str, str, bool]:
    """Return (base_stem, variant, is_dark) from a filename stem.

    ``canon_v2_dark`` → (``canon``, ``v2``, True)
    ``sony_alt``       → (``sony``, ``alt``, False)
    ``nikon``          → (``nikon``, ````, False)
    """
    parts = raw.split("_")
    is_dark = parts[-1] == "dark"
    if is_dark:
        parts.pop()
    if len(parts) > 1 and re.match(r"^(v\d+|[a-z]{2,3})$", parts[-1]):
        variant = parts[-1]
        base = "_".join(parts[:-1])
    else:
        variant = ""
        base = "_".join(parts)
    return base, variant, is_dark


def _find_logo_file(
    base_stem: str,
    variant: str = "",
    dark: bool = False,
) -> Path | None:
    """Find a logo file with fallback chain.

    Priority: <stem>_<variant>_dark → <stem>_dark → <stem>_<variant> → <stem>
    """
    if not LOGOS_DIR.exists():
        return None
    candidates: list[str] = []
    if variant and dark:
        candidates.append(f"{base_stem}_{variant}_dark")
    if dark:
        candidates.append(f"{base_stem}_dark")
    if variant:
        candidates.append(f"{base_stem}_{variant}")
    candidates.append(base_stem)
    for candidate in candidates:
        for f in _iter_builtin_logo_files():
            if f.stem == candidate:
                return f
    return None


def _resolve_auto_logo_path(
    content: LogoContent,
    field_values: dict[str, str],
    scheme: str = "dark",
    logo_variant: str = "",
) -> str | None:
    """Resolve auto-Logo path with dark/light and variant support.

    scheme == 'dark'  → light background → regular logo (no _dark suffix)
    scheme == 'light' → dark background  → prefer the _dark / white variant

    Falls back through variant/dark/plain in that order.
    """
    dark = scheme == "light"

    if content.path.startswith("builtin:"):
        key = content.path.split(":", 1)[1]
        f = _find_logo_file(key, variant=logo_variant, dark=dark)
        return str(f.absolute()) if f else None
    if content.path:
        return content.path

    make = field_values.get("make", "")
    model = field_values.get("camera_model", "")
    if not make and not model:
        return None
    builtins = _iter_builtin_logo_files()
    if not builtins:
        return None
    matched_stem = match_brand_stem(
        make,
        (f.stem for f in builtins if not f.stem.endswith("_dark")),
        model,
        on_dark=dark,
    )
    if matched_stem is None:
        return None
    f = _find_logo_file(matched_stem, variant=logo_variant, dark=dark)
    return str(f.absolute()) if f else None


# ── Logo 可见范围 / 深色背景适配 ───────────────────────────────────────

# (path, mtime_ns, size) → (visible bbox, opaque-with-white-box)
_LOGO_BOUNDS_CACHE: dict[tuple[str, int, int], tuple[tuple[int, int, int, int] | None, bool]] = {}
_ALPHA_VISIBLE = 8
_WHITE_DISTANCE = 16


def _is_opaque_white_box(logo: Image.Image) -> bool:
    alpha_min = logo.getchannel("A").getextrema()[0]
    if alpha_min < 250:
        return False
    w, h = logo.size
    corners = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    rgb = logo.convert("RGB")
    return all(min(rgb.getpixel(point)) >= 240 for point in corners)  # type: ignore[arg-type]


def _visible_bbox(logo: Image.Image, white_box: bool) -> tuple[int, int, int, int] | None:
    """Bounding box of the logo's visible ink (alpha, or non-white for boxed logos)."""
    if white_box:
        rgb = logo.convert("RGB")
        diff = ImageChops.difference(rgb, Image.new("RGB", rgb.size, (255, 255, 255))).convert("L")
        return diff.point(lambda v: 255 if v > _WHITE_DISTANCE else 0).getbbox()
    return logo.getchannel("A").point(lambda a: 255 if a > _ALPHA_VISIBLE else 0).getbbox()


def _logo_bounds(path: str, logo: Image.Image | None = None) -> tuple[tuple[int, int, int, int] | None, bool]:
    try:
        stat = Path(path).stat()
    except OSError:
        return None, False
    key = (path, stat.st_mtime_ns, stat.st_size)
    cached = _LOGO_BOUNDS_CACHE.get(key)
    if cached is not None:
        return cached
    if logo is None:
        try:
            logo = load_logo(path)
        except (FileNotFoundError, OSError, Image.UnidentifiedImageError):
            return None, False
    logo = logo.convert("RGBA")
    white_box = _is_opaque_white_box(logo)
    result = (_visible_bbox(logo, white_box), white_box)
    if len(_LOGO_BOUNDS_CACHE) > 256:
        _LOGO_BOUNDS_CACHE.clear()
    _LOGO_BOUNDS_CACHE[key] = result
    return result


def logo_visible_aspect_ratio(path: str) -> float | None:
    """Width / height of the logo's visible content (transparent / white margins trimmed)."""
    dims = _read_image_dimensions(path)
    if dims is None or dims[0] <= 0 or dims[1] <= 0:
        return None
    bbox, _white = _logo_bounds(path)
    if bbox is None:
        return dims[0] / dims[1]
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    return w / h if w > 0 and h > 0 else None


def _white_to_alpha(logo: Image.Image) -> Image.Image:
    """Turn a white box into transparency (GIMP "color to alpha" for white)."""
    arr = np.asarray(logo.convert("RGBA"), dtype=np.float32)
    rgb = arr[..., :3]
    alpha = arr[..., 3] / 255.0
    coverage = (255.0 - rgb.min(axis=2)) / 255.0
    safe = np.where(coverage > 0, coverage, 1.0)[..., None]
    unmixed = 255.0 - (255.0 - rgb) / safe
    out = np.empty_like(arr)
    out[..., :3] = np.clip(np.where(coverage[..., None] > 0, unmixed, 0.0), 0, 255)
    out[..., 3] = np.clip(alpha * coverage * 255.0, 0, 255)
    return Image.fromarray(np.rint(out).astype(np.uint8), "RGBA")


def _is_dark_mono(logo: Image.Image) -> bool:
    """A logo drawn in near-neutral dark ink (black wordmark) — invert on dark backgrounds."""
    arr = np.asarray(logo.convert("RGBA"), dtype=np.float32)
    visible = arr[..., 3] > 127
    if not visible.any():
        return False
    rgb = arr[..., :3][visible]
    chroma = float((rgb.max(axis=1) - rgb.min(axis=1)).mean())
    luminance = float((rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)).mean())
    return chroma < 24 and luminance < 110


def _invert_rgb(logo: Image.Image) -> Image.Image:
    r, g, b, a = logo.convert("RGBA").split()
    inverted = ImageChops.invert(Image.merge("RGB", (r, g, b)))
    return Image.merge("RGBA", (*inverted.split(), a))


def _render_logo_element(
    el: ComputedElement,
    field_values: dict[str, str],
    scheme: str = "dark",
    *,
    matte_white: bool = False,
) -> Image.Image | None:
    """加载 Logo，裁掉透明/白色留白，等比缩放（允许放大）到槽位盒子内。

    On dark backgrounds (``scheme == 'light'``) a boxed RGB logo loses its
    white box and a dark monochrome logo is inverted, unless a dedicated
    ``_dark`` / white variant was resolved.
    """
    content = el.content
    if not isinstance(content, LogoContent):
        return None

    logo_path = _resolve_auto_logo_path(content, field_values, scheme=scheme)
    if not logo_path:
        # 无可用 logo，返回透明占位
        return Image.new("RGBA", (max(1, el.rect.w), max(1, el.rect.h)), (0, 0, 0, 0))

    try:
        logo = load_logo(logo_path)
    except (FileNotFoundError, OSError) as exc:
        logger.warning("[renderer] Logo 加载失败: %s (%s)", Path(logo_path).name, exc)
        return None

    logo = logo.convert("RGBA")
    bbox, white_box = _logo_bounds(logo_path, logo)
    if bbox is not None and bbox != (0, 0, logo.width, logo.height):
        logo = logo.crop(bbox)

    # Contain within the slot box, preserving aspect ratio. Small builtin
    # logos are scaled up so they fill the same visible box as large ones.
    max_w = max(1, el.rect.w)
    max_h = max(1, el.rect.h)
    if content.orientation in {"rotate-cw", "rotate-ccw"}:
        max_w, max_h = max_h, max_w
    lw, lh = logo.size
    scale = min(max_w / lw, max_h / lh)
    new_size = (max(1, round(lw * scale)), max(1, round(lh * scale)))
    if new_size != logo.size:
        logo = logo.resize(new_size, Image.Resampling.LANCZOS)

    on_dark = scheme == "light"
    dedicated_variant = Path(logo_path).stem.endswith("_dark") or "white" in Path(logo_path).stem.lower()
    if white_box and (on_dark or matte_white):
        logo = _white_to_alpha(logo)
    if on_dark and not dedicated_variant and _is_dark_mono(logo):
        logo = _invert_rgb(logo)

    if content.orientation == "rotate-cw":
        logo = logo.rotate(-90, expand=True)
    elif content.orientation == "rotate-ccw":
        logo = logo.rotate(90, expand=True)

    return logo


def _render_signature_element(el: ComputedElement) -> Image.Image | None:
    """加载并处理签名元素。"""
    content = el.content
    if not isinstance(content, SignatureContent):
        return None

    if not content.path:
        return None

    try:
        sig = load_logo(content.path)
    except (FileNotFoundError, OSError) as exc:
        logger.warning("[renderer] 签名加载失败: %s (%s)", Path(content.path).name, exc)
        return None

    target_size = (max(1, el.rect.w), max(1, el.rect.h))
    if sig.size != target_size:
        sig = sig.resize(target_size, Image.Resampling.LANCZOS)

    # invert_mono: 黑白反转（仅处理 RGB 通道，保留 Alpha）
    if content.invert_mono and sig.mode == "RGBA":
        r, g, b, a = sig.split()
        rgb = Image.merge("RGB", (r, g, b))
        inverted = Image.eval(rgb, lambda x: 255 - x)
        r2, g2, b2 = inverted.split()
        sig = Image.merge("RGBA", (r2, g2, b2, a))

    return sig


# ── Logo 槽位解析（compute_layout 之前）───────────────────────────────


def _first_logo_slot(config: ImprintConfig):
    for region in config.regions:
        if not region.enabled:
            continue
        asset = region.slots.get("asset") if region.slots else None
        if asset is None or not asset.enabled or not isinstance(asset.content, LogoContent):
            continue
        yield region, asset


def _resolved_logo_aspect(
    content: LogoContent, field_values: dict[str, str], scheme: str, logo_variant: str,
) -> float | None:
    logo_path = _resolve_auto_logo_path(content, field_values, scheme=scheme, logo_variant=logo_variant)
    if not logo_path:
        return None
    return logo_visible_aspect_ratio(logo_path)


def resolve_logo_slots(
    config: ImprintConfig,
    field_values: dict[str, str],
    logo_variant: str = "",
) -> float | None:
    """Resolve every enabled Logo slot before ``compute_layout`` (mutates ``config``).

    A slot whose logo cannot be resolved (unknown brand, no EXIF Make, missing
    file) is disabled, so the layout reserves no space and draws no orphan
    divider — matching the Canvas preview's ``resolveLogoConfig``. Returns the
    visible aspect ratio of the first rendered logo, or ``None``.
    """
    scheme = resolve_ink_scheme(config.canvas.background, config.canvas.effect)
    first: float | None = None
    for region, asset in list(_first_logo_slot(config)):
        assert isinstance(asset.content, LogoContent)
        aspect = _resolved_logo_aspect(asset.content, field_values, scheme, logo_variant)
        if aspect is None:
            region.slots["asset"] = replace(asset, enabled=False)
            continue
        if first is None:
            first = aspect
    return first


def resolve_logo_asset_aspect_ratio(
    config: ImprintConfig,
    field_values: dict[str, str],
    bg_color: str = "#FFFFFF",
    logo_variant: str = "",
) -> float | None:
    """Resolve the visible aspect ratio (w/h) of the Logo that will be rendered.

    Read-only counterpart of :func:`resolve_logo_slots`; ``None`` when no logo
    is matched or the file cannot be opened.
    """
    scheme = resolve_ink_scheme(bg_color, config.canvas.effect)
    for _region, asset in _first_logo_slot(config):
        assert isinstance(asset.content, LogoContent)
        return _resolved_logo_aspect(asset.content, field_values, scheme, logo_variant)
    return None


# ── 主渲染入口 ────────────────────────────────────────────────────────


def _draw_divider_element(
    canvas: Image.Image,
    el: ComputedElement,
    scheme: str = "dark",
) -> None:
    """Composite a thin divider at 25% opacity (same as the Canvas preview)."""
    w, h = max(1, el.rect.w), max(1, el.rect.h)
    if el.rect.x >= canvas.width or el.rect.y >= canvas.height or el.rect.x + w <= 0 or el.rect.y + h <= 0:
        return
    base = el.style.color if el.style and el.style.color else divider_color(scheme)
    r, g, b, _a = _parse_color(base)
    layer = Image.new("RGBA", (w, h), (r, g, b, round(255 * DIVIDER_OPACITY)))
    x0, y0 = max(0, el.rect.x), max(0, el.rect.y)
    crop = (x0 - el.rect.x, y0 - el.rect.y, min(w, canvas.width - el.rect.x), min(h, canvas.height - el.rect.y))
    canvas.alpha_composite(layer.crop(crop), dest=(x0, y0))


def render_pil(
    layout: LayoutResult,
    image: Image.Image,
    *,
    bg_color: str = "#FFFFFF",
    field_values: dict[str, str] | None = None,
    custom_text: str = "",
    config: ImprintConfig | None = None,
) -> Image.Image:
    """主渲染函数 — 按 LayoutResult 将元素绘制到画布上。

    Args:
        layout: 布局引擎输出的 LayoutResult。
        image: 原始照片（将被粘贴到 layout.image_rect 指定位置）。
        bg_color: 画布背景色（CSS 颜色格式，如 "#FFFFFF"）。
        field_values: 字段值映射（field_id → 实际文本），用于解析 chips。
        custom_text: 用户自定义文本（当 chip 的 field_id 为 "custom_text" 时使用）。

    Returns:
        合成后的 PIL Image（RGBA 模式）。
    """
    effect = config.canvas.effect if config is not None else None
    if not effect_is_active(effect):
        effect = None
    background = _parse_color(bg_color)
    ir = layout.image_rect

    # 1. 创建画布（可选：模糊照片背景 / 柔和投影，均在下采样工作画布上计算）
    if effect is not None and needs_composed_background(effect):
        canvas = compose_background((layout.canvas.w, layout.canvas.h), image, ir, background, effect)
    else:
        canvas = Image.new("RGBA", (layout.canvas.w, layout.canvas.h), background)

    # 2. 绘制装饰边框（填充 margin 区域，底部有 footer 时不画底边）。
    if config is not None and config.canvas.border is not None and config.canvas.border.enabled:
        border_cfg = config.canvas.border
        draw = ImageDraw.Draw(canvas)
        color = _parse_color(border_cfg.color)
        if ir.y > 0:
            draw.rectangle([(0, 0), (layout.canvas.w, ir.y)], fill=color)
        has_left_side_bar = any(
            r.enabled and r.type == "side-bar" and r.edge == "left"
            for r in config.regions
        )
        if ir.x > 0 and not has_left_side_bar:
            draw.rectangle([(0, ir.y), (ir.x, ir.y + ir.h)], fill=color)
        right_gap = layout.canvas.w - (ir.x + ir.w)
        has_right_side_bar = any(
            r.enabled and r.type == "side-bar" and r.edge != "left"
            for r in config.regions
        )
        if right_gap > 0 and not has_right_side_bar:
            draw.rectangle([(ir.x + ir.w, ir.y), (layout.canvas.w, ir.y + ir.h)], fill=color)
        bottom_gap = layout.canvas.h - (ir.y + ir.h)
        has_footer = any(r.enabled and r.type == "footer-bar" for r in config.regions)
        if bottom_gap > 0 and not has_footer:
            draw.rectangle([(0, ir.y + ir.h), (layout.canvas.w, layout.canvas.h)], fill=color)

    # 3. 粘贴照片主体（RGB 直接粘贴，避免整幅 RGBA 拷贝）
    radius = photo_radius_px(effect, ir)
    corner_backgrounds = save_corner_backgrounds(canvas, ir, radius) if radius > 0 else []
    if image.mode == "RGB":
        canvas.paste(image, (ir.x, ir.y))
    else:
        canvas.paste(image.convert("RGBA") if image.mode != "RGBA" else image, (ir.x, ir.y))
    if radius > 0:
        round_photo_corners(canvas, ir, radius, corner_backgrounds)

    # 4. 按 LayoutResult 顺序绘制所有元素
    field_values = field_values or {}
    effect_for_scheme = config.canvas.effect if config is not None else None
    scheme = resolve_ink_scheme(bg_color, effect_for_scheme)
    matte_white = scheme == "light" or bg_color.strip().upper() not in {"#FFFFFF", "FFFFFF"} or effect is not None
    fonts = _FontCache()
    texts = {
        el.id: _build_text(el.content, field_values, custom_text)
        for el in layout.elements
        if el.type == "text" and isinstance(el.content, TextContent)
    }
    fitted = fit_layout_texts(layout.elements, texts, fonts.measure)

    for el in layout.elements:
        if el.type == "text":
            element_img = _render_text_element(el, field_values, custom_text, fitted.get(el.id), fonts)
        elif el.type == "logo":
            element_img = _render_logo_element(el, field_values, scheme=scheme, matte_white=matte_white)
        elif el.type == "signature":
            element_img = _render_signature_element(el)
        elif el.type == "divider":
            _draw_divider_element(canvas, el, scheme)
            continue
        else:
            continue

        if element_img is None:
            continue

        # anchor 点 → PIL paste 左上角坐标
        dx, dy = _anchor_to_paste_offset(el.anchor, element_img.width, element_img.height)
        # Free-region ratio offsets may be fractional; rasterize only here.
        paste_x = round(el.rect.x + dx)
        paste_y = round(el.rect.y + dy)

        canvas.paste(element_img, (paste_x, paste_y), mask=element_img)

    return canvas
