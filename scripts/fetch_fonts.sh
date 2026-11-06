#!/usr/bin/env bash
# Fetch the render fonts into assets/fonts and verify each against a pinned
# SHA-256. Fails closed: a missing or changed file is an error, never a
# silent fallback. Used by CI, the image publish workflow and local setup.
#
# Every font here is licensed under the SIL Open Font License 1.1 and is
# shipped unmodified under its original name (OFL Reserved Font Names).
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="$root/assets/fonts"
mkdir -p "$dest"

noto=https://github.com/notofonts/noto-cjk/raw/main

# file|url|sha256
fonts=(
  "NotoSansCJKsc-Regular.otf|$noto/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf|2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b"
  "NotoSansCJKsc-Bold.otf|$noto/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf|b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a"
  "NotoSerifCJKsc-Regular.otf|$noto/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf|2a2eae2628df83556c54018c41e20fa532c1b862c5256ae8b3f23feb918d12ca"
  "NotoSerifCJKsc-Bold.otf|$noto/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Bold.otf|8af07d4b6c2e82bcc72a30e066eaf295f11b9424f4aad2eaa9fe0e9c3b38fc73"
)

for entry in "${fonts[@]}"; do
  IFS='|' read -r file url sum <<<"$entry"
  target="$dest/$file"
  [ -f "$target" ] || curl -fsSL --retry 3 -o "$target" "$url"
  echo "$sum  $target" | sha256sum -c --quiet - || { echo "font checksum mismatch: $file" >&2; exit 1; }
done
echo "fonts ok: ${#fonts[@]} files in $dest"
