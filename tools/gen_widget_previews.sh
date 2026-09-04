#!/usr/bin/env bash
# 把 widget_previews.html 截成小组件选择器用的预览图（drawable-nodpi，3x）。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../android/app/src/main/res/drawable-nodpi"
CHROME="${CHROME:-google-chrome}"
mkdir -p "$OUT"

shot() { # name width height
  local tmp out; tmp="$(mktemp -d)"
  out="widget_preview_$(echo "$1" | sed 's/[A-Z]/_\l&/g').png"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --no-sandbox \
    --default-background-color=00000000 --force-device-scale-factor=3 \
    --window-size="$(( $2 + 100 ))","$(( $3 + 200 ))" --screenshot="$tmp/s.png" \
    "file://$HERE/widget_previews.html?w=$1" >/dev/null 2>&1
  # headless 的 window-size 含窗口边框，多截一圈再裁到卡片大小
  python3 -c "from PIL import Image; Image.open('$tmp/s.png').crop((0, 0, $2 * 3, $3 * 3)).save('$OUT/$out')"
  rm -rf "$tmp"
  echo "wrote $out"
}

shot today 162 162
shot next 162 162
shot twoDays 338 162
shot week 338 216
