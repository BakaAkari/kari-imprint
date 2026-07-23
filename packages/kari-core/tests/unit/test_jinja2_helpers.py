"""测试 [`core.jinja2renders.vw`](core/jinja2renders.py:7) / [`vh`](core/jinja2renders.py:13) / [`auto_logo`](core/jinja2renders.py:19)。"""
from __future__ import annotations

from pathlib import Path

import pytest
from jinja2 import Template

from kari_core.core import jinja2renders
from kari_core.core.jinja2renders import auto_logo, vh, vw


def _render(expr: str, exif: dict) -> str:
    tpl = Template(expr)
    tpl.globals["vw"] = vw
    tpl.globals["vh"] = vh
    tpl.globals["auto_logo"] = auto_logo
    return tpl.render(exif=exif)


class TestVwVh:
    def test_vw_basic(self) -> None:
        assert _render("{{ vw(50) }}", {"ImageWidth": "1000", "ImageHeight": "800"}) == "500"

    def test_vh_basic(self) -> None:
        assert _render("{{ vh(25) }}", {"ImageWidth": "1000", "ImageHeight": "800"}) == "200"

    def test_vw_zero_when_no_exif(self) -> None:
        assert _render("{{ vw(50) }}", {}) == "0"


class TestAutoLogo:
    @staticmethod
    def _logo_registry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        for name in ("fujifilm.png", "nikon.png"):
            (tmp_path / name).write_bytes(b"fixture")
        monkeypatch.setattr(jinja2renders, "logos_dir", tmp_path)

    def test_returns_default_fujifilm_for_unknown_brand(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._logo_registry(tmp_path, monkeypatch)
        out = _render("{{ auto_logo()|default('NONE', true) }}", {"Make": "PHOTON-9000-NOT-A-BRAND"})
        assert "fujifilm" in out.lower()

    def test_matches_known_brand(self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
        self._logo_registry(tmp_path, monkeypatch)
        out = _render("{{ auto_logo() }}", {"Make": "NIKON"})
        assert "nikon" in out.lower()
