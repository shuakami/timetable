#!/usr/bin/env python3
"""从学校官网抓横版校标（校徽 + 校名字体），统一成黑色 alpha 蒙版 PNG 写到 site/assets/schools/。

每校一条：(校名, 文件名, 官网 logo 地址, 取墨迹方式)。
  alpha  透明底 png/svg，直接拿 alpha 当墨迹
  lum    深底白字 jpg，拿亮度当墨迹
  dark   透明底彩色图（校徽是实心盘），alpha × 暗度当墨迹
  stack  官网只有上下排，拆开拼成横排
地址也可以是仓库内文件（tools/assets/…）。
产出 <key>.png（高 96，透明底、黑色墨迹，颜色交给 CSS）和 index.json（顺序 = 页面顺序）。
依赖 Pillow、cairosvg。
"""
import io
import json
import ssl
import subprocess
import urllib.error
import urllib.request
from pathlib import Path

import cairosvg
from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "site/assets/schools"
H = 96
UA = {"User-Agent": "Mozilla/5.0 Chrome/124"}
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

MARKS = [
    ("清华大学", "tsinghua", "https://www.tsinghua.edu.cn/image/logo180.png", "alpha"),
    ("浙江大学", "zju", "https://www.zju.edu.cn/_upload/tpl/0b/bf/3007/template3007/static/media/mlogo.66388675484ae2a807b2ad65b1d31ca9.svg", "alpha"),
    ("北京理工大学", "bit", "tools/assets/bit-wordmark.png", "dark"),
    ("大连理工大学", "dlut", "https://www.dlut.edu.cn/images/logo.png", "alpha"),
    ("华南理工大学", "scut", "https://www.scut.edu.cn/_upload/site/01/3b/315/logo.png", "alpha"),
    ("重庆大学", "cqu", "https://www.cqu.edu.cn/images/logo1.png", "alpha"),
    ("北京师范大学", "bnu", "https://english.bnu.edu.cn/images/logo_01.png", "stack"),
    ("华东师范大学", "ecnu", "https://www.ecnu.edu.cn/images/logo.svg", "alpha"),
    ("中央民族大学", "muc", "https://www.muc.edu.cn/images/logo1.png", "alpha"),
    ("云南大学", "ynu", "https://www.ynu.edu.cn/images/logo0430.png", "alpha"),
    ("河海大学", "hhu", "https://www.hhu.edu.cn/_upload/tpl/05/df/1503/template1503/images/logo.svg", "alpha"),
    ("华中农业大学", "hzau", "https://www.hzau.edu.cn/images/LOGO.png", "alpha"),
    ("吉林大学", "jlu", "https://www.jlu.edu.cn/images/logo.jpg", "lum"),
    ("南昌大学", "ncu", "https://www.ncu.edu.cn/images/logo.png", "alpha"),
    ("新疆大学", "xju", "https://www.xju.edu.cn/images/logo20240718.png", "alpha"),
    ("内蒙古大学", "imu", "https://www.imu.edu.cn/syx/images/logor.png", "alpha"),
    ("青海大学", "qhu", "https://www.qhu.edu.cn/images/footer_logo.png", "alpha"),
    ("河南工业大学", "haut", "https://www.haut.edu.cn/images/logo.png", "alpha"),
    ("浙江工业大学", "zjut", "https://www.zjut.edu.cn/_upload/site/00/04/4/logo.png", "alpha"),
]


def fetch(url: str) -> Image.Image:
    if not url.startswith("http"):
        return Image.open(ROOT / url).convert("RGBA")
    try:
        data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=20, context=CTX).read()
    except urllib.error.URLError:  # 个别学校的 TLS 配置 Python 握不上，curl 可以
        data = subprocess.run(["curl", "-sk", "-m", "30", "-A", UA["User-Agent"], url], check=True, capture_output=True).stdout
    if url.endswith(".svg"):
        data = cairosvg.svg2png(bytestring=data, output_height=400)
    return Image.open(io.BytesIO(data)).convert("RGBA")


def trim(m: Image.Image) -> Image.Image:
    return m.crop(m.point(lambda v: 255 if v > 24 else 0).getbbox())


def fit(m: Image.Image, h: int = H) -> Image.Image:
    return m.resize((max(1, round(m.width * h / m.height)), h), Image.LANCZOS)


def ink(im: Image.Image, mode: str) -> Image.Image:
    if mode == "lum":
        return im.convert("L").point(lambda v: 0 if v < 110 else min(255, int((v - 110) * 1.8)))
    if mode == "dark":
        dark = im.convert("L").point(lambda v: max(0, min(255, int((235 - v) * 1.25))))
        return ImageChops.multiply(im.getchannel("A"), dark)
    return im.getchannel("A")


def stacked_to_row(a: Image.Image) -> Image.Image:
    """官网只有上下排（校徽在上、校名在下）时，拼成横排。"""
    rows = [max(a.crop((0, y, a.width, y + 1)).getdata()) for y in range(a.height)]
    gap_rows = [y for y, v in enumerate(rows) if v < 20 and a.height * 0.4 < y < a.height * 0.8]
    cut_top, cut_bottom = gap_rows[0], gap_rows[-1] + 1
    crest = fit(trim(a.crop((0, 0, a.width, cut_top))))
    th = int(H * 0.72)
    text = trim(a.crop((0, cut_bottom, a.width, a.height)))
    text = text.resize((round(text.width * th / text.height), th), Image.LANCZOS)
    m = Image.new("L", (crest.width + 14 + text.width, H), 0)
    m.paste(crest, (0, 0))
    m.paste(text, (crest.width + 14, (H - th) // 2))
    return m


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for p in OUT.glob("*.png"):
        p.unlink()
    index = []
    for name, key, url, mode in MARKS:
        im = fetch(url)
        m = stacked_to_row(im.getchannel("A")) if mode == "stack" else fit(trim(ink(im, mode)))
        out = Image.new("RGBA", m.size, (0, 0, 0, 0))
        out.putalpha(m)
        out.save(OUT / f"{key}.png", optimize=True)
        index.append({"name": name, "file": f"{key}.png", "w": m.width, "h": m.height})
        print(key, m.size)
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n")


if __name__ == "__main__":
    main()
