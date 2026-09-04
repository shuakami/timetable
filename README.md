<div align="center">

<img src="public/icon.png" width="96" alt="嘎嘎课程表" />

# 嘎嘎课程表

**一款把「课表」做成真正日程工具的 Android 应用。**

今天 · 周视图 · 待办 · 冲突处理 · 变更记录 · 多源导入 · AI 转换 · 桌面小组件

React 18 · TypeScript · Vite · Tailwind v4 · Motion · Capacitor 8 · SQLite

</div>

---

## 截图

### 今天 / 周视图 / 课程详情

![今天、日历面板、周视图、课程详情](docs/screenshots/group1.png)

### 导入 / AI 转换 / 待办 / 我的

![导入课表、从链接添加、让 AI 生成规则、待办、我的](docs/screenshots/group5.png)

### 空状态 / 导入失败 / 时间冲突 / 变更记录

![还没有课表、导入失败、时间冲突、留哪一门、调课变更](docs/screenshots/group3.png)

### 学期边界 / 假期 / 考试周 / 编辑 / 手动添加

![超出学期、国庆假期、考试周、编辑课程、手动添加](docs/screenshots/group2.png)

### 通知 / 锁屏 / 桌面小组件

![锁屏通知、通知设置、桌面小组件、今天没有课](docs/screenshots/group4.png)

### 搜索 / 长按菜单

![搜索、长按课程菜单](docs/screenshots/group6.png)

---

## 功能

**今天**
- 按节次排布的当日时间线：已结束、上课中（剩余分钟）、下一节倒计时
- 明天预览、周六日/假期/学期外的独立空状态
- 底部日期条 + 从底部滑出的月历面板（学期周次对齐）

**课表**
- 周视图网格，正在上的课高亮，单双周、假期、考试周标注
- 时间重叠自动检测；「都保留 / 只留一门」决策，被隐藏的课可恢复
- 长按：静音本节 · 标记已上 · 请假一次 · 变更记录 · 编辑课程 · 本节停课

**课程**
- 详情页：下次上课、地点、老师、上课日、考核、提醒、学期进度、出勤、作业与备忘
- 编辑：生效范围「仅本次 / 每周」，状态、时间、地点、老师、备注、颜色
- 单节 Override 与常规规则分离，每次修改留一条变更记录，可撤销

**导入**
- 内置规则：JSON · Excel（xlsx）· 教务系统 HTML 网格 · ICS 日历 · CSV
- **让 AI 转换课表**：一键复制经过设计的 Prompt，把课表文字/截图交给任意 AI，粘贴 JSON 即可导入；兼容 ```json 代码块
- 解析 → 预览（新增 / 变化 / 无法解析 逐条列出）→ 导入；重复导入做三方合并，手动改过的字段不被覆盖
- JSON 带 `timeSlots` 时自动更新学期节次表；课程节次超出时自动补足

**待办**
- 作业 / 考试 / 自定义，可挂在课程上，按今天 · 近期 · 已完成分组

**通知与小组件**
- 上课前、作业截止前、变更即时推送；上课中静音
- 4 款桌面小组件：今日 · 下一节 · 两日 · 本周，跟随系统深浅色

**Android**
- 日期 / 时间 / 下拉选择走系统原生对话框（`Theme.DeviceDefault`，OPPO 上是 ColorOS 样式，Pixel 上是 Material You）
- Android 13+ 主题图标（monochrome）、自适应开屏、边到边 + 安全区
- 系统返回：先关菜单 / 面板 → 出栈 → 回到「今天」→ 两次返回退出

---

## 快速开始

```bash
# Node 22
npm ci
npm run dev            # http://localhost:5173，浏览器直接调试 Web 端
```

完整验证（提交前必须全绿）：

```bash
npx tsc --noEmit
npx vitest run
npm run build
```

Android debug 包：

```bash
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64   # JDK 21
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug
# → android/app/build/outputs/apk/debug/app-debug.apk
```

Gradle 下载慢时在 `~/.gradle/init.gradle` 加国内镜像；见 [AGENTS.md](AGENTS.md#部署与打包)。

---

## AI 转换课表

在「导入课表 → 让 AI 转换课表」或首次引导的「让 AI 转换」里复制 Prompt，连同课表（文字、截图或表格）发给任意 AI，拿到 JSON 后粘贴回应用。Prompt 全文见 [`src/domain/ai-prompt.ts`](src/domain/ai-prompt.ts)，输出格式：

```json
{
  "tableName": "2026 秋",
  "startDate": "2026-08-31",
  "totalWeeks": 20,
  "timeSlots": [{ "node": 1, "startTime": "08:00", "endTime": "08:40" }],
  "courses": [
    { "name": "高等数学", "day": 2, "startNode": 3, "step": 2, "weeks": [1, 2, 3], "teacher": "王立群", "location": "教三 302" }
  ]
}
```

---

## 项目结构

```
src/
  App.tsx                 原型（UI 唯一事实来源，勿删）
  app/
    RealApp.tsx           生产壳：路由栈、今天/课表/待办/我的、导入流程、AI 转换页
    pages.tsx             课程详情、编辑、冲突、变更、手动添加、搜索等内页
    Onboarding.tsx        首次引导
    ui.tsx                Page/TopBar/Row/PrimaryButton/Sheet、统一动效参数
    native.ts widgets.ts  Capacitor 桥：原生对话框、Toast、小组件数据
    notify.ts theme.ts    通知计划、主题
  domain/
    types.ts engine.ts    领域模型；周次/节次/Occurrence 展开与冲突检测
    store.ts              Store：导入预览/应用、Override、变更记录、持久化
    importer.ts rules.ts  规则运行器、JSON/CSV 解析、normalize
    importers/            html · xlsx · ics · url
    ai-prompt.ts          AI 转换 Prompt
    persistence/          SQLite（原生）/ localStorage 回退
    __tests__/            Vitest
android/
  app/src/main/java/app/timetable/
    MainActivity.java     返回键栈、边到边、状态栏
    WidgetBridge.java     原生日期/时间/列表对话框、Toast
    widget/               4 款 AppWidget
tools/                    小组件预览生成
docs/screenshots/         README 用图
```

---

## 数据与隐私

所有数据只存于本机（SQLite / localStorage）。不做账号密码收集，不做教务系统登录抓取；导入只处理用户主动粘贴或选择的内容。

## 许可

私有项目，保留所有权利。
