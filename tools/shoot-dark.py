from playwright.sync_api import sync_playwright

BASE = "http://localhost:4173/"
OUT = "site/assets/shots-dark"

PROTO = [
    "today", "today-cal", "week", "week-cal", "detail", "add", "link",
    "todo", "me", "lock", "notif", "widget", "widget2",
    "freeday", "nodata", "partialfail", "conflict", "conflict-pick",
    "change", "outofterm", "vacation", "examweek", "edit", "manualadd",
    "search", "longpress",
]

def settle(pg):
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(700)

with sync_playwright() as p:
    b = p.chromium.connect_over_cdp("http://127.0.0.1:9334")
    ctx = b.new_context(viewport={"width": 375, "height": 812}, device_scale_factor=2, color_scheme="dark")
    pg = ctx.new_page()

    for k in PROTO:
        pg.goto(f"{BASE}?proto&s={k}&theme=dark", wait_until="networkidle")
        settle(pg)
        pg.screenshot(path=f"{OUT}/{k}.png")
        print(f"ok {k}")

    for i in range(3):
        pg.goto(f"{BASE}?onboardStep={i}&still=1&theme=dark", wait_until="networkidle")
        settle(pg)
        pg.screenshot(path=f"{OUT}/onboard-{i}.png")
        print(f"ok onboard-{i}")

    pg.goto(f"{BASE}?theme=dark", wait_until="networkidle")
    pg.wait_for_timeout(1500)
    pg.get_by_text("开始", exact=True).first.click(); pg.wait_for_timeout(600)
    pg.get_by_text("继续", exact=True).first.click(); pg.wait_for_timeout(600)
    pg.get_by_text("让 AI 转换").first.click(); pg.wait_for_timeout(900)
    settle(pg)
    pg.screenshot(path=f"{OUT}/airule.png")
    print("ok airule")

    ctx.close()
