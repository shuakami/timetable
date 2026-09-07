#!/usr/bin/env python3
"""把「支持的学校」板块写进 site/index.html，样式写进 site/site.css。

数据：site/assets/schools/index.json（fetch_school_wordmarks.py 产出）+ src/domain/edu/schools.json（学校总数、系统）。
幂等：index.html / site.css 里都用 <!-- schools --> / /* schools */ 标记包住，重跑会替换。
板块 = 浅灰圆角格子，每格一枚学校官网的横版校标（校徽 + 校名字体），
png 是黑色 alpha 蒙版，页面里用 mask-image 上色，最后一格是「+N 所」。
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
schools = json.loads((ROOT / "src/domain/edu/schools.json").read_text())
logos = json.loads((SITE / "assets/schools/index.json").read_text())

total = len(schools)
# ---- 格子 ----
SHOW = len(logos)
MARK_H = 30  # 页面上校标高度 px，宽度按原图比例
MARK_W = 130  # 太宽的（校名字数多）整体缩小到这个宽度
cells = []
for l in logos:
    w = min(MARK_W, round(l["w"] * MARK_H / l["h"]))
    cells.append(
        f'<li><i class="mark" role="img" aria-label="{l["name"]}" '
        f'style="--mark:url(assets/schools/{l["file"]});width:{w}px"></i></li>'
    )
cells.append(f'<li class="more"><span>等 {total - SHOW} 所</span></li>')
grid = "\n".join("            " + c for c in cells)

html = f"""      <!-- schools -->
      <section class="schools" id="schools" aria-labelledby="schools-h">
        <header class="sec-head">
          <h2 id="schools-h">一登便知。</h2>
          <p class="lede">{total} 所高校全面支持。官方页面登录，你的账号与密码，始终只留在你的设备上。</p>
        </header>

        <ul class="grid" aria-label="支持的学校，节选">
{grid}
        </ul>
        <p class="credit">* 教务系统功能脚本鸣谢 <a href="https://github.com/baoozak/timetable" target="_blank" rel="noopener">baoozak/timetable</a> 项目。</p>
      </section>
      <!-- /schools -->
"""

css = """/* schools */
/* ============ 学校 ============ */
.schools .lede {
  margin-top: 18px;
}
.grid {
  margin-top: 56px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.grid li {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 104px;
  padding: 0 14px;
  border-radius: 14px;
  background: var(--paper-2);
  overflow: hidden;
}
.grid .mark {
  display: block;
  height: 30px;
  max-width: 100%;
  background: var(--ink-2);
  -webkit-mask: var(--mark) center / contain no-repeat;
  mask: var(--mark) center / contain no-repeat;
}
.grid .more {
  color: var(--ink-3);
  font-size: 15px;
  font-weight: 400;
}
.schools .credit {
  margin-top: 20px;
  font-size: 13px;
  color: var(--ink-3);
}
.schools .credit a {
  color: inherit;
  text-decoration: underline;
  text-underline-offset: 3px;
}
@media (max-width: 960px) {
  .grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
  }
  .grid li {
    height: 92px;
    padding: 0 14px;
  }
  .grid .mark {
    height: 26px;
  }
}
@media (max-width: 720px) {
  .grid {
    margin-top: 40px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .grid li {
    height: 72px;
    border-radius: 12px;
  }
  .grid .mark {
    height: 24px;
  }
  .grid li:nth-child(n + 12):not(.more) {
    display: none;
  }
}
/* /schools */
"""

idx = SITE / "index.html"
s = idx.read_text()
s = re.sub(r"      <!-- schools -->.*?<!-- /schools -->\n", "", s, flags=re.S)
anchor = "      <!-- ============ 学期 ============ -->"
assert anchor in s
s = s.replace(anchor, html + "\n" + anchor)
idx.write_text(s)

cp = SITE / "site.css"
c = cp.read_text()
c = re.sub(r"/\* schools \*/.*?/\* /schools \*/\n", "", c, flags=re.S)
marker = "/* ============ 学期 ============ */"
assert marker in c
c = c.replace(marker, css + "\n" + marker)
cp.write_text(c)

print("ok", total, len(logos))
