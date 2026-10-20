# Independent review blockers (during implementation)

1. albums.py source: compare album_id, NOT asset_id, to album_membership(asset_id) which returns ALBUM IDs. Minimal probe confirms existing implementation rejects valid member.
2. validate_immich_key(users/me HTTP 200 {}) returns empty identity without error; init then issues valid session. Validate dict, nonempty STRING email, reject malformed JSON/list/number/null. Defend init/session/middleware fail-closed too.
3. _resolve_owner_from_key catches only UpstreamError but me().json may raise ValueError/AttributeError; malformed upstream must not crash startup or persist arbitrary str(email). Allow recovery from temporarily unavailable owner lookup without permanent lockout/restart dependence.
4. Full waiting-state idempotency must include actual UI flow PUT config then POST render: identical saved config may increment revision and bypass enqueue dedup. Test end-to-end repeated save.
5. Preserve existing saved configs; enforce single frame at panel save/render boundary with clear legacy remediation, don't silently drop stored regions.
6. Verify saved output identity and membership before done; do not claim upstream thumbnail refresh completion from accepted request.

## Latest independent review at fff2717
Auth malformed users/me probe STILL fails: {} returns success empty identity, numeric email accepted, [] crashes. Init grants session even empty owner, middleware no owner guard. _refresh_complete ignores asset response contents (wrong id/library/path still True); after network confirmation recheck current revision/generation transactionally before done. Frontend polling still excludes refresh_pending. Download button points to downscaled output_preview, falsely suggests full export; provide real full-resolution download endpoint or accurately label preview. Keyboard Ctrl+Z in inputs currently preventDefault before typing check; preserve native editing. Fix these alongside UX and explicitly re-read this file before final checks.
