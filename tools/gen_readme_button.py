"""README 顶部按钮 SVG 生成器（文字转路径，不依赖字体）。

用法：python3 tools/gen_readme_button.py Website docs/website.svg
"""
import base64
import io
import sys

from PIL import Image

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

FONT = 'site/assets/fonts/Geist-Var.woff2'
SIZE = 14
BASE = 23.04
TEXT_X = 47
PAD_R = 13
INK = '#171717'

LOGO = 'docs/logo-circle.png'


def text_path(font, text, scale):
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    pen = SVGPathPen(glyph_set)
    x = 0.0
    for ch in text:
        name = cmap[ord(ch)]
        g = glyph_set[name]
        g.draw(TransformPen(pen, (scale, 0, 0, -scale, TEXT_X + x * scale, BASE)))
        x += g.width
    return pen.getCommands(), x * scale


def main(label, out):
    font = instantiateVariableFont(TTFont(FONT), {'wght': 500}, inplace=False)
    scale = SIZE / font['head'].unitsPerEm
    d, w = text_path(font, label, scale)
    im = Image.open(LOGO).convert('RGBA').resize((72, 72), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'PNG', optimize=True)
    logo = base64.b64encode(buf.getvalue()).decode()
    width = round(TEXT_X + w + PAD_R)
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{width + 9}" height="50" viewBox="-1 -4 {width + 9} 50" fill="none" role="img" aria-label="{label}">
  <defs>
    <filter id="s" x="-10%" y="-30%" width="120%" height="180%" color-interpolation-filters="sRGB">
      <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#0A0A0A" flood-opacity=".06"/>
      <feDropShadow dx="1" dy="3" stdDeviation="3" flood-color="#0A0A0A" flood-opacity=".04"/>
    </filter>
  </defs>
  <rect width="{width}" height="36" fill="#fff" rx="9" filter="url(#s)"/>
  <rect width="{width - 1}" height="35" x=".5" y=".5" stroke="#000" stroke-opacity=".08" rx="8.5"/>
  <image x="9" y="9" width="18" height="18" href="data:image/png;base64,{logo}"/>
  <path stroke="#000" stroke-opacity=".08" d="M35.5 1v34"/>
  <path fill="{INK}" d="{d}"/>
</svg>
'''
    open(out, 'w').write(svg)
    print(out, width)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
