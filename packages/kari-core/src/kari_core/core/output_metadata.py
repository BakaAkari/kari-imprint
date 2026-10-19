"""Opt-in photograph output policy; legacy/public rendering remains unchanged."""
from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from struct import pack
from typing import BinaryIO

from PIL import Image, ImageCms, ImageOps

POLICY_VERSION = "photo-srgb-v1"
# LittleCMS stamps newly created profiles with wall-clock time. Normalize the
# ICC header date so identical jobs remain reproducible across child processes.
_profile = bytearray(ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes())
_profile[24:36] = pack(">6H", 2000, 1, 1, 0, 0, 0)
SRGB_PROFILE = bytes(_profile)


@dataclass(frozen=True)
class OutputMetadata:
    exif: bytes
    icc_profile: bytes

    def save_options(self, size: tuple[int, int]) -> dict[str, bytes]:
        exif = Image.Exif()
        exif.load(self.exif)
        # Build a fresh IFD0 so the source's IFD1 thumbnail and strip offsets
        # cannot survive. Preserve photographic EXIF/GPS, not obsolete pixels.
        clean = Image.Exif()
        for tag, value in exif.items():
            if tag not in {273, 278, 279, 330, 513, 514, 34665, 34853}:
                clean[tag] = value
        clean[274] = 1
        clean[256], clean[257] = size
        photo = dict(exif.get_ifd(34665)) if 34665 in exif else {}
        for tag in (37500, 40965):  # MakerNote offsets / interoperability pointer
            photo.pop(tag, None)
        photo.update({40961: 1, 40962: size[0], 40963: size[1]})
        clean[34665] = photo
        if 34853 in exif:
            clean[34853] = dict(exif.get_ifd(34853))
        return {"exif": clean.tobytes(), "icc_profile": self.icc_profile}


def load_photograph(
    source: str | Path | BinaryIO, *, max_pixels: int,
) -> tuple[Image.Image, OutputMetadata]:
    """Decode, orient and colour-convert a bounded JPEG/PNG before composition.

    PNG transparency is composited onto white by this explicit photo policy.
    Invalid metadata/profile is an error, never silently assigned a wrong ICC.
    """
    with Image.open(source) as original:
        if original.format not in {"JPEG", "PNG"}:
            raise ValueError("unsupported_image")
        if original.width * original.height > max_pixels:
            raise ValueError("image_too_large")
        metadata = original.getexif().tobytes()
        profile = original.info.get("icc_profile")
        oriented = _to_8bit(ImageOps.exif_transpose(original))
        alpha = oriented.convert("RGBA").getchannel("A") if "A" in oriented.getbands() or "transparency" in oriented.info else None
        target = ImageCms.ImageCmsProfile(BytesIO(SRGB_PROFILE))
        if profile:
            try:
                source_profile = ImageCms.ImageCmsProfile(BytesIO(profile))
                colour = _match_profile_mode(oriented, source_profile)
                pixels = ImageCms.profileToProfile(colour, source_profile, target, outputMode="RGB")
            except (OSError, ImageCms.PyCMSError) as exc:
                # Corrupt or mismatched ICC: refuse rather than guess a profile.
                raise ValueError("unsupported_image") from exc
        else:
            pixels = oriented.convert("RGB")
        if alpha is not None:
            pixels = Image.composite(pixels, Image.new("RGB", pixels.size, "white"), alpha)
        pixels.load()
        return pixels.copy(), OutputMetadata(metadata, target.tobytes())


_SIXTEEN_BIT_MODES = {"I;16", "I;16B", "I;16L", "I;16N", "I"}


def _to_8bit(image: Image.Image) -> Image.Image:
    """Scale 16-bit / 32-bit integer grayscale to 8-bit ``L`` (PIL clips instead of scaling)."""
    if image.mode not in _SIXTEEN_BIT_MODES:
        return image
    wide = image if image.mode == "I" else image.convert("I")
    low, high = wide.getextrema()
    # PNG 16-bit samples always span 0..65535; only a genuinely 8-bit-valued
    # "I" image (max ≤ 255) is passed through without scaling.
    if image.mode == "I" and high <= 255 and low >= 0:
        return wide.convert("L")
    return wide.point(lambda value: value * (1 / 257)).convert("L")


def _match_profile_mode(image: Image.Image, profile: ImageCms.ImageCmsProfile) -> Image.Image:
    """Present pixels in the colour space the embedded ICC profile describes."""
    space = (profile.profile.xcolor_space or "").strip().upper()
    if space == "GRAY":
        if image.mode == "L":
            return image
        if image.mode in {"LA", "La"} or (image.mode in {"P", "PA"} and _palette_is_gray(image)):
            return image.convert("L")
        raise ValueError("unsupported_image")
    if space == "CMYK":
        if image.mode == "CMYK":
            return image
        raise ValueError("unsupported_image")
    if space == "LAB" and image.mode == "LAB":
        return image
    if image.mode == "RGB":
        return image
    if image.mode in {"L", "LA", "P", "PA", "RGBA", "RGBa", "RGBX"}:
        return image.convert("RGB")
    raise ValueError("unsupported_image")


def _palette_is_gray(image: Image.Image) -> bool:
    palette = image.getpalette() or []
    return all(palette[i] == palette[i + 1] == palette[i + 2] for i in range(0, len(palette) - 2, 3))
