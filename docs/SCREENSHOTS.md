# 首页截图流程（site/assets/shots、widgets）

所有手机截图均为 375×812 @2x（750×1624 PNG），从网页版直接截图，不用模拟器、不裁拼图。

## 准备

```bash
cd timetable
npm ci
npm run build
npx vite preview --port 4173        # 保持运行
pip install playwright               # 已有 Chrome 即可，不必 playwright install
```

Chrome 需带远程调试端口启动（或复用已开的浏览器）：

```bash
google-chrome --remote-debugging-port=9334 about:blank
```

## 三类来源

| 图 | URL | 说明 |
| --- | --- | --- |
| 原型单屏（today、week、lock、conflict 等 26 张） | `http://localhost:4173/?proto&s=<key>` | key 见 `src/App.tsx` 底部 `screens` 数组 |
| 引导页 onboard-0/1/2 | `http://localhost:4173/?onboardStep=0|1|2&still=1` | `still=1` 关闭动画定格 |
| AI 转换页 airule | `http://localhost:4173/` | 真实 app：点「开始」→「继续」→「让 AI 转换」，再截图（原型的 airule 屏带底栏，不要用） |

深色：真实 app 页面加 `&theme=dark` 即可；原型屏是写死浅色的，不支持。

## 脚本

```python
from playwright.sync_api import sync_playwright

BASE = "http://localhost:4173/"
OUT = "site/assets/shots"

def settle(pg):
    pg.evaluate("document.fonts.ready")   # 关键：等字体加载完，否则粗体文字丢失
    pg.wait_for_timeout(700)

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://localhost:9334")
    ctx = b.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2)
    pg = ctx.new_page()

    for k in ["today", "week", "lock", "conflict"]:          # 其余 key 同理
        pg.goto(f"{BASE}?proto&s={k}", wait_until="networkidle")
        settle(pg)
        pg.screenshot(path=f"{OUT}/{k}.png")

    for i in range(3):
        pg.goto(f"{BASE}?onboardStep={i}&still=1", wait_until="networkidle")
        settle(pg)
        pg.screenshot(path=f"{OUT}/onboard-{i}.png")

    pg.goto(BASE, wait_until="networkidle")
    pg.wait_for_timeout(1500)
    pg.get_by_text("开始", exact=True).first.click();   pg.wait_for_timeout(600)
    pg.get_by_text("继续", exact=True).first.click();   pg.wait_for_timeout(600)
    pg.get_by_text("让 AI 转换").first.click();          pg.wait_for_timeout(900)
    settle(pg)
    pg.screenshot(path=f"{OUT}/airule.png")
```

## 小组件预览（site/assets/widgets）

直接复制 Android 工程里的原生预览图，不重画：

```bash
cp android/app/src/main/res/drawable-nodpi/widget_preview_today.png    site/assets/widgets/today.png
cp android/app/src/main/res/drawable-nodpi/widget_preview_next.png     site/assets/widgets/next.png
cp android/app/src/main/res/drawable-nodpi/widget_preview_two_days.png site/assets/widgets/two_days.png
cp android/app/src/main/res/drawable-nodpi/widget_preview_week.png     site/assets/widgets/week.png
```

这些图由 `tools/gen_widget_previews.sh` 生成（headless Chrome 3x 截 `tools/widget_previews.html`）。

## 其他素材

- `site/assets/icon.png` ← `public/icon.png`（512×512）
- `site/assets/mascot.png` ← `public/mascot.png`
- `site/assets/favicon-{32,180,512}.png`：icon.png 用 PIL 缩放并套圆形 alpha 蒙版。

## 检查首页

```bash
cd site && python3 -m http.server 8787
google-chrome --headless --hide-scrollbars --window-size=1440,9000 --virtual-time-budget=12000 \
  --screenshot=/tmp/full.png http://localhost:8787/
```
