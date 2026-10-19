"""Canvas effects for the PIL renderer: blurred photo background, soft shadow, rounded photo.

Mirrored by ``apps/web/src/canvasEffects.ts`` (Canvas preview). The constants
below are the shared contract; keep both files in sync.

Performance contract (100MP+ inputs inside the worker limits):
  - Blur and shadow are computed on a downsampled work canvas whose long edge
    is at most ``WORK_EDGE`` pixels — never at full resolution.
  - The work canvas is upscaled into the output in horizontal strips, so the
    only full-size allocation is the output canvas itself.
  - A deterministic ±1 LSB dither is added per strip to avoid banding in the
    smooth upscaled gradients.
  - Rounded corners only touch the four r×r corner patches (supersampled mask).
"""

from __future__ import annotations

import math
import random

from PIL import Image, ImageChops, ImageDraw, ImageFilter

from kari_core.shared.layout.layout_engine import EffectConfig, Rect

WORK_EDGE = 1200
BLUR_SIGMA_RATIO = 0.05  # Gaussian σ as a ratio of the canvas short edge
DARKEN_OPACITY = 0.25  # black overlay on the blurred background
SHADOW_OPACITY = 0.35
SHADOW_OFFSET_RATIO = 0.006  # downward offset, ratio of the photo short edge
SHADOW_SIGMA_RATIO = 0.015  # shadow σ, ratio of the photo short edge
MAX_PHOTO_RADIUS = 0.08
_STRIP = 256
_SUPERSAMPLE = 4
_DITHER_SEED = 0x6B617269


def effect_is_active(effect: EffectConfig | None) -> bool:
    return effect is not None and not effect.is_noop


def photo_radius_px(effect: EffectConfig | None, image_rect: Rect) -> int:
    if effect is None or effect.photo_radius <= 0:
        return 0
    short = min(image_rect.w, image_rect.h)
    radius = round(min(MAX_PHOTO_RADIUS, effect.photo_radius) * short)
    return max(0, min(radius, short // 2))


def needs_composed_background(effect: EffectConfig | None) -> bool:
    return effect is not None and (effect.background == "blur" or effect.shadow)


def _cover(photo: Image.Image, width: int, height: int) -> Image.Image:
    """Scale ``photo`` to cover ``width × height`` and center-crop (RGB)."""
    scale = max(width / photo.width, height / photo.height)
    size = (max(width, math.ceil(photo.width * scale)), max(height, math.ceil(photo.height * scale)))
    source = photo if photo.mode == "RGB" else photo.convert("RGB")
    resized = source.resize(size, Image.Resampling.BILINEAR, reducing_gap=3.0)
    left = (size[0] - width) // 2
    top = (size[1] - height) // 2
    return resized.crop((left, top, left + width, top + height))


def _work_background(
    canvas_w: int,
    canvas_h: int,
    photo: Image.Image,
    image_rect: Rect,
    background: tuple[int, int, int, int],
    effect: EffectConfig,
) -> tuple[Image.Image, float]:
    scale = min(1.0, WORK_EDGE / max(canvas_w, canvas_h))
    work_w = max(1, round(canvas_w * scale))
    work_h = max(1, round(canvas_h * scale))
    if effect.background == "blur":
        work = _cover(photo, work_w, work_h)
        sigma = max(1.0, BLUR_SIGMA_RATIO * min(work_w, work_h))
        work = work.filter(ImageFilter.GaussianBlur(sigma))
        work = Image.blend(work, Image.new("RGB", work.size, (0, 0, 0)), DARKEN_OPACITY)
    else:
        work = Image.new("RGB", (work_w, work_h), background[:3])
    if effect.shadow:
        short = min(image_rect.w, image_rect.h)
        offset = SHADOW_OFFSET_RATIO * short * scale
        sigma = max(0.5, SHADOW_SIGMA_RATIO * short * scale)
        radius = photo_radius_px(effect, image_rect) * scale
        mask = Image.new("L", work.size, 0)
        box = (
            image_rect.x * scale,
            image_rect.y * scale + offset,
            image_rect.right * scale,
            image_rect.bottom * scale + offset,
        )
        ImageDraw.Draw(mask).rounded_rectangle(box, radius=radius, fill=255)
        mask = mask.filter(ImageFilter.GaussianBlur(sigma))
        mask = mask.point(lambda value: round(value * SHADOW_OPACITY))
        work = Image.composite(Image.new("RGB", work.size, (0, 0, 0)), work, mask)
    return work, scale


def compose_background(
    canvas_size: tuple[int, int],
    photo: Image.Image,
    image_rect: Rect,
    background: tuple[int, int, int, int],
    effect: EffectConfig,
) -> Image.Image:
    """Return the RGBA output canvas pre-filled with the effect background."""
    canvas_w, canvas_h = canvas_size
    work, _scale = _work_background(canvas_w, canvas_h, photo, image_rect, background, effect)
    canvas = Image.new("RGBA", canvas_size, (0, 0, 0, 255))
    rng = random.Random(_DITHER_SEED)
    noise = Image.frombytes("L", (canvas_w, _STRIP), rng.randbytes(canvas_w * _STRIP)).point(
        lambda value: value % 3
    )
    noise_rgb = Image.merge("RGB", (noise, noise, noise))
    work_h = work.height
    for top in range(0, canvas_h, _STRIP):
        height = min(_STRIP, canvas_h - top)
        box = (0.0, top * work_h / canvas_h, float(work.width), (top + height) * work_h / canvas_h)
        strip = work.resize((canvas_w, height), Image.Resampling.BICUBIC, box=box)
        dither = noise_rgb if height == _STRIP else noise_rgb.crop((0, 0, canvas_w, height))
        strip = ImageChops.add(strip, dither, scale=1.0, offset=-1)
        canvas.paste(strip, (0, top))
    return canvas


def _corner_mask(radius: int) -> Image.Image:
    """Antialiased top-left quarter-circle mask (255 inside the photo)."""
    big = radius * _SUPERSAMPLE
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, big * 2 - 1, big * 2 - 1), fill=255)
    return mask.resize((radius, radius), Image.Resampling.BOX)


def corner_boxes(image_rect: Rect, radius: int) -> list[tuple[int, int, int, int]]:
    x0, y0, x1, y1 = image_rect.x, image_rect.y, image_rect.right, image_rect.bottom
    return [
        (x0, y0, x0 + radius, y0 + radius),
        (x1 - radius, y0, x1, y0 + radius),
        (x0, y1 - radius, x0 + radius, y1),
        (x1 - radius, y1 - radius, x1, y1),
    ]


def save_corner_backgrounds(canvas: Image.Image, image_rect: Rect, radius: int) -> list[Image.Image]:
    return [canvas.crop(box) for box in corner_boxes(image_rect, radius)]


def round_photo_corners(
    canvas: Image.Image, image_rect: Rect, radius: int, backgrounds: list[Image.Image],
) -> None:
    """Blend the pasted photo's corners back to the saved background patches."""
    if radius <= 0:
        return
    top_left = _corner_mask(radius)
    masks = [
        top_left,
        top_left.transpose(Image.Transpose.FLIP_LEFT_RIGHT),
        top_left.transpose(Image.Transpose.FLIP_TOP_BOTTOM),
        top_left.transpose(Image.Transpose.ROTATE_180),
    ]
    for box, mask, background in zip(corner_boxes(image_rect, radius), masks, backgrounds, strict=True):
        photo_patch = canvas.crop(box)
        canvas.paste(Image.composite(photo_patch, background, mask), box[:2])
