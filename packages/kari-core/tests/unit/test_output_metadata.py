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
    with pytest.raises((ImageCms.PyCMSError, OSError)):
        load_photograph(path, max_pixels=100)
