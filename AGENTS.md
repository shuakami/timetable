# AGENTS.md

## UI 规范

原型 `src/App.tsx` 是唯一 UI 事实来源。生产壳 `src/app/RealApp.tsx` 必须与原型逐屏一致：布局、间距、字号、颜色、层级、状态呈现、交互与动画。原型里有的直接搬，不自创近似实现。

### 文案

- 客观、简短、商业软件级别。
- 禁止：教程式/第二人称句子、实现术语（入库、事务、三方合并等）、解释显而易见的下一步、免责安抚句、"可以怎么用"的说明。
- 页面标题用名词短语；副标题只在携带信息（学期、周次、门数）时出现。

### 交互

- 编辑、新增、导入、规则、冲突、变更一律全屏内页，禁止模态框套模态框。
- 主操作用底部大号实心主题色按钮（`PrimaryButton`）。
- 导入完成后回到课表，不停留在规则页。
- 本地解析不做进度条；同一屏不得出现多条进度指示。
- 返回必须回到上一页；系统返回键优先出栈，栈空回「今天」，再按退出。
- 长按课程：卡片抬起高亮，菜单出现在下方且不遮住它。
- 日历面板只能上下滚动，从底部滑入滑出，不做左右翻月/翻周。
- 「今天」不画圆圈圆点，只用主题色文字区分；日期条用圆角矩形高亮选中项。
- 内置规则不可编辑，不显示版本号、上次使用等实现信息。

### 动画

统一参数（`src/app/ui.tsx`）：

- 页面推入/退出：`tween`，`cubic-bezier(.25,1,.5,1)`，400ms，水平。
- 底栏指示器：`spring`，`bounce 0.2`，`duration 0.6`，共享 `layoutId`。
- 抽屉：`tween`，`cubic-bezier(.32,.72,0,1)`，300ms，仅 Y 轴。
- 遮罩：200ms 淡入淡出。
- Tab 切换只做淡入淡出。
- 禁止 stagger、弹力带式滚动、馅饼式弹出。

### 数据

生产界面只显示真实 Store 数据。禁止把原型假数据塞进生产。

### 安全

不做账号密码收集、不做教务系统登录抓取。导入只处理用户主动粘贴或选择的内容。

---

## 开发指南

### 目录速查

| 改什么 | 去哪 |
| --- | --- |
| 路由栈、Tab、导入流程、AI 转换页 | `src/app/RealApp.tsx` |
| 课程详情/编辑/冲突/变更/手动添加/搜索 | `src/app/pages.tsx` |
| 首次引导 | `src/app/Onboarding.tsx` |
| 公共组件、动效常量 | `src/app/ui.tsx` |
| 原生桥（对话框、Toast、返回键、小组件） | `src/app/native.ts`、`src/app/widgets.ts`、`android/.../WidgetBridge.java`、`MainActivity.java` |
| 周次/节次/冲突算法 | `src/domain/engine.ts`、`weeks.ts`、`dates.ts` |
| 导入解析、诊断、normalize | `src/domain/importer.ts`、`importers/*`、`rules.ts` |
| AI Prompt 文本 | `src/domain/ai-prompt.ts` |
| Store、持久化、导入合并 | `src/domain/store.ts`、`persistence/` |
| 桌面小组件 | `android/.../widget/`、`src/domain/widget-data.ts`、`tools/` |

### 环境

- Node 22，`npm ci`。
- JDK 21：`export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`。
- Android SDK：`android/local.properties` 写 `sdk.dir=...`，**不要提交**。
- Gradle 被限流时在 `~/.gradle/init.gradle` 加阿里云镜像。

### 验证

```bash
npx tsc --noEmit
npx vitest run
npm run build
npx cap sync android
cd android && ./gradlew assembleDebug
```

- `npm run build` 必须在 `cap sync` 之前。
- 不改测试来让测试通过。新增逻辑补 `src/domain/__tests__/` 用例。
- 不启动模拟器、不 `adb install`。

### 部署

```bash
npm run build && npx cap sync android
cd android && ./gradlew assembleDebug -q
cp app/build/outputs/apk/debug/app-debug.apk ../timetable-debug.apk
```

版本号在 `android/app/build.gradle`（`versionCode` / `versionName`）。

### 截图

README 用图走浏览器，不用模拟器：

1. `npm run build && npx vite preview --port 4173`
2. Chrome 打开 `http://localhost:4173/`，设备模拟 375×812（或用 `public/shots.html` 一次排多屏）。
3. 引导页定格：`?onboardStep=0|1|2&still=1`。
4. 多屏拼版：375×812 截图横向排列、`#EDEDEB` 底、圆角 40。
5. 小组件预览：`tools/gen_widget_previews.sh`。
6. 图标/开屏改动，出对比图；monochrome 层控制在 68dp 安全区内。

### 常见坑

- 原生对话框必须 `Theme.DeviceDefault.(Light.)Dialog.Alert`，AppCompat 会退回 AOSP 样式。
- 对话框要自己吃掉返回键，否则偶发退到桌面。
- 学期默认 10 节；导入课到 13 节时靠 `timeSlots` 或自动补足扩表，别改默认值。
- 引导页卸载要在内页退回同一帧，否则退场动画会闪。
- 颜色选择器是固定宽度横向滚动 + 两端渐变，不要改成撑满一行。
