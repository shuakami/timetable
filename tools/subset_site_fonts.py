#!/usr/bin/env python3
"""重建官网中文字体子集（site/assets/fonts/NotoSansSC-*-subset.woff2）。

字符集 = site/index.html 里出现的全部字符 + 校徽墙 index.json 的校名。
需要 fontTools + brotli，源字体 NotoSansCJKsc-{Regular,Medium,Bold}.otf 放在 ~/fonts/
（https://github.com/notofonts/noto-cjk/tree/main/Sans/OTF/SimplifiedChinese）。
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
SRC = Path.home() / "fonts"

chars = set((SITE / "index.html").read_text())
for l in json.loads((SITE / "assets/schools/index.json").read_text()):
    chars.update(l["name"])
chars.update("0123456789，。、：；！？「」（）·")
text = "".join(sorted(c for c in chars if not c.isspace()))

for w in ("Regular", "Medium", "Bold"):
    src = SRC / f"NotoSansCJKsc-{w}.otf"
    if not src.exists():
        sys.exit(f"missing {src}")
    out = SITE / "assets/fonts" / f"NotoSansSC-{w}-subset.woff2"
    subprocess.run(
        [
            "pyftsubset", str(src), f"--text={text}", "--flavor=woff2",
            "--layout-features=kern,liga,palt", "--no-hinting", "--desubroutinize",
            "--name-IDs=1,2,4,6", f"--output-file={out}",
        ],
        check=True,
    )
    print(out.name, out.stat().st_size)
