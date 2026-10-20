"""Immich v3.3.0 API adapter. No arbitrary proxy paths or upstream errors leak."""

from __future__ import annotations

from uuid import UUID

import httpx


class UpstreamError(Exception):
    def __init__(self, status: int = 502):
        self.status = status
        super().__init__("immich_unavailable")


class ImmichClient:
    def __init__(self, url: str, key: str, *, transport=None):
        self.http = httpx.Client(
            base_url=url.rstrip("/") + "/api/",
            headers={"x-api-key": key},
            timeout=15,
            follow_redirects=False,
            transport=transport,
        )

    def close(self):
        self.http.close()

    def request(self, method, path, **kwargs):
        try:
            response = self.http.request(method, path, **kwargs)
            response.raise_for_status()
            return response
        except httpx.HTTPStatusError as exc:
            raise UpstreamError(exc.response.status_code) from None
        except httpx.HTTPError:
            raise UpstreamError() from None

    def asset(self, asset_id: str):
        return self.request("GET", f"assets/{UUID(asset_id)}").json()

    def me(self):
        """Return the Immich user that owns the service API key (x-api-key)."""
        return self.request("GET", "users/me").json()

    def search(self, library: str, page: int = 1, *, path: str | None = None, albums=None):
        body = {"libraryId": str(UUID(library)), "type": "IMAGE", "page": page, "size": 50, "withExif": True}
        if path is not None:
            body["originalPath"] = path
        if albums:
            # Callers may pass validated UUID instances or raw strings; the wire
            # form is always the canonical string. UUID(UUID(...)) raises
            # AttributeError, so normalise through str first.
            body["albumIds"] = [str(UUID(str(album))) for album in albums]
        return self.request("POST", "search/metadata", json=body).json()["assets"]

    def album_has_images(self, library: str, album_id: str) -> bool:
        """Whether ``album_id`` holds at least one image from ``library``.

        Albums whose photos live only in another library (e.g. the RAW archive)
        have nothing this tool can process.
        """
        body = {
            "libraryId": str(UUID(library)),
            "albumIds": [str(UUID(str(album_id)))],
            "type": "IMAGE",
            "page": 1,
            "size": 1,
        }
        return bool(self.request("POST", "search/metadata", json=body).json()["assets"]["items"])

    def albums(self):
        # Requires the album.read scope; the panel degrades when it is missing.
        result = self.request("GET", "albums").json()
        return [
            {
                "id": str(UUID(album["id"])),
                "name": str(album.get("albumName") or "未命名相册"),
                "assetCount": int(album.get("assetCount") or 0),
                "thumbnailAssetId": album.get("albumThumbnailAssetId"),
            }
            for album in result
        ]

    def album(self, album_id):
        return self.request("GET", f"albums/{UUID(str(album_id))}").json()

    def album_membership(self, asset_id):
        """Return the set of album ids that currently contain ``asset_id``.

        Immich v3 album details no longer expose an ``assets`` array, even with
        ``withoutAssets=false``; the authoritative membership query is
        ``GET /albums?assetId=...``.  Callers must never infer membership from
        ``album().get('assets')``.
        """
        result = self.request("GET", "albums", params={"assetId": str(UUID(asset_id))}).json()
        return {str(UUID(album["id"])) for album in result}

    def create_album(self, name):
        return str(UUID(self.request("POST", "albums", json={"albumName": name}).json()["id"]))

    def add_to_album(self, album_id, asset_id):
        results = self.request(
            "PUT", f"albums/{UUID(str(album_id))}/assets", json={"ids": [str(UUID(str(asset_id)))]}
        ).json()
        if not all(r.get("success") or r.get("error") == "duplicate" for r in results):
            raise UpstreamError()
        # Read back membership; a successful HTTP response alone is insufficient.
        if str(UUID(str(album_id))) not in self.album_membership(asset_id):
            raise UpstreamError()

    def preview(self, asset_id: str, maximum: int = 20 * 1024 * 1024, *, thumbnail: bool = False):
        try:
            with self.http.stream(
                "GET",
                f"assets/{UUID(asset_id)}/thumbnail",
                params={"size": "thumbnail" if thumbnail else "preview", "edited": "false"},
            ) as response:
                response.raise_for_status()
                data = bytearray()
                for chunk in response.iter_bytes():
                    data.extend(chunk)
                    if len(data) > maximum:
                        raise ValueError("preview_too_large")
                return bytes(data), response.headers.get("content-type", "image/jpeg")
        except httpx.HTTPError:
            raise UpstreamError() from None

    def refresh(self, asset_id: str):
        # Acceptance only. M0 intentionally leaves completion unconfirmed.
        for name in ("refresh-metadata", "regenerate-thumbnail"):
            self.request("POST", "assets/jobs", json={"name": name, "assetIds": [str(UUID(asset_id))]})
