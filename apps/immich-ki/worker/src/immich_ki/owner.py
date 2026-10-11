"""Resolve the panel owner from the service API key's ``users/me`` identity.

The panel is single-operator and owner-bound: the authenticated identity must
equal the owner of the service API key (never whoever logs in first). Owner
resolution is shared by app startup and the login path so a startup where
Immich was briefly unreachable can recover on the next login without a restart.
"""

from __future__ import annotations

from immich_ki.client import UpstreamError
from immich_ki.keyconfig import save_panel_config


def resolve_owner_from_key(settings, upstream, key, owner=""):
    if not key or owner:
        return owner
    try:
        payload = upstream.me()
    except (UpstreamError, ValueError, TypeError, AttributeError):
        return owner
    # A malformed or unexpected upstream body must never crash or persist a
    # bogus owner; fail closed and retry on a later login or startup.
    if not isinstance(payload, dict):
        return owner
    email = payload.get("email")
    if not isinstance(email, str) or not email.strip():
        return owner
    email = email.strip()
    save_panel_config(settings.data, key, email)
    return email
