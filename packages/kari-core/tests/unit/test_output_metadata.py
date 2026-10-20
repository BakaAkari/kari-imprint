from io import BytesIO

import pytest
from PIL import Image, ImageCms

from kari_core.core.output_metadata import load_photograph


@pytest.mark.parametrize('format', ['JPEG', 'PNG'])
def test_photo_roundtrip_orientation_size_and_tags(tmp_path, format):
    exif = Image.Exif()
    exif[274] = 6
    exif[271] = 'Test Camera'
    exif[34665] = {36867: '2026:10:09 10:11:12', 40962: 40, 40963: 20}
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
    path = tmp_path / ('in.jpg' if format == 'JPEG' else 'in.png')
    Image.new('RGB', (40, 20), 'red').save(path, exif=exif, icc_profile=profile)
    image, metadata = load_photograph(path, max_pixels=1000)
    assert image.size == (20, 40)
    output = BytesIO()
    image.resize((30, 50)).save(output, format=format, **metadata.save_options((30, 50)))
    output.seek(0)
    with Image.open(output) as result:
        assert result.getexif()[274] == 1
        assert result.getexif()[271] == 'Test Camera'
        photo = result.getexif().get_ifd(34665)
        assert photo[40962] == 30 and photo[40963] == 50
        assert photo[36867] == '2026:10:09 10:11:12'
        assert result.info['icc_profile']


def test_transparent_png_white_and_pixel_limit(tmp_path):
    path = tmp_path / 'in.png'
    Image.new('RGBA', (20, 20), (0, 0, 0, 0)).save(path)
    with pytest.raises(ValueError, match='image_too_large'):
        load_photograph(path, max_pixels=10)
    image, _ = load_photograph(path, max_pixels=400)
    assert image.getpixel((0, 0)) == (255, 255, 255)


def test_invalid_icc_rejected(tmp_path):
    path = tmp_path / 'in.jpg'
    Image.new('RGB', (10, 10)).save(path, icc_profile=b'invalid')
    with pytest.raises(ValueError, match='unsupported_image'):
        load_photograph(path, max_pixels=100)


def test_sixteen_bit_gray_png_is_scaled_not_clipped(tmp_path):
    import numpy as np

    ramp = np.tile(np.linspace(0, 65535, 256), (8, 1)).astype('>u2')
    path = tmp_path / 'g16.png'
    Image.frombytes('I;16B', (256, 8), ramp.tobytes()).save(path)
    image, _ = load_photograph(path, max_pixels=10_000)
    row = [image.getpixel((x, 4))[0] for x in (0, 64, 128, 192, 255)]
    assert row[0] <= 1 and row[-1] >= 254
    assert 60 <= row[1] <= 68 and 124 <= row[2] <= 132 and 188 <= row[3] <= 196


def _gray_profile() -> bytes | None:
    import glob
    for candidate in glob.glob('/System/Library/ColorSync/Profiles/Generic Gray*.icc'):
        return open(candidate, 'rb').read()
    return None


@pytest.mark.parametrize('mode', ['L', 'LA'])
def test_gray_images_with_gray_icc_profile(tmp_path, mode):
    profile = _gray_profile()
    if profile is None:
        pytest.skip('no gray ICC profile available on this platform')
    image = Image.new(mode, (16, 16), 128 if mode == 'L' else (128, 255))
    path = tmp_path / 'gray.png'
    image.save(path, icc_profile=profile)
    pixels, _ = load_photograph(path, max_pixels=1000)
    r, g, b = pixels.getpixel((8, 8))
    assert r == g == b and 90 <= r <= 170
