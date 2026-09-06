#!/usr/bin/env python3
"""按 src/domain/stickers.json 拉取贴纸 SVG 到 public/stickers/。

编程/技术类来自 devicon（MIT），其余来自 Twemoji（CC-BY 4.0）。
只在清单变动时手动运行；产物提交进仓库。
"""
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MANIFEST = os.path.join(ROOT, 'src', 'domain', 'stickers.json')
OUT = os.path.join(ROOT, 'public', 'stickers')
DEVICON = 'https://cdn.jsdelivr.net/gh/devicons/devicon@v2.17.0'
TWEMOJI = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@v14.0.2/assets/svg'


def get(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode('utf-8')


def strip(svg: str) -> str:
    svg = re.sub(r'<\?xml[^>]*>|<!--[\s\S]*?-->|<title>[\s\S]*?</title>|<desc>[\s\S]*?</desc>', '', svg)
    return re.sub(r'\s+', ' ', svg).strip()


def main() -> int:
    os.makedirs(OUT, exist_ok=True)
    meta = {x['name']: x for x in json.loads(get(f'{DEVICON}/devicon.json'))}
    entries = json.load(open(MANIFEST, encoding='utf-8'))
    bad = []
    for sid, src, *_ in entries:
        dst = os.path.join(OUT, f'{sid}.svg')
        if os.path.exists(dst):
            continue
        if src == 'devicon':
            m = meta.get(sid)
            if not m:
                bad.append(sid)
                continue
            vs = m['versions']['svg']
            v = next((x for x in ('original', 'plain', 'original-wordmark', 'plain-wordmark') if x in vs), vs[0])
            url = f'{DEVICON}/icons/{sid}/{sid}-{v}.svg'
        else:
            url = f'{TWEMOJI}/{src}.svg'
        try:
            svg = strip(get(url))
        except Exception as e:  # noqa: BLE001
            bad.append(f'{sid} ({e})')
            continue
        with open(dst, 'w', encoding='utf-8') as f:
            f.write(svg)
        print(sid)
    if bad:
        print('missing:', bad, file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
